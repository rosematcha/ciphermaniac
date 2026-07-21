#!/usr/bin/env python3
"""
Daily price check script for GitHub Actions
Fetches prices for all cards in "Online - Last 14 Days" report
"""

import os
import sys
import json
import re
import time
import unicodedata
from datetime import datetime, timezone, date, timedelta
from collections import defaultdict
from pathlib import Path

# Shared R2 helpers (retrying client + typed read results). lib/r2.py has an
# underscore-free name so it imports cleanly regardless of the current directory.
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import r2  # noqa: E402


TCGCSV_GROUPS_URL = 'https://tcgcsv.com/tcgplayer/3/groups'
ONLINE_META_PATH = 'reports/Online - Last 14 Days'
CARD_SYNONYMS_KEY = 'assets/card-synonyms.json'

# Rolling price-history artifact: one compact file keyed by card UID → list of
# {d: 'YYYY-MM-DD', p: price} points, bounded to a 90-day window. To keep the
# file small on $0 static hosting, consecutive same-price days are collapsed
# (only the day a price *changes* is stored), so a flat card carries a single
# point and the frontend degrades it to no sparkline.
PRICES_HISTORY_KEY = 'reports/prices-history.json'
PRICES_CACHE_CONTROL = 'public, max-age=21600'
HISTORY_WINDOW_DAYS = 90

# Client-facing derivatives of the rolling history. The monolith above stays the
# job's own append state (it is the only place the full series lives), but no
# page downloads it: at ~3,400 priced prints it runs to several MB.
#   - Per-set shards feed one card page's sparkline (tens of KB).
#   - The pre-digested movers artifact feeds the trends page (a few KB) so the
#     browser does no window math over the whole corpus.
HISTORY_SHARD_PREFIX = 'reports/price-history/'
PRICE_MOVERS_KEY = 'reports/price-movers.json'

# Movers window and gates. Each row carries both metrics, and we emit a list
# ranked each way (the page toggles between them client-side):
#   - by percent: a flat dollar floor is 1% of one $20 print and 25% of another
#     $1 print, so the percent view gates on percent with a small dollar floor
#     to keep sub-dime noise on cheap cards out.
#   - by value: gates on raw dollars; expensive cards dominating is the point.
MOVER_WINDOW_DAYS = 7
MOVER_MIN_PRICE = 1.0
MOVER_MIN_PCT = 5.0
MOVER_MIN_DELTA = 0.10
MOVER_MIN_VALUE_DELTA = 0.25
MOVER_LIMIT = 12

# Manual group ID mappings for sets TCGCSV indexes under an unmatchable name.
#   MEP/SVP: promo groups whose abbreviation differs from our set code.
#   SP: SWSH promos — abbreviation "SWSD" and group name "SWSH: ... Promo Cards"
#       line up with neither our code nor the catalog name.
MANUAL_GROUP_ID_MAP = {
    'MEP': 24451,
    'SVP': 22872,
    'SP': 2545
}

# Local set catalog — the single source of truth for set names, shared with the
# name-based group fallback below.
SET_CATALOG_PATH = Path(__file__).resolve().parent / 'data' / 'set-catalog.json'

# TCGCSV publishes one price record per product per printing variant
# (subTypeName). The card's "standard" price is the plainest printing that
# actually has a market price: non-holo first, then holo (the only printing
# for rares/ex), and reverse holo only as a last resort.
SUBTYPE_PREFERENCE = ('Normal', 'Holofoil', 'Reverse Holofoil')

# Basic energy canonical mappings — the newest cheap print (currently MEE).
# Keep in sync with the canonicals emitted by update-card-synonyms.mjs.
BASIC_ENERGY_CANONICALS = {
    'Grass Energy': 'Grass Energy::MEE::001',
    'Fire Energy': 'Fire Energy::MEE::002',
    'Water Energy': 'Water Energy::MEE::003',
    'Lightning Energy': 'Lightning Energy::MEE::004',
    'Psychic Energy': 'Psychic Energy::MEE::005',
    'Fighting Energy': 'Fighting Energy::MEE::006',
    'Darkness Energy': 'Darkness Energy::MEE::007',
    'Metal Energy': 'Metal Energy::MEE::008'
}

BASIC_ENERGY_NAMES = {
    'Darkness Energy', 'Fighting Energy', 'Fire Energy', 'Grass Energy',
    'Lightning Energy', 'Metal Energy', 'Psychic Energy', 'Water Energy'
}


