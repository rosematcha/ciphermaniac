"""Reading the Limitless ``/decks`` metagame table.

Two producers scrape this page for different halves of the same row: the icon
map wants the sprite slugs, and the format archetype snapshot wants the shares.
They were parsing the same markup twice, so the fetch, the retry policy and the
row shape live here instead; :mod:`deck_arts` follows the row's slug through to
the deck's own page and borrows the fetch on the way.

A row looks like::

    <tr data-share="0.0714" data-winrate="0.667">
      <td>2</td>
      <td><img class="pokemon" src=".../pokemon/gen9/gardevoir.png"></td>
      <td><a href="/decks/gardevoir-ex-sv?format=expanded">Gardevoir</a></td>
      <td class="landscape-only">3</td>
      ...

``data-share`` is a fraction, not a percentage, and the count cell is the number
of players who brought the deck. Both are carried through unrounded; callers
decide what to do with them.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, replace
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

import requests

DECKS_URL = "https://play.limitlesstcg.com/decks"
HTTP_TIMEOUT = 20
HTTP_RETRIES = 4
#: Seconds between consecutive page fetches. The page is free and we are guests.
REQUEST_DELAY = 0.5
USER_AGENT = "ciphermaniac-decks-scraper/1.0"

#: Limitless's residual bucket. Never an archetype in its own right.
OTHER_DECK_NAME = "Other"

#: Sprites per archetype. The page shows at most two and so do we.
MAX_ICONS = 2

_ICON_SRC_RE = re.compile(r"/pokemon/[^/]+/([^/]+?)\.png", re.IGNORECASE)
_DECK_HREF_RE = re.compile(r"/decks/([^/?#]+)")
_SUMMARY_RE = re.compile(r"<p>([^<]*?\d+\s+tournaments[^<]*)</p>")


@dataclass(frozen=True)
class DeckRow:
    """One archetype's line in the metagame table."""

    name: str
    #: Limitless's own deck slug, e.g. ``buzzwole-gx``. The only stable identity
    #: a row has: two different decks can share a display name.
    slug: str
    #: Ordered, de-duped sprite slugs, at most :data:`MAX_ICONS`.
    icons: List[str]
    #: Players who brought the deck, or None when the page omitted the cell.
    count: Optional[int]
    #: Metagame share as a fraction of the field, not a percentage.
    share: float

    @property
    def is_other(self) -> bool:
        return self.name == OTHER_DECK_NAME


def fetch_html(url: str, params: Dict[str, str], *, session: Optional[requests.Session] = None) -> str:
    """GET a Limitless page, retrying with a widening backoff.

    Raises RuntimeError rather than returning a partial page: a producer that
    writes a snapshot from a failed fetch publishes an empty format.
    """
    get = session.get if session else requests.get
    last_err: Exception | None = None
    for attempt in range(HTTP_RETRIES):
        try:
            resp = get(url, params=params, timeout=HTTP_TIMEOUT, headers={"User-Agent": USER_AGENT})
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as err:  # pragma: no cover - network
            last_err = err
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {url} ({params}): {last_err}")


def fetch_decks_html(params: Dict[str, str], *, session: Optional[requests.Session] = None) -> str:
    """GET the metagame table."""
    return fetch_html(DECKS_URL, params, session=session)


def parse_deck_rows(html: str) -> List[DeckRow]:
    """Every archetype row on the page, in the order it is listed."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    rows: List[DeckRow] = []
    for element in soup.select("tr[data-share]"):
        link = element.find("a", href=_DECK_HREF_RE)
        name = link.get_text(strip=True) if link else ""
        share = _to_float(element.get("data-share"))
        if not name or share is None:
            continue
        rows.append(
            DeckRow(
                name=name,
                slug=_deck_slug(link),
                icons=_row_icons(element),
                count=_row_count(element),
                share=share,
            )
        )
    return rows


def parse_field_size(html: str) -> int:
    """Players behind the table, read off its "N tournaments, M players" line.

    Zero when the line is missing or the page reports an empty window — callers
    use it to tell "no data here" from "we failed to parse".
    """
    match = _SUMMARY_RE.search(html)
    if not match:
        return 0
    players = re.search(r"(\d+)\s+players", match.group(1))
    return int(players.group(1)) if players else 0


def parse_set_options(html: str) -> List[Tuple[str, str]]:
    """The set selector's ``(rotation, set)`` pairs, newest first.

    Page order, unreversed: callers want opposite ends of it — the format
    snapshot reads the newest windows, the icon map walks forward from a floor.

    The rotation is ``""`` on formats that do not rotate: Expanded's selector
    carries only ``data-set``, so requiring a rotation would return nothing for
    exactly the format whose windows we need.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    selector = soup.find("select", id="set")
    if not selector:
        return []
    options: List[Tuple[str, str]] = []
    for option in selector.find_all("option"):
        rotation = (option.get("data-rotation") or "").strip()
        code = (option.get("data-set") or "").strip()
        if code and (rotation, code) not in options:
            options.append((rotation, code))
    return options


