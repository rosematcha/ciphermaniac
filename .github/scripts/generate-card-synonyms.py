#!/usr/bin/env python3
"""
Generate card synonyms by analyzing all tournaments in R2 storage.
Creates canonical mappings for card reprints across all sets.
"""

import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Set, Tuple
from urllib.parse import quote

import boto3
import requests
from bs4 import BeautifulSoup

PUBLIC_R2_BASE = os.environ.get('PUBLIC_R2_BASE_URL', 'https://r2.ciphermaniac.com')
OUTPUT_PATH = Path('public') / 'assets' / 'card-synonyms.json'
ONLINE_FOLDER = 'Online - Last 14 Days'


def log(message: str) -> None:
    print(message, flush=True)


def initialize_r2_client():
    """Initialize boto3 S3 client for R2."""
    r2_account_id = os.environ['R2_ACCOUNT_ID']
    r2_access_key_id = os.environ['R2_ACCESS_KEY_ID']
    r2_secret_access_key = os.environ['R2_SECRET_ACCESS_KEY']

    return boto3.client(
        's3',
        endpoint_url=f'https://{r2_account_id}.r2.cloudflarestorage.com',
        aws_access_key_id=r2_access_key_id,
        aws_secret_access_key=r2_secret_access_key,
        region_name='auto'
    )


def load_tournaments_list(client, bucket: str) -> list:
    """Load the list of all tournaments from R2."""
    log("Loading tournaments list...")
    try:
        response = client.get_object(Bucket=bucket, Key='reports/tournaments.json')
        payload = response['Body'].read().decode('utf-8')
        data = json.loads(payload)
        if isinstance(data, list):
            tournaments = data
        elif isinstance(data, dict):
            tournaments = data.get('tournaments', [])
        else:
            tournaments = []
        log(f"  Found {len(tournaments)} tournaments")
        return tournaments
    except Exception as e:
        log(f"  Error loading tournaments: {e}")
        return []


def load_tournament_decks(client, bucket: str, folder: str) -> list:
    """Load decks.json for a specific tournament."""
    key = f'reports/{folder}/decks.json'
    try:
        response = client.get_object(Bucket=bucket, Key=key)
        payload = response['Body'].read().decode('utf-8')
        decks = json.loads(payload)
        return decks if isinstance(decks, list) else []
    except Exception:
        # Silently skip tournaments without decks.json
        return []


def normalize_card_number(number: Optional[str]) -> Optional[str]:
    """Normalize card number to zero-padded 3-digit form with optional suffix."""
    raw = str(number or '').strip()
    if not raw:
        return None
    match = re.match(r'^(\d+)([A-Za-z]*)$', raw)
    if not match:
        return raw.upper()
    digits, suffix = match.groups()
    padded = digits.zfill(3)
    return f"{padded}{suffix.upper()}" if suffix else padded


def merge_decks_into_card_map(cards_by_name: Dict[str, Set[Tuple[str, str]]], decks: list) -> None:
    """Add cards from a set of decks into the shared map."""
    for deck in decks:
        for card in deck.get('cards', []):
            card_name = card.get('name', '').strip()
            set_code = (card.get('set', '') or '').upper().strip()
            number = normalize_card_number(card.get('number'))

            if card_name and set_code and number:
                cards_by_name[card_name].add((set_code, number))