def normalize_card_name(name):
    """
    Normalize card name for matching:
    - Remove accents (é → e, etc.)
    - Remove bracketed text like [Ghetsis]
    - Lowercase for comparison
    """
    if not name:
        return ''
    
    # Remove bracketed text (e.g., "Boss's Orders [Ghetsis]" → "Boss's Orders")
    name = re.sub(r'\s*\[.*?\]\s*', '', name)
    
    # Normalize unicode characters (é → e)
    name = unicodedata.normalize('NFD', name)
    name = ''.join(char for char in name if unicodedata.category(char) != 'Mn')
    
    # Lowercase and strip
    return name.lower().strip()


TCGCSV_USER_AGENT = "ciphermaniac-price-updater/1.0 (+https://ciphermaniac.com)"


def fetch_json(url):
    """Fetch JSON from a URL."""
    import requests
    response = requests.get(url, timeout=30, headers={"User-Agent": TCGCSV_USER_AGENT})
    response.raise_for_status()
    return response.json()


def fetch_tcgcsv_results(url):
    """Fetch a TCGCSV endpoint and return its results list."""
    data = fetch_json(url)
    if not data.get('success'):
        raise RuntimeError(f"TCGCSV returned success=false for {url}")
    return data.get('results', [])


def initialize_r2_client():
    """Initialize boto3 S3 client for R2."""
    r2_account_id = os.environ.get('R2_ACCOUNT_ID')
    r2_access_key_id = os.environ.get('R2_ACCESS_KEY_ID')
    r2_secret_access_key = os.environ.get('R2_SECRET_ACCESS_KEY')

    if not all([r2_account_id, r2_access_key_id, r2_secret_access_key]):
        print("Error: R2 credentials not set")
        sys.exit(1)

    return r2.make_r2_client(r2_account_id, r2_access_key_id, r2_secret_access_key)


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


def load_card_synonyms(r2_client, bucket_name):
    """Load card synonyms for resolving canonical UIDs.

    Read straight from the R2 bucket, not the public r2.ciphermaniac.com URL:
    that origin sits behind Cloudflare's edge cache, which serves a stale
    synonyms file for hours after a rebuild — so the daily price job would key
    prices to the previous run's canonicals. The bucket is always current.
    """
    print("Loading card synonyms...")
    result = r2.read_json(r2_client, bucket_name, CARD_SYNONYMS_KEY)
    if result.status == 'missing':
        print("  No synonyms object in R2; starting with empty synonyms")
        return {'synonyms': {}, 'canonicals': {}}
    if result.status != 'found':
        # A transport blip or corrupt payload here would mis-key every price to
        # the previous canonicals — abort rather than run with empty synonyms.
        print(f"  Error: could not load synonyms from R2 ({result.status}): {result.error}")
        sys.exit(1)
    data = result.value if isinstance(result.value, dict) else {}
    print(f"  Loaded {len(data.get('synonyms', {}))} synonyms from R2")
    return {
        'synonyms': data.get('synonyms', {}),
        'canonicals': data.get('canonicals', {})
    }


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


def build_print_universe(synonyms_data):
    """Every print UID across every synonyms cluster, canonical included.

    Universe = keys of ``synonyms`` (the alias prints) + values of ``synonyms``
    (their canonicals) + values of ``canonicals`` (base-name → canonical).

    Pricing the whole universe, not just the canonicals, is what lets the movers
    artifact tell a playable print from a collector one: a cluster's canonical is
    only its *representative*, and for cards like Umbreon ex it is the $1,500
    special illustration rare. Cheap on the wire too — TCGCSV is fetched as
    whole-set dumps, so extra UIDs in sets we already pull cost no requests.

    Shared with backfill-print-prices.py, which prices the same universe against
    TCGCSV's daily archives.
    """
    universe = set()
    synonyms = synonyms_data.get('synonyms', {}) if isinstance(synonyms_data, dict) else {}
    canonicals = synonyms_data.get('canonicals', {}) if isinstance(synonyms_data, dict) else {}

    for alias_uid, canonical_uid in synonyms.items():
        if alias_uid:
            universe.add(alias_uid)
        if canonical_uid:
            universe.add(canonical_uid)
    for canonical_uid in canonicals.values():
        if canonical_uid:
            universe.add(canonical_uid)

    return universe


