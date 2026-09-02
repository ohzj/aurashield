<img src="icons/icon128.png" width="64" height="64" alt="AuraShield icon" />

# AuraShield

A personal, reversible filter for the web. Tell it what wears you down —
doomscrolling news, health-anxiety spirals, spoilers, whatever's yours — and
it blurs or hides matching content wherever you browse, with a one-click
"view anyway" always available. It's a dial you control, not a wall someone
else built for you.

Built for [Hack for Humanity | Summer 2026](https://hack-for-humanity-summer-26.devpost.com/)
— theme: *AI for Mental/Physical Health*.

## Why this exists

31% of US adults regularly doomscroll — for Gen Z it's over half — and a
third say it's actively wrecking their sleep (American Academy of Sleep
Medicine, Feb 2026). News avoidance just hit a joint-record 40% across 48
countries (Reuters Institute, 2025). People already want less of this, but
the tools available are all-or-nothing: block a whole site, mute a whole
topic, or don't browse at all. Research on "structured exposure" suggests
the healthier shape for this problem is a dial, not a wall — and that's the
whole design thesis here, not a marketing line: every choice below traces
back to reversibility and user authorship, because that's what makes this a
wellbeing tool instead of a censor.

## How it works

Two-stage filtering pipeline, entirely on-device — no page content is ever
sent off your machine:

1. **Keyword match** — instant, always-on safety net. Keywords support
   Sigma-style exclusion rules (`excludeKeywords`) so obvious false
   positives — "war" matching "Star Wars", "attack" matching "Attack on
   Titan" — get suppressed by a cheap rule instead of ever reaching the AI
   stage. When a keyword is what triggered a shield, the card tells you
   which one — the "why", not just the "what".
2. **Gemini Nano classification** — Chrome's built-in on-device Prompt API
   scores visible content against your active categories for topics keywords
   alone would miss. While a candidate is waiting on this stage, it gets a
   brief neutral dim (not the full shield treatment) so nothing sits fully
   readable during the classification window.

Matches get one of three treatments, set per category:

| Level | Treatment | Still reversible how |
|---|---|---|
| Gentle | Light blur, stays interactive, clears on hover/focus | Already peeking through |
| Balanced (default) | Full blur + "view anyway" button | One click reveals in place |
| Strict | Fully hidden | Collapses to a slim "Shielded · category" strip — click to expand. Never vanishes without a trace. |

A weekly **Insights** view (below) turns the shield count into a signal about
whether any of this is actually helping, and a hard-coded exception means
crisis and harm-reduction resources are never shielded no matter what you've
turned on — see **Safety** below.

## Safety

A wellbeing filter that hides the wrong thing is a hazard, not a feature:

- **Health-anxiety filtering ships off by default.** Its own keywords
  ("symptom", "diagnosis") are exactly what a patient portal or a medical
  reference page uses — shielding health information by default, on a
  health-themed product, was the wrong default even though the category is
  legitimate for someone who wants it.
- **Crisis and harm-reduction sites are never shielded, hard-coded,
  regardless of settings** — 988lifeline.org, crisistextline.org,
  findtreatment.gov, samhsa.gov, thetrevorproject.org, translifeline.org,
  poisoncontrol.org (`NEVER_SHIELD_HOSTS` in `content/shield.js`). This
  isn't user-configurable, on purpose.

## Known limitations

- **Site adapters were verified live** against X, Reddit (new), YouTube, and
  Google News — three of those four (X, YouTube, Google News) had already
  changed their DOM since this project's original assumptions were written,
  once. Frontends drift; if a site stops matching, the fix is to re-inspect
  its current DOM and update `content/shield.js`'s `ADAPTERS` entry for it,
  not to assume the old selector still holds.
- **old.reddit.com's adapter is untested** — the site now requires a login
  even for public subreddits, which blocked live verification. Its
  `.thing .title a.title` selector targets Reddit's long-stable legacy
  markup, so it's a reasonable bet, just not empirically confirmed here.