def collect_all_cards(client, bucket: str, tournaments: list) -> Dict[str, Set[Tuple[str, str]]]:
    """
    Collect all unique cards from all tournaments.
    Returns: dict mapping card_name -> set of (set_code, number) tuples
    """
    log("\nCollecting cards from all tournaments...")
    cards_by_name = defaultdict(set)
    processed = 0
    skipped = 0
    processed_folders = set()

    for folder in tournaments:
        if isinstance(folder, dict):
            folder = folder.get('folder') or folder.get('name') or folder.get('path')
        if not folder:
            continue

        processed_folders.add(folder)
        decks = load_tournament_decks(client, bucket, folder)
        if not decks:
            skipped += 1
            continue

        merge_decks_into_card_map(cards_by_name, decks)

        processed += 1
        if processed % 5 == 0:
            log(f"  Processed {processed}/{len(tournaments)} tournaments...")

    online_included = ONLINE_FOLDER in processed_folders
    if not online_included:
        online_decks = load_tournament_decks(client, bucket, ONLINE_FOLDER)
        if online_decks:
            merge_decks_into_card_map(cards_by_name, online_decks)
            processed += 1
            online_included = True
            log(f"  Included decks from {ONLINE_FOLDER} ({len(online_decks)} decks)")
        else:
            log(f"  Warning: No decks found for {ONLINE_FOLDER}; online meta cards will be missing")

    suffix = " (online meta included)" if online_included else ""
    log(f"  Processed {processed} tournaments{suffix}, skipped {skipped}")
    log(f"  Found {len(cards_by_name)} unique card names")
    return cards_by_name


def build_number_variants(number):
    """Return card number variants (no leading zeros first, then original)."""
    if number is None:
        return []
    raw = str(number).strip()
    if not raw:
        return []
    normalized = raw.upper()
    match = re.match(r'^0*(\d+)([A-Z]*)$', normalized)
    if not match:
        return [normalized]
    digits, suffix = match.groups()
    trimmed_digits = digits.lstrip('0') or '0'
    primary = f"{trimmed_digits}{suffix}"
    variants = [primary]
    padded = f"{digits}{suffix}"
    if primary != padded:
        variants.append(padded)
    return variants


def request_with_retries(session, method, url, retries=3, backoff_factor=0.5, **kwargs):
    """Simple retry wrapper around requests.Session methods."""
    import time
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            resp = session.request(method, url, **kwargs)
            resp.raise_for_status()
            return resp
        except requests.exceptions.RequestException as e:
            last_exc = e
            sleep_for = backoff_factor * (2 ** (attempt - 1))
            if attempt < retries:
                time.sleep(sleep_for)
    return None


def scrape_card_print_variations(session, set_code, number):
    """
    Scrapes print variations for a specific card from Limitless.
    Returns list of dicts: [{'set': 'SFA', 'number': '038', 'price_usd': 19.67}, ...]
    Only includes international prints, not Japanese.
    """
    number_variants = build_number_variants(number)
    if not number_variants:
        return []

    headers = {'User-Agent': 'Mozilla/5.0'}
    soup = None
    for variant in number_variants:
        url = f"https://limitlesstcg.com/cards/{set_code}/{variant}"
        resp = request_with_retries(session, 'GET', url, headers=headers, timeout=20, retries=2)
        if not resp:
            continue
        soup = BeautifulSoup(resp.text, 'html.parser')
        table = soup.find('table', class_='card-prints-versions')
        if table:
            break
        soup = None

    if soup is None:
        return []

    table = soup.find('table', class_='card-prints-versions')
    if not table:
        return []

    variations = []
    in_jp_section = False

    for row in table.find_all('tr'):
        th = row.find('th')
        if th and 'JP. Prints' in th.get_text():
            in_jp_section = True
            continue

        if in_jp_section or th:
            continue

        cells = row.find_all('td')
        if len(cells) < 2:
            continue

        first_cell = cells[0]
        number_elem = first_cell.find('span', class_='prints-table-card-number')
        if not number_elem:
            continue

        card_num = number_elem.get_text(strip=True).lstrip('#')
        set_name_elem = first_cell.find('a')
        set_acronym = None

        if set_name_elem:
            href = set_name_elem.get('href', '')
            if href:
                match = re.search(r'/cards/([A-Z0-9]+)/\d+', href)
                if match:
                    set_acronym = match.group(1)

        if not set_acronym:
            continue

        normalized_num = card_num.zfill(3)

        price_usd = None
        if len(cells) >= 2:
            price_link = cells[1].find('a', class_='card-price')
            if price_link:
                price_text = price_link.get_text(strip=True)
                price_match = re.search(r'\$?([\d.]+)', price_text)
                if price_match:
                    try:
                        price_usd = float(price_match.group(1))
                    except ValueError:
                        pass

        variations.append({
            'set': set_acronym,
            'number': normalized_num,
            'price_usd': price_usd
        })

    return variations


