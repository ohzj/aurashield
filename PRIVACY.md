# Privacy

**Claim: no page content you read is ever sent anywhere.**

This isn't a policy promise — it's an architectural fact you can check
yourself, in about thirty seconds:

```bash
grep -rE "fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource" --include=*.js .
```

That returns nothing, because there is nothing to find. Three things make it
true, not just currently accurate:

1. **No `host_permissions` in `manifest.json`.** Even if a future version of
   this code tried to make a cross-origin request, Chrome would block it.
2. **No Content-Security-Policy override**, so Manifest V3's strict default
   (`script-src 'self'`) applies — no remote script can ever load into this
   extension.
3. **Everything persists to `chrome.storage.local`, never `.sync`.** Your
   settings, categories, and shield history don't leave this device even via
   your Google account.

## What actually happens locally

Two filtering stages, both entirely on-device:

- **Keyword matching** — a regex check against your categories' keyword
  lists. Instant, no model involved.
- **Gemini Nano classification** — Chrome's built-in on-device Prompt API
  (`content/shield.js`'s `AIClassifier`). The only network traffic this can
  ever cause is Chrome downloading the model itself, once, when you
  explicitly click "Enable on-device AI" — that's Chrome fetching a model,
  never your page text being uploaded anywhere.

## What's stored, and what isn't

- **Settings**: your categories, their enabled/intensity state, custom
  categories, paused sites. Necessary for the product to function at all.
- **Shield history** (used for the Insights view): per shield event, a
  timestamp, the category, the site's hostname, whether the keyword or AI
  stage matched it, and whether you revealed it.
  **It never records the shielded text itself or the page's URL** — only
  enough to answer "when" and "what kind" of thing was shielded, never
  "what" the actual content was. Capped at the last 2000 events; a
  **Clear history** button in the options page wipes it immediately.

## Guardrails on the AI stage itself

Page content fed into the on-device classifier is untrusted input — a page
could try to manipulate its own classification by embedding text that reads
as new instructions. Two layers address this: the snippet is wrapped in
`<<<SNIPPET>>>`/`<<<END SNIPPET>>>` markers rather than a bare quoted string
(nothing in ordinary page text can close that early), and the model's system
prompt explicitly instructs it to treat everything inside those markers as
data to classify, never as instructions, regardless of what it appears to
say. The classifier's output is separately bounded to a closed set of your
own category ids via a JSON-schema response constraint, so even a
successful manipulation could only ever produce one of your own labels or
"none" — never arbitrary text, never an escape from the classification task
itself.

## The one honest caveat

This is a guarantee about *processing location*, not about *what gets read*.
The content script does read the text of every http/https page you visit, to
check it against your active categories — that's the entire mechanism by
which filtering works. It just never leaves your device while doing so.

## One non-negotiable exception

Crisis and harm-reduction resources — 988lifeline.org, crisistextline.org,
findtreatment.gov, samhsa.gov, thetrevorproject.org, translifeline.org,
poisoncontrol.org (see `NEVER_SHIELD_HOSTS` in `content/shield.js`) — are
never shielded, regardless of what categories you've turned on. This isn't
user-configurable, on purpose: a wellbeing filter must not be capable of
hiding the help someone is actively looking for.
