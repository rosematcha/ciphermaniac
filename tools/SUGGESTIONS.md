## Suggestions generator — requirements and implementation notes

Purpose
- Describe the requirements and operational rules for the static "suggestions" used by the Cards landing page.
- Explain inputs, outputs, exclusivity rules, archetype caps, backfill behavior, tuning knobs, and validation steps.

High-level checklist
- Input: `reports/` (especially `reports/tournaments.json`, per-tournament `master.json`, `decks.json`, `meta.json`).
- Output: `reports/suggestions.json` — 4 categories, 12 items each (target).
- Categories: `consistent-leaders`, `on-the-rise`, `chopped-and-washed`, `that-day2d`.
- Exclude basic energy cards (project's BASIC_ENERGY set).
- Exclusivity rules enforced across categories.
- Per-archetype caps: `that-day2d` = 1 per archetype, `chopped-and-washed` = 2 per archetype.
- Backfill behavior: categories should be filled to 12 with lower-priority candidates while respecting caps and exclusivity.
- Chronology: `reports/tournaments.json` is treated newest-first (index 0 = latest).

Inputs and ordering
- `reports/tournaments.json`: canonical tournament order (generator treats index 0 as the newest/most-recent event).
- For each tournament, the generator reads `master.json` / `meta.json` and `decks.json` to obtain card usage percentages and archetype associations.

Output format (high level)
- `reports/suggestions.json` is a JSON object with metadata and `categories`, each category has:
  - id: machine id (e.g. `consistent-leaders`)
  - title: human title
  - items: array of suggestion objects. Each item should include at least:
    - name (card identifier)
    - score (float 









- ranking score used to sort within category)
    - archetype (best-effort archetype string or `null`)
    - debug fields useful for diagnosis: `peak_pct`, `latest_pct`, `peak_tournament`, `latest_tournament`, `reason` (short)

Category definitions & selection rules

- Consistent Leaders
  - Definition: cards that reliably appear near the top of usage across multiple recent tournaments.
  - Selection: use across-event frequency and average/top percent presence as the signal.
  - Exclusivity: cards chosen here must not appear in `on-the-rise` or `that-day2d`.

- On The Rise
  - Definition: cards that have recently broken out or show significant recent growth vs older events.
  - Selection: require absolute and relative increase thresholds over a baseline, plus recency weighting.
  - Exclusivity: exclude anything already in `consistent-leaders`.
  - Backfill candidate source: this category may be used as a source when backfilling `that-day2d`.

- Chopped and Washed
  - Definition: cards that had a clear earlier peak (older events) and are much lower in the most recent event  i.e., a downturn/crash.
  - Important nuance: a latest value of exactly `0.0` must be treated as a valid extreme drop and should often increase the card's priority for this category.
  - Selection heuristics (implementation notes):
    - Find a prior peak that is strictly older than the latest event.
    - Require the prior peak to meet a minimum `MIN_PEAK_PCT` (so trivial historical blips are ignored).
    - Require an absolute drop `peak_pct - latest_pct >= MIN_DROP_ABS` and/or a relative drop `peak_pct / max(latest_pct, eps) >= MIN_DROP_REL`.
    - Apply a recency weight so more recent peaks (but still older than latest) are favored.
  - Per-archetype cap: maximum 2 cards per archetype in this category.
  - Exclusivity: treated as its own category but initial candidate pool should exclude items already present in `consistent-leaders` and/or `on-the-rise` if project rules require.

- That Day 2'd? (short: that-day2d)
  - Definition: cards that spiked on a single tournament but are not generally present across events ("one-day wonders").
  - Selection: identify large single-event appearance that is not repeated elsewhere.
  - Per-archetype cap: strictly 1 card per archetype.
  - Exclusivity: cards present in `consistent-leaders` or `on-the-rise` must be ineligible for `that-day2d`.
  - Size guarantee: the category should contain 12 items. If the strict candidate set has fewer items than 12, the generator must backfill while respecting per-archetype caps and exclusivity (see Backfill rules below).

Exclusions
- A configurable set of names is excluded entirely (the project's BASIC_ENERGY set is an explicit example). Excluded cards should never be suggested.

Exclusivity & selection priority (summary)
- The generator enforces mutual-exclusion rules to keep categories meaningful:
  1. `consistent-leaders` winners are removed from the candidate sets for `on-the-rise` and `that-day2d`.
  2. `on-the-rise` winners are removed from `that-day2d`.
  3. `chopped-and-washed` may be computed from the remaining pool; project policy may vary whether `chopped` excludes `consistent`/`on-the-rise`  the current implementation treats `chopped-and-washed` as separate and enforces its own per-archetype caps.

Backfill rules (fill to 12)
- Target size per category: 12 items.
- Filling priority when candidates are insufficient (recommended order; tunable):
  1. Use additional candidates that meet the category's relaxed thresholds but were dropped due to caps (if doing so does not violate per-archetype limits).
  2. Pull from lower-priority category `on-the-rise` (for `that-day2d`) or from an ordered pool of remaining candidates.
  3. As a last resort, pull from `consistent-leaders` only if allowed by exclusivity rules and the project prefers a non-empty list over strict separation.
- All backfills must still respect archetype caps for the receiving category.

Archetype association
- Archetypes are inferred heuristically from `decks.json` (the generator should pick the archetype of a representative deck that included the card).
- Cards that map to multiple archetypes should be assigned a best-effort primary archetype; if ambiguous, assign `null` and treat them as their own bucket for caps.

Parameters and tuning knobs
- Location: constants / top-level variables in `tools/generate_suggestions.py` (or equivalent).
- Common parameters:
  - `MAX_CANDIDATES` (12)
  - `MIN_PEAK_PCT` (minimum historical peak % to consider a chopped candidate)
  - `MIN_DROP_ABS` (minimum absolute drop to consider)
  - `MIN_DROP_REL` (minimum relative drop factor)
  - Recency weights (how much more important recent peaks are)
  - Archetype caps: per-category caps (e.g., that-day2d:1, chopped-and-washed:2)
- Recommendation: keep defaults conservative, then iterate using `tools/debug_series.py` to validate examples (Morty's Conviction, Air Balloon, Genesect ex, etc.).

Validation & debugging
- Primary scripts:
  - `tools/generate_suggestions.py`  runs the generator and writes `reports/suggestions.json`.
  - `tools/debug_series.py`  prints percent series per tournament for one or more cards to validate chronology and detection heuristics.
- Quick checks:
  1. Run the generator: `python tools/generate_suggestions.py` and confirm "Wrote .../reports/suggestions.json" in the output.
  2. Inspect `reports/suggestions.json` for each category to confirm 12 items and that debug fields (`peak_pct`, `latest_pct`, `archetype`) are populated.
  3. Use `tools/debug_series.py <card name>` to view the card's tournament percent time series and confirm that the card's pattern matches the category assignment.

Edge cases and recommended handling
- Sparse histories: ignore cards with fewer than N non-zero data points when computing time-series-derived categories (threshold N is tunable).
- Ties: break ties deterministically (lexicographically by card name) after scoring.
- Missing tournament data: skip tournaments lacking required files; log an error and continue.
- Cards with `0.0` in the latest event: for `chopped-and-washed`, treat `0.0` as a valid strong signal and consider a small boost in scoring when `latest_pct == 0.0`.

Quality gates
- After any change to the generator:
  - Run the generator and confirm no exceptions.
  - Confirm `reports/suggestions.json` has four categories and each category contains up to 12 items.
  - Run `tools/debug_series.py` for 3	6 known examples and verify their percent histories match expectations.

Implementation notes for developers
- Keep selection logic isolated into per-category functions returning scored candidate lists.
- Apply exclusion & archetype rules as a separate post-processing pass to keep category logic simple.
- Persist debug fields in the output to make tuning iterative and transparent.
- Add JSDoc-style or inline comments describing the reasoning behind each threshold to aid future tuning.

Where to change behavior
- `tools/generate_suggestions.py`  main place to change thresholds, caps, and candidate/prioritization logic.
- `tools/debug_series.py`  useful for spot-checking candidate time series.
- `assets/js/cardsLanding.js`  reads `reports/suggestions.json`; verify rendering expectations (thumbnail sizes, title strings) if you change item fields.

Contact & ownership
- File author: tools/generate_suggestions.py maintains the logic; update this doc if you change the category rules.

Notes
- This document is a living spec. Tune thresholds and backfill order based on review of actual tournament data and desired UX.