def choose_canonical_print(variations, card_name):
    """
    Choose the canonical print from a list of variations.
    Prefers: Standard-legal sets > Non-promo > Lowest price > Lower card number
    """
    if not variations:
        return None

    # Define standard-legal sets (Scarlet & Violet era onwards, including Mega Evolution)
    STANDARD_LEGAL_SETS = {
        'MEG', 'MEE', 'MEP',
        'WHT', 'BLK', 'DRI', 'JTG', 'PRE', 'SSP', 'SCR', 'SFA', 'TWM', 'TEF',
        'PAF', 'PAR', 'MEW', 'M23', 'OBF', 'PAL', 'SVE', 'SVI', 'SVP'
    }

    # Define promo sets (should be deprioritized)
    PROMO_SETS = {'SVP', 'MEP', 'PRE', 'M23', 'PAF'}

    def get_set_priority(set_code):
        return 0 if set_code in STANDARD_LEGAL_SETS else 1

    def is_promo(set_code):
        return set_code in PROMO_SETS

    def sort_key(var):
        set_priority = get_set_priority(var['set'])
        promo_priority = 1 if is_promo(var['set']) else 0
        price = var.get('price_usd') or 999999
        card_num = int(var['number']) if var['number'].isdigit() else 999999
        return (set_priority, promo_priority, price, card_num)

    sorted_variations = sorted(variations, key=sort_key)
    return sorted_variations[0]


class UnionFind:
    def __init__(self):
        self.parent = {}

    def find(self, x):
        if x not in self.parent:
            self.parent[x] = x
            return x
        if self.parent[x] == x:
            return x
        self.parent[x] = self.find(self.parent[x])
        return self.parent[x]

    def union(self, a, b):
        ra = self.find(a)
        rb = self.find(b)
        if ra == rb:
            return
        self.parent[ra] = rb

    def components(self):
        groups = defaultdict(list)
        for key in list(self.parent.keys()):
            root = self.find(key)
            groups[root].append(key)
        return list(groups.values())


def build_clusters_from_limitless(session, print_set):
    uf = UnionFind()
    meta = {}  # uid -> {set, number, price_usd}

    for sample_set, sample_num in print_set:
        if not sample_set or not sample_num:
            continue
        variations = scrape_card_print_variations(session, sample_set, sample_num)
        filtered = []
        for v in variations or []:
            set_code = v.get('set')
            number = v.get('number')
            if not set_code or not number:
                continue
            norm_num = normalize_card_number(number)
            if not norm_num:
                continue
            filtered.append({
                'set': set_code.upper(),
                'number': norm_num,
                'price_usd': v.get('price_usd')
            })

        if len(filtered) < 2:
            continue

        ids = [f"{v['set']}::{v['number']}" for v in filtered]
        for v, id_ in zip(filtered, ids):
            uf.find(id_)
            if id_ not in meta:
                meta[id_] = v
        anchor = ids[0]
        for other in ids[1:]:
            uf.union(anchor, other)

    clusters = []
    for group in uf.components():
        if len(group) < 2:
            continue
        cluster = []
        for gid in group:
            set_code, number = gid.split('::')
            info = meta.get(gid, {})
            cluster.append({
                'set': info.get('set', set_code),
                'number': info.get('number', number),
                'price_usd': info.get('price_usd')
            })
        clusters.append(cluster)
    return clusters


MEE_BASIC_ENERGY = [
    ("Darkness Energy", "MEE", "007", "Darkness Energy::SVE::007"),
    ("Psychic Energy", "MEE", "005", "Psychic Energy::SVE::005"),
    ("Fighting Energy", "MEE", "006", "Fighting Energy::SVE::014"),
    ("Fire Energy", "MEE", "002", "Fire Energy::SVE::002"),
    ("Metal Energy", "MEE", "008", "Metal Energy::SVE::016"),
    ("Grass Energy", "MEE", "001", "Grass Energy::SVE::017"),
    ("Water Energy", "MEE", "003", "Water Energy::SVE::003"),
    ("Lightning Energy", "MEE", "004", "Lightning Energy::SVE::004"),
]


