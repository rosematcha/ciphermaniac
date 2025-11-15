#!/usr/bin/env python3
"""
Simplified tournament downloader for GitHub Actions
Downloads tournament data from Limitless Labs and uploads directly to R2
"""

import os
import re
import json
import hashlib
import requests
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs
from bs4 import BeautifulSoup
from collections import Counter, defaultdict
import boto3


LIMITLESS_LABS_BASE_URL = "https://labs.limitlesstcg.com"


def sanitize_for_path(text):
    """Sanitizes text for a directory name, keeping spaces."""
    return re.sub(r'[<>:"/\\|?*]', '', text)


def sanitize_for_filename(text):
    """Sanitizes text for a filename, replacing spaces with underscores."""
    text = text.replace(" ", "_")
    return re.sub(r'[<>:"/\\|?*]', '', text)


def normalize_archetype_name(name):
    """Normalizes whitespace in an archetype name."""
    name = name.replace('_', ' ')
    return ' '.join(name.split())


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
            print(f"Request failed (attempt {attempt}/{retries}): {e}; retrying in {sleep_for}s...")
            time.sleep(sleep_for)
    print(f"All retries failed for {url}: {last_exc}")
    return None


def get_soup(url, session):
    """Gets a BeautifulSoup object from a URL using the provided session."""
    print(f"Downloading webpage from {url}...")
    headers = {'User-Agent': 'Mozilla/5.0'}
    resp = request_with_retries(session, 'GET', url, headers=headers, timeout=20)
    if not resp:
        print("Error: Could not download the webpage after retries.")
        return None, None, None
    print("Download successful.")
    return BeautifulSoup(resp.text, 'html.parser'), resp.headers, resp.text


# Month mapping for date parsing
_MONTHS = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
    'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12
}


def _parse_start_date(text: str):
    """Parse a start date like '15th August 2025' to 'YYYY-MM-DD'."""
    if not text:
        return None, None
    t = text.strip()
    t = t.split('•', 1)[0].strip()
    m = re.search(r"^(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2})?\s+([A-Za-z]+)\s+(\d{4})$", t)
    if not m:
        return None, t
    day = int(m.group(1))
    month_name = m.group(2).lower()
    year = int(m.group(3))
    month = _MONTHS.get(month_name)
    if not month:
        return None, t
    try:
        iso = datetime(year, month, day, tzinfo=timezone.utc).date().isoformat()
        return iso, t
    except Exception:
        return None, t


def extract_metadata(soup, url, headers):
    """Extracts tournament metadata from the page."""
    if not soup:
        return {}

    infobox = soup.find('div', class_='infobox')
    name = None
    date_val = None
    fmt = None
    players = None
    start_date_iso = None
    start_date_text = None
    format_code = None
    format_name = None
    
    if infobox:
        heading = infobox.find('div', class_='infobox-heading')
        if heading and heading.text:
            name = heading.text.strip()

        line = infobox.find('div', class_='infobox-line')
        if line:
            date_line = line.get_text(separator=' ', strip=True)
            parts = [p.strip() for p in re.split(r"\s•\s|•", date_line) if p.strip()]
            if parts:
                date_val = parts[0]
                start_date_iso, start_date_text = _parse_start_date(parts[0])
            
            m = re.search(r"(\d+)\s+Players", date_line, flags=re.IGNORECASE)
            if m:
                try:
                    players = int(m.group(1))
                except Exception:
                    players = None
            
            fmt_link = None
            for a in line.find_all('a'):
                href = a.get('href') or ''
                if 'format=' in href:
                    fmt_link = a
                    break
            if fmt_link is not None:
                try:
                    href = fmt_link.get('href', '')
                    q = parse_qs(urlparse(href).query)
                    code = q.get('format', [None])[0]
                    if code:
                        format_code = code
                        fmt = fmt or fmt_link.get_text(strip=True)
                        format_name = fmt_link.get_text(strip=True)
                except Exception:
                    pass

    hdrs = headers or {}
    return {
        "name": name,
        "sourceUrl": url,
        "date": date_val,
        "format": fmt,
        "players": players,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "etag": hdrs.get('ETag'),
        "lastModified": hdrs.get('Last-Modified'),
        "reportVersion": "2.0",
        "startDate": start_date_iso,
        "startDateText": start_date_text,
        "formatCode": format_code,
        "formatName": format_name
    }


