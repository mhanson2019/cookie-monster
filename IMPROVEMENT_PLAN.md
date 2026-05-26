# Cookie Monster — Improvement Plan

This document captures a proposed evolution of Cookie Monster from its current "binary trust + small hardcoded list" model into a richer, score-based classifier with effective user settings, real-scale tracker data, and an accessible dashboard.

The work is intentionally split into phases. Each phase is independently shippable and verifiable, so progress is visible without waiting for a big-bang release.

---

## Goals

1. **User settings that actually drive behavior.** Today the sliders/toggles save to `chrome.storage.local` but `background.js` never reads them — they're decorative. Fix that.
2. **A richer risk model.** Replace the current `high | medium | low` branching with a continuous score across purpose × scope × persistence × owner.
3. **A real domain list.** Replace the 48 hand-typed tracker domains with a real, periodically refreshed dataset (~3–5k domains) that already includes owner/category attribution.
4. **An accessible dashboard.** Live view + weekly + monthly reports so users can see what the extension is doing for them over time.

Everything stays local. No backend, no live LLM lookups, no telemetry.

---

## Phase 1 — Wire up the existing settings

The smallest change with the biggest correctness win.

### What's broken today
- `src/settings.js` writes `userConfig` to `chrome.storage.local` on save.
- `src/background.js` never reads `userConfig`. Search the file — there are zero references.
- Every slider and toggle in the settings page is currently cosmetic.

### Work
1. Load `userConfig` once at service-worker startup in `background.js`.
2. Subscribe to `chrome.storage.onChanged` so changes apply immediately without an extension reload.
3. Define a `defaultConfig` constant so first-run users get sensible behavior before they ever open settings.
4. Replace the hardcoded `severity === 'high' → auto-delete` decision (`background.js:217`) with a config-driven decision.
5. As a Phase-1-only shortcut, ship a "Strict / Balanced / Lenient" preset that maps to the existing sliders. This lets us ship Phase 1 without yet having the full scoring model from Phase 3.

### Done when
- Moving the `adTolerance` slider visibly changes which cookies get auto-deleted vs flagged on a test site (e.g., visit cnn.com, move slider to "Delete all", refresh popup, see more cookies in the auto-deleted column).
- Toggling `keepShoppingCarts` off prevents Shopify cart cookies (`_shopify_*`) from being touched.
- No new files required for this phase; all changes in `background.js` and a small `src/config.js` helper.

---

## Phase 2 — Add persistence and expiry as a classification signal

### What's missing
- `chrome.cookies.getAll()` already returns `expirationDate` (Unix seconds) and `session` (boolean) fields.
- The current `classifyCookie()` (`background.js:93`) ignores both. A 10-year tracking cookie and a 1-hour session cookie of the same name are treated identically.

### Work
1. Compute a `persistenceBucket` for every cookie:
   - `session` — no expiry, dies with the browser
   - `≤ 1 day`
   - `≤ 7 days`
   - `≤ 30 days`
   - `≤ 1 year`
   - `> 1 year`
2. Add `persistenceBucket` to the result returned by `classifyCookie()`.
3. Surface persistence in the popup UI (`renderCookieItem` in `src/popup.js`) — e.g., a small badge "🕐 1 year" next to the domain.
4. Put bucket boundaries in a new `src/classifier/constants.js` so they're easy to tune.

### Done when
- Each cookie item in the popup shows its persistence bucket.
- Manual spot-check confirms session cookies are bucketed correctly.

---

## Phase 3 — Replace the branch-based classifier with a scoring function

### Model

Each cookie gets a risk score in `[0, 10]` derived from four axes:

| Axis        | Values                                                                                | Weight |
|-------------|---------------------------------------------------------------------------------------|--------|
| Purpose     | auth, personalization, analytics, advertising, tracking, security, consent, unknown   | 4      |
| Scope       | first-party, third-party, third-party-on-tracker-domain                               | 3      |
| Persistence | session → > 1 year (6 buckets, from Phase 2)                                           | 2      |
| Owner       | site-itself, vendor (known), big-platform (Google/Meta/Microsoft), data-broker, unknown | 1     |

### Proposed file layout

```
src/classifier/
  index.js          // public: classify(cookie, tab, dictionary, config) → result
  axes/
    purpose.js      // returns 'analytics' | 'advertising' | ... + confidence
    scope.js        // returns 'first-party' | 'third-party' | 'tracker'
    persistence.js  // returns bucket from Phase 2
    owner.js        // returns ecosystem string
  score.js          // combines axis outputs + config thresholds → decision
  threshold_matrix.js  // settings slider value → max acceptable score per purpose
  constants.js
```

### Config → thresholds mapping (concrete)

Example: `adTolerance` slider value (1–5) maps to `max_allowed_score_for(purpose=advertising)`:

| Slider | Label         | Max allowed score |
|--------|---------------|-------------------|
| 1      | Delete all    | 0                 |
| 2      | Delete most   | 2                 |
| 3      | Neutral       | 4                 |
| 4      | Keep most     | 6                 |
| 5      | Keep all      | 10                |

Similar mappings for `loginPersistence`, `localizationTolerance`, `googleTrust`. Encode the whole matrix in `threshold_matrix.js` so it's reviewable and tunable in one place.

### Final decision

- `score ≥ delete_threshold(purpose)` → auto-delete
- `score ≥ flag_threshold(purpose)` → flag for review
- otherwise → trust (keep silently)

### Done when
- Same site visited with different slider positions produces different counts in the deleted vs flagged columns.
- A first-party 5-year persistent ID cookie is now flagged (today: silently trusted).
- A third-party session cookie from a CDN is no longer flagged (today: low-severity flag).

---

## Phase 4 — Replace the hand-rolled domain list with a real one

### Current state
- `data/cookies.json` has 48 hand-typed tracker domains and 120 cookie names.
- No update mechanism — the file is only as fresh as the last commit.

### Recommended primary data source: DuckDuckGo Tracker Radar

Repo: <https://github.com/duckduckgo/tracker-radar>

Why this one over EasyPrivacy/Disconnect/etc:
- **Already structured as JSON**, one file per tracker domain.
- **Includes owner attribution and category out of the box** — aligns directly with the proposed taxonomy. This saves a huge amount of curation work.
- **Includes prevalence data** (how widely each tracker is deployed) — useful for prioritization and for the dashboard's "top trackers" view.
- **Permissive licensing** (Apache 2.0).
- **Continuously maintained** by DuckDuckGo.

### Supplementary sources to consider
- **EasyPrivacy** (filterlists.com) — broader coverage of pure tracker hostnames, less metadata.
- **Disconnect.me Services list** — categorized, used by Firefox's tracking protection.
- **whotracks.me** (Ghostery) — useful for owner/parent-company info.

A reasonable approach: use Tracker Radar as the primary structured source, augment its domain list with anything additional EasyPrivacy catches that TR misses.

### Build pipeline

Add `scripts/build-trackers.js` that:
1. Pulls the latest Tracker Radar release (git submodule, or HTTP fetch of the release tarball).
2. Transforms it into the extension's bundle format:
   - `data/tracker_domains.json` — flat list of root domains for the scope axis
   - `data/owners.json` — owner → category + parent-company mapping for the owner axis
   - `data/vendor_name_patterns.json` — cookie-name patterns by vendor (curated, ~1–2k) for attribution
3. Outputs compressed JSON to `data/` (target: under 300 KB total).
4. Runs weekly in CI; commits refreshed bundle.

**Important:** do not have the extension fetch these lists live at runtime. See the privacy discussion that motivated this plan — live lookups leak browsing data. The bundle ships with the extension and updates via the Chrome Web Store's normal release mechanism (which is itself how Chrome updates EasyList for its own filters).

### Aligning the categorization

Tracker Radar's categories don't map 1:1 to our purpose taxonomy. Define an explicit translation table in `scripts/category_map.json`:

| Tracker Radar category | Our `purpose` |
|------------------------|---------------|
| Advertising            | advertising   |
| Analytics              | analytics     |
| Social Network         | tracking      |
| CDN                    | functional    |
| Customer Interaction   | functional    |
| Audio/Video Player     | functional    |
| Online Payment         | functional    |
| Federated Login        | auth          |
| Consent Management     | consent       |
| (unmapped)             | unknown       |

Keeping this in a separate JSON makes the mapping reviewable and easy to update without code changes.

### Done when
- `data/` contains generated `tracker_domains.json`, `owners.json`, `vendor_name_patterns.json`.
- `node scripts/build-trackers.js` runs cleanly from a fresh checkout.
- The classifier picks up at least a 10× larger tracker domain set without the extension feeling slower in popup open time.

---

## Phase 5 — Accessible dashboard

### Why
The popup is per-glance. A dashboard answers "what is this extension actually doing for me" over weeks and months — that's the question that turns a passive user into someone who recommends it to friends.

### Page structure

New file: `src/dashboard.html`, with three tabbed views.

**1. Live view**
- Cookies-screened-per-second sparkline (last 60 seconds).
- Currently-open tabs and their flagged counts.
- "Now blocking" feed: new auto-deletions stream in as they happen.
- Implementation: push from `background.js` via `chrome.runtime.sendMessage` to any open dashboard tab, with a polling fallback every 2s.

**2. This week**
- Total cookies deleted, flagged, kept.
- Breakdown by purpose (donut chart).
- Top 10 tracker domains seen.
- Top 10 sites by tracker count.
- Daily time series for the last 7 days (bar chart).