def ensure_mee_basic_energy_synonyms(synonyms_dict, canonicals_dict):
    """Ensure MEE basic energies are mapped even if upstream print tables are missing."""
    for name, set_code, number, fallback in MEE_BASIC_ENERGY:
        canonical = canonicals_dict.get(name, fallback)
        if not canonical:
            continue
        normalized_number = normalize_card_number(number) or number
        uid = f"{name}::{set_code}::{normalized_number}"
        synonyms_dict.setdefault(uid, canonical)


def generate_synonyms(cards_by_name: Dict[str, Set[Tuple[str, str]]]) -> dict:
    """
    Generate synonym mappings for all cards.
    Returns dict with synonyms and canonicals.
    """
    log("\nGenerating canonical mappings...")
    session = requests.Session()
    synonyms_dict = {}
    canonicals_dict = {}

    total_cards = len(cards_by_name)
    current = 0
    processed_count = 0

    for card_name, print_set in cards_by_name.items():
        current += 1
        if current % 50 == 0 or current == total_cards:
            log(f"  Progress: {current}/{total_cards} cards ({processed_count} with multiple prints)")

        # Skip if only one print exists in our data
        if len(print_set) < 2:
            continue

        # Build synonym clusters strictly from Limitless print tables (avoid observed fallback to prevent false merges)
        clusters = build_clusters_from_limitless(session, print_set)
        if not clusters:
            continue

        for cluster in clusters:
            canonical_var = choose_canonical_print(cluster, card_name)
            if not canonical_var:
                continue

            canonical_uid = f"{card_name}::{canonical_var['set']}::{canonical_var['number']}"

            for var in cluster:
                variant_uid = f"{card_name}::{var['set']}::{var['number']}"
                if variant_uid != canonical_uid:
                    synonyms_dict[variant_uid] = canonical_uid

            if card_name not in canonicals_dict:
                canonicals_dict[card_name] = canonical_uid
            processed_count += 1

    log(f"  Completed: {processed_count} cards with multiple prints")
    log(f"  Generated {len(synonyms_dict)} synonym mappings")
    log(f"  Generated {len(canonicals_dict)} canonical mappings")

    ensure_mee_basic_energy_synonyms(synonyms_dict, canonicals_dict)

    return {
        "synonyms": synonyms_dict,
        "canonicals": canonicals_dict,
        "metadata": {
            "generated": datetime.now(timezone.utc).isoformat(),
            "totalSynonyms": len(synonyms_dict),
            "totalCanonicals": len(canonicals_dict),
            "totalCardsAnalyzed": total_cards,
            "description": "Canonical card mappings for handling reprints and alternate versions"
        }
    }


def save_synonyms(data: dict) -> None:
    """Save synonyms to the output file."""
    log(f"\nSaving to {OUTPUT_PATH}...")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open('w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    log("  ✓ Saved successfully")


def main():
    bucket_name = os.environ.get('R2_BUCKET_NAME', 'ciphermaniac-reports')

    log("=" * 60)
    log("Card Synonyms Generator")
    log("=" * 60)

    # Initialize R2
    r2_client = initialize_r2_client()

    # Load all tournaments
    tournaments = load_tournaments_list(r2_client, bucket_name)
    if not tournaments:
        log("No tournaments found")
        sys.exit(1)

    # Collect all cards from all tournaments
    cards_by_name = collect_all_cards(r2_client, bucket_name, tournaments)

    # Generate canonical synonyms
    synonyms_data = generate_synonyms(cards_by_name)

    # Save to file
    save_synonyms(synonyms_data)

    log("\n" + "=" * 60)
    log("Summary")
    log("=" * 60)
    log(f"  Total unique card names: {len(cards_by_name)}")
    log(f"  Cards with multiple prints: {synonyms_data['metadata']['totalCanonicals']}")
    log(f"  Total synonym mappings: {synonyms_data['metadata']['totalSynonyms']}")
    log("\n✓ Card synonyms generation complete!")


if __name__ == '__main__':
    main()