def accessible_price_cap(min_price):
    """Ceiling for a "standard" print: no more than twice the cheapest print in
    its cluster, with $0.50 of absolute slack so penny cards do not strike prints
    over noise. Mirror of ``accessiblePriceCap`` in shared/data/cardIdentity.ts.
    """
    return max(min_price * 2, min_price + 0.5)


def build_clusters(synonyms_data):
    """Invert the synonyms map into canonical UID → list of member print UIDs."""
    clusters = defaultdict(set)
    for alias_uid, canonical_uid in synonyms_data.get('synonyms', {}).items():
        if alias_uid and canonical_uid:
            clusters[canonical_uid].update((canonical_uid, alias_uid))
    return clusters


def classify_standard_prints(price_data, synonyms_data):
    """UIDs that are the playable print of their cluster, by price.

    A print qualifies when it costs no more than ``accessible_price_cap`` of the
    cheapest print in its cluster. Prints in no cluster (single-printing cards)
    and prints we could not price qualify by default — dropping them would read
    on the page as "this card did not move".
    """
    clusters = build_clusters(synonyms_data)
    member_of = {}
    for canonical_uid, members in clusters.items():
        for uid in members:
            member_of[uid] = canonical_uid

    def price_of(uid):
        entry = price_data.get(uid)
        price = entry.get('price') if isinstance(entry, dict) else None
        return price if isinstance(price, (int, float)) else None

    standard = set()
    for uid in price_data:
        own = price_of(uid)
        canonical_uid = member_of.get(uid)
        if own is None or canonical_uid is None:
            standard.add(uid)
            continue
        prices = [p for p in (price_of(m) for m in clusters[canonical_uid]) if p is not None]
        if not prices or own <= accessible_price_cap(min(prices)):
            standard.add(uid)
    return standard


def group_cards_by_set(card_list):
    """Group cards by set code."""
    by_set = defaultdict(list)
    
    for card_uid in card_list:
        parts = card_uid.split('::')
        if len(parts) >= 3:
            set_code = parts[1]
            by_set[set_code].append(card_uid)
    
    return by_set


def _group_name_tail(name):
    """The comparable tail of a TCGCSV group name.

    ``"SWSH09: Brilliant Stars"`` → ``"brilliant stars"``; a bare
    ``"Brilliant Stars"`` → ``"brilliant stars"``.
    """
    if not name:
        return ""
    tail = name.split(": ", 1)[1] if ": " in name else name
    return tail.strip().lower()


def build_catalog_name_index(catalog):
    """Map lowercased set *name* → set code from the local set catalog.

    Feeds the name-based group fallback: TCGCSV group names look like
    ``"SWSH09: Brilliant Stars"``, so matching the portion after ``": "`` against
    catalog names resolves the group when abbreviations don't line up.
    """
    index = {}
    for entry in catalog.get("sets", []):
        name = (entry.get("name") or "").strip().lower()
        code = entry.get("code")
        if name and code:
            index.setdefault(name, code)
    return index


def resolve_group_ids(set_codes, groups, catalog_name_index, manual_map):
    """Resolve set codes to TCGCSV group IDs (pure).

    Resolution order per set: abbreviation → manual map → catalog-name match
    against the group name tail. Returns ``(mappings, unmapped)`` where
    ``unmapped`` is sorted so the caller can log it loudly. Never fatal — an
    unmapped set just yields no prices for its prints. Shared with
    backfill-print-prices.py so the daily job and backfills map identically.
    """
    by_abbrev = {}
    by_name_code = {}
    for group in groups:
        if not isinstance(group, dict):
            continue
        gid = group.get("groupId")
        if gid is None:
            continue
        abbrev = group.get("abbreviation")
        if abbrev:
            by_abbrev[abbrev] = gid
        code = catalog_name_index.get(_group_name_tail(group.get("name") or ""))
        if code:
            by_name_code.setdefault(code, gid)

    mappings = {}
    unmapped = []
    for set_code in set_codes:
        if set_code in by_abbrev:
            mappings[set_code] = by_abbrev[set_code]
        elif set_code in manual_map:
            mappings[set_code] = manual_map[set_code]
        elif set_code in by_name_code:
            mappings[set_code] = by_name_code[set_code]
        else:
            unmapped.append(set_code)

    return mappings, sorted(unmapped)