def extract_all_decklists(soup, anonymize=False):
    """Extracts all decklists into a list of dictionaries."""
    print("Extracting decklists from HTML...")
    all_decks = []
    deck_containers = soup.find_all('div', class_='tournament-decklist')

    for container in deck_containers:
        player_info = container.find('div', class_='decklist-toggle').text.strip()
        placement_match = re.match(r'^(\d+)[stndrh]+', player_info)
        placement = int(placement_match.group(1)) if placement_match else None
        player_name = re.sub(r'^(\d+)[stndrh]+\s', '', player_info)

        if anonymize and player_name:
            digest = hashlib.sha1(player_name.encode('utf-8')).hexdigest()[:10]
            player_name = f"Player-{digest}"

        cards = []
        cards_container = container.find('div', attrs={'data-text-decklist': True})
        if not cards_container:
            continue

        for card_div in cards_container.find_all('div', class_='decklist-card'):
            category_text = card_div.find_parent('div', class_='decklist-column').find(
                'div', class_='decklist-column-heading').text.strip().lower()
            category = "pokemon" if "pokémon" in category_text else "trainer" if "trainer" in category_text else "energy"
            set_acronym = card_div.get('data-set', '').upper().strip()
            number_raw = card_div.get('data-number', '').lstrip('0')
            number = number_raw.zfill(3) if number_raw else number_raw

            card_name = card_div.find('span', class_='card-name').text.strip()
            card_entry = {
                "count": int(card_div.find('span', class_='card-count').text.strip()),
                "name": card_name,
                "set": set_acronym,
                "number": number,
                "category": category
            }
            cards.append(card_entry)

        canonical_card_list = sorted([f"{c['count']}x{c['name']}{c['set']}{c['number']}" for c in cards])
        deck_hash = hashlib.sha1(json.dumps(canonical_card_list).encode()).hexdigest()

        all_decks.append({
            "id": deck_hash[:10],
            "player": player_name,
            "placement": placement,
            "archetype": container.find('div', class_='decklist-title').text.strip().split('\n')[0].strip(),
            "cards": cards,
            "deckHash": deck_hash
        })

    print(f"Extracted and processed {len(all_decks)} decks.")
    return all_decks


def canonicalize_variant(set_code: str, number: str):
    """Normalize set/number combinations."""
    sc = (set_code or '').upper().strip()
    num = (number or '').lstrip('0')
    num = num.zfill(3) if num else num
    return sc, num


def generate_report_json(deck_list, deck_total, all_decks_for_variants):
    """Generates the JSON structure for a list of decks."""
    card_data = defaultdict(list)
    name_casing = {}
    uid_meta = {}
    uid_category = {}

    for deck in deck_list:
        per_deck_counts = defaultdict(int)
        per_deck_seen_meta = {}
        
        for card in deck["cards"]:
            name = card.get("name", "")
            cat = (card.get("category") or "").lower() or None
            set_code = card.get("set", "")
            number = card.get("number", "")
            sc, num = canonicalize_variant(set_code, number)
            
            if sc and num:
                uid = f"{name}::{sc}::{num}"
                display = name
                per_deck_counts[uid] += int(card.get('count', 0))
                per_deck_seen_meta[uid] = {
                    "set": sc,
                    "number": num,
                    "category": cat
                }
                if cat:
                    uid_category[uid] = {"category": cat}
            else:
                uid = name
                display = name
                per_deck_counts[uid] += int(card.get('count', 0))
                if cat:
                    uid_category[uid] = {"category": cat}
                per_deck_seen_meta[uid] = {
                    "set": sc,
                    "number": num,
                    "category": cat
                }
        
        for uid, tot in per_deck_counts.items():
            card_data[uid].append(tot)
            if uid not in name_casing:
                name_casing[uid] = uid.split('::',1)[0] if '::' in uid else uid
            meta_payload = per_deck_seen_meta.get(uid, uid_meta.get(uid, {}))
            if '::' in uid:
                uid_meta[uid] = meta_payload or {}
            elif meta_payload:
                uid_meta.setdefault(uid, meta_payload)

    sorted_card_keys = sorted(card_data.keys(), key=lambda k: len(card_data[k]), reverse=True)
    
    report_items = []
    for rank, uid in enumerate(sorted_card_keys, 1):
        counts_list, found_count = card_data[uid], len(card_data[uid])
        dist_counter = Counter(counts_list)
        
        card_obj = {
            "rank": rank,
            "name": name_casing[uid],
            "found": found_count,
            "total": deck_total,
            "pct": round((found_count / deck_total) * 100, 2),
            "dist": [
                {
                    "copies": c,
                    "players": p,
                    "percent": round((p / found_count) * 100, 2)
                }
                for c, p in sorted(dist_counter.items())
            ]
        }
        
        meta = uid_meta.get(uid) or {}
        if '::' in uid:
            card_obj["set"] = meta.get("set")
            card_obj["number"] = meta.get("number")
            card_obj["uid"] = uid
        
        category_info = uid_category.get(uid)
        if isinstance(category_info, dict):
            base_category = category_info.get("category") or meta.get("category")
            if base_category:
                card_obj["category"] = base_category
        elif category_info:
            card_obj["category"] = category_info
        else:
            base_category = meta.get("category")
            if base_category:
                card_obj["category"] = base_category
                
        report_items.append(card_obj)
        
    return {"deckTotal": deck_total, "items": report_items}


