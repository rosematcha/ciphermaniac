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
from typing import Dict, Set, Tuple
from urllib.parse import quote

import boto3
import requests
from bs4 import BeautifulSoup

PUBLIC_R2_BASE = os.environ.get('PUBLIC_R2_BASE_URL', 'https://r2.ciphermaniac.com')
OUTPUT_PATH = Path('public') / 'assets' / 'card-synonyms.json'


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


def collect_all_cards(client, bucket: str, tournaments: list) -> Dict[str, Set[Tuple[str, str]]]:
    """
    Collect all unique cards from all tournaments.
    Returns: dict mapping card_name -> set of (set_code, number) tuples
    """
    log("\nCollecting cards from all tournaments...")
    cards_by_name = defaultdict(set)
    processed = 0
    skipped = 0

    for folder in tournaments:
        if isinstance(folder, dict):
            folder = folder.get('folder') or folder.get('name') or folder.get('path')
        if not folder or folder == 'Online - Last 14 Days':
            continue

        decks = load_tournament_decks(client, bucket, folder)
        if not decks:
            skipped += 1
            continue

        for deck in decks:
            for card in deck.get('cards', []):
                card_name = card.get('name', '').strip()
                set_code = (card.get('set', '') or '').upper().strip()
                number = (card.get('number', '') or '').lstrip('0').zfill(3)

                if card_name and set_code and number:
                    cards_by_name[card_name].add((set_code, number))

        processed += 1
        if processed % 5 == 0:
            log(f"  Processed {processed}/{len(tournaments)} tournaments...")

    log(f"  Processed {processed} tournaments, skipped {skipped}")
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

        # Pick any print to scrape variations
        sample_set, sample_num = next(iter(print_set))

        # Scrape all print variations from Limitless
        variations = scrape_card_print_variations(session, sample_set, sample_num)

        if not variations or len(variations) < 2:
            continue

        # Choose the canonical print
        canonical_var = choose_canonical_print(variations, card_name)
        if not canonical_var:
            continue

        canonical_uid = f"{card_name}::{canonical_var['set']}::{canonical_var['number']}"

        # Build synonyms for all variations
        for var in variations:
            variant_uid = f"{card_name}::{var['set']}::{var['number']}"
            if variant_uid != canonical_uid:
                synonyms_dict[variant_uid] = canonical_uid

        # Add canonical mapping
        canonicals_dict[card_name] = canonical_uid
        processed_count += 1

    log(f"  Completed: {processed_count} cards with multiple prints")
    log(f"  Generated {len(synonyms_dict)} synonym mappings")
    log(f"  Generated {len(canonicals_dict)} canonical mappings")

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