- **A large safety/stability/accessibility pass (crisis-site exclusions,
  the generic adapter no longer using the AI stage, the AI session-lifecycle
  and recycled-DOM-node fixes, aria-hidden/inert, the reveal layout fix) is
  unit-tested (44 tests, all passing) but the next step is a fresh
  live-verification pass in a real loaded extension** to confirm it holds up
  the same way outside the test sandbox — the same discipline that caught
  the site-adapter drift above and several other real bugs earlier in this
  project. Don't take "tests pass" as "verified working" until that pass is
  done.

## Setup

1. Open `chrome://extensions`, enable **Developer mode** (top right).
2. Click **Load unpacked** and select this folder.
3. Requires **Chrome 138+**. Pin the AuraShield icon and click it to see
   today's stats and category toggles; click "Manage categories & intensity"
   for the full settings page.

### Enabling on-device AI (Gemini Nano)

The keyword stage always works with zero setup. To also get AI topic
understanding:

1. Open the AuraShield popup or options page — it checks availability
   automatically.
2. If it says **"Ready to set up"**, click **Enable on-device AI**. This
   triggers a one-time model download (a few GB) that stays on your device.
3. If it says **unavailable/unsupported**, check:
   - `chrome://on-device-internals` — confirms whether the on-device model
     component is present.
   - `chrome://components` — find "Optimization Guide On Device Model" and
     click **Check for update**.
   - `chrome://flags` — search "Prompt API for Gemini Nano" and
     "Optimization Guide On Device Model", set both to **Enabled**, then
     relaunch Chrome.
   - Hardware requirements: ~22GB free storage, 4GB+ VRAM, non-metered
     connection, Windows 10/11, macOS 13+, or Linux.

AuraShield never fails "open" — if the model isn't available, it keeps
filtering with the keyword stage and says so plainly in the UI.

## Project layout

```
manifest.json              Manifest V3 config
background/                Service worker: defaults, stats badge, history log, onboarding tab
content/
  shield.js                   the content script: scanning, keyword + AI matching, blur/hide UI
                               (one plain script - static content_scripts entries can't use
                               ES module import/export, so this has no dependencies)
  shield.css                  blur/hide treatment styles
popup/, options/,           Extension UI - regular extension pages, so these *can* use
onboarding/                 <script type="module"> and import from shared/
shared/                     Category defaults, chrome.storage helpers, AI-availability check,
                             insights computation (used by popup/options/onboarding/background,
                             not by content/shield.js)
```

## Testing

```
npm test
```

Runs the suite in `tests/` via Node's built-in test runner — keyword/exclusion
matching, storage reconciliation, the AI-classifier session queue, and a
structural check that `shared/categories.js` hasn't drifted from the copy
inlined in `content/shield.js` (see Project layout above for why that copy
exists). The pure-logic tests extract real slices of `content/shield.js`'s
source rather than reimplementing it, so they exercise the actual shipped code.

## Insights

The options page's "This week" card turns the shield count into something
closer to self-knowledge than a tally: how many items were revealed after
being shown (a low reveal rate means a category is actually serving you; a
high one means it's mostly adding friction), your most-shielded category and
site this week, and how much of it happened between 10pm and 2am — the
window the sleep research above is about.

This is backed by a local history log (`shared/insights.js` computes the
numbers, `shared/storage.js` stores the log) that records, per shield event:
a timestamp, the category, the site's hostname, whether the keyword or AI
stage matched it, and whether you revealed it. **It never records the
shielded text itself or the page's URL** — only enough to answer "when" and
"what kind", never "what". Capped at the last 2000 events, oldest dropped
first. A **Clear history** button in the options page wipes it immediately.

## Privacy

**No page content you read is ever sent anywhere.** `chrome.storage.local`
only, no `host_permissions`, no CSP override, no analytics — and it's written
so you can verify that yourself rather than take our word for it. See
[PRIVACY.md](PRIVACY.md) for the full claim, the exact command to check it,
and the one non-negotiable exception (crisis/harm-reduction sites, see
Safety above).

## Roadmap

- Let people correct a false positive in the moment — exclude the specific
  matched term for that category, one click, right from the shield card
  (the display side of this already ships; the correction action needs a
  small schema change to give categories a user-owned exclude-list slot).
- A wind-down schedule that escalates intensity late at night, tying
  directly to the sleep-disruption research this project already cites.
- Broader site coverage, Firefox/Edge support, image/thumbnail-level
  classification.