def map_sets_to_group_ids(card_sets):
    """Fetch TCGCSV groups and resolve our set codes to group IDs."""
    print("\nFetching TCGCSV groups...")
    groups_data = fetch_json(TCGCSV_GROUPS_URL)

    if not groups_data.get('success'):
        print("Error: TCGCSV groups API returned success: false")
        sys.exit(1)

    catalog = json.loads(SET_CATALOG_PATH.read_text())
    mappings, unmapped = resolve_group_ids(
        card_sets,
        groups_data.get('results', []),
        build_catalog_name_index(catalog),
        MANUAL_GROUP_ID_MAP
    )
    for set_code, gid in mappings.items():
        print(f"  {set_code} -> {gid}")
    if unmapped:
        print(f"  Warning: no TCGCSV group for {len(unmapped)} sets: {unmapped}")

    return mappings


def parse_product(product):
    """
    Extract (product_id, card_name, normalized_number) from a TCGCSV product
    record, or None for products that aren't single cards (sealed product etc.
    carries no Number in extendedData).
    """
    product_id = product.get('productId')
    name = (product.get('name') or '').strip()
    if not product_id or not name:
        return None

    number = ''
    for ext in product.get('extendedData') or []:
        if ext.get('name') == 'Number':
            number = str(ext.get('value') or '').strip()
            break
    if not number:
        return None

    # Product names come as "CardName - Number/Total" or bare "CardName"
    if ' - ' in name and '/' in name:
        card_name = name.split(' - ')[0].strip()
    else:
        card_name = name

    card_number = number.split('/')[0] if '/' in number else number
    normalized_number = card_number.zfill(3) if card_number.isdigit() else card_number
    return product_id, card_name, normalized_number


def build_normalized_lookup(card_uids):
    """Map "normalized_name::number" to actual UID for fuzzy matching."""
    normalized_lookup = {}
    for uid in card_uids:
        parts = uid.split('::')
        if len(parts) >= 3:
            normalized_key = f"{normalize_card_name(parts[0])}::{parts[2]}"
            normalized_lookup[normalized_key] = uid
    return normalized_lookup


def build_product_uid_map(products, set_code, card_uids):
    """Map TCGCSV productId -> card UID for the cards we track in this set."""
    card_uid_lookup = set(card_uids)
    normalized_lookup = build_normalized_lookup(card_uids)

    product_uid_map = {}
    for product in products:
        parsed = parse_product(product)
        if not parsed:
            continue
        product_id, card_name, number = parsed

        uid = f"{card_name}::{set_code}::{number}"
        if uid not in card_uid_lookup:
            uid = normalized_lookup.get(f"{normalize_card_name(card_name)}::{number}")
        if uid:
            product_uid_map[product_id] = uid
    return product_uid_map


def select_market_price(variants):
    """
    Pick the standard printing's market price from a product's price records.

    Returns (price, subTypeName) for the first SUBTYPE_PREFERENCE entry with a
    positive market price, falling back to any positive price, or None when
    the product has no usable market price at all.
    """
    priced = []
    for variant in variants:
        try:
            price = float(variant.get('marketPrice') or 0)
        except (TypeError, ValueError):
            price = 0.0
        priced.append((variant.get('subTypeName'), price))

    for preferred in SUBTYPE_PREFERENCE:
        for subtype, price in priced:
            if subtype == preferred and price > 0:
                return price, subtype
    for subtype, price in priced:
        if price > 0:
            return price, subtype
    return None


def extract_set_prices(products, price_records, set_code, card_uids):
    """
    Join a set's product and price records into {uid: {price, tcgPlayerId}}.

    Pure (no I/O) so it's unit-testable. When several products resolve to the
    same UID, the first priced one wins (stable product order beats the old
    last-row-wins accident).
    """
    product_uid_map = build_product_uid_map(products, set_code, card_uids)

    variants_by_product = defaultdict(list)
    for record in price_records:
        product_id = record.get('productId')
        if product_id in product_uid_map:
            variants_by_product[product_id].append(record)

    prices = {}
    for product in products:
        product_id = product.get('productId')
        uid = product_uid_map.get(product_id)
        if not uid or uid in prices:
            continue
        selected = select_market_price(variants_by_product.get(product_id, []))
        if selected is None:
            continue
        price, _subtype = selected
        prices[uid] = {
            'price': price,
            'tcgPlayerId': str(product_id)
        }
    return prices


