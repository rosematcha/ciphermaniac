"""Choosing the card arts that stand for an archetype in a scraped format.

The tier list's Previews mode shows an archetype as its cards. Standard gets
those from our own reports, which know what every deck played; a scraped format
has no report behind it, so the arts come from where its share already did.
Limitless gives each archetype a page of the decks that played it, and every
decklist names its Pokemon with a set and a number.

The pick is anchored on the sprite slugs the metagame row already carries. Those
slugs *are* the deck's name in Pokemon form — Limitless picked them for the same
job — so taking one card per slug makes the Previews tile show the same deck the
Icons tile does, which is the only way the two views can be trusted against each
other.

A slug is not a card name, though, and the gap between them is the whole
problem: ``lucario-mega`` has to find "Mega Lucario ex", ``goodra-hisui``
"Hisuian Goodra VSTAR", ``inteleon-gmax`` "Inteleon VMAX". So a slug matches a
card in two tiers — every word of it on the card, or just the species — and the
looser tier is only consulted when the stricter one finds nothing. That ordering
is what keeps "Porygon-Z" from being answered with Porygon2.
"""

from __future__ import annotations

import re
import time
from collections import OrderedDict
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from limitless_decks import REQUEST_DELAY, fetch_html

#: Cards per archetype. The tile stacks at most three but Standard ships two,
#: and a scraped format should not look richer than the format we have data for.
MAX_ARTS = 2

#: Form words a sprite slug spells differently from the card that carries them.
#: Gigantamax is the odd one: the sprite is the G-Max form, the card is a VMAX.
SLUG_WORD_ALIASES: Dict[str, Tuple[str, ...]] = {
    "hisui": ("hisuian",),
    "alola": ("alolan",),
    "galar": ("galarian",),
    "paldea": ("paldean",),
    "gmax": ("vmax",),
    "eternamax": ("vmax",),
    # XY-era megas print as "M Lucario EX", Mega-era ones as "Mega Lucario ex".
    "mega": ("mega", "m"),
}

#: How much of a deck a printing tends to be about. Ties on play frequency are
#: common — a V and its VMAX ride in every list together — and the card the deck
#: is named after is always the one with the bigger suffix.
POWER_RANK: Dict[str, int] = {
    "vmax": 6,
    "vstar": 6,
    "gx": 5,
    "ex": 5,
    "prime": 5,
    "break": 5,
    "lv": 4,
    "star": 4,
    "v": 3,
}

#: One Pokemon line of a Limitless decklist: "4 Yanmega (TM-98)".
CARD_LINE_RE = re.compile(r"^(\d+)\s+(.+?)\s+\(([A-Za-z0-9]+)-([0-9A-Za-z]+)\)$")

CardKey = Tuple[str, str, str]


def tokenize(text: object) -> List[str]:
    """Words of a name or a slug, punctuation and the delta symbol dropped."""
    return re.sub(r"[^a-z0-9]+", " ", str(text).lower()).split()


def _power(name: str) -> int:
    return max((POWER_RANK.get(word, 0) for word in tokenize(name)), default=0)


def _slug_words(slug: str) -> List[Tuple[str, ...]]:
    """Each slug word as the set of spellings a card may use for it."""
    return [tuple({word, *SLUG_WORD_ALIASES.get(word, ())}) for word in tokenize(slug)]


def match_tier(slug: str, card_name: str) -> int:
    """How well a card answers a sprite slug: 2 whole, 1 species only, 0 not.

    Tier 2 is the form-exact read — "Origin Forme Dialga VSTAR" for
    ``dialga-origin``. Tier 1 exists because plenty of cards drop the form from
    their name entirely: the Lost Zone deck's Giratina is Origin Forme in the
    art and plain "Giratina VSTAR" in print.
    """
    words = _slug_words(slug)
    if not words:
        return 0
    found = set(tokenize(card_name))
    if all(any(spelling in found for spelling in group) for group in words):
        return 2
    return 1 if any(spelling in found for spelling in words[0]) else 0


def parse_pokemon_line(text: str) -> Optional[Dict[str, object]]:
    """One decklist line as a card, or None for anything that is not one."""
    match = CARD_LINE_RE.match(text.strip())
    if not match:
        return None
    return {
        "count": int(match.group(1)),
        "name": match.group(2),
        "set": match.group(3).upper(),
        "number": match.group(4),
    }


def thumbnail_id(set_code: object, number: object) -> str:
    """``SET/NNN``, the form the site's card-image layer takes."""
    text = str(number)
    match = re.match(r"^(\d+)([A-Za-z]*)$", text)
    padded = f"{match.group(1).zfill(3)}{match.group(2).upper()}" if match else text.upper()
    return f"{str(set_code).upper()}/{padded}"


