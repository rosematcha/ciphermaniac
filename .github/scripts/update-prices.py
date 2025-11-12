#!/usr/bin/env python3
"""
Daily price check script for GitHub Actions
Fetches prices for all cards in "Online - Last 14 Days" report
"""

import os
import sys
import json
import re
import csv
import boto3
from datetime import datetime, timezone
from collections import defaultdict
from io import StringIO


TCGCSV_GROUPS_URL = 'https://tcgcsv.com/tcgplayer/3/groups'
ONLINE_META_PATH = 'reports/Online - Last 14 Days'
CARD_SYNONYMS_URL = 'https://r2.ciphermaniac.com/assets/card-synonyms.json'

# Manual group ID mappings for sets not in TCGCSV API
MANUAL_GROUP_ID_MAP = {
    'MEP': 24451,
    'SVP': 22872
}

# Basic energy canonical mappings
BASIC_ENERGY_CANONICALS = {
    'Grass Energy': 'Grass Energy::SVE::017',
    'Psychic Energy': 'Psychic Energy::SVE::021',
    'Lightning Energy': 'Lightning Energy::SVE::019',
    'Fire Energy': 'Fire Energy::SVE::018',
    'Darkness Energy': 'Darkness Energy::SVE::015',
    'Metal Energy': 'Metal Energy::SVE::020',
    'Fighting Energy': 'Fighting Energy::SVE::016',
    'Water Energy': 'Water Energy::SVE::022'
}

BASIC_ENERGY_NAMES = {
    'Darkness Energy', 'Fighting Energy', 'Fire Energy', 'Grass Energy',
    'Lightning Energy', 'Metal Energy', 'Psychic Energy', 'Water Energy'
}


def fetch_json(url):
    """Fetch JSON from a URL."""
    import requests
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.json()


def fetch_csv(url):
    """Fetch CSV text from a URL."""
    import requests
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.text


def initialize_r2_client():
    """Initialize boto3 S3 client for R2."""
    r2_account_id = os.environ.get('R2_ACCOUNT_ID')
    r2_access_key_id = os.environ.get('R2_ACCESS_KEY_ID')
    r2_secret_access_key = os.environ.get('R2_SECRET_ACCESS_KEY')

    if not all([r2_account_id, r2_access_key_id, r2_secret_access_key]):
        print("Error: R2 credentials not set")
        sys.exit(1)

    return boto3.client(
        's3',
        endpoint_url=f'https://{r2_account_id}.r2.cloudflarestorage.com',
        aws_access_key_id=r2_access_key_id,
        aws_secret_access_key=r2_secret_access_key,
        region_name='auto'
    )


def load_online_meta_report(r2_client, bucket_name):
    """Load the master.json from Online - Last 14 Days report."""
    key = f'{ONLINE_META_PATH}/master.json'
    print(f"Loading {key}...")
    
    try:
        response = r2_client.get_object(Bucket=bucket_name, Key=key)
        data = json.loads(response['Body'].read().decode('utf-8'))
        print(f"  Loaded {len(data.get('items', []))} cards")
        return data
    except Exception as e:
        print(f"  Error loading online meta report: {e}")
        sys.exit(1)


def load_card_synonyms():
    """Load card synonyms for resolving canonical UIDs."""
    print("Loading card synonyms...")
    try:
        data = fetch_json(CARD_SYNONYMS_URL)
        print(f"  Loaded {len(data.get('synonyms', {}))} synonyms")
        return {
            'synonyms': data.get('synonyms', {}),
            'canonicals': data.get('canonicals', {})
        }
    except Exception as e:
        print(f"  Warning: Could not load synonyms: {e}")
        return {'synonyms': {}, 'canonicals': {}}


def build_uid_from_parts(name, set_code, number):
    """Build a UID from card parts."""
    if not name or not set_code or not number:
        return None
    padded_number = str(number).zfill(3)
    return f"{name}::{set_code}::{padded_number}"


def resolve_canonical_uid(card_uid, synonyms_data):
    """Resolve a card UID to its canonical form."""
    if not card_uid:
        return card_uid

    trimmed = card_uid.strip()
    base_name = trimmed.split('::')[0]

    # Check basic energy first
    if base_name in BASIC_ENERGY_CANONICALS:
        return BASIC_ENERGY_CANONICALS[base_name]

    # Check synonyms mapping
    if trimmed in synonyms_data['synonyms']:
        return synonyms_data['synonyms'][trimmed]

    # Check canonicals mapping
    if base_name in synonyms_data['canonicals']:
        return synonyms_data['canonicals'][base_name]

    return trimmed


