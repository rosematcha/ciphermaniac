# Documentation: generate_suggestions.py

## Intent

This script generates a categorized list of card suggestions for competitive Pokémon TCG deckbuilding, outputting the results to `reports/suggestions.json`. The categories help identify cards that are consistently popular, rising in usage, experiencing sharp declines ("chopped and washed"), or appeared once or twice as seeming anomalies ("That Day 2'd?"). The goal is to provide actionable insights for players and analysts by tracking card usage trends across recent tournaments.

## How It Works

1. **Data Loading**
   - Reads the tournament order from `reports/tournaments.json`.
   - Loads card usage data from each tournament’s `master.json`.
   - Extracts card usage percentages and display names.

    **Input Files:**
    - `reports/tournaments.json`: An array of tournament folder names, ordered newest-first.
    - Each tournament folder contains a `master.json` with card usage data (list of items with `name`, `uid`, and `pct` fields).
    - Card display names and unique IDs are extracted for analysis.

2. **Category Computation**
   - **Consistent Leaders**: Cards with high average usage across tournaments.
   - **On The Rise**: Cards with a significant recent increase in usage.
    - **Chopped and Washed**: Cards with a sharp, recent drop from a previous peak (absolute drop ≥ 3%, relative drop ≥ 40%), with recency weighting. Penalizes steady low usage and rewards sudden declines. Excludes cards with >3% usage in the last two events.
    - **That Day 2'd?**: Cards that had a significant peak (≥ 6%) in a prior event but are now rarely played (≤ 2% in the latest event), and not present above 3% in the last 10 tournaments.

3. **Heuristics and Filtering**
   - Excludes basic energy cards and enforces per-archetype caps.
   - Applies recency weighting and drop thresholds for "chopped and washed".
   - Filters tournaments to focus on the current rotation if enough events are available.

    **Parameters:**
    - Recency weighting half-life: 30 days (exponential decay).
    - Peak lookback: considers all prior events.
    - Minimum peak percent: 3% (chopped), 6% (day2d).
    - Minimum drop: 3% absolute, 40% relative (chopped).
    - Per-archetype cap: 2 (can relax to 3 or 4 if needed).
    - Minimum/maximum candidates per category: 12/18.

    **Assumptions and Limitations:**
    - Assumes tournament folders and files are present and formatted as described.
    - Requires at least 3 events in the current rotation to filter older events.
    - Newly legal cards (with only 0% in prior events) are ignored for "on the rise".
    - Handles missing or malformed files gracefully (skips them).

4. **Output**
   - Assembles the computed categories into a structured JSON file.
   - Includes metadata such as generation time and source script.

    **Output File:**
    - `reports/suggestions.json` contains:
       - `generatedAt`: ISO timestamp
       - `source`: script name
       - `categories`: array of category objects, each with an `id`, `title`, and list of card items (with name, uid, set, number, archetype, and score/usage info)

5. **Usage**
   - Run from the repository root directory.
   - Produces `reports/suggestions.json` for use in web apps, analysis, or reporting.

    **How to Run:**
    - Run with `python tools/generate_suggestions.py` from the repo root.
    - No external dependencies required (uses Python standard library).

    **Error Handling:**
    - If a file is missing or malformed, the script skips it and continues.
    - If insufficient candidates are found for a category, per-archetype caps are relaxed to try to meet minimums.