def fetch_prices_for_set(set_code, group_id, card_uids):
    """Fetch prices for a single set from TCGCSV's JSON endpoints."""
    print(f"\n  Fetching {set_code} (group {group_id})...")
    try:
        products = fetch_tcgcsv_results(f"https://tcgcsv.com/tcgplayer/3/{group_id}/products")
        price_records = fetch_tcgcsv_results(f"https://tcgcsv.com/tcgplayer/3/{group_id}/prices")
        prices = extract_set_prices(products, price_records, set_code, card_uids)
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
        time.sleep(0.25)  # per TCGCSV FAQ etiquette

    return all_prices


def add_basic_energy_prices(price_data, card_list):
    """Add hardcoded $0.01 prices for basic energy."""
    for energy_name in BASIC_ENERGY_NAMES:
        canonical_uid = BASIC_ENERGY_CANONICALS.get(energy_name)
        if canonical_uid and canonical_uid in card_list:
            if canonical_uid not in price_data:
                price_data[canonical_uid] = {
                    'price': 0.01,
                    'tcgPlayerId': None
                }
    print(f"\nAdded {len([k for k in price_data if 'Energy::' in k])} basic energy prices")


class PriceHistoryReadError(Exception):
    """Raised when the existing price history exists but cannot be read.

    A transient transport error or corrupt payload must abort the run:
    starting fresh here would replace up to 90 days of valid history with
    a single day's data.
    """


def _is_missing_object_error(error):
    """True only when the object verifiably does not exist (404/NoSuchKey)."""
    return r2.is_missing_object_error(error)


def load_price_history(r2_client, bucket_name):
    """Load the existing rolling price-history artifact.

    Returns {} only when the object verifiably does not exist (first run).
    Any other failure — transport error, permission error, corrupt JSON —
    raises PriceHistoryReadError so the run aborts instead of silently
    replacing valid history.
    """
    print(f"\nLoading {PRICES_HISTORY_KEY}...")
    try:
        response = r2_client.get_object(Bucket=bucket_name, Key=PRICES_HISTORY_KEY)
    except Exception as e:
        if _is_missing_object_error(e):
            print("  No existing history object; starting fresh")
            return {}
        raise PriceHistoryReadError(
            f"Failed to read {PRICES_HISTORY_KEY}: {e}"
        ) from e
    try:
        data = json.loads(response['Body'].read().decode('utf-8'))
    except (ValueError, UnicodeDecodeError) as e:
        raise PriceHistoryReadError(
            f"Corrupt price history at {PRICES_HISTORY_KEY}: {e}"
        ) from e
    history = data.get('history', {}) if isinstance(data, dict) else {}
    print(f"  Loaded history for {len(history)} cards")
    return history


def update_price_history(existing_history, price_data, today, window_days=HISTORY_WINDOW_DAYS):
    """
    Append today's prices onto the rolling history and return the new history.

    Pure (no I/O) so it's unit-testable. Rules:
    - Only cards priced today are carried forward (cards that fall out of the
      report drop out of the file).
    - A day is only stored when the price differs from the card's most recent
      stored point — flat runs collapse to a single point to keep the file small.
    - Points older than `window_days` before `today` are trimmed.
    - `today` is a `datetime.date`; prices are rounded to whole cents.
    """
    cutoff = today - timedelta(days=window_days)
    today_str = today.isoformat()
    new_history = {}

    for uid, entry in price_data.items():
        price = entry.get('price') if isinstance(entry, dict) else None
        if price is None:
            continue
        try:
            price = round(float(price), 2)
        except (TypeError, ValueError):
            continue

        # Carry forward prior in-window points, dropping any stale "today" entry
        # (idempotent re-runs on the same day) and anything past the window.
        prior = []
        for point in existing_history.get(uid, []):
            d = point.get('d')
            p = point.get('p')
            if not d or p is None or d >= today_str:
                continue
            try:
                point_date = date.fromisoformat(d)
            except (TypeError, ValueError):
                continue
            if point_date < cutoff:
                continue
            prior.append({'d': d, 'p': round(float(p), 2)})

        prior.sort(key=lambda pt: pt['d'])
        # Collapse flat runs: only record today if it moves the last known price.
        if not prior or prior[-1]['p'] != price:
            prior.append({'d': today_str, 'p': price})
        new_history[uid] = prior

    return new_history