def tally(lists: Sequence[Sequence[Dict[str, object]]]) -> "OrderedDict[CardKey, Dict[str, float]]":
    """Every printing across the sampled decks, with how much of the field ran it.

    Counted per list rather than per copy: a four-of in one deck says less about
    an archetype than a one-of in all of them. Copies stay a float, because one
    of the two sources hands over an average rather than a count.
    """
    agg: "OrderedDict[CardKey, Dict[str, float]]" = OrderedDict()
    for cards in lists:
        for card in cards:
            key = (str(card["name"]), str(card["set"]).upper(), str(card["number"]))
            entry = agg.setdefault(key, {"lists": 0, "copies": 0.0})
            entry["lists"] += 1
            entry["copies"] += float(card["count"])
    return agg


def _ranked(agg: "OrderedDict[CardKey, Dict[str, float]]", keep: Callable[[str], bool]) -> List[CardKey]:
    matched = [(key, stats) for key, stats in agg.items() if keep(key[0])]
    matched.sort(key=lambda pair: (-pair[1]["lists"], -_power(pair[0][0]), -pair[1]["copies"], pair[0][0]))
    return [key for key, _ in matched]


def choose_arts(icons: Sequence[str], lists: Sequence[Sequence[Dict[str, object]]]) -> List[str]:
    """One card per sprite, best first, as ``SET/NNN`` thumbnail ids.

    An archetype whose sprites name no card in its own decks — Regigigas Stall's
    Hoopa is drawn Unbound and printed plain — still gets a tile: the fallback is
    the Pokemon the field ran most, which is the deck's face by definition.
    """
    agg = tally(lists)
    if not agg:
        return []
    chosen: List[str] = []
    for slug in icons[:MAX_ARTS]:
        for tier in (2, 1):
            ids = [thumbnail_id(key[1], key[2])
                   for key in _ranked(agg, lambda name, s=slug, t=tier: match_tier(s, name) == t)]
            hit = next((thumb for thumb in ids if thumb not in chosen), None)
            if hit:
                chosen.append(hit)
                break
    if not chosen:
        chosen = [thumbnail_id(key[1], key[2]) for key in _ranked(agg, lambda name: True)[:1]]
    return chosen[:MAX_ARTS]


# --------------------------------------------------------------- fetching

PLAY_BASE = "https://play.limitlesstcg.com"

#: Decks sampled per archetype. The page is ordered by finish, so the first few
#: are the lists that defined the deck; going deeper buys noise, and every extra
#: one is another page fetch across a hundred-odd archetypes.
SAMPLE_LISTS = 6

_DECKLIST_HREF_RE = re.compile(r"/decklist/?$")


def parse_decklist_hrefs(html: str, limit: int = SAMPLE_LISTS) -> List[str]:
    """Links to the decks that played this archetype, best finish first."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    hrefs: List[str] = []
    for link in soup.select('a[href*="/decklist"]'):
        href = (link.get("href") or "").strip()
        if not href or not _DECKLIST_HREF_RE.search(href) or href in hrefs:
            continue
        hrefs.append(href)
        if len(hrefs) >= limit:
            break
    return hrefs


def parse_decklist_pokemon(html: str) -> List[Dict[str, object]]:
    """A decklist's Pokemon, read off the column its own heading names.

    Trainers and Energy are dropped here rather than filtered later: a deck is
    never named after its Rare Candy, and the columns are already separated.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    cards: List[Dict[str, object]] = []
    for block in soup.select("div.decklist div.cards"):
        heading = block.select_one(".heading")
        if not heading or not heading.get_text(strip=True).lower().startswith("pok"):
            continue
        for line in block.select("p"):
            card = parse_pokemon_line(line.get_text(" ", strip=True))
            if card:
                cards.append(card)
    return cards


def archetype_arts(
    slug: str,
    format_id: str,
    icons: Sequence[str],
    *,
    set_codes: Optional[Sequence[str]] = None,
    session=None,
) -> List[str]:
    """Scrape an archetype's sampled decklists and choose its arts.

    ``set_codes`` mirrors the aggregation the metagame table needed: an archetype
    page, like the table, shows only the current set's window, so a format read
    across several windows has to have its decks read across the same ones. Left
    unset the page is fetched once, which is right for a format whose page
    already covers its whole history.

    Identical lists are folded. The same player's deck appears under every
    tournament it entered, and counting it twice lets one build outvote a field.
    """
    lists: List[List[Dict[str, object]]] = []
    seen: set = set()
    for params in _windows(format_id, set_codes):
        if lists:
            time.sleep(REQUEST_DELAY)
        page = fetch_html(f"{PLAY_BASE}/decks/{slug}", params, session=session)
        for href in parse_decklist_hrefs(page, SAMPLE_LISTS - len(lists)):
            time.sleep(REQUEST_DELAY)
            cards = parse_decklist_pokemon(fetch_html(PLAY_BASE + href, {}, session=session))
            fingerprint = tuple(sorted((c["count"], c["name"], c["set"], c["number"]) for c in cards))
            if not cards or fingerprint in seen:
                continue
            seen.add(fingerprint)
            lists.append(cards)
        if len(lists) >= SAMPLE_LISTS:
            break
    return choose_arts(icons, lists)


def _windows(format_id: str, set_codes: Optional[Sequence[str]]) -> List[Dict[str, str]]:
    base = {"format": format_id, "combine": ""}
    if not set_codes:
        return [base]
    return [{**base, "set": code} for code in set_codes]