def generate_card_index(all_decks):
    """Builds a per-card index keyed by base card name."""
    deck_total = len(all_decks)
    card_data = defaultdict(list)
    sets_map = defaultdict(set)
    name_casing = {}

    for deck in all_decks:
        per_deck_counts = defaultdict(int)
        for card in deck.get('cards', []):
            name = card.get('name', '')
            set_code = card.get('set', '')
            category = card.get('category')
            base_key = name.lower()
            if base_key not in name_casing:
                name_casing[base_key] = name
            per_deck_counts[base_key] += int(card.get('count', 0))
            if set_code:
                sets_map[base_key].add(set_code)
        
        for base_key, total_copies in per_deck_counts.items():
            card_data[base_key].append(total_copies)

    index = {}
    for base_key, counts in card_data.items():
        found = len(counts)
        dist_counter = Counter(counts)
        index[name_casing[base_key]] = {
            "found": found,
            "total": deck_total,
            "pct": round((found / deck_total) * 100, 2) if deck_total else 0.0,
            "dist": [
                {
                    "copies": c,
                    "players": p,
                    "percent": round((p / found) * 100, 2) if found else 0.0
                }
                for c, p in sorted(dist_counter.items())
            ],
            "sets": sorted(list(sets_map[base_key])) if sets_map[base_key] else []
        }

    return {"deckTotal": deck_total, "cards": index}


def scrape_card_print_variations(session, set_code, number):
    """
    Scrapes print variations for a specific card from Limitless.
    Returns list of dicts: [{'set': 'SFA', 'number': '038', 'price_usd': 19.67}, ...]
    Only includes international prints, not Japanese.
    """
    print(f"  Checking print variations for {set_code}/{number}...")

    number_variants = build_number_variants(number)
    if not number_variants:
        return []

    headers = {'User-Agent': 'Mozilla/5.0'}
    soup = None
    for variant in number_variants:
        url = f"https://limitlesstcg.com/cards/{set_code}/{variant}"
        resp = request_with_retries(session, 'GET', url, headers=headers, timeout=20, retries=2)
        if not resp:
            print(f"    Warning: Could not fetch print variations from {url}")
            continue
        soup = BeautifulSoup(resp.text, 'html.parser')
        table = soup.find('table', class_='card-prints-versions')
        if table:
            break
        soup = None  # reset and try next variant

    if soup is None:
        return []

    table = soup.find('table', class_='card-prints-versions')
    if not table:
        return []

    variations = []

    # Track whether we're in the international or Japanese section
    in_jp_section = False

    for row in table.find_all('tr'):
        # Check if this is the JP section header
        th = row.find('th')
        if th and 'JP. Prints' in th.get_text():
            in_jp_section = True
            continue

        # Skip if we're in the JP section
        if in_jp_section:
            continue

        # Skip header rows
        if th:
            continue

        # Find all table cells
        cells = row.find_all('td')
        if len(cells) < 2:
            continue

        # First cell has set name and number
        first_cell = cells[0]

        # Look for the card number span first
        number_elem = first_cell.find('span', class_='prints-table-card-number')
        if not number_elem:
            continue

        # Extract number from "#130" format
        card_num = number_elem.get_text(strip=True).lstrip('#')

        # Extract set acronym from href
        set_name_elem = first_cell.find('a')
        set_acronym = None

        if set_name_elem:
            href = set_name_elem.get('href', '')
            if href:
                # href format: /cards/SFA/38
                match = re.search(r'/cards/([A-Z0-9]+)/\d+', href)
                if match:
                    set_acronym = match.group(1)

        if not set_acronym:
            continue

        # Normalize to 3 digits with leading zeros
        normalized_num = card_num.zfill(3)

        # Extract USD price from second cell if available
        price_usd = None
        if len(cells) >= 2:
            price_link = cells[1].find('a', class_='card-price')
            if price_link:
                price_text = price_link.get_text(strip=True)
                # Extract numeric value from "$19.67" format
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

    if variations:
        print(f"    Found {len(variations)} international print(s)")

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
    canonical = sorted_variations[0]

    price_str = f"${canonical.get('price_usd', 'N/A')}" if canonical.get('price_usd') else 'N/A'
    print(f"    {card_name}: Selected {canonical['set']}~{canonical['number']} ({price_str}) from {len(variations)} prints")

    return canonical