def history_span_days(history):
    """Calendar days between the earliest and latest observation anywhere in the
    history. The frontend gates price UI on this so trends stay hidden until the
    daily job has accumulated enough (there is no backfill for this artifact).
    """
    dates = []
    for points in history.values():
        for point in points:
            try:
                dates.append(date.fromisoformat(point['d']))
            except (KeyError, TypeError, ValueError):
                continue
    if not dates:
        return 0
    return (max(dates) - min(dates)).days


def _mover_row(uid, start, current):
    # Last two segments win, mirroring parseCardUid in cardIdentity.ts — a name
    # is free to contain '::' but a set code and number are not.
    name, set_code, number = uid.rsplit('::', 2)
    delta = round(current - start, 2)
    return {
        'uid': uid,
        'name': name,
        'set': set_code,
        'number': number,
        'start': start,
        'current': current,
        'delta': delta,
        'pct': round((current - start) / start * 100, 1)
    }


def _rank_movers(rows, key, limit):
    """Rising/falling lists ranked by `key` (a row → signed magnitude)."""
    return {
        'rising': sorted((r for r in rows if key(r) > 0), key=lambda r: -key(r))[:limit],
        'falling': sorted((r for r in rows if key(r) < 0), key=key)[:limit]
    }


def build_price_movers(history, standard_uids, today,
                       window_days=MOVER_WINDOW_DAYS, limit=MOVER_LIMIT):
    """Pre-digest the biggest movers so the browser downloads a few KB, not the
    whole history.

    Each scope carries the same rows ranked two ways — `pct` and `value` — so the
    page can toggle the metric without recomputing. Every row already holds both
    `pct` and `delta`, so the toggle only swaps which pre-sorted list renders.

    The baseline is the last observation at or before the cutoff, carried
    forward: flat runs collapse to a single point when written, so a card that
    has not moved in weeks has no point inside the window at all. Pure (no I/O)
    for testability.
    """
    cutoff = (today - timedelta(days=window_days)).isoformat()
    scopes = {'all': [], 'standard': []}

    for uid, points in history.items():
        if len(uid.split('::')) < 3 or len(points) < 2:
            continue
        ordered = sorted(points, key=lambda pt: pt.get('d', ''))
        baseline = None
        for point in ordered:
            if point.get('d', '') <= cutoff:
                baseline = point.get('p')
            else:
                break
        if baseline is None:
            baseline = ordered[0].get('p')
        current = ordered[-1].get('p')
        if not isinstance(baseline, (int, float)) or not isinstance(current, (int, float)):
            continue
        if baseline <= 0 or current < MOVER_MIN_PRICE:
            continue
        row = _mover_row(uid, round(float(baseline), 2), round(float(current), 2))
        scopes['all'].append(row)
        if uid in standard_uids:
            scopes['standard'].append(row)

    def rankings(rows):
        by_pct = [r for r in rows if abs(r['pct']) >= MOVER_MIN_PCT and abs(r['delta']) >= MOVER_MIN_DELTA]
        by_value = [r for r in rows if abs(r['delta']) >= MOVER_MIN_VALUE_DELTA]
        return {
            'pct': _rank_movers(by_pct, lambda r: r['pct'], limit),
            'value': _rank_movers(by_value, lambda r: r['delta'], limit)
        }

    return {scope: rankings(rows) for scope, rows in scopes.items()}


def upload_price_movers_to_r2(r2_client, bucket_name, movers, span_days):
    """Upload the pre-digested movers artifact read by the trends page."""
    output = {
        'windowDays': MOVER_WINDOW_DAYS,
        'spanDays': span_days,
        'scopes': movers,
        'metadata': {
            'generated': datetime.now(timezone.utc).isoformat(),
            'minPct': MOVER_MIN_PCT,
            'minDelta': MOVER_MIN_DELTA,
            'minValueDelta': MOVER_MIN_VALUE_DELTA,
            'minPrice': MOVER_MIN_PRICE
        }
    }
    print(f"\nUploading to R2: {PRICE_MOVERS_KEY}")
    r2_client.put_object(
        Bucket=bucket_name,
        Key=PRICE_MOVERS_KEY,
        Body=json.dumps(output, separators=(',', ':')),
        ContentType='application/json',
        CacheControl=PRICES_CACHE_CONTROL
    )
    for scope, metrics in movers.items():
        parts = ', '.join(f"{m} {len(l['rising'])}↑/{len(l['falling'])}↓" for m, l in metrics.items())
        print(f"  ✓ {scope}: {parts}")


