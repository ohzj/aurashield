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
background/                Service worker: defaults, stats badge, onboarding tab
content/
  shield.js                   the content script: scanning, keyword + AI matching, blur/hide UI
                               (one plain script - static content_scripts entries can't use
                               ES module import/export, so this has no dependencies)
  shield.css                  blur/hide treatment styles
popup/, options/,           Extension UI - regular extension pages, so these *can* use
onboarding/                 <script type="module"> and import from shared/
shared/                     Category defaults, chrome.storage helpers, AI-availability check
                             (used by popup/options/onboarding, not by content/shield.js)
```

## Privacy

`chrome.storage.local` only. No network requests ever carry page text —
both filtering stages run entirely inside the browser.

## Known limitations

- **Site adapters were verified live** against X, Reddit (new), YouTube, and
  Google News as of this writing — but all three of X/YouTube/Google News
  had already changed their DOM since this project's original assumptions
  were written, once. Frontends drift; if a site stops matching, the fix is
  to re-inspect its current DOM and update `content/shield.js`'s `ADAPTERS`
  entry for it, not to assume the old selector still holds.
- **old.reddit.com's adapter is untested** — the site now requires a login
  even for public subreddits, which blocked live verification. Its
  `.thing .title a.title` selector targets Reddit's long-stable legacy
  markup, so it's a reasonable bet, just not empirically confirmed here.
- **Strict-intensity visual treatment is code-reviewed but not
  browser-verified** — it shares the same wrap/overlay/reveal mechanism
  already confirmed working for Gentle and Balanced, just with different
  CSS (`display: none` instead of blur). Worth a manual check: enable a
  Strict category (Spoilers or Violence) in the options page and confirm
  a match collapses to a clickable strip.
