#!/usr/bin/env python3
"""Snapshot the played archetypes of each non-Standard format we offer.

The Tier List Maker ranks a *format*, not a tournament. Standard comes from our
own rolling online-meta report on R2, which we already rebuild daily. Everything
else has no report behind it, so this scrapes the Limitless metagame table once
and commits the result to ``src/data/format-archetypes.json``.

Two kinds of format live in that file:

``current``
    Expanded, which is still being played and so is re-scraped on a schedule.
    Monthly is plenty — see the window note below.
``past``
    Rotated-out formats. Their metagames are settled; a re-scrape would produce
    the same table, so they are scraped by hand when added and then left alone.

Every scrape asks for combined deck variants (``combine=1``), because a tier
list wants "Lugia Archeops", not four spellings of it, and drops rows at or
below :data:`SHARE_FLOOR` along with Limitless's residual "Other" bucket.

Each surviving row is then followed to its own deck page for the cards it was
built around, so the tier list's Previews mode works on a format we hold no
decklists for. That pass is most of a scrape's runtime — see :mod:`deck_arts`.

**Two tables, not one.** Most formats read play.limitlesstcg.com — the online
ladder, which is where a rotated format still gets played. EFG is the exception:
it was a real-tournament Standard format, so its metagame lives on
limitlesstcg.com's points ranking instead, and it is cut at a rank rather than
at a share floor. See :mod:`limitless_events`.

**The Expanded window.** Unlike the past formats, whose pages cover their whole
history, ``?format=expanded`` shows only the current set's window — six
tournaments and forty-odd players as this was written. At a 0.75% floor a single
player clears the bar, so that window alone would tier two dozen one-offs. We
therefore walk the set selector backwards and fold the newest
:data:`EXPANDED_WINDOWS` windows that have any players into one table, summing
player counts and recomputing share from the total.

Usage:
    # Re-scrape everything, including the past formats:
    python .github/scripts/scrape-format-archetypes.py --all

    # What the monthly workflow runs — refresh Expanded, leave the rest:
    python .github/scripts/scrape-format-archetypes.py --format expanded

    # Print the result instead of writing it:
    python .github/scripts/scrape-format-archetypes.py --all --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))

import limitless_events as events  # noqa: E402
from deck_arts import archetype_arts  # noqa: E402
from limitless_decks import (  # noqa: E402
    DeckRow,
    REQUEST_DELAY,
    aggregate_rows,
    disambiguate_names,
    fetch_decks_html,
    parse_deck_rows,
    parse_field_size,
    parse_set_options,
)

OUTPUT_PATH = Path("src") / "data" / "format-archetypes.json"

#: Minimum metagame share, in percent, for an archetype to earn a tile.
SHARE_FLOOR = 0.75

#: How many non-empty set windows an aggregated format folds together.
EXPANDED_WINDOWS = 6

#: How far back to look for those windows before giving up on finding more.
EXPANDED_WINDOW_SCAN = 12


@dataclass(frozen=True)
class FormatSpec:
    """One entry in the tier list's format picker."""

    #: The ``?format=`` value on play.limitlesstcg.com. Doubles as our own id.
    id: str
    label: str
    #: "current" formats are re-scraped on a schedule; "past" ones are frozen.
    group: str
    #: Fold several set windows into one table. See the module docstring.
    aggregate: bool = False
    #: Read the real-tournament points ranking on limitlesstcg.com instead of
    #: the online ladder. Set :attr:`query` and :attr:`top` with it.
    events: bool = False
    #: The events table's own format key, which is not our id — ours is frozen
    #: into shared tier-list URLs and theirs names a set range.
    query: Optional[str] = None
    #: Rank to cut the events table at. Points thin out rather than stopping, so
    #: there is no share floor to apply. See :func:`limitless_events.top_archetypes`.
    top: Optional[int] = None


FORMATS: List[FormatSpec] = [
    FormatSpec("expanded", "Expanded", "current", aggregate=True),
    FormatSpec("ex", "RS-PK", "past"),
    FormatSpec("2010", "2010", "past"),
    FormatSpec("2011", "2011", "past"),
    FormatSpec("2016", "2016", "past"),
    FormatSpec("sumlot", "SUM-LOT", "past"),
    FormatSpec("rmep", "EFG", "past", events=True, query="BST-PAR", top=22),
]