**3. Monthly report**
- Same metrics as weekly, aggregated to 30 days.
- "Compared to last month" delta line ("23% more trackers blocked than last month").
- Export to CSV button for the data nerds.

### Charting library
**Chart.js v4** (~75 KB minified, no dependencies, vanilla JS, declarative API). Avoid React/Vue — the extension should stay dependency-free where possible.

### Storage changes needed
- Current `deletion_log` is capped at 500 entries (`background.js:132`). For 30-day reporting that's ~17 deletions/day before the buffer wraps — far too small.
- Add a separate `daily_rollup` store:
  ```json
  {
    "2026-05-25": {
      "deleted": { "advertising": 142, "analytics": 38, "tracking": 7 },
      "flagged": { "advertising": 8, "analytics": 2 },
      "kept":    { "functional": 412, "auth": 18 },
      "topSites":    [{ "site": "cnn.com", "count": 47 }, ...],
      "topTrackers": [{ "domain": "doubleclick.net", "count": 31 }, ...]
    }
  }
  ```
- Keep 365 daily rollups (~1 MB on disk). Trim entries older than that.
- Keep `deletion_log` for the live/recent feed but bump cap to 2000 entries.

### Accessibility (explicit requirement)

The user called this out specifically. Hold the bar to WCAG 2.1 AA:

- **Keyboard navigation.** Every interactive element reachable via Tab. Visible focus ring (not the default browser one — match the theme but keep contrast ≥ 3:1).
- **ARIA labels** on charts. Chart.js has plugins for this; for any hand-drawn SVG, add `aria-label` + `role="img"`.
- **Color contrast.** WCAG AA minimum (4.5:1 for body text, 3:1 for large text). The current cream-on-brown theme (`src/theme.css`) needs a contrast pass — especially the muted secondary text.
- **Screen-reader summaries.** Every chart gets a visually hidden `<table>` containing the same data, so screen readers can read the numbers directly.
- **Respect user preferences.** `prefers-reduced-motion` (no auto-animating bars), `prefers-color-scheme` (provide a high-contrast variant).
- **Don't rely on color alone.** Every color-coded badge gets paired with an icon or text label — colorblind users should be able to distinguish "advertising" from "analytics" without seeing the color.
- **Semantic HTML.** Real `<button>` elements, real heading hierarchy, real `<table>` for tabular data.

### Done when
- Opening the dashboard from the popup → live count ticks up visibly as you browse a new site in another tab.
- Weekly view shows last 7 days of activity with a real chart.
- A keyboard-only user can navigate every control with no mouse.
- A screen reader (VoiceOver on macOS, NVDA on Windows) announces chart contents via the hidden tables.
- Lighthouse Accessibility score ≥ 95.

---

## Suggested phase order & rough sizing

| Phase                | Why this order                                       | Rough size       |
|----------------------|------------------------------------------------------|------------------|
| 1 — Wire settings    | Smallest change, fixes a correctness/honesty bug     | ~half a day      |
| 2 — Persistence axis | Independent of scoring; useful in popup as-is        | ~half a day      |
| 3 — Scoring function | Needs Phases 1 & 2 to be meaningful                  | 1–2 days         |
| 4 — Real domain list | Independent of Phase 3; can run in parallel          | 1 day            |
| 5 — Dashboard        | Depends on 1–4 producing meaningful data              | 2–3 days         |

Sizing assumes a single developer working steadily. Pair-programming with a learner will be slower but produces much better code review and shared understanding.

---

## Out of scope (deliberately)

- **Live LLM lookups for unknown cookies.** Discussed and rejected on privacy grounds — every unknown cookie name + domain would get phoned home. If we want LLM-generated classifications, do it offline server-side over aggregated/opt-in data and ship the result as part of the Phase 4 bundle.
- **A backend service.** Everything stays in the browser.
- **Custom user rules** (per-cookie regex). Defer until the basics are solid.
- **Cross-browser support** (Firefox, Safari). Current code is Chrome MV3-only; that's fine for now.

---

## Open questions to align on before starting

1. **Data refresh cadence.** Is committing updated `data/*.json` weekly via CI acceptable, or do we want a 7-day signed CDN fetch from the extension?
2. **Default tolerance for first-run users.** Strict, balanced, or lenient out of the box? My recommendation: **balanced**, because strict will surprise users with broken logins on Day 1.
3. **Dashboard surface.** Separate full-page tab (recommended — more room for charts and accessibility) or embedded inside the popup?
4. **Whose privacy threat model are we optimizing for?** A user who wants every tracker dead at any cost ("strict" defaults) vs. a user who wants a tidy web without breaking sites ("balanced" defaults). Worth being explicit; affects every threshold in `threshold_matrix.js`.