def upload_derived_artifacts(r2_client, bucket_name, history, price_data, synonyms_data, today):
    """Write the two client-facing derivatives of the rolling history: per-set
    shards (card sparklines) and the pre-digested movers (trends page).

    Shared by the daily job and the history backfill so both stay in lockstep —
    a backfill refreshes the whole surface, not just the monolith.
    """
    upload_history_shards_to_r2(r2_client, bucket_name, history)
    standard_uids = classify_standard_prints(price_data, synonyms_data)
    movers = build_price_movers(history, standard_uids, today)
    upload_price_movers_to_r2(r2_client, bucket_name, movers, history_span_days(history))


def shard_history_by_set(history):
    """Split the rolling history into one bucket per set code — a card page
    needs its own set's series, not the whole corpus.
    """
    shards = defaultdict(dict)
    for uid, points in history.items():
        parts = uid.split('::')
        if len(parts) >= 3:
            shards[parts[1]][uid] = points
    return shards


def upload_history_shards_to_r2(r2_client, bucket_name, history):
    """Upload per-set history shards. Every set is rewritten each run; the daily
    write volume (tens of objects) is far inside the R2 free tier.
    """
    shards = shard_history_by_set(history)
    print(f"\nUploading {len(shards)} price-history shards under {HISTORY_SHARD_PREFIX}")
    generated = datetime.now(timezone.utc).isoformat()
    for set_code, shard in shards.items():
        output = {
            'history': shard,
            'metadata': {
                'generated': generated,
                'windowDays': HISTORY_WINDOW_DAYS,
                'totalCards': len(shard)
            }
        }
        r2_client.put_object(
            Bucket=bucket_name,
            Key=f'{HISTORY_SHARD_PREFIX}{set_code}.json',
            Body=json.dumps(output, separators=(',', ':')),
            ContentType='application/json',
            CacheControl=PRICES_CACHE_CONTROL
        )
    print(f"  ✓ Shard upload complete ({sum(len(s) for s in shards.values())} cards)")


def upload_price_history_to_r2(r2_client, bucket_name, history):
    """Upload the rolling price-history artifact (compact, no whitespace)."""
    output = {
        'history': history,
        'metadata': {
            'generated': datetime.now(timezone.utc).isoformat(),
            'windowDays': HISTORY_WINDOW_DAYS,
            'totalCards': len(history)
        }
    }
    print(f"\nUploading to R2: {PRICES_HISTORY_KEY}")
    r2_client.put_object(
        Bucket=bucket_name,
        Key=PRICES_HISTORY_KEY,
        Body=json.dumps(output, separators=(',', ':')),
        ContentType='application/json',
        CacheControl=PRICES_CACHE_CONTROL
    )
    print(f"  ✓ History upload complete ({len(history)} cards)")


def upload_prices_to_r2(r2_client, bucket_name, price_data):
    """Upload the spot-price snapshot to R2 (frontend-compatible format).

    Canonical UIDs only. The card index and archetype pages fetch this on load
    and only ever look up canonicals, so the extra printings we now price stay
    out of it — they reach the browser pre-digested in the movers artifact.
    """
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
        Body=json.dumps(output, separators=(',', ':')),
        ContentType='application/json',
        CacheControl=PRICES_CACHE_CONTROL
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
    synonyms_data = load_card_synonyms(r2_client, bucket_name)
    
    # Canonical cards drive the snapshot; the full print universe (every
    # printing in every cluster) is what we actually price, so the movers
    # artifact can tell playable prints from collector ones.
    canonical_list = extract_unique_cards(master_report, synonyms_data)
    card_list = canonical_list | build_print_universe(synonyms_data)
    print(f"Pricing {len(card_list)} prints ({len(canonical_list)} canonical)")

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
    
    # Upload snapshot to R2 (canonicals only — see upload_prices_to_r2)
    canonical_prices = {uid: entry for uid, entry in price_data.items() if uid in canonical_list}
    upload_prices_to_r2(r2_client, bucket_name, canonical_prices)

    # Append onto the rolling price history. The monolith is this job's own
    # append state; the browser reads the shards and the movers artifact.
    today = datetime.now(timezone.utc).date()
    existing_history = load_price_history(r2_client, bucket_name)
    history = update_price_history(existing_history, price_data, today)
    upload_price_history_to_r2(r2_client, bucket_name, history)
    upload_derived_artifacts(r2_client, bucket_name, history, price_data, synonyms_data, today)


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
