#!/usr/bin/env python3
"""
Scrape all Day-2 decklists for a rotated archetype from limitlesstcg.com
and output aggregated JSON data for the "In Loving Memory" toy.

Usage:
    python .github/scripts/scrape-memorial.py <archetype_id> <slug>

Example:
    python .github/scripts/scrape-memorial.py 255 gardevoir
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from bs4 import BeautifulSoup

LIMITLESS_BASE_URL = "https://limitlesstcg.com"
HTTP_TIMEOUT = 20
HTTP_RETRIES = 4
FETCH_CONCURRENCY = int(os.environ.get("MEMORIAL_CONCURRENCY", "10"))

LOCAL_CARD_TYPES_PATH = Path("public") / "assets" / "data" / "card-types.json"
LOCAL_CARD_SYNONYMS_PATH = Path("public") / "assets" / "card-synonyms.json"

# ---------------------------------------------------------------------------
# Utilities (mirrors download-tournament.py patterns)
# ---------------------------------------------------------------------------

def normalize_card_number(value: Any) -> Optional[str]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    match = re.match(r"^(\d+)([A-Za-z]*)$", raw)
    if not match:
        return raw.upper()
    digits, suffix = match.groups()
    return f"{digits.zfill(3)}{suffix.upper()}"


def repair_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value)
    if "\u00e2" in text or "\u00c3" in text:
        try:
            repaired = text.encode("latin1").decode("utf-8")
            if repaired:
                text = repaired
        except Exception:
            pass
    return text.strip()


def request_with_retries(session, method, url, retries=HTTP_RETRIES, backoff_factor=0.5, **kwargs):
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            resp = session.request(method, url, **kwargs)
            resp.raise_for_status()
            return resp
        except requests.exceptions.RequestException as e:
            last_exc = e
            sleep_for = backoff_factor * (2 ** (attempt - 1))
            print(f"  Request failed (attempt {attempt}/{retries}): {e}; retrying in {sleep_for:.1f}s...")
            time.sleep(sleep_for)
    print(f"  All retries failed for {url}: {last_exc}")
    return None


def get_soup(url: str, session: requests.Session):
    headers = {"User-Agent": "Mozilla/5.0"}
    resp = request_with_retries(session, "GET", url, headers=headers, timeout=HTTP_TIMEOUT)
    if not resp:
        return None
    resp.encoding = "utf-8"
    return BeautifulSoup(resp.text, "html.parser")


def enrich_card_entry(card: dict, card_types_db: dict) -> dict:
    enriched = dict(card)
    set_code = enriched.get("set")
    number = enriched.get("number")
    key = f"{set_code}::{number}" if set_code and number else None
    info = card_types_db.get(key) if key else None

    if info:
        card_type = info.get("cardType")
        if card_type:
            enriched["category"] = card_type
        if card_type == "trainer" and info.get("subType"):
            enriched["trainerType"] = info["subType"]
        if card_type == "energy" and info.get("subType"):
            enriched["energyType"] = info["subType"]
        if info.get("fullType"):
            enriched["fullType"] = info["fullType"]
        if card_type == "trainer" and info.get("aceSpec"):
            enriched["aceSpec"] = True

    return enriched


def compose_category_path(base_category, trainer_type=None, energy_type=None, ace_spec=False):
    parts = []
    bc = (base_category or "").lower().strip()
    if bc:
        parts.append(bc)
    if bc == "trainer" and trainer_type:
        parts.append(trainer_type.lower())
        if ace_spec:
            parts.append("acespec")
    elif bc == "energy" and energy_type:
        parts.append(energy_type.lower())
    return "/".join(parts)


def canonicalize_variant(set_code: str, number: str):
    sc = (set_code or "").upper().strip()
    num = (number or "").lstrip("0")
    num = num.zfill(3) if num else num
    return sc, num


# ---------------------------------------------------------------------------
# Scrape results table
# ---------------------------------------------------------------------------

def scrape_results_page(session: requests.Session, archetype_id: int) -> List[dict]:
    """Scrape all rows from the archetype results page."""
    url = f"{LIMITLESS_BASE_URL}/decks/{archetype_id}/results"
    print(f"Fetching results page: {url}")
    soup = get_soup(url, session)
    if not soup:
        print("ERROR: Failed to fetch results page")
        return []

    rows = []
    tournament_urls: Dict[str, str] = {}  # tournament name -> /tournaments/XXX URL
    table = soup.find("table")
    if not table:
        print("ERROR: No table found on results page")
        return [], {}

    current_tournament = "Unknown Tournament"

    for tr in table.find_all("tr"):
        tds = tr.find_all("td")

        # Header rows contain the tournament name (th-only rows between data rows)
        if not tds:
            ths = tr.find_all("th")
            header_text = tr.get_text(strip=True)
            # Skip the column-header row (Place, Variant, Player, List)
            if ths and header_text and "Place" not in header_text and "Variant" not in header_text:
                current_tournament = repair_text(header_text) or current_tournament
                # Capture tournament URL for player count lookup
                link = tr.find("a", href=re.compile(r"/tournaments/\d+"))
                if link and current_tournament:
                    tournament_urls[current_tournament] = link.get("href", "")
            continue

        # Skip Junior and Senior division events — only Masters
        if "(JR)" in current_tournament or "(SR)" in current_tournament:
            continue

        if len(tds) < 5:
            continue

        # Column 0: format icon
        format_img = tds[0].find("img")
        fmt = format_img.get("alt", "standard") if format_img else "standard"

        # Column 1: placement
        placement_text = tds[1].get_text(strip=True)
        placement_match = re.match(r"(\d+)", placement_text)
        placement = int(placement_match.group(1)) if placement_match else None

        # Column 2: archetype icon (skip)

        # Column 3: player
        player_link = tds[3].find("a")
        player_name = player_link.get_text(strip=True) if player_link else tds[3].get_text(strip=True)
        player_url = player_link.get("href", "") if player_link else ""

        # Column 4: decklist link
        list_link = tds[4].find("a")
        if not list_link:
            continue
        href = list_link.get("href", "")
        list_match = re.search(r"/decks/list/(\d+)", href)
        if not list_match:
            continue
        list_id = int(list_match.group(1))

        rows.append({
            "listId": list_id,
            "player": repair_text(player_name),
            "playerUrl": player_url,
            "placement": placement,
            "format": fmt,
            "tournament": current_tournament,
        })

    print(f"Found {len(rows)} result rows with decklist links ({len(tournament_urls)} tournaments with URLs)")
    return rows, tournament_urls


# ---------------------------------------------------------------------------
# Parse individual decklist page
# ---------------------------------------------------------------------------

def fetch_tournament_players(session: requests.Session, tournament_url: str) -> Optional[int]:
    """Fetch player count from a tournament page."""
    url = f"{LIMITLESS_BASE_URL}{tournament_url}" if tournament_url.startswith("/") else tournament_url
    soup = get_soup(url, session)
    if not soup:
        return None
    for div in soup.find_all("div", class_="infobox-line"):
        text = div.get_text(strip=True)
        m = re.search(r"(\d[\d,]*)\s*Players?", text)
        if m:
            return int(m.group(1).replace(",", ""))
    return None


def fetch_all_tournament_sizes(session: requests.Session, tournament_urls: Dict[str, str]) -> Dict[str, int]:
    """Fetch player counts for all tournaments concurrently."""
    sizes: Dict[str, int] = {}
    if not tournament_urls:
        return sizes

    print(f"\nFetching player counts for {len(tournament_urls)} tournaments...")

    def fetch_one(name_url):
        name, url = name_url
        count = fetch_tournament_players(session, url)
        return name, count

    with ThreadPoolExecutor(max_workers=FETCH_CONCURRENCY) as executor:
        futures = {executor.submit(fetch_one, item): item for item in tournament_urls.items()}
        done = 0
        for future in as_completed(futures):
            name, count = future.result()
            done += 1
            if count is not None:
                sizes[name] = count
            if done % 20 == 0 or done == len(tournament_urls):
                print(f"  Tournament sizes: {done}/{len(tournament_urls)} ({len(sizes)} found)")

    print(f"Got player counts for {len(sizes)} tournaments")
    return sizes


def parse_decklist_page(soup: BeautifulSoup, card_types_db: dict) -> List[dict]:
    """Parse a /decks/list/XXXXX page into card entries.

    Structure:
      div.decklist-cards > div.decklist-column (one per section)
        div.decklist-column-heading  "Pokémon (16)" / "Trainer (33)" / "Energy (11)"
        div.decklist-card[data-set][data-number]
          a.card-link > span.card-count + span.card-name
    """
    cards = []
    decklist_cards = soup.find("div", class_="decklist-cards")
    if not decklist_cards:
        return cards

    for column in decklist_cards.find_all("div", class_="decklist-column"):
        heading = column.find("div", class_="decklist-column-heading")
        section = "trainer"
        if heading:
            text = heading.get_text(strip=True).lower()
            if "pok" in text:
                section = "pokemon"
            elif "energy" in text:
                section = "energy"

        for card_div in column.find_all("div", class_="decklist-card"):
            set_code = (card_div.get("data-set") or "").upper().strip()
            raw_number = card_div.get("data-number") or ""
            number = normalize_card_number(raw_number)

            count_span = card_div.find("span", class_="card-count")
            count = int(count_span.get_text(strip=True)) if count_span else 1

            name_span = card_div.find("span", class_="card-name")
            card_name = repair_text(name_span.get_text(strip=True)) if name_span else "Unknown Card"

            card = {
                "count": count,
                "name": card_name or "Unknown Card",
                "set": set_code,
                "number": number,
                "category": section,
            }
            cards.append(enrich_card_entry(card, card_types_db))

    return cards


def fetch_decklist(session: requests.Session, list_id: int, card_types_db: dict) -> Optional[List[dict]]:
    """Fetch and parse a single decklist."""
    url = f"{LIMITLESS_BASE_URL}/decks/list/{list_id}"
    soup = get_soup(url, session)
    if not soup:
        return None
    cards = parse_decklist_page(soup, card_types_db)
    return cards if cards else None


# ---------------------------------------------------------------------------
# Aggregation (mirrors generate_report_json from download-tournament.py)
# ---------------------------------------------------------------------------

def resolve_synonym(name: str, set_code: str, number: str, synonyms: dict, _canonicals: dict, category: str = "") -> tuple:
    """Resolve a card to its canonical UID via the synonym list.

    Uses exact UID→UID synonyms for all cards. For trainer and energy cards,
    same-name cards are always the same functional card (just different
    printings), so name-only canonicals are used as a fallback for those
    categories. Pokemon are NOT merged by name since same-name Pokemon can
    have different attacks/HP/abilities.
    """
    sc, num = canonicalize_variant(set_code, number)
    uid = f"{name}::{sc}::{num}" if sc and num else name

    if uid in synonyms:
        canonical_uid = synonyms[uid]
        parts = canonical_uid.split("::", 2)
        if len(parts) == 3:
            return parts[0], parts[1], parts[2]

    return name, sc, num


def generate_report_json(deck_list: List[dict], deck_total: int, synonyms: Optional[dict] = None, canonicals: Optional[dict] = None) -> dict:
    card_data: Dict[str, list] = defaultdict(list)
    name_casing: Dict[str, str] = {}
    uid_meta: Dict[str, dict] = {}
    uid_category: Dict[str, dict] = {}
    uid_variant_counts: Dict[str, Counter] = {}  # name-only UID -> Counter of "SET::NUM"

    for deck in deck_list:
        per_deck_counts: Dict[str, int] = defaultdict(int)
        per_deck_seen_meta: Dict[str, dict] = {}

        for card in deck.get("cards", []):
            name = card.get("name", "")
            set_code = card.get("set", "")
            number = card.get("number", "")

            # Resolve through synonym list to canonical printing
            if synonyms or canonicals:
                name, sc, num = resolve_synonym(name, set_code, number, synonyms or {}, canonicals or {})
            else:
                sc, num = canonicalize_variant(set_code, number)

            count = int(card.get("count", 0))
            if count <= 0:
                continue

            # For trainer/energy, same-name cards are always the same functional
            # card (just different printings). Use name-only UID to merge them.
            card_category = (card.get("category") or "").lower()
            if card_category in ("trainer", "energy"):
                uid = name
            else:
                uid = f"{name}::{sc}::{num}" if sc and num else name
            per_deck_counts[uid] += count

            meta_payload = {
                "set": sc or None,
                "number": num or None,
                "category": (card.get("category") or "").lower() or None,
                "trainerType": card.get("trainerType"),
                "energyType": card.get("energyType"),
                "aceSpec": card.get("aceSpec"),
            }
            per_deck_seen_meta[uid] = meta_payload

            # Track set/number frequency for name-only UIDs (trainer/energy)
            if "::" not in uid and sc and num:
                variant_key = f"{sc}::{num}"
                uid_variant_counts.setdefault(uid, Counter())[variant_key] += 1

            info = uid_category.setdefault(uid, {})
            for field in ("category", "trainerType", "energyType", "aceSpec"):
                value = meta_payload.get(field)
                if value and field not in info:
                    info[field] = value

            if uid not in name_casing:
                name_casing[uid] = uid.split("::", 1)[0] if "::" in uid else uid

        for uid, tot in per_deck_counts.items():
            card_data[uid].append(tot)
            meta_payload = per_deck_seen_meta.get(uid, uid_meta.get(uid, {})) or {}
            if "::" in uid:
                uid_meta[uid] = meta_payload
            elif meta_payload and uid not in uid_meta:
                uid_meta[uid] = meta_payload

    sorted_card_keys = sorted(card_data.keys(), key=lambda k: len(card_data[k]), reverse=True)

    report_items = []
    for rank, uid in enumerate(sorted_card_keys, 1):
        counts_list = card_data[uid]
        found_count = len(counts_list)
        dist_counter = Counter(counts_list)

        card_obj = {
            "rank": rank,
            "name": name_casing[uid],
            "found": found_count,
            "total": deck_total,
            "pct": round((found_count / deck_total) * 100, 2) if deck_total else 0,
            "dist": [
                {
                    "copies": c,
                    "players": p,
                    "percent": round((p / found_count) * 100, 2) if found_count else 0,
                }
                for c, p in sorted(dist_counter.items())
            ],
        }

        meta = uid_meta.get(uid) or {}
        if "::" in uid:
            card_obj["set"] = meta.get("set")
            card_obj["number"] = meta.get("number")
            card_obj["uid"] = uid
        elif uid in uid_variant_counts:
            # Name-only UID (trainer/energy): use the most common printing
            best_variant = uid_variant_counts[uid].most_common(1)[0][0]
            parts = best_variant.split("::", 1)
            card_obj["set"] = parts[0]
            card_obj["number"] = parts[1]
            card_obj["uid"] = f"{uid}::{parts[0]}::{parts[1]}"

        category_info = uid_category.get(uid)
        base_category = None
        trainer_type = None
        energy_type = None
        ace_spec = False

        if isinstance(category_info, dict):
            base_category = category_info.get("category") or meta.get("category")
            trainer_type = category_info.get("trainerType") or meta.get("trainerType")
            energy_type = category_info.get("energyType") or meta.get("energyType")
            ace_spec = category_info.get("aceSpec") or meta.get("aceSpec") or False
        elif category_info:
            base_category = category_info
        else:
            base_category = meta.get("category")
            trainer_type = meta.get("trainerType")
            energy_type = meta.get("energyType")
            ace_spec = meta.get("aceSpec") or False

        if trainer_type:
            card_obj["trainerType"] = trainer_type
        if energy_type:
            card_obj["energyType"] = energy_type
        if ace_spec:
            card_obj["aceSpec"] = True

        slug = compose_category_path(base_category, trainer_type, energy_type, ace_spec)
        if slug:
            card_obj["category"] = slug
        elif base_category:
            card_obj["category"] = base_category

        report_items.append(card_obj)

    return {"deckTotal": deck_total, "items": report_items}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 3:
        print("Usage: python scrape-memorial.py <archetype_id> <slug>")
        print("Example: python scrape-memorial.py 255 gardevoir")
        sys.exit(1)

    archetype_id = int(sys.argv[1])
    slug = sys.argv[2].lower().strip()
    display_name = slug.replace("-", " ").title()

    # Load card types DB
    card_types_db = {}
    if LOCAL_CARD_TYPES_PATH.exists():
        with open(LOCAL_CARD_TYPES_PATH) as f:
            card_types_db = json.load(f)
        print(f"Loaded card types DB ({len(card_types_db)} entries)")
    else:
        print(f"WARNING: card-types.json not found at {LOCAL_CARD_TYPES_PATH}")

    # Load card synonyms
    synonyms_map = {}
    canonicals_map = {}
    if LOCAL_CARD_SYNONYMS_PATH.exists():
        with open(LOCAL_CARD_SYNONYMS_PATH) as f:
            syn_data = json.load(f)
        synonyms_map = syn_data.get("synonyms", {})
        canonicals_map = syn_data.get("canonicals", {})
        print(f"Loaded card synonyms ({len(synonyms_map)} synonyms, {len(canonicals_map)} canonicals)")
    else:
        print(f"WARNING: card-synonyms.json not found at {LOCAL_CARD_SYNONYMS_PATH}")

    session = requests.Session()

    # Step 1: Scrape results table
    results, tournament_urls = scrape_results_page(session, archetype_id)
    if not results:
        print("No results found. Exiting.")
        sys.exit(1)

    # Step 1b: Fetch tournament sizes (player counts)
    tournament_sizes = fetch_all_tournament_sizes(session, tournament_urls)

    # Step 2: Fetch each decklist concurrently
    print(f"\nFetching {len(results)} decklists (concurrency={FETCH_CONCURRENCY})...")
    decks_with_cards = []
    failed = 0

    def fetch_one(row):
        cards = fetch_decklist(session, row["listId"], card_types_db)
        return row, cards

    with ThreadPoolExecutor(max_workers=FETCH_CONCURRENCY) as executor:
        futures = {executor.submit(fetch_one, row): row for row in results}
        for i, future in enumerate(as_completed(futures), 1):
            row, cards = future.result()
            if cards:
                decks_with_cards.append({
                    "listId": row["listId"],
                    "player": row["player"],
                    "playerUrl": row["playerUrl"],
                    "placement": row["placement"],
                    "format": row["format"],
                    "tournament": row.get("tournament", "Unknown"),
                    "tournamentPlayers": tournament_sizes.get(row.get("tournament", ""), 0),
                    "cards": cards,
                })
            else:
                failed += 1
            if i % 50 == 0 or i == len(results):
                print(f"  Progress: {i}/{len(results)} ({failed} failed)")

    print(f"\nSuccessfully fetched {len(decks_with_cards)} decklists ({failed} failed)")

    if not decks_with_cards:
        print("No decklists retrieved. Exiting.")
        sys.exit(1)

    # Step 3: Generate aggregated report
    deck_total = len(decks_with_cards)
    report = generate_report_json(decks_with_cards, deck_total, synonyms_map, canonicals_map)
    report["archetype"] = display_name
    report["archetypeId"] = archetype_id

    # Step 4: Build lists.json — canonicalize card entries so client-side
    # matching uses the same UIDs as master.json
    def canonicalize_card(card):
        """Resolve a card entry through synonyms to its canonical printing."""
        name = card.get("name", "")
        set_code = card.get("set", "")
        number = card.get("number", "")
        canon_name, canon_set, canon_num = resolve_synonym(
            name, set_code, number, synonyms_map, canonicals_map
        )
        out = dict(card)
        out["name"] = canon_name
        out["set"] = canon_set
        out["number"] = canon_num
        return out

    lists_data = {
        "archetype": display_name,
        "archetypeId": archetype_id,
        "lists": [
            {
                "id": d["listId"],
                "player": d["player"],
                "playerUrl": d["playerUrl"],
                "placement": d["placement"],
                "format": d["format"],
                "tournament": d.get("tournament", "Unknown"),
                "tournamentPlayers": d.get("tournamentPlayers", 0),
                "cards": [canonicalize_card(c) for c in d["cards"]],
            }
            for d in decks_with_cards
        ],
    }

    # Step 5: Write output
    out_dir = Path("public") / "toys" / "in-loving-memory" / "data" / slug
    out_dir.mkdir(parents=True, exist_ok=True)

    master_path = out_dir / "master.json"
    with open(master_path, "w") as f:
        json.dump(report, f, separators=(",", ":"))
    print(f"Wrote {master_path} ({master_path.stat().st_size:,} bytes)")

    lists_path = out_dir / "lists.json"
    with open(lists_path, "w") as f:
        json.dump(lists_data, f, separators=(",", ":"))
    print(f"Wrote {lists_path} ({lists_path.stat().st_size:,} bytes)")

    # Step 6: Update or create index.json
    index_path = out_dir.parent / "index.json"
    index_data = {"archetypes": []}
    if index_path.exists():
        with open(index_path) as f:
            index_data = json.load(f)

    # Find the most common pokemon card for thumbnail
    thumbnail = None
    for item in report.get("items", []):
        cat = (item.get("category") or "").lower()
        if cat.startswith("pokemon") and item.get("set") and item.get("number"):
            thumbnail = f"{item['set']}/{item['number']}"
            break

    # Update or add this archetype entry, preserving extra fields (e.g. rotations)
    prev_entry = next((a for a in index_data["archetypes"] if a["slug"] == slug), {})
    existing = [a for a in index_data["archetypes"] if a["slug"] != slug]
    updated_entry = dict(prev_entry)
    updated_entry.update({
        "name": display_name,
        "slug": slug,
        "archetypeId": archetype_id,
        "listCount": deck_total,
        "thumbnail": thumbnail,
    })
    existing.append(updated_entry)
    index_data["archetypes"] = sorted(existing, key=lambda a: a.get("listCount", 0), reverse=True)

    with open(index_path, "w") as f:
        json.dump(index_data, f, indent=2)
    print(f"Wrote {index_path}")

    print(f"\nDone! {deck_total} decklists aggregated for {display_name}.")


if __name__ == "__main__":
    main()
