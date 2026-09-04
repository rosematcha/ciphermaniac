"""Reading the Limitless ``/decks`` tournament rankings.

Not the page :mod:`limitless_decks` reads, despite the identical path. That one
is play.limitlesstcg.com — the online ladder, ranked by how many players brought
a deck. This is limitlesstcg.com, the real-tournament side, ranked by the
championship points a deck earned. A rotated format that was played at
Regionals has its metagame here and next to nothing on the ladder, which is why
a format can be worth reading from this table instead.

A row looks like::

    <tr>
      <td>1</td>
      <td><img class="pokemon" alt="giratina-origin" src="..."></td>
      <td><a href="/decks/240">Giratina <span class="annotation">VSTAR</span></a></td>
      <td>2278</td>
      <td>15.70%</td>
    </tr>

Three things differ from the ladder's markup and each one costs a parse. The
deck's identity is a numeric id rather than a slug. The share is already a
percentage in its own cell, not a fraction in an attribute. And the name carries
a variant annotation, which is kept out of the label and spent only on
separating two rows that would otherwise collide.

Points rank with a long tail — the EFG table runs to decks on a single point —
so this source is cut at a rank rather than at a share floor. See
:func:`top_archetypes`.

Card art comes from the deck's own ``/cards`` page, which is a better source
than the ladder's: it is the average copy count of every card across every
recorded list, so there is nothing to sample and nothing to fold.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from typing import Dict, List, Optional, Sequence

from deck_arts import choose_arts
from limitless_decks import DeckRow, MAX_ICONS, fetch_html

EVENTS_BASE = "https://limitlesstcg.com"
EVENTS_URL = f"{EVENTS_BASE}/decks"

#: The tournament filter the ranking is read through. Everything unfiltered
#: except the format itself: a rotated format's whole history is the point.
BASE_QUERY: Dict[str, str] = {
    "time": "all",
    "type": "all",
    "region": "all",
    "division": "all",
    "show": "100",
}

_DECK_HREF_RE = re.compile(r"/decks/(\d+)")
_SHARE_RE = re.compile(r"([0-9.]+)\s*%")


@dataclass(frozen=True)
class _Parsed:
    """A row and the variant tag it may or may not need to keep."""

    row: DeckRow
    tag: str


def fetch_ranking_html(format_key: str, *, session=None) -> str:
    """The points ranking for one format, unfiltered but for the format."""
    return fetch_html(EVENTS_URL, {**BASE_QUERY, "format": format_key}, session=session)


def fetch_deck_cards_html(deck_id: str, format_key: str, *, session=None) -> str:
    """A deck's average card counts across every list recorded for the format."""
    return fetch_html(f"{EVENTS_URL}/{deck_id}/cards", {"time": "all", "format": format_key}, session=session)


def parse_ranking_rows(html: str) -> List[DeckRow]:
    """Every ranked deck, in the order the table lists them.

    ``count`` carries points rather than players — the two sources measure a
    different thing and the row has one number slot. Only :func:`top_archetypes`
    reads it, and only to keep the table's own order.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    parsed = [row for row in (_row(element) for element in soup.select("tr")) if row]
    return _named(parsed)


def top_archetypes(rows: Sequence[DeckRow], top: int) -> List[DeckRow]:
    """The first ``top`` rows.

    A rank cut, not a share floor: points thin out rather than stopping, and the
    EFG table runs on past decks worth a single one. Where to stop is a judgement
    about how many tiles a board wants, so it is a number the format catalog
    states rather than one derived from the data.
    """
    return list(rows[:top])


def archetype_arts(deck_id: str, format_key: str, icons: Sequence[str], *, session=None) -> List[str]:
    """The cards a deck was built around, from its average-counts page."""
    cards = parse_deck_pokemon(fetch_deck_cards_html(deck_id, format_key, session=session))
    # One "list", because the page already averaged every list there was.
    return choose_arts(icons, [cards] if cards else [])


def parse_deck_pokemon(html: str) -> List[Dict[str, object]]:
    """The Pokemon column of an average-counts page, most-played first.

    Read off the column its own heading names, exactly as a decklist is: a deck
    is never named after its Rare Candy, and the page has already separated the
    three categories.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    cards: List[Dict[str, object]] = []
    for column in soup.select("div.decklist-column"):
        heading = column.select_one(".decklist-column-heading")
        if not heading or not heading.get_text(strip=True).lower().startswith("pok"):
            continue
        for entry in column.select("div.decklist-card"):
            card = _card(entry)
            if card:
                cards.append(card)
    return cards


def _card(entry) -> Optional[Dict[str, object]]:
    set_code = (entry.get("data-set") or "").strip().upper()
    number = (entry.get("data-number") or "").strip()
    name = entry.select_one(".card-name")
    count = entry.select_one(".card-count")
    if not set_code or not number or not name:
        return None
    return {
        "count": _float(count.get_text(strip=True) if count else "0"),
        "name": name.get_text(strip=True),
        "set": set_code,
        "number": number,
    }


def _row(element) -> Optional["_Parsed"]:
    link = element.find("a", href=_DECK_HREF_RE)
    cells = element.find_all("td")
    if not link or len(cells) < 5:
        return None
    annotation = link.find("span", class_="annotation")
    tag = annotation.get_text(strip=True) if annotation else ""
    if annotation:
        annotation.extract()
    # Counted from the right: share is the last column and points the one before
    # it, which stays true if the table ever grows one on the left.
    share = _share(cells[-1].get_text(strip=True))
    if share is None:
        return None
    row = DeckRow(
        name=link.get_text(" ", strip=True),
        slug=_DECK_HREF_RE.search(link.get("href") or "").group(1),
        icons=_icons(element),
        count=_points(cells[-2].get_text(strip=True)),
        share=share,
    )
    return _Parsed(row, tag)


def _named(parsed: Sequence["_Parsed"]) -> List[DeckRow]:
    """Bare names, except where two decks share one and the tag tells them apart.

    The board keys its tiles by name, so a collision is one tile with the other
    silently dropped. Limitless prints the variant annotation for exactly this
    reason — "Giratina VSTAR" against a second Giratina — so it is what gets
    spent, and only on the rows that need it.
    """
    counts: Dict[str, int] = {}
    for entry in parsed:
        counts[entry.row.name] = counts.get(entry.row.name, 0) + 1
    return [
        replace(entry.row, name=f"{entry.row.name} {entry.tag}".strip())
        if counts[entry.row.name] > 1 and entry.tag
        else entry.row
        for entry in parsed
    ]


def _icons(element) -> List[str]:
    slugs: List[str] = []
    for img in element.select("img.pokemon"):
        slug = (img.get("alt") or "").strip().lower()
        if slug and slug not in slugs:
            slugs.append(slug)
        if len(slugs) >= MAX_ICONS:
            break
    return slugs


def _share(text: str) -> Optional[float]:
    match = _SHARE_RE.search(text)
    return float(match.group(1)) / 100 if match else None


def _points(text: str) -> Optional[int]:
    digits = text.replace(",", "").strip()
    return int(digits) if digits.isdigit() else None


def _float(text: str) -> float:
    try:
        return float(text)
    except ValueError:
        return 0.0
