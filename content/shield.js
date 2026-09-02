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
      enabled: true,
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

  // ---- shared/storage.js ------------------------------------------------
  const todayKey = () => new Date().toISOString().slice(0, 10);

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
      if (!category.pattern.test(text)) continue;
      if (category.excludePattern && category.excludePattern.test(text)) continue;
      return category.id;
    }
    return null;
  }

  // ---- content/ai-classifier.js ------------------------------------------
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

    async classify(text, categories) {
      if (categories.length === 0 || !text) return null;
      const session = await this.ensureSession();

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

      const run = this.queue.then(() => session.prompt(prompt, { responseConstraint }));
      this.queue = run.catch(() => {});
      const raw = await run;

      try {
        const parsed = JSON.parse(raw);
        return parsed.category && parsed.category !== "none" ? parsed.category : null;
      } catch {
        return null;
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

  const GENERIC = {
    name: "generic",
    selector: "h1, h2, h3, [role='heading']",
    getText(el) {
      return textOf(el);
    },
  };

  function adapterForHost(host) {
    return ADAPTERS.find((a) => a.test(host)) || GENERIC;
  }

  // ---- content/dom-scanner.js ---------------------------------------------
  const MIN_TEXT_LENGTH = 12;

  function startScanning({ adapter, onCandidate }) {
    const processed = new WeakSet();

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          const text = adapter.getText(entry.target);
          if (text.length >= MIN_TEXT_LENGTH) onCandidate(entry.target, text);
        }
      },
      { rootMargin: "200px" }
    );

    function scan(root = document) {
      const nodes = root.querySelectorAll(adapter.selector);
      for (const el of nodes) {
        if (processed.has(el)) continue;
        if (el.closest(".aurashield-wrap")) continue;
        processed.add(el);
        io.observe(el);
      }
    }

    let debounceHandle = null;
    const mo = new MutationObserver(() => {
      clearTimeout(debounceHandle);
      debounceHandle = setTimeout(() => scan(), 150);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    scan();
    const interval = setInterval(() => scan(), 2500);

    return () => {
      mo.disconnect();
      io.disconnect();
      clearInterval(interval);
    };
  }

  // ---- content/shield-ui.js ------------------------------------------------
  function shieldElement(el, { category, label, intensity, source }) {
    if (el.dataset.aurashield === "1") return;
    el.dataset.aurashield = "1";

    const wrap = document.createElement("div");
    wrap.className = `aurashield-wrap aurashield-${intensity}`;
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);

    const overlay = document.createElement("div");
    overlay.className = "aurashield-overlay";
    overlay.setAttribute("role", "button");
    overlay.setAttribute("tabindex", "0");
    overlay.setAttribute("aria-label", `Shielded for ${label}. Activate to view the original content.`);

    const icon = document.createElement("span");
    icon.className = "aurashield-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "\u{1F6E1}";

    const text = document.createElement("span");
    text.className = "aurashield-label";
    text.textContent = `Shielded · ${label}`;

    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.className = "aurashield-reveal";
    reveal.textContent = "View anyway";

    overlay.append(icon, text, reveal);
    wrap.appendChild(overlay);

    const doReveal = (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrap.classList.add("aurashield-revealed");
    };
    reveal.addEventListener("click", doReveal);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") doReveal(e);
    });

    chrome.runtime.sendMessage({ type: "SHIELD_INCREMENT", category, source }).catch(() => {});
  }

  // ---- entry point -----------------------------------------------------
  function mergeCategories(settings) {
    return [...settings.categories, ...settings.customCategories];
  }

  function isActiveOnThisSite(settings) {
    return settings.enabled && !settings.disabledSites.includes(location.hostname);
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

    onSettingsChanged(async () => {
      const fresh = await getSettings();
      categories = mergeCategories(fresh);
      compiled = compileCategories(categories);
      enabledCategories = categories.filter((c) => c.enabled);
      categoryById = new Map(categories.map((c) => [c.id, c]));
      enabled = isActiveOnThisSite(fresh);
    });

    const adapter = adapterForHost(location.hostname);

    async function handleCandidate(el, text) {
      if (!enabled) return;

      let matchId = matchKeywords(text, compiled);
      let source = "keyword";

      // Keyword matches resolve synchronously - nothing to hide in the
      // meantime. AI classification takes real inference time, though, and
      // without a placeholder the content sits fully readable for that
      // whole window - exactly the case the AI stage exists for. Dim it the
      // instant a candidate is found, before we even know if it'll match.
      if (!matchId && classifier && enabledCategories.length > 0) {
        el.classList.add("aurashield-checking");
        try {
          matchId = await classifier.classify(text, enabledCategories);
          source = "ai";
        } catch {
          matchId = null;
        }
        el.classList.remove("aurashield-checking");
      }

      if (!matchId) return;
      const category = categoryById.get(matchId);
      if (!category) return;

      shieldElement(el, {
        category: category.id,
        label: category.label,
        intensity: category.intensity || "balanced",
        source,
      });
    }

    startScanning({ adapter, onCandidate: handleCandidate });
  }

  main().catch((err) => console.error("[AuraShield]", err));
})();
