// Content scripts declared in the static manifest content_scripts array
// cannot use ES module import/export (there is no "type": "module" key for
// that entry - only background.type supports it). Everything this content
// script needs is inlined below as one plain, classic script.
(function () {
  "use strict";

  // ---- shared/categories.js -------------------------------------------
  const BUILTIN_CATEGORIES = [
    {
      id: "doomscrolling-news",
      label: "Doomscrolling news",
      aiHint: "breaking-news alarmism, war, disasters, tragedy, mass casualty events",
      keywords: [
        "breaking news", "war", "disaster", "tragedy", "killed", "dead", "death toll",
        "crisis", "catastrophe", "explosion", "attack", "shooting", "casualties",
        "emergency", "evacuate", "collapse", "wildfire", "earthquake", "flood",
        "deported", "deportation", "hurricane", "tornado", "pandemic", "mass shooting",
      ],
      // High-traffic entertainment titles that would otherwise false-positive
      // on the plain keywords above ("war" matches "Star Wars" via the s?
      // plural rule, "attack"/"shooting" match anime and photography posts).
      excludeKeywords: ["star wars", "attack on titan", "shooting star", "shooting hoops"],
      enabled: true,
      intensity: "balanced",
      builtin: true,
    },
    {
      id: "politics",
      label: "Politics & divisive content",
      aiHint: "electoral politics, partisan debate, political scandal",
      keywords: [
        "election", "senator", "senate", "congress", "republican", "democrat", "politician",
        "partisan", "president", "governor", "campaign trail", "impeach", "midterm",
        "white house", "supreme court", "gop",
      ],
      enabled: true,
      intensity: "balanced",
      builtin: true,
    },
    {
      id: "health-anxiety",
      label: "Health-anxiety spirals",
      aiHint: "symptom-checking content, medical scare stories, disease-risk alarmism",
      keywords: [
        "symptom", "diagnosis", "tumor", "cancer risk", "disease outbreak",
        "you might have", "warning signs of", "could be a sign of", "rare disease",
      ],
      // Off by default: this category's own keywords ("symptom", "diagnosis")
      // are exactly the headings on a patient portal or a medical reference
      // page someone navigated to on purpose. Shielding health information by
      // default, on a health-themed product, is the wrong default even
      // though the category itself is legitimate for someone who wants it.
      enabled: false,
      intensity: "gentle",
      builtin: true,
    },
    {
      id: "body-image",
      label: "Body image & diet culture",
      aiHint: "weight loss content, diet culture, restrictive-eating and body-comparison content",
      keywords: [
        "weight loss", "calorie deficit", "diet plan", "before and after", "thinspo",
        "body fat percentage", "six pack", "shred fat", "cheat day",
      ],
      enabled: false,
      intensity: "balanced",
      builtin: true,
    },
    {
      id: "violence",
      label: "Violence & gore",
      aiHint: "graphic violence, gore, brutal or disturbing imagery described in text",
      keywords: ["graphic content", "gore", "brutal attack", "mutilated", "gruesome", "stabbed"],
      enabled: false,
      intensity: "strict",
      builtin: true,
    },
    {
      id: "spoilers",
      label: "Spoilers",
      aiHint: "plot spoilers for movies, TV shows, books, or sports results",
      keywords: [
        "spoiler", "series finale", "season finale", "plot twist", "ending explained",
        "dies in the finale", "final score",
      ],
      enabled: false,
      intensity: "strict",
      builtin: true,
    },
    {
      id: "substance-use",
      label: "Substance-use triggers",
      aiHint: "content about drug or alcohol use, relapse, or addiction that could trigger someone in recovery",
      keywords: ["relapse", "overdose", "getting high", "drug use", "addiction story", "bender"],
      enabled: false,
      intensity: "balanced",
      builtin: true,
    },
  ];

  // Crisis and harm-reduction resources are never shielded, regardless of
  // what the user has enabled - a wellbeing filter must not be capable of
  // hiding the help someone is actively looking for. This list is
  // deliberately not user-configurable.
  const NEVER_SHIELD_HOSTS = [
    "988lifeline.org",
    "crisistextline.org",
    "findtreatment.gov",
    "samhsa.gov",
    "thetrevorproject.org",
    "translifeline.org",
    "poisoncontrol.org",
  ];

  function isNeverShieldHost(host) {
    return NEVER_SHIELD_HOSTS.some((safe) => host === safe || host.endsWith("." + safe));
  }

  // ---- shared/storage.js ------------------------------------------------
  // Local date, not UTC - toISOString().slice(0,10) rolls the "day" over at
  // UTC midnight, which is 8pm Eastern. Every "today" claim in the UI was
  // wrong for most of the world for most of the day.
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    categories: BUILTIN_CATEGORIES,
    customCategories: [],
    disabledSites: [],
    stats: { date: todayKey(), count: 0 },
  };

  // chrome.storage.local persists whatever was written on first install
  // forever - a code change to a builtin category's keywords/label/aiHint
  // would otherwise be silently shadowed by the stale stored copy. Builtin
  // category *content* always comes from the current code; only the user's
  // own enabled/intensity choices are read back from storage.
  function reconcileCategories(storedCategories, currentDefs) {
    const stored = storedCategories || [];
    return currentDefs.map((def) => {
      const existing = stored.find((c) => c.id === def.id);
      return existing ? { ...def, enabled: existing.enabled, intensity: existing.intensity } : def;
    });
  }

  async function getSettings() {
    const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
    stored.categories = reconcileCategories(stored.categories, BUILTIN_CATEGORIES);
    if (stored.stats?.date !== todayKey()) {
      stored.stats = { date: todayKey(), count: 0 };
      await chrome.storage.local.set({ stats: stored.stats });
    }
    return stored;
  }

  function onSettingsChanged(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local") callback(changes);
    });
  }

  // ---- content/keyword-filter.js ----------------------------------------
  function buildPattern(keywords) {
    const escaped = keywords
      .filter(Boolean)
      .map((k) => k.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .filter((k) => k.length > 0);
    if (escaped.length === 0) return null;
    // Trailing "s?" absorbs simple plurals ("Republicans", "Democrats") without
    // needing every keyword entered twice.
    return new RegExp(`(?:^|\\b)(?:${escaped.join("|")})s?(?:\\b|$)`, "i");
  }

  function compileCategories(categories) {
    return categories
      .filter((c) => c.enabled)
      .map((c) => ({
        ...c,
        pattern: buildPattern(c.keywords || []),
        excludePattern: buildPattern(c.excludeKeywords || []),
      }))
      .filter((c) => c.pattern);
  }

  // Sigma-style detection: match on keywords, but suppress the match if an
  // exclude term is also present. This is deliberately hardcoded ahead of
  // the AI stage - every case an exclusion rule correctly rules out here
  // never has to wait on a Gemini Nano round-trip at all. Cheap to write,
  // and it directly targets known false-positive phrases (e.g. "war"
  // matching "Star Wars") rather than trying to make the AI stage smarter.
  function matchKeywords(text, compiledCategories) {
    if (!text) return null;
    for (const category of compiledCategories) {
      // No "g" flag on these patterns, so exec() is a stateless single-match
      // check here, not a stateful iterator - safe to call repeatedly.
      const match = category.pattern.exec(text);
      if (!match) continue;
      if (category.excludePattern && category.excludePattern.test(text)) continue;
      return { categoryId: category.id, matchedKeyword: match[0] };
    }
    return null;
  }

  // ---- content/ai-classifier.js ------------------------------------------
  const MAX_PENDING_CLASSIFICATIONS = 6;
  const SESSION_RESET_AFTER = 20;

  async function checkAvailability() {
    if (typeof LanguageModel === "undefined") return "unsupported";
    try {
      return await LanguageModel.availability();
    } catch {
      return "unsupported";
    }
  }

  class AIClassifier {
    constructor() {
      this.session = null;
      this.queue = Promise.resolve();
      this.pending = 0;
      this.callCount = 0;
    }

    async ensureSession() {
      if (this.session) return this.session;
      this.session = await LanguageModel.create({
        initialPrompts: [
          {
            role: "system",
            content:
              "You classify short snippets of text pulled from a web page into at most one topic " +
              "category from a fixed list, for a personal content filter the reader controls themselves. " +
              "Only choose a category if the snippet is clearly about that topic. Prefer \"none\" when unsure.",
          },
        ],
      });
      return this.session;
    }

    // session.prompt() accumulates conversation history on every call, with
    // no way to clear it short of a new session - left unchecked, that both
    // biases later classifications toward earlier ones and eventually
    // exhausts the model's input quota. Recycling the session periodically
    // (and immediately on any prompt failure) bounds both problems, at the
    // cost of one extra session-creation round-trip every N calls.
    async resetSession() {
      const old = this.session;
      this.session = null;
      this.callCount = 0;
      try {
        old?.destroy?.();
      } catch {
        // best-effort cleanup only
      }
    }

    destroy() {
      try {
        this.session?.destroy?.();
      } catch {
        // best-effort cleanup only
      }
      this.session = null;
    }

    async classify(text, categories) {
      if (categories.length === 0 || !text) return null;
      // A serial on-device queue can't keep up with a fast-scrolling feed
      // that surfaces dozens of candidates at once - rather than let the
      // backlog (and the "checking" dim over stale off-screen content) grow
      // unboundedly, new work is dropped once too much is already queued.
      // The keyword stage still runs regardless, so this never fully
      // disables filtering, just the AI layer under heavy load.
      if (this.pending >= MAX_PENDING_CLASSIFICATIONS) return null;

      this.pending++;
      try {
        const ids = categories.map((c) => c.id);
        const catalogue = categories.map((c) => `- ${c.id}: ${c.aiHint || c.label}`).join("\n");
        const prompt =
          `Categories:\n${catalogue}\n\n` +
          `Snippet: "${text.slice(0, 300)}"\n\n` +
          `Which category best matches the snippet's topic? Use "none" if it doesn't clearly match any.`;

        const responseConstraint = {
          type: "object",
          properties: { category: { type: "string", enum: [...ids, "none"] } },
          required: ["category"],
        };

        // ensureSession() is called from *inside* the queued callback, not
        // before joining the queue - concurrent classify() calls therefore
        // can't each see a null session and each start their own
        // LanguageModel.create(), which is what happens if session creation
        // is awaited ahead of the serialization point.
        const run = this.queue.then(async () => {
          const session = await this.ensureSession();
          try {
            const raw = await session.prompt(prompt, { responseConstraint });
            this.callCount++;
            if (this.callCount >= SESSION_RESET_AFTER) await this.resetSession();
            return raw;
          } catch (err) {
            await this.resetSession();
            throw err;
          }
        });
        this.queue = run.catch(() => {});

        // Deliberately outside any try/catch here: a genuine prompt failure
        // should propagate to the caller, not be swallowed. Only malformed
        // (but successfully returned) model output is treated as "no match"
        // below - that's a data problem, not an error.
        const raw = await run;
        try {
          const parsed = JSON.parse(raw);
          return parsed.category && parsed.category !== "none" ? parsed.category : null;
        } catch {
          return null;
        }
      } finally {
        this.pending--;
      }
    }
  }

  // ---- content/site-adapters.js ------------------------------------------
  function textOf(el) {
    return (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 300);
  }

  const ADAPTERS = [
    {
      // X's current frontend carries no data-testid or lang markers on tweet
      // text (verified live - it's a Tailwind-class-based rebuild with none
      // of the old React Testing Library hooks), so this falls back to the
      // whole <article>. That pulls in the handle/timestamp/like-counts as
      // minor noise ahead of the real tweet text, which textOf's 300-char
      // cap tolerates fine.
      name: "twitter",
      test: (host) => host === "twitter.com" || host === "x.com" || host.endsWith(".x.com"),
      selector: "article",
      getText(el) {
        return textOf(el);
      },
    },
    {
      name: "reddit-new",
      test: (host) => host.endsWith("reddit.com") && host !== "old.reddit.com",
      selector: "shreddit-post",
      getText(el) {
        return (el.getAttribute("post-title") || textOf(el)).trim();
      },
    },
    {
      name: "reddit-old",
      test: (host) => host === "old.reddit.com",
      selector: ".thing .title a.title",
      getText(el) {
        return textOf(el);
      },
    },
    {
      // YouTube's DOM has no #video-title element anymore (verified live -
      // the old id is gone). The wrapper custom elements survived though,
      // and each still carries exactly one aria-labeled anchor holding the
      // clean title text, which is far more stable than chasing internal
      // class names.
      name: "youtube",
      test: (host) => host.endsWith("youtube.com"),
      selector: "ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer",
      getText(el) {
        const labeled = el.querySelector("a[aria-label]");
        return (labeled?.getAttribute("aria-label") || textOf(el)).trim();
      },
    },
    {
      // Google News has no <article> elements at all (verified live) and
      // hashes its CSS class names on every deploy, so this keys off
      // data-n-tid instead - a stable-looking data attribute Google's own
      // JS relies on, attached directly to each clean headline link.
      name: "google-news",
      test: (host) => host === "news.google.com",
      selector: "a[data-n-tid]",
      getText(el) {
        return textOf(el);
      },
    },
  ];

  // The generic fallback runs on every http/https page with no dedicated
  // adapter - i.e. most of the web. It is deliberately keyword-only
  // (aiEligible: false): letting every heading on an arbitrary page queue
  // into the serial AI pipeline is how a 60-heading docs page ends up
  // wholesale-blurred for the duration of 60 sequential on-device
  // inferences. It's also scoped to headings inside main/article, not the
  // whole document, to avoid nav bars, sidebar widgets, and modal titles.
  const GENERIC = {
    name: "generic",
    selector: "main h1, main h2, main h3, article h1, article h2, article h3",
    aiEligible: false,
    getText(el) {
      return textOf(el);
    },
  };

  function adapterForHost(host) {
    return ADAPTERS.find((a) => a.test(host)) || GENERIC;
  }

  // ---- content/shield-ui.js ------------------------------------------------
  let labelIdCounter = 0;

  function shieldElement(el, { category, label, intensity, source, matchedKeyword }) {
    // The element can be removed from the DOM between being queued (e.g. for
    // AI classification) and this call resolving - most commonly on a fast
    // infinite-scroll feed. insertBefore on a detached node throws, and
    // without this guard the dataset flag below would already be set,
    // permanently marking the node as "shielded" with no wrap ever created.
    if (!el.isConnected || !el.parentNode) return;
    if (el.dataset.aurashield === "1") return;
    el.dataset.aurashield = "1";

    const wrap = document.createElement("div");
    wrap.className = `aurashield-wrap aurashield-${intensity}`;
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);

    // Gentle intensity is deliberately the lightest touch: it doesn't block
    // pointer interaction with the underlying content either, so hiding it
    // from assistive tech while leaving it mouse-clickable would be a worse
    // inconsistency than leaving it in the accessibility tree. Balanced and
    // Strict both already remove interactivity for sighted users (via
    // pointer-events/display:none) - inert and aria-hidden bring the
    // non-visual experience to the same place.
    if (intensity !== "gentle") {
      el.setAttribute("aria-hidden", "true");
      el.setAttribute("inert", "");
    }

    const overlay = document.createElement("div");
    overlay.className = "aurashield-overlay";

    const icon = document.createElement("span");
    icon.className = "aurashield-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "\u{1F6E1}";

    const text = document.createElement("span");
    text.className = "aurashield-label";
    text.id = `aurashield-label-${++labelIdCounter}`;
    text.textContent = `Shielded · ${label}`;
    // Real text content of the same span the reveal button's
    // aria-describedby points to - so this reaches screen-reader users too,
    // not just sighted ones. Deliberately not shown for AI-sourced matches,
    // which have no single term to point to.
    if (matchedKeyword) {
      const hint = document.createElement("span");
      hint.className = "aurashield-match-hint";
      hint.textContent = ` — matched "${matchedKeyword}"`;
      text.appendChild(hint);
    }

    // A single real <button> is the only interactive control here - the
    // overlay itself is a plain div, not a second, invalidly-nested
    // "role=button" wrapper around it. aria-describedby links the button to
    // the category label so a screen reader announces which category
    // triggered the shield, not just "View anyway".
    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.className = "aurashield-reveal";
    reveal.textContent = "View anyway";
    reveal.setAttribute("aria-describedby", text.id);

    overlay.append(icon, text, reveal);
    wrap.appendChild(overlay);

    // Identifies this specific shield event so a later reveal can be
    // matched back to it in the history log (see shared/insights.js) -
    // never anything derived from the shielded text itself.
    const eventId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let revealSent = false;

    const doReveal = (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrap.classList.add("aurashield-revealed");
      el.removeAttribute("aria-hidden");
      el.removeAttribute("inert");
      // Move focus into the now-visible content instead of letting it fall
      // back to <body> with no indication the reveal worked.
      el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });

      if (!revealSent) {
        revealSent = true;
        chrome.runtime.sendMessage({ type: "SHIELD_REVEALED", id: eventId }).catch(() => {});
      }
    };
    reveal.addEventListener("click", doReveal);
    // A click anywhere on the card (not just the button) also reveals - the
    // button's own listener calls stopPropagation, so this never double-fires.
    overlay.addEventListener("click", doReveal);

    chrome.runtime
      .sendMessage({
        type: "SHIELD_INCREMENT",
        id: eventId,
        category,
        source,
        hostname: location.hostname,
        ts: Date.now(),
      })
      .catch(() => {});
  }

  // Restores an element to its pre-shield state: unwraps it, clears every
  // attribute shieldElement may have set, and leaves it ready to be
  // evaluated fresh. Used both when a recycled DOM node is found holding
  // different content than it was shielded for, and when a settings change
  // means every existing shield needs to be re-derived from scratch.
  function unwrapShield(wrap, el) {
    wrap.replaceWith(el);
    delete el.dataset.aurashield;
    el.removeAttribute("aria-hidden");
    el.removeAttribute("inert");
    el.removeAttribute("tabindex");
  }

  // ---- content/dom-scanner.js ---------------------------------------------
  const MIN_TEXT_LENGTH = 8;

  function startScanning({ adapter, onCandidate }) {
    // Maps an element to the text it was last evaluated against - not just
    // a seen/unseen flag - so a re-check can tell whether a recycled DOM
    // node (virtualized feeds on X/YouTube reuse nodes for new content) now
    // holds something different from what it was judged on.
    let seen = new WeakMap();
    const inFlight = new WeakSet();

    function evaluate(el) {
      const text = adapter.getText(el);
      if (text.length < MIN_TEXT_LENGTH) return;
      if (seen.get(el) === text) return;
      seen.set(el, text);
      Promise.resolve(onCandidate(el, text)).catch((err) => {
        console.error("[AuraShield] candidate handling failed", err);
      });
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          inFlight.delete(entry.target);
          evaluate(entry.target);
        }
      },
      // Generous lookahead: the AI stage takes real inference time, and a
      // margin sized for the keyword stage's instant matches gives it no
      // useful lead time on a normally-paced scroll.
      { rootMargin: "600px" }
    );

    function discoverNew() {
      for (const el of document.querySelectorAll(adapter.selector)) {
        if (el.closest(".aurashield-wrap")) continue;
        if (seen.has(el) || inFlight.has(el)) continue;
        inFlight.add(el);
        io.observe(el);
      }
    }

    // Re-checking is real DOM/layout work, so it only ever runs on the slow
    // interval below, never on every mutation.
    function recheckForRecycledContent() {
      for (const wrap of document.querySelectorAll(".aurashield-wrap")) {
        const el = wrap.querySelector(":scope > *:not(.aurashield-overlay)");
        if (!el) continue;
        const text = adapter.getText(el);
        if (seen.get(el) === text) continue;
        // The framework reused this element for different content than it
        // was shielded for - drop the stale shield and let the new content
        // get a fresh evaluation, rather than leaving an old "Shielded ·
        // X" card sitting over unrelated text.
        unwrapShield(wrap, el);
        seen.delete(el);
        evaluate(el);
      }
      for (const el of document.querySelectorAll(adapter.selector)) {
        if (el.closest(".aurashield-wrap") || inFlight.has(el)) continue;
        if (seen.has(el)) evaluate(el);
      }
    }

    let debounceHandle = null;
    const mo = new MutationObserver(() => {
      clearTimeout(debounceHandle);
      debounceHandle = setTimeout(discoverNew, 150);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    discoverNew();
    const interval = setInterval(() => {
      discoverNew();
      recheckForRecycledContent();
    }, 2500);

    return {
      // A settings change (a category toggled, intensity changed, site
      // paused) can't just recompute which categories are active - every
      // existing shield needs to be re-derived under the new settings, or
      // toggling a category off does nothing visible until reload.
      rescan() {
        for (const wrap of document.querySelectorAll(".aurashield-wrap")) {
          const el = wrap.querySelector(":scope > *:not(.aurashield-overlay)");
          if (el) unwrapShield(wrap, el);
          else wrap.remove();
        }
        seen = new WeakMap();
        discoverNew();
      },
      stop() {
        mo.disconnect();
        io.disconnect();
        clearInterval(interval);
      },
    };
  }

  // ---- entry point -----------------------------------------------------
  function mergeCategories(settings) {
    return [...settings.categories, ...settings.customCategories];
  }

  function isActiveOnThisSite(settings) {
    return (
      settings.enabled &&
      !settings.disabledSites.includes(location.hostname) &&
      !isNeverShieldHost(location.hostname)
    );
  }

  async function main() {
    let settings = await getSettings();
    let categories = mergeCategories(settings);
    let compiled = compileCategories(categories);
    let enabledCategories = categories.filter((c) => c.enabled);
    let categoryById = new Map(categories.map((c) => [c.id, c]));
    let enabled = isActiveOnThisSite(settings);

    const aiAvailability = await checkAvailability();
    const classifier = aiAvailability === "available" ? new AIClassifier() : null;

    const adapter = adapterForHost(location.hostname);

    async function handleCandidate(el, text) {
      if (!enabled) return;

      let match = matchKeywords(text, compiled);
      let source = "keyword";

      // Keyword matches resolve synchronously - nothing to hide in the
      // meantime. AI classification takes real inference time, though, and
      // without a placeholder the content sits fully readable for that
      // whole window - exactly the case the AI stage exists for. Dim it the
      // instant a candidate is found, before we even know if it'll match.
      // The generic adapter never reaches this branch (aiEligible: false),
      // so an arbitrary page's headings are never queued for inference.
      if (!match && classifier && enabledCategories.length > 0 && adapter.aiEligible !== false) {
        el.classList.add("aurashield-checking");
        try {
          const categoryId = await classifier.classify(text, enabledCategories);
          match = categoryId ? { categoryId, matchedKeyword: null } : null;
          source = "ai";
        } catch {
          match = null;
        }
        el.classList.remove("aurashield-checking");
      }

      if (!match) return;
      const category = categoryById.get(match.categoryId);
      if (!category) return;

      shieldElement(el, {
        category: category.id,
        label: category.label,
        intensity: category.intensity || "balanced",
        source,
        matchedKeyword: match.matchedKeyword,
      });
    }

    const scanner = startScanning({ adapter, onCandidate: handleCandidate });

    // Keep local state in sync if the user changes settings in the
    // popup/options page while this tab stays open, and make the change
    // visible immediately rather than only on the next reload.
    onSettingsChanged(async () => {
      const fresh = await getSettings();
      categories = mergeCategories(fresh);
      compiled = compileCategories(categories);
      enabledCategories = categories.filter((c) => c.enabled);
      categoryById = new Map(categories.map((c) => [c.id, c]));
      enabled = isActiveOnThisSite(fresh);
      scanner.rescan();
    });

    window.addEventListener("pagehide", () => classifier?.destroy());
  }

  main().catch((err) => console.error("[AuraShield]", err));
})();