def generate_card_synonyms(all_decks, session):
    """
    Generates synonym mappings for cards based on their print variations.
    Returns a dict with synonyms and canonicals for handling card reprints.
    """
    print("\nGenerating card synonyms from print variations...")

    # Collect all unique cards by name
    unique_cards_by_name = {}
    card_uids_by_name = {}

    for deck in all_decks:
        for card in deck.get('cards', []):
            card_name = card.get('name', '').strip()
            if not card_name:
                continue

            set_code = (card.get('set', '') or '').upper().strip()
            number = (card.get('number', '') or '').lstrip('0').zfill(3)

            if set_code and number:
                # Track all unique UIDs for this card name
                if card_name not in card_uids_by_name:
                    card_uids_by_name[card_name] = set()
                card_uids_by_name[card_name].add(f"{set_code}::{number}")

                # Store first occurrence for scraping
                if card_name not in unique_cards_by_name:
                    unique_cards_by_name[card_name] = {
                        'name': card_name,
                        'set': set_code,
                        'number': number
                    }

    # Build output structure
    synonyms_dict = {}
    canonicals_dict = {}

    total_cards = len(unique_cards_by_name)
    current = 0

    for card_name, card_info in unique_cards_by_name.items():
        current += 1
        if current % 10 == 0 or current == total_cards:
            print(f"  Progress: {current}/{total_cards} unique cards checked")

        # Scrape print variations for this card
        variations = scrape_card_print_variations(
            session,
            card_info['set'],
            card_info['number']
        )

        if not variations or len(variations) < 2:
            # Single print or no variations found
            continue

        # Choose the canonical print
        canonical_var = choose_canonical_print(variations, card_name)
        if not canonical_var:
            continue

        # Build canonical UID
        canonical_uid = f"{card_name}::{canonical_var['set']}::{canonical_var['number']}"

        # Build synonym UIDs
        for var in variations:
            variant_uid = f"{card_name}::{var['set']}::{var['number']}"
            if variant_uid != canonical_uid:
                synonyms_dict[variant_uid] = canonical_uid

        # Add to canonicals dict only if single unique UID in tournament
        if len(card_uids_by_name.get(card_name, set())) <= 1:
            canonicals_dict[card_name] = canonical_uid

    output = {
        "synonyms": synonyms_dict,
        "canonicals": canonicals_dict,
        "metadata": {
            "generated": datetime.now(timezone.utc).isoformat(),
            "totalSynonyms": len(synonyms_dict),
            "totalCanonicals": len(canonicals_dict),
            "description": "Card synonym mappings for handling reprints and alternate versions"
        }
    }

    print(f"\nSynonym generation complete: {len(canonicals_dict)} unique cards with {len(synonyms_dict)} total variants")
    return output


def upload_to_r2(r2_client, bucket_name, key, data):
    """Upload JSON data to R2."""
    print(f"  Uploading {key}...")
    r2_client.put_object(
        Bucket=bucket_name,
        Key=key,
        Body=json.dumps(data, indent=2),
        ContentType='application/json'
    )


def update_tournaments_json(r2_client, bucket_name, tournament_name):
    """Update tournaments.json to include the new tournament at the top."""
    tournaments_key = "reports/tournaments.json"
    
    try:
        # Download existing tournaments.json
        print(f"Downloading existing {tournaments_key}...")
        response = r2_client.get_object(Bucket=bucket_name, Key=tournaments_key)
        existing = json.loads(response['Body'].read().decode('utf-8'))
    except r2_client.exceptions.NoSuchKey:
        print(f"  {tournaments_key} not found, creating new list")
        existing = []
    except Exception as e:
        print(f"  Warning: Could not read {tournaments_key}: {e}")
        existing = []
    
    # Remove the tournament if it already exists
    existing = [x for x in existing if x != tournament_name]
    
    # Add at the top
    updated = [tournament_name] + existing
    
    # Sort in reverse chronological order
    updated.sort(reverse=True)
    
    # Upload back
    print(f"  Uploading updated {tournaments_key}...")
    r2_client.put_object(
        Bucket=bucket_name,
        Key=tournaments_key,
        Body=json.dumps(updated, indent=2),
        ContentType='application/json'
    )
    print(f"  ✓ Added '{tournament_name}' to tournaments.json")


