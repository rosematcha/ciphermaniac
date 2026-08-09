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
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Tuple

import requests
from bs4 import BeautifulSoup

LIMITLESS_DECKS_URL = "https://play.limitlesstcg.com/decks"
ICON_SRC_RE = re.compile(r"/pokemon/[^/]+/([^/]+?)\.png", re.IGNORECASE)
HTTP_TIMEOUT = 20
HTTP_RETRIES = 4
REQUEST_DELAY = 0.5  # be polite between snapshot fetches
OUTPUT_PATH = Path("src") / "data" / "archetype-icons.json"
MAX_ICONS = 2

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


def parse_set_options(html: str) -> List[Tuple[str, str]]:
    """Read the decks-page set selector, oldest → newest.

    The selector lists sets newest-first and spans every rotation back to 2021,
    so we reverse it and cut everything older than EARLIEST_TARGET. That single
    cut handles both the rotation floor and the pre-SFA 2024 sets, because
    document order puts older rotations after 2024.
    """
    soup = BeautifulSoup(html, "html.parser")
    selector = soup.find("select", id="set")
    if not selector:
        return []

    options: List[Tuple[str, str]] = []
    for option in selector.find_all("option"):
        rotation = (option.get("data-rotation") or "").strip()
        set_code = (option.get("data-set") or "").strip()
        if rotation and set_code and (rotation, set_code) not in options:
            options.append((rotation, set_code))

    options.reverse()
    if EARLIEST_TARGET not in options:
        return []
    return options[options.index(EARLIEST_TARGET):]


def discover_targets() -> List[Tuple[str, str]]:
    try:
        targets = parse_set_options(fetch_html({}))
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


def fetch_html(params: Dict[str, str]) -> str:
    last_err: Exception | None = None
    for attempt in range(HTTP_RETRIES):
        try:
            resp = requests.get(
                LIMITLESS_DECKS_URL,
                params=params,
                timeout=HTTP_TIMEOUT,
                headers={"User-Agent": "ciphermaniac-icon-scraper/1.0"},
            )
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as err:  # pragma: no cover - network
            last_err = err
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch decks ({params}): {last_err}")


def parse_rows(html: str) -> Dict[str, List[str]]:
    """Map each archetype display name → ordered, de-duped icon slug list."""
    soup = BeautifulSoup(html, "html.parser")
    mapping: Dict[str, List[str]] = {}
    for row in soup.select("tr"):
        link = row.find("a", href=re.compile(r"/decks/"))
        if not link:
            continue
        name = link.get_text(strip=True)
        if not name:
            continue
        slugs: List[str] = []
        for img in row.select("img.pokemon"):
            match = ICON_SRC_RE.search(img.get("src") or "")
            if not match:
                continue
            slug = match.group(1).lower()
            if slug and slug not in slugs:
                slugs.append(slug)
            if len(slugs) >= MAX_ICONS:
                break
        if slugs:
            mapping[name] = slugs
    return mapping


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
        html = fetch_html({"rotation": rotation, "set": set_code})
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