def extract_unique_cards(master_report, synonyms_data):
    """Extract all unique canonical cards from the master report."""
    card_set = set()
    
    # Add basic energy canonicals
    for canonical_uid in BASIC_ENERGY_CANONICALS.values():
        card_set.add(canonical_uid)
    
    # Add all synonym targets
    for canonical_uid in synonyms_data['synonyms'].values():
        if canonical_uid:
            card_set.add(canonical_uid)
    
    # Add all canonical mappings
    for canonical_uid in synonyms_data['canonicals'].values():
        if canonical_uid:
            card_set.add(canonical_uid)
    
    # Extract cards from master report
    items = master_report.get('items', [])
    for item in items:
        uid = item.get('uid') or build_uid_from_parts(
            item.get('name'),
            item.get('set'),
            item.get('number')
        )
        if uid:
            canonical_uid = resolve_canonical_uid(uid, synonyms_data)
            if canonical_uid:
                card_set.add(canonical_uid)
    
    print(f"Extracted {len(card_set)} unique canonical cards")
    return card_set


def group_cards_by_set(card_list):
    """Group cards by set code."""
    by_set = defaultdict(list)
    
    for card_uid in card_list:
        parts = card_uid.split('::')
        if len(parts) >= 3:
            set_code = parts[1]
            by_set[set_code].append(card_uid)
    
    return by_set


def map_sets_to_group_ids(card_sets):
    """Map set codes to TCGCSV group IDs."""
    print("\nFetching TCGCSV groups...")
    groups_data = fetch_json(TCGCSV_GROUPS_URL)
    
    if not groups_data.get('success'):
        print("Error: TCGCSV groups API returned success: false")
        sys.exit(1)
    
    # Build group index by abbreviation
    group_index = {}
    for group in groups_data.get('results', []):
        if group and group.get('abbreviation'):
            group_index[group['abbreviation']] = group
    
    # Map our sets to group IDs
    mappings = {}
    for set_code in card_sets:
        group = group_index.get(set_code)
        if group:
            mappings[set_code] = group['groupId']
            print(f"  Found: {set_code} -> {group['groupId']} ({group['name']})")
        else:
            manual_id = MANUAL_GROUP_ID_MAP.get(set_code)
            if manual_id:
                mappings[set_code] = manual_id
                print(f"  Manual: {set_code} -> {manual_id}")
            else:
                print(f"  Warning: No group ID for {set_code}")
    
    return mappings


def parse_csv_to_records(csv_text):
    """Parse CSV text into list of dict records."""
    reader = csv.DictReader(StringIO(csv_text))
    return list(reader)


def extract_price_from_record(record, set_code, card_uid_lookup):
    """Extract price data from a CSV record."""
    product_id = record.get('productId', '').strip()
    name = record.get('name', '').strip()
    market_price = record.get('marketPrice', '').strip()
    ext_number = record.get('extNumber', '').strip()
    
    # Validate required fields
    if not product_id or not name or not ext_number:
        return None
    
    # Parse card name - TCGCSV format can be:
    # - "CardName" or
    # - "CardName - Number/Total"
    # We need to extract just the card name part
    if ' - ' in name and '/' in name:
        # Has the " - Number/Total" suffix, extract just the name
        card_name = name.split(' - ')[0].strip()
    else:
        card_name = name
    
    # Parse price
    try:
        price = float(market_price) if market_price else 0.0
    except ValueError:
        price = 0.0
    
    # Extract card number from extNumber (format is "Number/Total")
    # We only want the number part before the slash
    if '/' in ext_number:
        card_number = ext_number.split('/')[0]
    else:
        card_number = ext_number
    
    # Normalize card number (pad to 3 digits if it's purely numeric)
    normalized_number = card_number.zfill(3) if card_number.isdigit() else card_number
    
    # Build UID
    card_uid = f"{card_name}::{set_code}::{normalized_number}"
    
    # Only keep if this card is in our lookup
    if card_uid not in card_uid_lookup:
        return None
    
    return {
        'uid': card_uid,
        'price': price,
        'tcgPlayerId': product_id
    }