def aggregate_rows(pages: Sequence[Sequence[DeckRow]]) -> List[DeckRow]:
    """Fold several windows of the same format into one ranked table.

    Shares are recomputed from summed player counts rather than averaged: a
    window with twelve players and one with a hundred do not carry equal weight,
    and averaging their percentages says they do. Rows with no count cell are
    dropped, since there is nothing to add them into.

    Folded on the deck slug, not the display name — Limitless lists
    ``buzzwole-gx`` and ``buzzwole-fli`` as two rows both labelled "Buzzwole",
    and adding them together would invent a deck neither of them is.

    Icons and names come from the first window that supplied them, which keeps
    the result stable when an older window predates a sprite.
    """
    counts: Dict[str, int] = {}
    seen: Dict[str, DeckRow] = {}
    for rows in pages:
        for row in rows:
            if row.count is None:
                continue
            key = row.slug or row.name
            counts[key] = counts.get(key, 0) + row.count
            if key not in seen or (row.icons and not seen[key].icons):
                seen[key] = row
    field = sum(counts.values())
    if field == 0:
        return []
    merged = [
        DeckRow(name=seen[key].name, slug=seen[key].slug, icons=seen[key].icons, count=count, share=count / field)
        for key, count in counts.items()
    ]
    merged.sort(key=lambda row: (-row.share, row.name))
    return merged


def disambiguate_names(rows: Sequence[DeckRow]) -> List[DeckRow]:
    """Give colliding display names a suffix drawn from their deck slugs.

    Limitless labels both ``buzzwole-gx`` and ``buzzwole-fli`` "Buzzwole" and
    leaves the slug to tell them apart, but a tier list keys its tiles by name:
    two "Buzzwole" tiles are one tile with the other silently dropped.

    The suffix is the slug's last segment — "Buzzwole (GX)", "Buzzwole (FLI)" —
    which is the convention Limitless itself uses where it does disambiguate
    ("Blacephalon (GX)"). Only collisions are touched, so an unambiguous name
    keeps the label the format's players actually use.
    """
    collisions = _repeats(row.name for row in rows)
    if not collisions:
        return list(rows)
    tagged = [(row, f"{row.name} ({_suffix(row)})" if row.name in collisions else row.name) for row in rows]
    # A suffix that does not separate them is worse than none. The fallback is
    # built from the original name, not the tagged one, so a row cannot end up
    # wearing both.
    unresolved = _repeats(tag for _, tag in tagged)
    return [
        replace(row, name=f"{row.name} ({row.slug})" if tag in unresolved else tag) for row, tag in tagged
    ]


def _repeats(names: Iterable[str]) -> Set[str]:
    seen: Set[str] = set()
    twice: Set[str] = set()
    for name in names:
        twice.add(name) if name in seen else seen.add(name)
    return twice


def _suffix(row: DeckRow) -> str:
    tail = row.slug.rsplit("-", 1)[-1] if row.slug else ""
    return tail.upper() if tail else row.name


def _deck_slug(link) -> str:
    match = _DECK_HREF_RE.search(link.get("href") or "")
    return match.group(1) if match else ""


def _row_icons(element) -> List[str]:
    slugs: List[str] = []
    for img in element.select("img.pokemon"):
        match = _ICON_SRC_RE.search(img.get("src") or "")
        if not match:
            continue
        slug = match.group(1).lower()
        if slug and slug not in slugs:
            slugs.append(slug)
        if len(slugs) >= MAX_ICONS:
            break
    return slugs


def _row_count(element) -> Optional[int]:
    for cell in element.select("td.landscape-only"):
        text = cell.get_text(strip=True)
        if text.isdigit():
            return int(text)
    return None


def _to_float(value) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