def main():
    # Get environment variables
    limitless_url = os.environ.get('LIMITLESS_URL')
    anonymize = os.environ.get('ANONYMIZE', 'false').lower() == 'true'
    r2_account_id = os.environ.get('R2_ACCOUNT_ID')
    r2_access_key_id = os.environ.get('R2_ACCESS_KEY_ID')
    r2_secret_access_key = os.environ.get('R2_SECRET_ACCESS_KEY')
    r2_bucket_name = os.environ.get('R2_BUCKET_NAME', 'ciphermaniac-reports')

    if not limitless_url:
        print("Error: LIMITLESS_URL environment variable not set")
        sys.exit(1)

    if not all([r2_account_id, r2_access_key_id, r2_secret_access_key]):
        print("Error: R2 credentials not set")
        sys.exit(1)

    # Initialize R2 client
    r2_client = boto3.client(
        's3',
        endpoint_url=f'https://{r2_account_id}.r2.cloudflarestorage.com',
        aws_access_key_id=r2_access_key_id,
        aws_secret_access_key=r2_secret_access_key,
        region_name='auto'
    )

    # Create session and download page
    session = requests.Session()
    soup, headers, html_text = get_soup(limitless_url, session)
    if not soup:
        print("Error: Failed to download tournament page")
        sys.exit(1)

    # Extract metadata and decks
    metadata = extract_metadata(soup, limitless_url, headers)
    all_decks = extract_all_decklists(soup, anonymize=anonymize)

    if not all_decks:
        print("Error: No decklists found")
        sys.exit(1)

    # Generate tournament folder name from date and name
    tournament_name = metadata.get('name')
    start_date = metadata.get('startDate')
    
    if start_date and tournament_name:
        folder_name = f"{start_date}, {sanitize_for_path(tournament_name)}"
    elif tournament_name:
        folder_name = sanitize_for_path(tournament_name)
    else:
        folder_name = "Unknown Tournament"

    print(f"\nProcessing tournament: {folder_name}")
    print(f"  Players: {len(all_decks)}")

    # Generate reports
    print("\nGenerating master report...")
    master_report = generate_report_json(all_decks, len(all_decks), all_decks)

    print("Generating card index...")
    card_index = generate_card_index(all_decks)

    print("Generating card synonyms...")
    synonyms_data = generate_card_synonyms(all_decks, session)

    print("Generating archetype reports...")
    archetype_groups = defaultdict(list)
    archetype_casing = {}
    
    for deck in all_decks:
        norm_name = normalize_archetype_name(deck["archetype"])
        archetype_groups[norm_name].append(deck)
        if norm_name not in archetype_casing:
            archetype_casing[norm_name] = deck["archetype"]

    archetype_index_list = []
    archetype_files = {}
    
    for norm_name, deck_list in archetype_groups.items():
        proper_name = archetype_casing[norm_name]
        print(f"  - {proper_name} ({len(deck_list)} decks)")
        archetype_data = generate_report_json(deck_list, len(deck_list), all_decks)
        json_filename_base = sanitize_for_filename(proper_name)
        archetype_filename = f"{json_filename_base}.json"
        archetype_index_list.append(json_filename_base)
        archetype_files[archetype_filename] = archetype_data

    # Upload to R2
    print(f"\nUploading to R2 bucket: {r2_bucket_name}")
    base_path = f"reports/{folder_name}"

    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/meta.json", metadata)
    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/decks.json", all_decks)
    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/master.json", master_report)
    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/cardIndex.json", card_index)
    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/synonyms.json", synonyms_data)
    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/archetypes/index.json", sorted(archetype_index_list))

    for filename, data in archetype_files.items():
        upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/archetypes/{filename}", data)

    # Update tournaments.json
    print("\nUpdating tournaments.json...")
    update_tournaments_json(r2_client, r2_bucket_name, folder_name)

    print("\n✓ Process complete!")
    print(f"  Tournament: {folder_name}")
    print(f"  Decks: {len(all_decks)}")
    print(f"  Archetypes: {len(archetype_files)}")
    print(f"  Synonyms: {len(synonyms_data.get('synonyms', {}))} variants, {len(synonyms_data.get('canonicals', {}))} canonicals")


if __name__ == '__main__':
    main()