FORMATS_BY_ID: Dict[str, FormatSpec] = {spec.id: spec for spec in FORMATS}


def ranked_archetypes(rows: Sequence[DeckRow]) -> List[Dict[str, object]]:
    """Rows worth a tile, most-played first, as the JSON records them.

    Names are disambiguated *after* the floor, not before: a deck whose
    same-named twin never made the cut keeps its plain label, which is the one
    the format's players use.

    The slug rides along unwritten: it is how the arts pass finds the deck's
    page, and it is dropped again before the file is written because nothing at
    runtime has any use for it.
    """
    kept = [row for row in rows if not row.is_other and row.share * 100 > SHARE_FLOOR]
    kept = disambiguate_names(kept)
    kept.sort(key=lambda row: (-row.share, row.name))
    return [
        {"name": row.name, "slug": row.slug, "icons": row.icons, "share": round(row.share * 100, 2)}
        for row in kept
    ]


def attach_arts(
    archetypes: List[Dict[str, object]], format_id: str, set_codes: Sequence[str]
) -> List[Dict[str, object]]:
    """Give every archetype the cards its decks were built around.

    A deck page plus a handful of decklists each, which is the expensive half of
    a scrape — a full ``--all`` run is a few hundred requests. That is the price
    of a Previews mode on formats we hold no decklists for, and it is paid
    monthly for Expanded and once for a past format.
    """
    out: List[Dict[str, object]] = []
    for archetype in archetypes:
        slug = str(archetype.pop("slug", ""))
        icons = archetype.get("icons") or []
        arts = archetype_arts(slug, format_id, icons, set_codes=set_codes) if slug else []
        if not arts:
            print(f"  ! {archetype['name']}: no card art found")
        out.append({**archetype, "cards": arts})
        time.sleep(REQUEST_DELAY)
    return out


def scrape_single(spec: FormatSpec) -> Tuple[Dict[str, object], List[str]]:
    """A format whose page already covers its whole history."""
    html = fetch_decks_html({"format": spec.id, "combine": "1"})
    return _entry(spec, ranked_archetypes(parse_deck_rows(html)), {"players": parse_field_size(html)}, 1), []


def scrape_events(spec: FormatSpec) -> Dict[str, object]:
    """A format read off the real-tournament points ranking.

    Its own end-to-end path, not a branch inside the ladder's: different site,
    different markup, a rank cut instead of a share floor, and card art that
    comes pre-averaged rather than sampled. The only thing the two share is the
    shape they write.
    """
    rows = events.top_archetypes(events.parse_ranking_rows(events.fetch_ranking_html(spec.query)), spec.top)
    if not rows:
        raise RuntimeError(f"{spec.id}: the {spec.query} ranking came back empty — page layout may have changed")
    archetypes = []
    for row in rows:
        time.sleep(REQUEST_DELAY)
        arts = events.archetype_arts(row.slug, spec.query, row.icons)
        if not arts:
            print(f"  ! {row.name}: no card art found")
        archetypes.append(
            {"name": row.name, "icons": row.icons, "share": round(row.share * 100, 2), "cards": arts}
        )
    return _entry(spec, archetypes, {"points": sum(row.count or 0 for row in rows), "top": spec.top}, 1)


def scrape_aggregated(spec: FormatSpec) -> Tuple[Dict[str, object], List[str]]:
    """A format that has to be read one set window at a time.

    The windows that had players come back with the entry: the archetype pages
    the arts pass reads are windowed the same way this table is, so they have to
    be walked over the same set codes or they answer for the newest set alone.
    """
    index = fetch_decks_html({"format": spec.id, "combine": "1"})
    codes = [code for _, code in parse_set_options(index)]
    if not codes:
        raise RuntimeError(f"{spec.id}: set selector unreadable, cannot pick windows")

    pages: List[Sequence[DeckRow]] = []
    used: List[str] = []
    players = 0
    for code in codes[:EXPANDED_WINDOW_SCAN]:
        if len(pages) >= EXPANDED_WINDOWS:
            break
        time.sleep(REQUEST_DELAY)
        html = fetch_decks_html({"format": spec.id, "combine": "1", "set": code})
        field = parse_field_size(html)
        print(f"  {code}: {field} players")
        if field == 0:
            continue
        pages.append(parse_deck_rows(html))
        used.append(code)
        players += field

    if not pages:
        raise RuntimeError(f"{spec.id}: every set window came back empty")
    return _entry(spec, ranked_archetypes(aggregate_rows(pages)), {"players": players}, len(pages)), used


