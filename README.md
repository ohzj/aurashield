# AuraShield

A personal, reversible filter for the web. Tell it what wears you down —
doomscrolling news, health-anxiety spirals, spoilers, whatever's yours — and
it blurs or hides matching content wherever you browse, with a one-click
"view anyway" always available. It's a dial you control, not a wall someone
else built for you.

Built for [Hack for Humanity | Summer 2026](https://hack-for-humanity-summer-26.devpost.com/).

## How it works

Two-stage filtering pipeline, entirely on-device — no page content is ever
sent off your machine:

1. **Keyword match** — instant, always-on safety net. Keywords support
   Sigma-style exclusion rules (`excludeKeywords`) so obvious false
   positives — "war" matching "Star Wars", "attack" matching "Attack on
   Titan" — get suppressed by a cheap rule instead of ever reaching the AI
   stage. Every case an exclusion rule rules out here is one less thing
   waiting on a model round-trip.
2. **Gemini Nano classification** — Chrome's built-in on-device Prompt API
   scores visible content against your active categories for topics keywords
   alone would miss. While a candidate is waiting on this stage, it gets a
   brief neutral dim (not the full shield treatment) so nothing sits fully
   readable during the classification window — the point of the AI stage
   isn't much good if you've already read the headline by the time it
   resolves.

Matches get one of three treatments, set per category:

| Level | Treatment | Still reversible how |
|---|---|---|
| Gentle | Light blur, clears on hover/focus | Already peeking through |
| Balanced (default) | Full blur + "view anyway" button | One click reveals in place |
| Strict | Fully hidden | Collapses to a slim "Shielded · category" strip — click to expand. Never vanishes without a trace. |

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
window the sleep research in the pitch is about.

This is backed by a local history log (`shared/insights.js` computes the
numbers, `shared/storage.js` stores the log) that records, per shield event:
a timestamp, the category, the site's hostname, whether the keyword or AI
stage matched it, and whether you revealed it. **It never records the
shielded text itself or the page's URL** — only enough to answer "when" and
"what kind", never "what". Capped at the last 2000 events, oldest dropped
first. A **Clear history** button in the options page wipes it immediately.

## Privacy

**Claim: no page content you read is ever sent anywhere.** Verify it
yourself rather than take our word for it — `grep -rE "fetch\(|XMLHttpRequest|sendBeacon|WebSocket" --include=*.js .`
returns nothing, because there's nothing to find: `manifest.json` declares no
`host_permissions` (a cross-origin request would be blocked even if the code
tried), no CSP override (so Manifest V3's default `script-src 'self'`
applies — no remote code can load), and everything persists to
`chrome.storage.local`, never `.sync`. The one network call the product can
ever cause is Chrome's own one-time Gemini Nano model *download*, which you
trigger explicitly by clicking "Enable on-device AI" — that's Chrome fetching
a model, never your page text being uploaded.

The honest caveat: this is a guarantee about *processing location*, not about
*what gets read*. The content script does read the text of every http/https
page you visit to check it against your categories — that's the whole
mechanism — it just never leaves your device. One deliberate, non-negotiable
exception either way: crisis and harm-reduction sites (988lifeline.org,
crisistextline.org, findtreatment.gov, and similar — see `NEVER_SHIELD_HOSTS`
in `content/shield.js`) are never shielded, regardless of what categories
you've enabled. A wellbeing filter should not be able to hide the help
someone is actively looking for.

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
  unit-tested (35+ tests, all passing) but the next step is a fresh
  live-verification pass in a real loaded extension** to confirm it holds up
  the same way outside the test sandbox - the same discipline that caught
  the site-adapter drift above and several other real bugs earlier in this
  project. Don't take "tests pass" as "verified working" until that pass is
  done.