def fetch_prices_for_set(set_code, group_id, card_uids):
    """Fetch prices for a single set from TCGCSV."""
    csv_url = f"https://tcgcsv.com/tcgplayer/3/{group_id}/ProductsAndPrices.csv"
    print(f"\n  Fetching {set_code} (group {group_id})...")
    
    try:
        csv_text = fetch_csv(csv_url)
        records = parse_csv_to_records(csv_text)
        
        # Create lookup for faster checking
        card_uid_lookup = set(card_uids)
        
        # Extract prices
        prices = {}
        for record in records:
            price_data = extract_price_from_record(record, set_code, card_uid_lookup)
            if price_data:
                prices[price_data['uid']] = {
                    'price': price_data['price'],
                    'tcgPlayerId': price_data['tcgPlayerId']
                }
        
        print(f"    Found {len(prices)} prices for {set_code}")
        return prices
        
    except Exception as e:
        print(f"    Error fetching {set_code}: {e}")
        return {}


def fetch_all_prices(card_sets_map, set_mappings):
    """Fetch prices for all sets."""
    print("\nFetching prices from TCGCSV...")
    all_prices = {}
    
    for set_code, card_uids in card_sets_map.items():
        group_id = set_mappings.get(set_code)
        if not group_id:
            print(f"  Skipping {set_code} (no group ID)")
            continue
        
        set_prices = fetch_prices_for_set(set_code, group_id, card_uids)
        all_prices.update(set_prices)
    
    return all_prices


def add_basic_energy_prices(price_data, card_list):
    """Add hardcoded $0.10 prices for basic energy."""
    for energy_name in BASIC_ENERGY_NAMES:
        canonical_uid = BASIC_ENERGY_CANONICALS.get(energy_name)
        if canonical_uid and canonical_uid in card_list:
            if canonical_uid not in price_data:
                price_data[canonical_uid] = {
                    'price': 0.10,
                    'tcgPlayerId': None
                }
    print(f"\nAdded {len([k for k in price_data if 'Energy::' in k])} basic energy prices")


def upload_prices_to_r2(r2_client, bucket_name, price_data):
    """Upload price data to R2 (frontend-compatible format)."""
    key = 'reports/prices.json'
    
    # Format for frontend compatibility (matches old API response)
    output = {
        'cardPrices': price_data,  # Frontend expects 'cardPrices' key
        'metadata': {
            'generated': datetime.now(timezone.utc).isoformat(),
            'totalCards': len(price_data),
            'source': 'tcgcsv.com'
        }
    }
    
    print(f"\nUploading to R2: {key}")
    r2_client.put_object(
        Bucket=bucket_name,
        Key=key,
        Body=json.dumps(output, indent=2),
        ContentType='application/json'
    )
    print("  ✓ Upload complete")


def main():
    bucket_name = os.environ.get('R2_BUCKET_NAME', 'ciphermaniac-reports')
    
    print("=" * 60)
    print("Daily Price Check - Online Meta Report")
    print("=" * 60)
    
    # Initialize R2
    r2_client = initialize_r2_client()
    
    # Load data
    master_report = load_online_meta_report(r2_client, bucket_name)
    synonyms_data = load_card_synonyms()
    
    # Extract unique cards
    card_list = extract_unique_cards(master_report, synonyms_data)
    
    # Group by set
    card_sets_map = group_cards_by_set(card_list)
    print(f"\nCards grouped into {len(card_sets_map)} sets:")
    for set_code, cards in sorted(card_sets_map.items(), key=lambda x: -len(x[1])):
        print(f"  {set_code}: {len(cards)} cards")
    
    # Map sets to TCGCSV group IDs
    set_mappings = map_sets_to_group_ids(card_sets_map.keys())
    
    # Fetch prices
    price_data = fetch_all_prices(card_sets_map, set_mappings)
    
    # Add basic energy prices
    add_basic_energy_prices(price_data, card_list)
    
    # Upload to R2
    upload_prices_to_r2(r2_client, bucket_name, price_data)
    
    # Summary
    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"  Total unique cards: {len(card_list)}")
    print(f"  Cards with prices: {len(price_data)}")
    print(f"  Missing prices: {len(card_list) - len(price_data)}")
    print(f"  Coverage: {len(price_data) / len(card_list) * 100:.1f}%")
    
    # Show missing cards
    missing = [card for card in card_list if card not in price_data]
    if missing:
        print(f"\nMissing prices for {len(missing)} cards:")
        missing_by_set = defaultdict(list)
        for card in missing:
            parts = card.split('::')
            if len(parts) >= 2:
                missing_by_set[parts[1]].append(card)
        
        for set_code, cards in sorted(missing_by_set.items()):
            print(f"  {set_code}: {len(cards)} cards")
            for card in cards[:3]:  # Show first 3
                print(f"    - {card}")
            if len(cards) > 3:
                print(f"    ... and {len(cards) - 3} more")
    
    print("\n✓ Price check complete!")


if __name__ == '__main__':
    main()