def _entry(
    spec: FormatSpec, archetypes: List[Dict[str, object]], provenance: Dict[str, object], windows: int
) -> Dict[str, object]:
    """The written shape, whichever table produced it.

    ``provenance`` says what was measured and where the table was cut, under the
    names those things actually go by: players and a share floor for the ladder,
    championship points and a rank for the tournament ranking. Flattening the
    two onto one pair of keys would make one of them a lie, and the difference
    is what tells a reader why a 0.29% deck earned a tile.
    """
    return {
        "id": spec.id,
        "label": spec.label,
        "group": spec.group,
        **provenance,
        "windows": windows,
        "scrapedAt": date.today().isoformat(),
        "archetypes": archetypes,
    }


def scrape(spec: FormatSpec) -> Dict[str, object]:
    print(f"Scraping {spec.label} (format={spec.id})...")
    if spec.events:
        entry = scrape_events(spec)
        print(f"  took the top {len(entry['archetypes'])} of the {spec.query} ranking")
        return entry
    entry, set_codes = scrape_aggregated(spec) if spec.aggregate else scrape_single(spec)
    archetypes = entry["archetypes"]
    assert isinstance(archetypes, list)
    print(f"  kept {len(archetypes)} archetypes above {SHARE_FLOOR}% of {entry['players']} players")
    if not archetypes:
        raise RuntimeError(f"{spec.id}: nothing cleared the share floor — page layout may have changed")
    entry["archetypes"] = attach_arts(archetypes, spec.id, set_codes)
    return entry


def load_existing() -> Dict[str, Dict[str, object]]:
    """Committed entries keyed by format id, or empty when there is no file yet."""
    try:
        with OUTPUT_PATH.open(encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    formats = data.get("formats") if isinstance(data, dict) else None
    if not isinstance(formats, list):
        return {}
    return {entry["id"]: entry for entry in formats if isinstance(entry, dict) and entry.get("id")}


def merge(existing: Dict[str, Dict[str, object]], scraped: Dict[str, Dict[str, object]]) -> Dict[str, object]:
    """Rebuild the file in :data:`FORMATS` order, keeping formats we did not scrape.

    Order matters: the picker renders the file top to bottom, so the catalog
    here is what decides where a format sits rather than the order a partial
    re-scrape happened to visit them in.
    """
    merged = {**existing, **scraped}
    return {
        "version": 1,
        "shareFloor": SHARE_FLOOR,
        "formats": [merged[spec.id] for spec in FORMATS if spec.id in merged],
    }


def selected(args: argparse.Namespace) -> List[FormatSpec]:
    if args.all:
        return FORMATS
    return [FORMATS_BY_ID[name] for name in args.formats]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--format",
        dest="formats",
        action="append",
        choices=sorted(FORMATS_BY_ID),
        metavar="ID",
        help=f"Scrape only this format (repeatable). One of: {', '.join(sorted(FORMATS_BY_ID))}.",
    )
    parser.add_argument("--all", action="store_true", help="Scrape every format, past ones included.")
    parser.add_argument("--dry-run", action="store_true", help="Print the merged file instead of writing it.")
    args = parser.parse_args()
    if not args.all and not args.formats:
        parser.error("pass --format ID (repeatable) or --all")

    scraped: Dict[str, Dict[str, object]] = {}
    for index, spec in enumerate(selected(args)):
        if index:
            time.sleep(REQUEST_DELAY)
        scraped[spec.id] = scrape(spec)

    document = merge(load_existing(), scraped)
    text = json.dumps(document, indent=2, ensure_ascii=False) + "\n"
    if args.dry_run:
        print(text)
        return 0

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(text, encoding="utf-8")
    total = sum(len(entry["archetypes"]) for entry in document["formats"])
    print(f"Wrote {OUTPUT_PATH} ({len(document['formats'])} formats, {total} archetypes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
