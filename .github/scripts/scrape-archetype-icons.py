#!/usr/bin/env python3
"""
Scrape the Limitless "decks" pages to build the archetype → Pokémon-icon map.

On play.limitlesstcg.com/decks each archetype row carries one or two
``<img class="pokemon" src="https://r2.limitlesstcg.net/pokemon/gen9/<slug>.png">``
icons (e.g. ``dragapult`` for Dragapult, ``greninja-mega`` for Mega Greninja, and
two for dual decks like Dragapult Dusknoir). We harvest those slugs keyed by the
row's display name and write them to ``src/data/archetype-icons.json``.

The slug carries form information that can't be derived from the archetype name
(``Lucario Hariyama`` → ``lucario-mega``), which is exactly why this map exists.

This builds a CUMULATIVE database across every standard-legal format from
Shrouded Fable (SFA) onward — the earliest format our tournament data covers. The
snapshot list is read from the decks page's own set selector at run time, so a newly
released set is picked up without editing this file. Each ``(rotation, set)``
snapshot is scraped and MERGED: an archetype's icon Pokémon are stable across
formats (Charizard Pidgeot is always charizard + pidgeot), so adding a format only
fills gaps, never rewrites. Hand-edited keys in the committed JSON are preserved too
(pass --overwrite to force replacement).

Usage:
    # Rebuild the full SFA→current database (default):
    python .github/scripts/scrape-archetype-icons.py

    # Scrape only specific snapshots (repeatable rotation:set):
    python .github/scripts/scrape-archetype-icons.py --target 2026:CRI --target 2026:POR

    # Force-replace existing keys from the scrape:
    python .github/scripts/scrape-archetype-icons.py --overwrite
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Dict, List, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))

from limitless_decks import (  # noqa: E402
    REQUEST_DELAY,
    fetch_decks_html,
    parse_deck_rows,
    parse_set_options,
)

OUTPUT_PATH = Path("src") / "data" / "archetype-icons.json"

# Limitless deliberately has no deck-index row for its residual "Other" bucket,
# so scraping cannot discover its representative icon. Keep this product choice
# here rather than relying on a JSON edit that a later refresh could lose. Its
# Substitute art is committed at static/img/substitute.png from
# https://limitless3.nyc3.cdn.digitaloceanspaces.com/pokemon/substitute.png.
MANUAL_ICON_OVERRIDES: Dict[str, List[str]] = {
    "Other": ["substitute"],
}

# Shrouded Fable is the earliest format our tournament data covers, so it's the
# floor for the cumulative scrape. Everything older on the selector (pre-SFA
# 2024 sets like TEF/TWM, plus the 2023-and-earlier rotations) is dropped.
EARLIEST_TARGET: Tuple[str, str] = ("2024", "SFA")

# Fallback only. `discover_targets()` reads the live set selector so a newly
# released set is picked up without a code change; this list is what we fall
# back to if that markup ever changes shape. Ordered oldest → newest, matching
# the decks-page filter (data-rotation / data-set on the set selector).
FALLBACK_SET_TARGETS: List[Tuple[str, str]] = [
    # rotation 2024 — Shrouded Fable through Prismatic Evolutions
    ("2024", "SFA"),  # Shrouded Fable
    ("2024", "SCR"),  # Stellar Crown
    ("2024", "SSP"),  # Surging Sparks
    ("2024", "PRE"),  # Prismatic Evolutions
    # rotation 2025 — Journey Together through Ascended Heroes
    ("2025", "JTG"),  # Journey Together
    ("2025", "DRI"),  # Destined Rivals
    ("2025", "BLK/WHT"),  # Black Bolt / White Flare
    ("2025", "MEG"),  # Mega Evolution
    ("2025", "PFL"),  # Phantasmal Flames
    ("2025", "ASC"),  # Ascended Heroes
    # rotation 2026 — Perfect Order through the current format, Pitch Black
    ("2026", "POR"),  # Perfect Order
    ("2026", "CRI"),  # Chaos Rising
    ("2026", "PBL"),  # Pitch Black
]


def targets_from_selector(html: str) -> List[Tuple[str, str]]:
    """Cut the decks-page set selector down to the snapshots we scrape.

    The selector lists sets newest-first and spans every rotation back to 2021,
    so we reverse it and cut everything older than EARLIEST_TARGET. That single
    cut handles both the rotation floor and the pre-SFA 2024 sets, because
    document order puts older rotations after 2024. Options with no rotation
    are dropped: a snapshot is only addressable as a (rotation, set) pair.
    """
    options = [pair for pair in parse_set_options(html) if pair[0]]
    options.reverse()
    if EARLIEST_TARGET not in options:
        return []
    return options[options.index(EARLIEST_TARGET):]


def discover_targets() -> List[Tuple[str, str]]:
    try:
        targets = targets_from_selector(fetch_decks_html({}))
    except RuntimeError as err:
        print(f"WARNING: could not fetch the set selector ({err});", file=sys.stderr)
        targets = []
    if targets:
        return targets
    print(
        f"WARNING: set selector unreadable or missing {':'.join(EARLIEST_TARGET)} —"
        " falling back to the hardcoded set list.",
        file=sys.stderr,
    )
    return FALLBACK_SET_TARGETS


def parse_rows(html: str) -> Dict[str, List[str]]:
    """Map each archetype display name → ordered, de-duped icon slug list."""
    return {row.name: row.icons for row in parse_deck_rows(html) if row.icons}


def load_existing() -> Dict[str, List[str]]:
    try:
        with OUTPUT_PATH.open(encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def parse_target(value: str) -> Tuple[str, str]:
    rotation, sep, set_code = value.partition(":")
    if not sep or not rotation or not set_code:
        raise argparse.ArgumentTypeError(f"--target must be 'rotation:set' (got {value!r})")
    return rotation, set_code


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--target",
        dest="targets",
        action="append",
        type=parse_target,
        metavar="ROTATION:SET",
        help="Scrape only this rotation:set snapshot (repeatable). Defaults to the full SFA→current set.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace existing keys instead of preserving hand-edited values.",
    )
    args = parser.parse_args()
    targets = args.targets or discover_targets()

    scraped: Dict[str, List[str]] = {}
    for index, (rotation, set_code) in enumerate(targets):
        if index:
            time.sleep(REQUEST_DELAY)
        print(f"Fetching decks (rotation={rotation}, set={set_code})...")
        html = fetch_decks_html({"rotation": rotation, "set": set_code})
        rows = parse_rows(html)
        new = sum(1 for name in rows if name not in scraped)
        print(f"  parsed {len(rows)} archetype rows (+{new} new to this run)")
        for name, slugs in rows.items():
            # First snapshot to surface an archetype wins; icons are stable across
            # formats, so this just keeps the run deterministic.
            scraped.setdefault(name, slugs)

    if not scraped:
        print("ERROR: no archetype rows parsed — page layout may have changed.", file=sys.stderr)
        return 1

    existing = load_existing()
    if args.overwrite:
        merged = {**existing, **scraped}
    else:
        # Preserve hand-edited keys; only add archetypes we didn't already have.
        merged = {**scraped, **existing}

    # These are deliberately absent from the Limitless deck index, so every
    # refresh must restore their manual representative icon.
    merged = {**merged, **MANUAL_ICON_OVERRIDES}

    merged = {k: merged[k] for k in sorted(merged, key=str.lower)}

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as handle:
        json.dump(merged, handle, indent=2, ensure_ascii=False)
        handle.write("\n")

    added = len(merged) - len(existing)
    print(f"Wrote {OUTPUT_PATH} ({len(merged)} archetypes, +{added} new from {len(targets)} snapshot(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
