import os
import re
import json
import hashlib
import requests
import argparse
import tempfile
import time
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs, urljoin
from bs4 import BeautifulSoup
from collections import Counter, defaultdict
from itertools import product
from concurrent.futures import ThreadPoolExecutor, as_completed
import sys
import shutil
from pathlib import Path
import unicodedata
import atexit

LIMITLESS_BASE_URL = "https://play.limitlesstcg.com"
LIMITLESS_LABS_BASE_URL = "https://labs.limitlesstcg.com"
_LIMITLESS_ARCHETYPE_CACHE = None

CARD_METADATA_FILE = Path(__file__).resolve().parent / "card_categories.json"
_CARD_METADATA = {"version": 1, "cards": {}}
_CARD_METADATA_DIRTY = False

_TRAINER_TYPE_CHOICES = {
    's': 'supporter',
    'i': 'item',
    't': 'tool',
    'd': 'stadium',
    'o': 'other'
}

_ENERGY_TYPE_CHOICES = {
    'b': 'basic',
    's': 'special'
}


def _compose_display_category(category, trainer_type=None, energy_type=None):
    base = (category or '').strip().lower()
    if not base:
        return ''
    if base == 'trainer' and trainer_type:
        return f"trainer-{trainer_type.strip().lower()}"
    if base == 'energy' and energy_type:
        return f"energy-{energy_type.strip().lower()}"
    return base


def _normalize_card_key(name):
    if not name:
        return ''
    normalized = unicodedata.normalize('NFKC', name)
    normalized = normalized.replace('’', "'").replace('“', '"').replace('”', '"')
    normalized = re.sub(r'\s+', ' ', normalized)
    return normalized.strip().lower()


def _load_card_metadata():
    global _CARD_METADATA
    if not CARD_METADATA_FILE.exists():
        _CARD_METADATA = {"version": 1, "cards": {}}
        return
    try:
        with CARD_METADATA_FILE.open('r', encoding='utf-8') as handle:
            raw = json.load(handle)
        if not isinstance(raw, dict):
            raise ValueError("metadata root must be an object")
        cards_raw = raw.get('cards')
        if not isinstance(cards_raw, dict):
            cards_raw = {}
        normalized_cards = {}
        for key, meta in cards_raw.items():
            if not isinstance(meta, dict):
                continue
            display_name = meta.get('name') or key
            category = (meta.get('category') or '').strip().lower() or None
            trainer_type = (meta.get('trainerType') or '').strip().lower() or None
            energy_type = (meta.get('energyType') or '').strip().lower() or None
            norm_key = _normalize_card_key(display_name)
            normalized_cards[norm_key] = {
                "name": display_name,
                "category": category,
                "trainerType": trainer_type,
                "energyType": energy_type,
                "updatedAt": meta.get('updatedAt')
            }
        _CARD_METADATA = {"version": int(raw.get('version') or 1), "cards": normalized_cards}
    except Exception as error:
        print(f"Warning: Failed to load card metadata ({CARD_METADATA_FILE}): {error}")
        _CARD_METADATA = {"version": 1, "cards": {}}


def _serialize_card_metadata():
    cards_out = {}
    for key, meta in _CARD_METADATA.get('cards', {}).items():
        if not isinstance(meta, dict):
            continue
        entry = {
            "name": meta.get("name") or key,
            "category": (meta.get("category") or '').strip().lower() or None
        }
        if meta.get("trainerType"):
            entry["trainerType"] = meta["trainerType"]
        if meta.get("energyType"):
            entry["energyType"] = meta["energyType"]
        if meta.get("updatedAt"):
            entry["updatedAt"] = meta["updatedAt"]
        cards_out[key] = entry
    return {"version": _CARD_METADATA.get("version", 1), "cards": cards_out}


def _save_card_metadata(force=False):
    global _CARD_METADATA_DIRTY
    if not (_CARD_METADATA_DIRTY or force):
        return
    try:
        CARD_METADATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        payload = _serialize_card_metadata()
        with CARD_METADATA_FILE.open('w', encoding='utf-8') as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
        _CARD_METADATA_DIRTY = False
    except Exception as error:
        print(f"Warning: Failed to save card metadata ({CARD_METADATA_FILE}): {error}")


def _get_card_metadata_entry(name):
    key = _normalize_card_key(name)
    meta = _CARD_METADATA.get('cards', {}).get(key)
    if not meta:
        return None
    category = (meta.get('category') or '').strip().lower() or None
    trainer_type = (meta.get('trainerType') or '').strip().lower() or None
    energy_type = (meta.get('energyType') or '').strip().lower() or None
    display_category = _compose_display_category(category, trainer_type, energy_type)
    result = {
        "name": meta.get("name") or name,
        "category": category,
        "trainerType": trainer_type,
        "energyType": energy_type,
        "displayCategory": display_category
    }
    if meta.get('updatedAt'):
        result['updatedAt'] = meta['updatedAt']
    return result


def _update_card_metadata(name, category=None, trainer_type=None, energy_type=None):
    global _CARD_METADATA_DIRTY
    key = _normalize_card_key(name)
    entry = _CARD_METADATA.setdefault('cards', {}).get(key, {}).copy()
    entry['name'] = name
    if category:
        entry['category'] = category.strip().lower()
    if trainer_type:
        entry['trainerType'] = trainer_type.strip().lower()
    elif entry.get('trainerType') and entry.get('category') != 'trainer':
        entry.pop('trainerType', None)
    if energy_type:
        entry['energyType'] = energy_type.strip().lower()
    elif entry.get('energyType') and entry.get('category') != 'energy':
        entry.pop('energyType', None)
    entry['updatedAt'] = datetime.now(timezone.utc).isoformat()
    _CARD_METADATA.setdefault('cards', {})[key] = entry
    _CARD_METADATA_DIRTY = True
    _save_card_metadata()


def _prompt_choice(label, choices, default=None):
    formatted_options = ', '.join(f"[{key.upper()}]{value[1:]}" if value.lower().startswith(key) else f"[{key.upper()}]{value}" for key, value in choices.items())
    prompt = f"{label} ({formatted_options}"
    if default:
        prompt += f", default {default}"
    prompt += "): "
    while True:
        try:
            response = input(prompt)
        except (EOFError, KeyboardInterrupt):
            response = ''
        response = (response or '').strip().lower()
        if not response and default:
            return default
        if response in choices:
            return choices[response]
        for key, value in choices.items():
            if response == value.lower():
                return value
        print("  Please choose one of the available options.")


def _prompt_trainer_type(card_name):
    print(f"\nAssign trainer subtype for card: {card_name}")
    print("  Options: Supporter, Item, Tool, Stadium, Other")
    value = _prompt_choice("Enter trainer subtype", _TRAINER_TYPE_CHOICES)
    return value.lower()


def _prompt_energy_type(card_name):
    print(f"\nAssign energy subtype for card: {card_name}")
    print("  Options: Basic, Special")
    value = _prompt_choice("Enter energy subtype", _ENERGY_TYPE_CHOICES, default='basic')
    return value.lower()


def _ensure_card_metadata(name, base_category):
    normalized_category = (base_category or '').strip().lower() or 'pokemon'
    entry = _get_card_metadata_entry(name)

    if normalized_category == 'trainer':
        trainer_type = entry.get('trainerType') if entry else None
        if not trainer_type:
            trainer_type = _prompt_trainer_type(name)
            _update_card_metadata(name, category='trainer', trainer_type=trainer_type)
        else:
            if not entry.get('category'):
                _update_card_metadata(name, category='trainer', trainer_type=trainer_type)
        entry = _get_card_metadata_entry(name)
    elif normalized_category == 'energy':
        energy_type = entry.get('energyType') if entry else None
        if not energy_type:
            energy_type = _prompt_energy_type(name)
            _update_card_metadata(name, category='energy', energy_type=energy_type)
        else:
            if not entry.get('category'):
                _update_card_metadata(name, category='energy', energy_type=energy_type)
        entry = _get_card_metadata_entry(name)
    else:
        if not entry or not entry.get('category'):
            _update_card_metadata(name, category=normalized_category)
            entry = _get_card_metadata_entry(name)

    if not entry:
        entry = {"name": name, "category": normalized_category}

    category = entry.get('category') or normalized_category
    trainer_type = entry.get('trainerType')
    energy_type = entry.get('energyType')
    entry['displayCategory'] = _compose_display_category(category, trainer_type, energy_type)
    return entry


def _flush_card_metadata():
    _save_card_metadata(force=True)


_load_card_metadata()
atexit.register(_flush_card_metadata)

# --- UTILITY FUNCTIONS ---

def sanitize_for_path(text):
    """Sanitizes text for a directory name, keeping spaces."""
    return re.sub(r'[<>:"/\\|?*]', '', text)

def sanitize_for_filename(text):
    """Sanitizes text for a filename, replacing spaces with underscores."""
    text = text.replace(" ", "_")
    return re.sub(r'[<>:"/\\|?*]', '', text)

def normalize_archetype_name(name):
    """Sorts words in an archetype name to group similar decks."""
    name = name.replace('_', ' ')
    return ' '.join(sorted(name.split()))

def request_with_retries(session, method, url, retries=3, backoff_factor=0.5, **kwargs):
    """Simple retry wrapper around requests.Session methods."""
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
    """Gets a BeautifulSoup object from a URL using the provided session. Returns (soup, headers, text)."""
    print(f"Downloading webpage from {url}...")
    headers = {'User-Agent': 'Mozilla/5.0'}
    resp = request_with_retries(session, 'GET', url, headers=headers, timeout=20)
    if not resp:
        print("Error: Could not download the webpage after retries.")
        return None, None, None
    print("Download successful.")
    return BeautifulSoup(resp.text, 'html.parser'), resp.headers, resp.text

# --- LOGGING HELPERS ---

def _ensure_parent_dir(path):
    d = os.path.dirname(path)
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)

def append_jsonl(log_path, records):
    """Append dict records to a JSONL file; creates parent dirs if needed."""
    if not log_path or not records:
        return
    _ensure_parent_dir(log_path)
    with open(log_path, 'a', encoding='utf-8') as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

def write_json_atomic(path, data):
    """Atomically write JSON to path with UTF-8 encoding."""
    dirpath = os.path.dirname(path)
    if dirpath and not os.path.exists(dirpath):
        os.makedirs(dirpath, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=dirpath)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as tmpf:
            json.dump(data, tmpf, indent=2, ensure_ascii=False)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.remove(tmp_path)
        except Exception:
            pass

# --- SYNONYM DETECTION ---

def scrape_set_acronyms(session):
    """Scrapes set acronyms from pkmncards.com and returns a mapping of set names to acronyms."""
    url = "https://pkmncards.com/sets/"
    print(f"Scraping set acronyms from {url}...")

    headers = {'User-Agent': 'Mozilla/5.0'}
    resp = request_with_retries(session, 'GET', url, headers=headers, timeout=20)
    if not resp:
        print("Warning: Could not fetch set acronyms from pkmncards.com")
        return {}

    soup = BeautifulSoup(resp.text, 'html.parser')
    set_mapping = {}

    # Find the entry-content div which contains all the sets
    entry_content = soup.find('div', class_='entry-content')
    if not entry_content:
        print("Warning: Could not find entry-content div on pkmncards.com")
        return {}

    # Find all list items containing set information
    # The structure is: "Set Name (ACRONYM)"
    for li in entry_content.find_all('li'):
        text = li.get_text(strip=True)
        # Match pattern like "Crown Zenith (CRZ)" or "Stellar Crown (SCR)"
        match = re.match(r'^(.+?)\s+\(([A-Z0-9]+)\)$', text)
        if match:
            set_name = match.group(1).strip()
            acronym = match.group(2).strip()
            # Store bidirectional mapping
            set_mapping[set_name] = acronym
            set_mapping[acronym] = acronym

    print(f"Found {len(set_mapping) // 2} set acronyms")
    return set_mapping


def scrape_card_print_variations(session, set_code, number, set_acronym_mapping=None):
    """
    Scrapes print variations for a specific card from Limitless.
    Returns list of dicts: [{'set': 'SFA', 'number': '038', 'price_usd': 19.67}, ...]
    Only includes international prints, not Japanese.

    Args:
        session: requests Session
        set_code: Set code like 'SFA'
        number: Card number like '038'
        set_acronym_mapping: Optional dict mapping set names to acronyms from pkmncards.com
    """
    # Remove leading zeros for Limitless URL
    number_clean = str(number).lstrip('0')
    url = f"https://limitlesstcg.com/cards/{set_code}/{number_clean}"

    print(f"  Checking print variations for {set_code}/{number}...")

    headers = {'User-Agent': 'Mozilla/5.0'}
    resp = request_with_retries(session, 'GET', url, headers=headers, timeout=20, retries=2)
    if not resp:
        print(f"    Warning: Could not fetch print variations from {url}")
        return []

    soup = BeautifulSoup(resp.text, 'html.parser')
    variations = []

    # Find the card-prints-versions table
    table = soup.find('table', class_='card-prints-versions')
    if not table:
        return []

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

        # Extract set acronym - try href first, then fallback to text parsing
        set_name_elem = first_cell.find('a')
        set_acronym = None

        if set_name_elem:
            href = set_name_elem.get('href', '')
            if href:
                # href format: /cards/SFA/38
                match = re.search(r'/cards/([A-Z0-9]+)/\d+', href)
                if match:
                    set_acronym = match.group(1)

            # If no href (current card has class="current" and no href), use set name mapping
            if not set_acronym:
                # Get text but exclude the span with class 'prints-table-card-number'
                # Clone the element to avoid modifying the original
                set_name_elem_clone = set_name_elem
                # Remove the card number span to get clean set name
                span_to_remove = set_name_elem.find('span', class_='prints-table-card-number')
                if span_to_remove:
                    # Get all text nodes that are direct children of the <a>, excluding the span
                    set_text = set_name_elem.get_text(strip=True)
                    span_text = span_to_remove.get_text(strip=True)
                    # Remove the span text from the full text
                    set_text = set_text.replace(span_text, '').strip()
                else:
                    set_text = set_name_elem.get_text(strip=True)

                # Normalize set text for better matching
                # "Pokémon 151" -> "151", "Pokémon GO" -> "Pokémon GO"
                set_text_normalized = set_text.replace('Pokémon ', '')

                # Use the dynamic mapping from pkmncards.com
                if set_acronym_mapping:
                    # Try exact match first
                    set_acronym = set_acronym_mapping.get(set_text)
                    # If not found, try normalized version
                    if not set_acronym:
                        set_acronym = set_acronym_mapping.get(set_text_normalized)

        if not set_acronym:
            # Log when we can't find a set acronym
            set_text_debug = set_name_elem.get_text(strip=True) if set_name_elem else 'unknown'
            print(f"    Warning: Could not determine set acronym for '{set_text_debug}' #{card_num}")
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


def _choose_canonical_print(variations, card_name):
    """
    Choose the canonical print from a list of variations.
    Prefers: Standard-legal sets > Non-promo > Lowest price > Lower card number
    Promo cards (SVP, MEP, etc.) are only chosen if no non-promo exists.

    Args:
        variations: List of dicts with 'set', 'number', 'price_usd' keys
        card_name: Name of the card for logging

    Returns:
        The canonical variation dict
    """
    if not variations:
        return None

    # Define standard-legal sets (Scarlet & Violet era onwards, including Mega Evolution)
    # Sword & Shield sets are rotated and not included
    STANDARD_LEGAL_SETS = {
        # Mega Evolution era
        'MEG', 'MEE', 'MEP',
        # Scarlet & Violet era (all SV sets are standard legal)
        'WHT', 'BLK', 'DRI', 'JTG', 'PRE', 'SSP', 'SCR', 'SFA', 'TWM', 'TEF',
        'PAF', 'PAR', 'MEW', 'M23', 'OBF', 'PAL', 'SVE', 'SVI', 'SVP'
    }

    # Define promo sets (should be deprioritized unless they're the only option)
    PROMO_SETS = {'SVP', 'MEP', 'PRE', 'M23', 'PAF'}

    def get_set_priority(set_code):
        """Lower number = higher priority. Standard-legal sets are all equal priority."""
        if set_code in STANDARD_LEGAL_SETS:
            return 0  # Standard legal - all equal priority
        else:
            return 1  # Non-standard sets - lower priority

    def is_promo(set_code):
        """Check if a set is a promo set."""
        return set_code in PROMO_SETS

    # Sort variations by priority
    def sort_key(var):
        set_priority = get_set_priority(var['set'])
        promo_priority = 1 if is_promo(var['set']) else 0  # Non-promos come first
        price = var.get('price_usd') or 999999  # High value if no price
        card_num = int(var['number']) if var['number'].isdigit() else 999999

        # Sort by: 1) Standard legal (yes/no), 2) Non-promo, 3) Price, 4) Card number
        return (set_priority, promo_priority, price, card_num)

    sorted_variations = sorted(variations, key=sort_key)
    canonical = sorted_variations[0]

    # Log the selection
    price_str = f"${canonical.get('price_usd', 'N/A')}" if canonical.get('price_usd') else 'N/A'
    is_standard = "standard" if canonical['set'] in STANDARD_LEGAL_SETS else "non-standard"
    is_promo_card = "promo" if is_promo(canonical['set']) else "regular"
    print(f"    {card_name}: Selected {canonical['set']}~{canonical['number']} ({price_str}, {is_standard}, {is_promo_card}) from {len(variations)} prints")

    return canonical


def _load_synonym_cache():
    """Load the persistent synonym cache from disk."""
    cache_path = os.path.join("tools", "synonym_cache.json")
    if os.path.exists(cache_path):
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _save_synonym_cache(cache):
    """Save the persistent synonym cache to disk."""
    cache_path = os.path.join("tools", "synonym_cache.json")
    write_json_atomic(cache_path, cache)


def generate_card_synonyms(all_decks, session, set_acronym_mapping=None, use_cache=True):
    """
    Generates synonym mappings for cards based on their print variations.
    Returns a dict in the format expected by the app:
    {
      "synonyms": {
        "Card Name::SET::NUMBER": "Card Name::SET::NUMBER",  # canonical maps to itself
        "Card Name::SET2::NUMBER2": "Card Name::SET::NUMBER"  # variants map to canonical
      },
      "canonicals": {
        "Card Name": "Card Name::SET::NUMBER"  # name maps to canonical UID
      },
      "metadata": {
        "generated": "ISO timestamp",
        "totalSynonyms": count,
        "totalCanonicals": count
      }
    }

    Cache persists ONLY within a single script run (in-memory cache).
    Each time the script is executed, the cache is cleared and re-built.

    Args:
        all_decks: List of deck dictionaries
        session: requests Session
        set_acronym_mapping: Optional pre-fetched set acronym mapping
        use_cache: If True, uses in-memory cache within this run (default: True)
    """
    if set_acronym_mapping is None:
        set_acronym_mapping = scrape_set_acronyms(session)

    print("\nGenerating card synonyms from print variations...")

    # Use in-memory cache that persists only for this run
    # Cache is attached to the function itself
    if not hasattr(generate_card_synonyms, '_run_cache'):
        generate_card_synonyms._run_cache = {}

    cache = generate_card_synonyms._run_cache if use_cache else {}
    cache_hits = 0
    cache_misses = 0

    # Collect all unique cards by name AND track all unique set::number combinations
    # This allows us to detect when multiple mechanically different cards share the same name
    unique_cards_by_name = {}  # card name -> first occurrence for scraping
    card_uids_by_name = {}     # card name -> set of all unique UIDs seen in decks

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

                # Use card name as the dedup key - only store first occurrence for scraping
                if card_name not in unique_cards_by_name:
                    unique_cards_by_name[card_name] = {
                        'name': card_name,
                        'set': set_code,
                        'number': number
                    }

    # Build output structure
    synonyms_dict = {}  # variant UID -> canonical UID
    canonicals_dict = {}  # card name -> canonical UID
    newly_scraped = 0

    total_cards = len(unique_cards_by_name)
    current = 0

    for card_name, card_info in unique_cards_by_name.items():
        current += 1
        if current % 10 == 0 or current == total_cards:
            print(f"  Progress: {current}/{total_cards} unique cards checked (cache hits: {cache_hits}, new scrapes: {newly_scraped})")

        # Check if we have this card in cache
        if card_name in cache:
            cache_hits += 1
            cached_data = cache[card_name]
            # Skip if this card has no synonyms (single print only)
            if not cached_data.get('canonical') or not cached_data.get('synonyms'):
                continue
            # Skip if only has one print
            if len(cached_data['synonyms']) < 2:
                continue

            # Use cached data to rebuild synonyms in app format
            # Try to use new format if available, otherwise build from old format
            if 'canonical_uid' in cached_data:
                canonical_uid = cached_data['canonical_uid']
            else:
                # Build from old format: "SFA~038" -> "Card Name::SFA::038"
                old_canonical = cached_data['canonical']
                if '~' in old_canonical:
                    set_code, number = old_canonical.split('~')
                    canonical_uid = f"{card_name}::{set_code}::{number}"
                else:
                    # Fallback if format is unexpected
                    canonical_uid = f"{card_name}::{old_canonical}"

            # Build variant UIDs from old format synonyms list (excluding canonical)
            for old_variant in cached_data['synonyms']:
                if '~' in old_variant:
                    set_code, number = old_variant.split('~')
                    variant_uid = f"{card_name}::{set_code}::{number}"
                    # Only add non-canonical variants
                    if variant_uid != canonical_uid:
                        synonyms_dict[variant_uid] = canonical_uid
                else:
                    # Fallback for unexpected format
                    variant_uid = f"{card_name}::{old_variant}"
                    if variant_uid != canonical_uid:
                        synonyms_dict[variant_uid] = canonical_uid

            # Add canonical to canonicals dict ONLY if there's only one unique UID
            # for this card name in the tournament data (prevents mapping different cards
            # with the same name, like Ralts SVI 084 vs Ralts MEG 058)
            if len(card_uids_by_name.get(card_name, set())) <= 1:
                canonicals_dict[card_name] = canonical_uid
            continue

        # Not in cache - need to scrape
        cache_misses += 1
        newly_scraped += 1

        # Scrape print variations for this card
        variations = scrape_card_print_variations(
            session,
            card_info['set'],
            card_info['number'],
            set_acronym_mapping
        )

        if not variations:
            # No variations found, card stands alone - cache this result
            cache[card_name] = {'canonical': None, 'synonyms': []}
            continue

        # Choose the canonical print intelligently
        canonical_var = _choose_canonical_print(variations, card_info['name'])
        if not canonical_var:
            cache[card_name] = {'canonical': None, 'synonyms': []}
            continue

        # Only include cards with multiple prints (2 or more variations)
        if len(variations) < 2:
            # Cache as single-print card (no synonyms needed)
            cache[card_name] = {'canonical': None, 'synonyms': []}
            continue

        # Build canonical UID in format: Name::SET::NUMBER
        canonical_uid = f"{card_name}::{canonical_var['set']}::{canonical_var['number']}"

        # Build synonym UIDs and add to synonyms dict (excluding the canonical itself)
        for var in variations:
            variant_uid = f"{card_name}::{var['set']}::{var['number']}"
            # Only add non-canonical variants to synonyms dict
            if variant_uid != canonical_uid:
                synonyms_dict[variant_uid] = canonical_uid

        # Add to canonicals dict ONLY if there's only one unique UID for this card name
        # in the tournament data (prevents mapping different cards with the same name)
        if len(card_uids_by_name.get(card_name, set())) <= 1:
            canonicals_dict[card_name] = canonical_uid

        # Cache this result (keep old format for backward compatibility with cache)
        cache_synonyms = [f"{var['set']}~{var['number']}" for var in variations]
        cache[card_name] = {
            'canonical': f"{canonical_var['set']}~{canonical_var['number']}",
            'synonyms': cache_synonyms,
            'canonical_uid': canonical_uid  # Also store new format
        }

    # Cache is in-memory only (persists for this run only)
    # No disk persistence - cache resets on next run
    if newly_scraped > 0:
        print(f"  Added {newly_scraped} new entries to in-memory cache (resets per run)")

    # Build final output
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
    print(f"  Cache statistics: {cache_hits} hits, {newly_scraped} new scrapes")
    return output


# --- DATA EXTRACTION ---

# Month mapping for date parsing
_MONTHS = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
    'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12
}

def _parse_start_date(text: str):
    """Parse a start date like '15th August 2025' or '15-17 August 2025' to 'YYYY-MM-DD'.
    Returns (iso_date_str or None, raw_fragment or None).
    """
    if not text:
        return None, None
    t = text.strip()
    # Keep only the first segment before bullets if passed whole line
    t = t.split('•', 1)[0].strip()
    # Normalize ordinal suffixes and ranges like '15-17 August 2025'
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
    """Extracts tournament metadata from the page. Defensive about missing nodes."""
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
            # Split by bullet separators still present in text variants
            parts = [p.strip() for p in re.split(r"\s•\s|•", date_line) if p.strip()]
            if parts:
                date_val = parts[0]
                start_date_iso, start_date_text = _parse_start_date(parts[0])
            # Extract players count from raw text
            m = re.search(r"(\d+)\s+Players", date_line, flags=re.IGNORECASE)
            if m:
                try:
                    players = int(m.group(1))
                except Exception:
                    players = None
            # Extract format code from <a href> query param if present, and friendly name from link text
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
    """Extracts all decklists into a list of dictionaries with hashes and placement."""
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
        if not cards_container: continue

        for card_div in cards_container.find_all('div', class_='decklist-card'):
            category_text = card_div.find_parent('div', class_='decklist-column').find('div', class_='decklist-column-heading').text.strip().lower()
            category = "pokemon" if "pokémon" in category_text else "trainer" if "trainer" in category_text else "energy"
            set_acronym = card_div.get('data-set', '').upper().strip()
            number_raw = card_div.get('data-number', '').lstrip('0')
            number = number_raw.zfill(3) if number_raw else number_raw

            # Ensure all cards (Pokemon, Trainer, Energy) have set and number identifiers
            if not set_acronym or not number:
                print(f"Warning: Card '{card_div.find('span', class_='card-name').text.strip()}' missing set ({set_acronym}) or number ({number}) identifiers")

            card_name = card_div.find('span', class_='card-name').text.strip()
            category_meta = _ensure_card_metadata(card_name, category)
            card_entry = {
                "count": int(card_div.find('span', class_='card-count').text.strip()),
                "name": card_name,
                "set": set_acronym,
                "number": number,
                "category": category_meta.get('category') or category
            }
            if category_meta.get('trainerType'):
                card_entry['trainerType'] = category_meta['trainerType']
            if category_meta.get('energyType'):
                card_entry['energyType'] = category_meta['energyType']
            if category_meta.get('displayCategory'):
                card_entry['displayCategory'] = category_meta['displayCategory']
            cards.append(card_entry)

        # Create a canonical string for hashing by sorting cards
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

# --- RK9 SUPPORT ---

def _is_rk9_url(value: str) -> bool:
    if not value:
        return False
    norm = (value or "").strip().lower()
    return "rk9.gg" in norm


def _normalize_rk9_url(u: str) -> str:
    if not u:
        return u
    s = u.strip()
    if not s.startswith(('http://', 'https://')):
        s = 'https://' + s
    return s


def _extract_rk9_roster_entries(soup, roster_url):
    table = soup.find('table', id='dtLiveRoster')
    if not table:
        print("Warning: RK9 roster table not found.")
        return []

    tbody = table.find('tbody') or table
    rows = []
    for tr in tbody.find_all('tr'):
        cells = tr.find_all('td')
        if len(cells) < 7:
            continue

        player_id = cells[0].get_text(strip=True)
        first = cells[1].get_text(strip=True)
        last = cells[2].get_text(strip=True)
        country = cells[3].get_text(strip=True)
        division = cells[4].get_text(strip=True)
        deck_link = cells[5].find('a', href=True)
        standing_text = cells[6].get_text(strip=True)

        try:
            standing = int(standing_text)
        except Exception:
            standing = None

        deck_url = urljoin(roster_url, deck_link['href']) if deck_link else None
        rows.append({
            "player_id": player_id,
            "first_name": first,
            "last_name": last,
            "name": (first + " " + last).strip() or player_id,
            "country": country,
            "division": division,
            "deck_url": deck_url,
            "standing": standing,
        })

    def _division_sort_key(value):
        mapping = {
            'junior': 0,
            'juniors': 0,
            'master': 1,
            'masters': 1,
            'senior': 2,
            'seniors': 2,
        }
        return mapping.get((value or '').strip().lower(), 99)

    rows.sort(key=lambda r: (_division_sort_key(r.get('division')), r.get('standing') or 999999))
    return rows


def _split_rk9_setnum(setnum: str):
    if not setnum:
        return '', ''
    parts = setnum.strip().upper().split('-', 1)
    set_code = parts[0].strip() if parts else ''
    number = parts[1].strip() if len(parts) > 1 else ''
    return set_code, number


def _clean_rk9_energy_name(name: str) -> str:
    if not name:
        return name
    return re.sub(r"\s*-\s*(Basic|Special)$", "", name, flags=re.IGNORECASE).strip()


def extract_rk9_decklist(soup):
    cards = []
    if not soup:
        return cards

    for category in ("pokemon", "trainer", "energy"):
        ul = soup.find('ul', class_=category)
        if not ul:
            continue
        for li in ul.find_all('li', class_=category):
            quantity_text = li.get('data-quantity') or ''
            try:
                quantity = int(quantity_text)
            except Exception:
                quantity = None

            raw_name = (li.get('data-cardname') or '').strip()
            name = _clean_rk9_energy_name(raw_name) if category == 'energy' else raw_name

            set_code, number_raw = _split_rk9_setnum(li.get('data-setnum') or '')
            normalized_number = _normalize_card_number(number_raw)

            if quantity is None:
                print(f"    Warning: Skipping card with invalid quantity: {raw_name}")
                continue

            if not set_code or not normalized_number:
                print(f"    Warning: Card '{name}' missing set/number identifiers (set='{set_code}', number='{normalized_number}')")

            meta = _ensure_card_metadata(name, category)
            card_entry = {
                "count": quantity,
                "name": name,
                "set": set_code,
                "number": normalized_number,
                "category": meta.get('category') or category
            }
            if meta.get('trainerType'):
                card_entry['trainerType'] = meta['trainerType']
            if meta.get('energyType'):
                card_entry['energyType'] = meta['energyType']
            if meta.get('displayCategory'):
                card_entry['displayCategory'] = meta['displayCategory']
            cards.append(card_entry)

    return cards

# --- LIMITLESS ARCHETYPE MATCHING ---

def _limitless_headers():
    return {'User-Agent': 'Mozilla/5.0'}


def _fetch_limitless_archetype_rows(session):
    overview_url = f"{LIMITLESS_BASE_URL}/decks"
    resp = request_with_retries(session, 'GET', overview_url, headers=_limitless_headers(), timeout=25)
    if not resp:
        print("Warning: Could not fetch Limitless archetype overview.")
        return []

    soup = BeautifulSoup(resp.text, 'html.parser')
    table = soup.find('table', class_='meta')
    if not table:
        print("Warning: Limitless archetype table not found on overview page.")
        return []

    entries = []
    for row in table.find_all('tr'):
        if row.find('th'):
            continue
        cells = row.find_all('td')
        if len(cells) < 3:
            continue
        link = cells[2].find('a', href=True)
        if not link:
            continue
        href = link['href']
        name = link.get_text(strip=True)
        if not href or not name:
            continue
        full_url = urljoin(LIMITLESS_BASE_URL, href)
        entries.append({
            "name": name,
            "url": full_url
        })

    unique_entries = []
    seen = set()
    for entry in entries:
        key = normalize_archetype_name(entry['name'])
        if key in seen:
            continue
        seen.add(key)
        unique_entries.append(entry)
    return unique_entries


def _fetch_limitless_decklist_pokemon(session, deck_url):
    resp = request_with_retries(session, 'GET', deck_url, headers=_limitless_headers(), timeout=25)
    if not resp:
        print(f"Warning: Could not fetch Limitless decklist: {deck_url}")
        return None

    soup = BeautifulSoup(resp.text, 'html.parser')
    deck_container = soup.find('div', class_='decklist')
    if not deck_container:
        print(f"Warning: Pokémon section missing on Limitless decklist page: {deck_url}")
        return None

    pokemon_counter = Counter()
    cards = []

    for column in deck_container.find_all('div', class_='column'):
        heading = column.find('div', class_='heading')
        if not heading:
            continue
        label = heading.get_text(strip=True).lower()
        if 'pokémon' not in label and 'pokemon' not in label:
            continue
        for node in column.find_all('p'):
            text = node.get_text(" ", strip=True)
            match = re.match(r'(\d+)\s+(.+?)(?:\s+\(([^)]+)\))?$', text)
            if not match:
                continue
            try:
                count = int(match.group(1))
            except Exception:
                continue
            name = match.group(2).strip()
            if not name:
                continue
            cards.append({"count": count, "name": name})
            pokemon_counter[name] += count

    if not pokemon_counter:
        print(f"Warning: No Pokémon cards parsed from {deck_url}")
        return None

    return {
        "cards": cards,
        "counter": pokemon_counter
    }


def _fetch_limitless_archetype_top_deck(session, archetype_url):
    resp = request_with_retries(session, 'GET', archetype_url, headers=_limitless_headers(), timeout=25)
    if not resp:
        print(f"Warning: Could not load Limitless archetype page: {archetype_url}")
        return None

    soup = BeautifulSoup(resp.text, 'html.parser')
    top_row = None
    for tr in soup.find_all('tr'):
        if tr.has_attr('data-player'):
            top_row = tr
            break

    if not top_row:
        print(f"Warning: No deck entries found for archetype page: {archetype_url}")
        return None

    deck_link = top_row.find('a', href=re.compile(r'/decklist'))
    if not deck_link:
        print(f"Warning: Decklist link missing for archetype page: {archetype_url}")
        return None

    deck_url = urljoin(LIMITLESS_BASE_URL, deck_link['href'])
    deck_data = _fetch_limitless_decklist_pokemon(session, deck_url)
    if not deck_data:
        return None

    deck_data["decklistUrl"] = deck_url
    deck_data["player"] = top_row.get('data-player')
    deck_data["tournament"] = top_row.get('data-tournament')
    return deck_data


def build_limitless_archetype_prototypes(session, limit=None):
    global _LIMITLESS_ARCHETYPE_CACHE

    if limit is None and _LIMITLESS_ARCHETYPE_CACHE is not None:
        return _LIMITLESS_ARCHETYPE_CACHE

    if _LIMITLESS_ARCHETYPE_CACHE is not None and limit is not None:
        cached_items = list(_LIMITLESS_ARCHETYPE_CACHE.items())[:limit]
        return {k: v for k, v in cached_items}

    entries = _fetch_limitless_archetype_rows(session)
    if not entries:
        if limit is None:
            _LIMITLESS_ARCHETYPE_CACHE = {}
        return {}

    if limit is not None:
        entries = entries[:limit]

    total = len(entries)
    print(f"\nFetching Limitless archetype prototypes ({total} archetype(s))...")
    prototypes = {}
    for idx, entry in enumerate(entries, 1):
        print(f"  [{idx}/{total}] {entry['name']}...", end='')
        archetype_data = _fetch_limitless_archetype_top_deck(session, entry['url'])
        if not archetype_data:
            print(" skipped")
            continue
        prototypes[normalize_archetype_name(entry['name'])] = {
            "name": entry['name'],
            "url": entry['url'],
            "counter": archetype_data['counter'],
            "cards": archetype_data['cards'],
            "decklistUrl": archetype_data.get('decklistUrl')
        }
        print(" ok")

    if not prototypes:
        print("Warning: Archetype prototypes could not be collected from Limitless.")

    if limit is None:
        _LIMITLESS_ARCHETYPE_CACHE = prototypes
        return prototypes

    return prototypes


def _pokemon_counter_for_deck(deck):
    counts = Counter()
    for card in deck.get("cards", []):
        category = (card.get("category") or "").lower()
        if category != "pokemon":
            continue
        try:
            qty = int(card.get("count", 0) or 0)
        except Exception:
            qty = 0
        if qty <= 0:
            continue
        name = (card.get("name") or "").strip()
        if not name:
            continue
        counts[name] += qty
    return counts


def _score_archetype_match(deck_counter, proto_counter):
    if not deck_counter or not proto_counter:
        return 0.0, 0.0, 0

    deck_names = set(deck_counter.keys())
    proto_names = set(proto_counter.keys())
    shared = deck_names & proto_names
    if not shared:
        return 0.0, 0.0, 0

    intersection = sum(min(deck_counter[name], proto_counter[name]) for name in shared)
    union = sum(max(deck_counter.get(name, 0), proto_counter.get(name, 0)) for name in deck_names | proto_names)
    deck_total = sum(deck_counter.values()) or 1

    score = intersection / union if union else 0.0
    coverage = intersection / deck_total if deck_total else 0.0
    return score, coverage, len(shared)


def assign_archetypes_from_prototypes(decks, prototypes, min_score=0.6, min_coverage=0.6, min_unique=5):
    if not decks or not prototypes:
        return

    print("\nMatching RK9 decks to Limitless archetypes...")
    for deck in decks:
        counter = _pokemon_counter_for_deck(deck)
        if not counter:
            continue

        best = None
        for proto in prototypes.values():
            score, coverage, overlap_unique = _score_archetype_match(counter, proto['counter'])
            candidate = {
                "proto": proto,
                "score": score,
                "coverage": coverage,
                "overlap": overlap_unique
            }
            if best is None or candidate['score'] > best['score']:
                best = candidate

        if not best or best['proto'] is None:
            continue

        proto_name = best['proto']['name']
        match_info = {
            "name": proto_name,
            "score": round(best['score'], 4),
            "coverage": round(best['coverage'], 4),
            "overlapUnique": best['overlap'],
            "decklistUrl": best['proto'].get('decklistUrl'),
            "referenceUrl": best['proto']['url']
        }

        player_label = deck.get('player') or deck.get('playerId') or 'Unknown player'
        if best['score'] >= min_score and best['coverage'] >= min_coverage and best['overlap'] >= min_unique:
            deck['archetype'] = proto_name
            deck['archetypeMatch'] = match_info
            print(f"  ✓ {player_label}: {proto_name} (score {best['score']:.2f}, coverage {best['coverage']:.2f}, overlap {best['overlap']})")
        else:
            deck.setdefault('archetype', deck.get('archetype') or 'Unknown')
            deck['archetypeMatch'] = match_info
            print(f"  - {player_label}: no confident match (best {proto_name}, score {best['score']:.2f}, coverage {best['coverage']:.2f}, overlap {best['overlap']})")

# --- REPORT GENERATION ---

def identify_pokemon_variants(all_decks):
    """Identifies Pokémon that have more than one version in the dataset."""
    pokemon_versions = defaultdict(set)
    for deck in all_decks:
        for card in deck["cards"]:
            if card["category"] == "pokemon":
                pokemon_versions[card["name"]].add(f"{card['set']} {card['number']}")
    return {name for name, versions in pokemon_versions.items() if len(versions) > 1}

# REPRINT_EQUIV mapping removed - each card with different set/number is treated as unique

def canonicalize_variant(set_code: str, number: str):
    """No longer canonicalizes - each set/number combination is treated as unique.
    Different cards with the same name but different sets/numbers are different cards."""
    sc = (set_code or '').upper().strip()
    num = (number or '').lstrip('0')
    num = num.zfill(3) if num else num
    return sc, num

def generate_report_json(deck_list, deck_total, all_decks_for_variants):
    """Generates the JSON structure for a list of decks.
    Internal aggregation key always includes set+number for Pokémon to avoid cross-event drift,
    but the exported display name remains the base card name without set/number.
    """
    pokemon_variants = identify_pokemon_variants(all_decks_for_variants)
    card_data = defaultdict(list)  # uid -> list of per-deck total copies
    name_casing = {}              # uid -> display name (base)
    uid_meta = {}                 # uid -> {set, number}
    uid_category = {}             # uid -> category

    for deck in deck_list:
        cards_in_this_deck = set()
        # Aggregate total copies per UID (variant) within the deck
        per_deck_counts = defaultdict(int)
        per_deck_seen_meta = {}
        for card in deck["cards"]:
            name = card.get("name", "")
            cat = (card.get("category") or "").lower() or None
            trainer_type = (card.get("trainerType") or "").lower() or None
            energy_type = (card.get("energyType") or "").lower() or None
            display_category = card.get("displayCategory") or _compose_display_category(cat, trainer_type, energy_type)
            category_payload = {
                "category": cat,
                "trainerType": trainer_type,
                "energyType": energy_type,
                "displayCategory": display_category
            }
            set_code = card.get("set", "")
            number = card.get("number", "")
            sc, num = canonicalize_variant(set_code, number)
            # All card types get set/number treatment for consistency
            if sc and num:
                uid = f"{name}::{sc}::{num}"
                display = name
                per_deck_counts[uid] += int(card.get('count', 0))
                per_deck_seen_meta[uid] = {
                    "set": sc,
                    "number": num,
                    "category": cat,
                    "trainerType": trainer_type,
                    "energyType": energy_type,
                    "displayCategory": display_category
                }
                if cat or trainer_type or energy_type:
                    existing = uid_category.get(uid)
                    if not existing or not existing.get("displayCategory"):
                        uid_category[uid] = category_payload
            else:
                # Fallback for cards without set/number identifiers
                uid = name
                display = name
                per_deck_counts[uid] += int(card.get('count', 0))
                if cat or trainer_type or energy_type:
                    existing = uid_category.get(uid)
                    if not existing or not existing.get("displayCategory"):
                        uid_category[uid] = category_payload
                per_deck_seen_meta[uid] = {
                    "set": sc,
                    "number": num,
                    "category": cat,
                    "trainerType": trainer_type,
                    "energyType": energy_type,
                    "displayCategory": display_category
                }
        # After scanning deck, record one entry per uid
        for uid, tot in per_deck_counts.items():
            card_data[uid].append(tot)
            if uid not in name_casing:
                # Display is base name (before ::)
                name_casing[uid] = uid.split('::',1)[0] if '::' in uid else uid
            meta_payload = per_deck_seen_meta.get(uid, uid_meta.get(uid, {}))
            if '::' in uid:
                uid_meta[uid] = meta_payload or {}
            elif meta_payload:
                uid_meta.setdefault(uid, meta_payload)
        
        for lname, count in cards_in_this_deck:
            card_data[lname].append(count)

    sorted_card_keys = sorted(card_data.keys(), key=lambda k: len(card_data[k]), reverse=True)
    
    report_items = []
    for rank, uid in enumerate(sorted_card_keys, 1):
        counts_list, found_count = card_data[uid], len(card_data[uid])
        dist_counter = Counter(counts_list)
        
        card_obj = {
            "rank": rank, "name": name_casing[uid], "found": found_count,
            "total": deck_total, "pct": round((found_count / deck_total) * 100, 2),
            "dist": [{"copies": c, "players": p, "percent": round((p / found_count) * 100, 2)} for c, p in sorted(dist_counter.items())]
        }
        meta = uid_meta.get(uid) or {}
        # Include variant metadata for Pokémon
        if '::' in uid:
            card_obj["set"] = meta.get("set")
            card_obj["number"] = meta.get("number")
            card_obj["uid"] = uid
        # Include category details if available
        category_info = uid_category.get(uid)
        if isinstance(category_info, dict):
            base_category = category_info.get("category") or meta.get("category")
            if base_category:
                card_obj["category"] = base_category
            if category_info.get("trainerType"):
                card_obj["trainerType"] = category_info["trainerType"]
            if category_info.get("energyType"):
                card_obj["energyType"] = category_info["energyType"]
            display_category = category_info.get("displayCategory") or _compose_display_category(
                base_category,
                category_info.get("trainerType"),
                category_info.get("energyType")
            )
            if display_category:
                card_obj["displayCategory"] = display_category
        elif category_info:
            card_obj["category"] = category_info
        else:
            base_category = meta.get("category")
            if base_category:
                card_obj["category"] = base_category
            if meta.get("trainerType"):
                card_obj["trainerType"] = meta["trainerType"]
            if meta.get("energyType"):
                card_obj["energyType"] = meta["energyType"]
            display_category = meta.get("displayCategory") or _compose_display_category(
                base_category,
                meta.get("trainerType"),
                meta.get("energyType")
            )
            if display_category:
                card_obj["displayCategory"] = display_category
        report_items.append(card_obj)
        
    return {"deckTotal": deck_total, "items": report_items}


def _normalize_card_number(value):
    """Normalize card numbers to a consistent three-digit format with optional suffix."""
    if value is None:
        return ""
    raw = str(value).strip()
    if not raw:
        return ""
    match = re.match(r"^(\d+)([A-Za-z]*)$", raw)
    if not match:
        return raw.upper()
    digits, suffix = match.groups()
    normalized = digits.zfill(3)
    if suffix:
        normalized += suffix.upper()
    return normalized


def _build_card_identifier(set_code, number):
    """Build the include/exclude identifier string (e.g., SVI~118)."""
    sc = (set_code or "").upper().strip()
    if not sc:
        return None
    normalized_number = _normalize_card_number(number)
    if not normalized_number:
        return None
    return f"{sc}~{normalized_number}"


def _serialize_filter_card(card_info):
    if not card_info:
        return None
    return {
        "id": card_info["id"],
        "name": card_info.get("name"),
        "set": card_info.get("set"),
        "number": card_info.get("number"),
        "found": card_info.get("found"),
        "total": card_info.get("total"),
        "pct": card_info.get("pct"),
        "alwaysIncluded": card_info.get("alwaysIncluded", False)
    }


def generate_include_exclude_reports(archetype_label, archetype_base, deck_list, archetype_data, output_root):
    """Generate include/exclude analysis JSON files for an archetype with deduplication."""

    deck_total = len(deck_list)
    if deck_total < 4:
        print(f"    - Skipping include/exclude analysis for {archetype_label}: only {deck_total} decks available.")
        # Clean up any prior artifacts if they exist
        if os.path.exists(output_root):
            try:
                shutil.rmtree(output_root)
            except Exception:
                pass
        return

    os.makedirs(output_root, exist_ok=True)

    card_lookup = {}
    candidate_cards = []
    cards_summary = {}

    items = (archetype_data or {}).get("items", [])
    for item in items:
        set_code = item.get("set")
        number = item.get("number")
        card_id = _build_card_identifier(set_code, number)
        if not card_id:
            continue
        found = int(item.get("found", 0) or 0)
        total = int(item.get("total", deck_total) or deck_total)
        pct = round((found / total) * 100, 2) if total else 0.0
        normalized_number = _normalize_card_number(number)
        info = {
            "id": card_id,
            "name": item.get("name"),
            "set": (set_code or "").upper().strip() or None,
            "number": normalized_number,
            "found": found,
            "total": total,
            "pct": pct,
            "alwaysIncluded": total > 0 and found == total
        }
        card_lookup[card_id] = info
        cards_summary[card_id] = {
            "name": info["name"],
            "set": info["set"],
            "number": info["number"],
            "pct": info["pct"],
            "found": info["found"],
            "total": info["total"],
            "alwaysIncluded": info["alwaysIncluded"]
        }
        if not info["alwaysIncluded"]:
            candidate_cards.append(info)

    if not candidate_cards:
        print(f"    - No optional cards to analyze for {archetype_label}. Cleaning up include/exclude directory.")
        if os.path.exists(output_root):
            try:
                shutil.rmtree(output_root)
            except Exception:
                pass
        return

    deck_by_id = {}
    card_presence = defaultdict(set)

    for deck in deck_list:
        deck_id = deck.get("deckHash") or deck.get("id") or deck.get("player")
        if not deck_id:
            deck_id = hashlib.sha1(json.dumps(deck, sort_keys=True).encode()).hexdigest()
        deck_by_id[deck_id] = deck

        seen_cards = set()
        for card in deck.get("cards", []):
            card_id = _build_card_identifier(card.get("set"), card.get("number"))
            if not card_id:
                continue
            if card_id in seen_cards:
                continue
            seen_cards.add(card_id)
            card_presence[card_id].add(deck_id)

    all_deck_ids = set(deck_by_id.keys())

    def build_subset(include_ids, exclude_ids):
        include_ids = tuple(sorted(include_ids))
        exclude_ids = tuple(sorted(exclude_ids))

        if include_ids:
            # start with intersection of decks that contain all include cards
            candidate_sets = [set(card_presence.get(cid, set())) for cid in include_ids]
            if not all(candidate_sets):
                return None, set()
            eligible = set(deck_by_id.keys()) if not candidate_sets else set.intersection(*candidate_sets)
        else:
            eligible = set(deck_by_id.keys())

        for cid in exclude_ids:
            eligible -= card_presence.get(cid, set())

        eligible = {deck_id for deck_id in eligible if deck_id in deck_by_id}
        if not eligible:
            return None, set()

        subset_decks = [deck_by_id[d] for d in eligible]
        report = generate_report_json(subset_decks, len(subset_decks), deck_list)
        report["filters"] = {
            "include": [
                _serialize_filter_card(card_lookup.get(cid))
                for cid in include_ids
                if card_lookup.get(cid)
            ],
            "exclude": [
                _serialize_filter_card(card_lookup.get(cid))
                for cid in exclude_ids
                if card_lookup.get(cid)
            ],
            "baseDeckTotal": deck_total
        }
        report["source"] = {
            "archetype": archetype_label,
            "generatedAt": datetime.now(timezone.utc).isoformat()
        }
        return report, eligible

    print(f"    - Building include/exclude reports for {archetype_label} ({len(candidate_cards)} variable cards)")

    # PHASE 1: Generate all filter combinations
    all_combinations = []

    # Single includes
    for card in candidate_cards:
        all_combinations.append(([card["id"]], []))

    # Single excludes
    for card in candidate_cards:
        all_combinations.append(([], [card["id"]]))

    # Cross include-exclude combinations (distinct cards)
    for include_card, exclude_card in product(candidate_cards, repeat=2):
        if include_card["id"] != exclude_card["id"]:
            all_combinations.append(([include_card["id"]], [exclude_card["id"]]))

    # PHASE 2: Compute subsets and deduplicate
    unique_subsets = {}  # content_hash -> subset_info
    filter_map = {}      # "inc:X|exc:Y" -> subset_id

    for include_ids, exclude_ids in all_combinations:
        # Compute subset
        report, deck_ids = build_subset(include_ids, exclude_ids)

        if not report or not deck_ids:
            continue

        # Skip exclude-only combinations that match the baseline
        if not include_ids and deck_ids == all_deck_ids:
            continue

        # Hash the subset content (items only, ignore filters/source)
        items_str = json.dumps(report["items"], sort_keys=True)
        content_hash = hashlib.sha256(items_str.encode()).hexdigest()

        # Build filter key
        inc_key = '+'.join(sorted(include_ids)) if include_ids else ''
        exc_key = '+'.join(sorted(exclude_ids)) if exclude_ids else ''
        filter_key = f"inc:{inc_key}|exc:{exc_key}"

        # Store or update
        if content_hash not in unique_subsets:
            subset_id = f"subset_{len(unique_subsets) + 1:03d}"
            unique_subsets[content_hash] = {
                'id': subset_id,
                'data': report,
                'primary_filter': (include_ids, exclude_ids),
                'alternate_filters': []
            }
        else:
            # Add to alternates
            unique_subsets[content_hash]['alternate_filters'].append(
                (include_ids, exclude_ids)
            )

        subset_id = unique_subsets[content_hash]['id']
        filter_map[filter_key] = subset_id

    # PHASE 3: Write files
    subsets_dir = os.path.join(output_root, 'unique_subsets')
    os.makedirs(subsets_dir, exist_ok=True)

    subsets_metadata = {}

    for content_hash, subset_info in unique_subsets.items():
        subset_id = subset_info['id']
        data = subset_info['data']

        # Write subset file
        subset_path = os.path.join(subsets_dir, f"{subset_id}.json")
        write_json_atomic(subset_path, data)

        # Store metadata
        primary_inc, primary_exc = subset_info['primary_filter']
        subsets_metadata[subset_id] = {
            'deckTotal': data['deckTotal'],
            'primaryFilters': {
                'include': list(primary_inc),
                'exclude': list(primary_exc)
            },
            'alternateFilters': [
                {'include': list(inc), 'exclude': list(exc)}
                for inc, exc in subset_info['alternate_filters']
            ]
        }

    # PHASE 4: Write index
    index_data = {
        'archetype': archetype_label,
        'deckTotal': deck_total,
        'totalCombinations': len(all_combinations),
        'uniqueSubsets': len(unique_subsets),
        'deduplicationRate': round(
            (len(all_combinations) - len(unique_subsets)) / len(all_combinations) * 100,
            2
        ) if all_combinations else 0,
        'cards': cards_summary,
        'filterMap': filter_map,
        'subsets': subsets_metadata,
        'generatedAt': datetime.now(timezone.utc).isoformat()
    }

    index_path = os.path.join(output_root, 'index.json')
    write_json_atomic(index_path, index_data)

    print(f"      • Generated {len(unique_subsets)} unique subsets from {len(all_combinations)} combinations")
    print(f"      • Deduplication: {index_data['deduplicationRate']:.1f}% reduction")

    # Clean up old structure files if they exist
    try:
        for filename in os.listdir(output_root):
            filepath = os.path.join(output_root, filename)
            if filename.endswith('.json') and filename != 'index.json' and os.path.isfile(filepath):
                os.remove(filepath)
    except Exception:
        pass

# --- THUMBNAIL DOWNLOADER ---

def download_thumbnails(all_decks, base_path, session, workers=1, download_log_path=None, tournament_name=None, force=False):
    """Downloads XS and SM thumbnails for every unique card using session. Returns missing thumbnails list.

    workers > 1 enables simple parallel downloads.
    """
    print("Starting thumbnail downloads...")
    pokemon_variants = identify_pokemon_variants(all_decks)

    processed_filenames, missing_thumbs = set(), []
    log_buffer = []
    base_url = "https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/"
    sizes_to_download = ["XS", "SM"]

    for size in sizes_to_download:
        os.makedirs(os.path.join(base_path, "thumbnails", size.lower()), exist_ok=True)

    # Build a map of unique cards; fallback to sanitized name when set/number missing
    unique_cards = {}
    for d in all_decks:
        for c in d.get('cards', []):
            set_acronym = (c.get('set', '') or '').upper().strip()
            number_raw = (c.get('number', '') or '').lstrip('0')
            number = number_raw.zfill(3) if number_raw else number_raw
            category = c.get('category', '')
            # Use set+number as key for all cards if present, else fallback to name
            if set_acronym and number:
                key = f"{set_acronym}_{number}"
            else:
                key = sanitize_for_filename(c.get('name', ''))
            if key not in unique_cards:
                card_copy = dict(c)
                card_copy['set'] = set_acronym
                card_copy['number'] = number
                card_copy['category'] = category
                unique_cards[key] = card_copy

    # Build download jobs
    jobs = []
    for card in unique_cards.values():
        name = card.get("name", "")
        set_code = (card.get("set", "") or '').upper().strip()
        number = (card.get("number", "") or '').zfill(3)
        category = card.get("category", "")
        # All card types (Pokemon, Trainer, Energy) should use set+number identifiers when available
        if set_code and number:
            base_filename = f"{sanitize_for_filename(name)}_{set_code}_{number}"
            if base_filename in processed_filenames:
                continue
            processed_filenames.add(base_filename)
            print(f"  - Queueing images for: {name} ({set_code} {number}) [{category.title()}]")
            for size in sizes_to_download:
                img_filename = f"{set_code}_{number}_R_EN_{size}.png"
                full_url = f"{base_url}{set_code}/{img_filename}"
                file_path = os.path.join(base_path, "thumbnails", size.lower(), f"{base_filename}.png")
                alias_path = None  # No alias needed - all cards use consistent set+number naming
                jobs.append((name, set_code, number, size, full_url, file_path, alias_path, category))
        else:
            # Fallback for cards without set/number (should be rare with proper data extraction)
            base_filename = sanitize_for_filename(name)
            if base_filename in processed_filenames:
                continue
            processed_filenames.add(base_filename)
            print(f"  - Queueing images for: {name} (no set/number) [{category.title()}]")
            for size in sizes_to_download:
                img_filename = ''
                full_url = ''
                file_path = os.path.join(base_path, "thumbnails", size.lower(), f"{base_filename}.png")
                alias_path = file_path
                jobs.append((name, set_code, number, size, full_url, file_path, alias_path, category))

    def fetch_one(job):
        name, set_code, number, size, full_url, file_path, alias_path, category = job
        ts = datetime.now(timezone.utc).isoformat()
        # Skip if exists and not forcing
        if not force and os.path.exists(file_path):
            return {
                "timestamp": ts,
                "status": "skip_exists",
                "tournament": tournament_name,
                "name": name,
                "set": set_code,
                "number": number,
                "size": size,
                "url": full_url,
                "file": file_path
            }
        if not full_url:
            reason = []
            if not set_code:
                reason.append("missing set acronym")
            if not number:
                reason.append("missing card number")
            if set_code and number:
                reason.append("URL pattern may not exist for this card type (likely not a Pokémon)")
            reason_str = ", ".join(reason) if reason else "unknown reason"
            print(f"    - Could not download size {size} for {name}: No URL generated (set: {set_code}, number: {number}) [{reason_str}]")
            return {
                "timestamp": ts,
                "status": "no_url",
                "tournament": tournament_name,
                "name": name,
                "set": set_code,
                "number": number,
                "size": size,
                "url": full_url,
                "file": file_path,
                "error": f"No URL generated for this card. Reason: {reason_str}",
                "url_tried": full_url
            }
        try:
            resp = request_with_retries(session, 'GET', full_url, stream=True, timeout=15)
            if resp and resp.status_code == 200:
                with open(file_path, 'wb') as f:
                    f.write(resp.content)
                return {
                    "timestamp": ts,
                    "status": "ok",
                    "tournament": tournament_name,
                    "name": name,
                    "set": set_code,
                    "number": number,
                    "size": size,
                    "url": full_url,
                    "file": file_path,
                    "bytes": len(resp.content)
                }
            else:
                print(f"    - Could not download size {size} for {name}: HTTP error {getattr(resp, 'status_code', None)} for URL {full_url}")
                return {
                    "timestamp": ts,
                    "status": "http_error",
                    "http_status": getattr(resp, 'status_code', None),
                    "tournament": tournament_name,
                    "name": name,
                    "set": set_code,
                    "number": number,
                    "size": size,
                    "url": full_url,
                    "file": file_path,
                    "error": f"HTTP error {getattr(resp, 'status_code', None)} for URL {full_url}"
                }
        except requests.exceptions.RequestException as e:
            print(f"    - Could not download size {size} for {name}: Exception {str(e)} for URL {full_url}")
            return {
                "timestamp": ts,
                "status": "exception",
                "error": str(e),
                "tournament": tournament_name,
                "name": name,
                "set": set_code,
                "number": number,
                "size": size,
                "url": full_url,
                "file": file_path,
                "error": f"Exception {str(e)} for URL {full_url}"
            }

    if workers and workers > 1 and len(jobs) > 1:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(fetch_one, j) for j in jobs]
            for fut in as_completed(futures):
                res = fut.result()
                if not res:
                    continue
                log_buffer.append(res)
                if res.get('status') in {"http_error", "exception", "no_url"}:
                    print(f"    - Could not download size {res['size']} for {res['name']}")
                    missing_thumbs.append({
                        "name": res.get('name'),
                        "set": res.get('set'),
                        "number": res.get('number'),
                        "size": res.get('size'),
                        "url_tried": res.get('url')
                    })
    else:
        for j in jobs:
            res = fetch_one(j)
            if not res:
                continue
            log_buffer.append(res)
            if res.get('status') in {"http_error", "exception", "no_url"}:
                print(f"    - Could not download size {res['size']} for {res['name']}")
                missing_thumbs.append({
                    "name": res.get('name'),
                    "set": res.get('set'),
                    "number": res.get('number'),
                    "size": res.get('size'),
                    "url_tried": res.get('url')
                })

    print(f"Thumbnail download complete for {len(processed_filenames)} unique cards.")
    if download_log_path:
        append_jsonl(download_log_path, log_buffer)
    return missing_thumbs


def replay_downloads(log_path, session, workers=4, force=False):
    """Re-downloads thumbnails from a JSONL log. Keeps existing filenames.
    Returns a summary dict.
    """
    print(f"Replaying downloads from log: {log_path}")
    if not os.path.exists(log_path):
        print("Log path not found.")
        return {"total": 0, "attempted": 0, "ok": 0, "skipped": 0, "errors": 0}

    entries = []
    seen = set()
    with open(log_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            file_path = rec.get('file')
            size = rec.get('size')
            if not file_path or not size:
                continue
            key = (file_path, size)
            if key in seen:
                continue
            seen.add(key)
            entries.append({
                "name": rec.get('name'),
                "size": size,
                "url": rec.get('url'),
                "file": file_path
            })

    attempted = ok = skipped = errors = 0

    def do_one(e):
        nonlocal attempted, ok, skipped, errors
        attempted += 1
        file_path = e['file']
        url = e['url']
        if not force and os.path.exists(file_path):
            skipped += 1
            return {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "status": "skip_exists",
                "name": e.get('name'),
                "size": e['size'],
                "url": url,
                "file": file_path
            }
        if not url:
            errors += 1
            return {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "status": "no_url",
                "name": e.get('name'),
                "size": e['size'],
                "url": url,
                "file": file_path
            }
        try:
            resp = request_with_retries(session, 'GET', url, stream=True, timeout=15)
            if resp and resp.status_code == 200:
                _ensure_parent_dir(file_path)
                with open(file_path, 'wb') as f:
                    f.write(resp.content)
                ok += 1
                return {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "status": "ok",
                    "name": e.get('name'),
                    "size": e['size'],
                    "url": url,
                    "file": file_path,
                    "bytes": len(resp.content)
                }
            else:
                errors += 1
                return {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "status": "http_error",
                    "http_status": getattr(resp, 'status_code', None),
                    "name": e.get('name'),
                    "size": e['size'],
                    "url": url,
                    "file": file_path
                }
        except requests.exceptions.RequestException as e2:
            errors += 1
            return {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "status": "exception",
                "error": str(e2),
                "name": e.get('name'),
                "size": e['size'],
                "url": url,
                "file": file_path
            }

    results = []
    if workers and workers > 1 and len(entries) > 1:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(do_one, e) for e in entries]
            for fut in as_completed(futures):
                results.append(fut.result())
    else:
        for e in entries:
            results.append(do_one(e))

    # Append replay outcomes to the same log
    append_jsonl(log_path, results)
    print(f"Replay summary: total={len(entries)} attempted={attempted} ok={ok} skipped={skipped} errors={errors}")
    return {"total": len(entries), "attempted": attempted, "ok": ok, "skipped": skipped, "errors": errors}


def generate_card_index(all_decks):
    """Builds a per-card index keyed by base card name (no set), aggregating Pokémon across sets.
    For each deck, multiple Pokémon variants with the same base name are summed to a single copies count.
    """
    deck_total = len(all_decks)
    card_data = defaultdict(list)  # base name -> list of per-deck total copies
    sets_map = defaultdict(set)    # base name -> set codes observed
    name_casing = {}               # base lower -> display name

    for deck in all_decks:
        # First accumulate total copies per base card within this deck
        per_deck_counts = defaultdict(int)
        for card in deck.get('cards', []):
            name = card.get('name', '')
            set_code = card.get('set', '')
            number = card.get('number', '')
            category = card.get('category')
            base_key = name.lower() if category == 'pokemon' else name.lower()
            if base_key not in name_casing:
                name_casing[base_key] = name
            # All card types get set tracking for consistency
            per_deck_counts[base_key] += int(card.get('count', 0))
            if set_code:
                sets_map[base_key].add(set_code)
        # After scanning the deck, record one entry per base
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
            "dist": [{"copies": c, "players": p, "percent": round((p / found) * 100, 2) if found else 0.0} for c, p in sorted(dist_counter.items())],
            "sets": sorted(list(sets_map[base_key])) if sets_map[base_key] else []
        }

    return {"deckTotal": deck_total, "cards": index}

# --- R2 MANAGEMENT ---

# Hardcoded R2 configuration
R2_REMOTE = "r2"
R2_BASE_PATH = "archetype"


def clear_r2_bucket(remote, path):
    """Clear an arbitrary R2 bucket path using rclone."""
    target = f"{remote}:{path}"
    print(f"\nClearing R2 bucket: {target}")
    try:
        result = os.system(f'rclone purge "{target}" 2>nul' if os.name == 'nt' else f'rclone purge "{target}" 2>/dev/null')
        if result == 0:
            print("  ✓ R2 bucket cleared.")
            return True
        print("  ✗ Failed to clear R2 bucket.")
        return False
    except Exception as exc:
        print(f"✗ Error clearing R2 bucket: {exc}")
        return False


def upload_to_r2(local_path, remote, path):
    """Upload a local directory to R2 using rclone."""
    destination = f"{remote}:{path}"
    print(f"\nUploading to R2: {destination}")
    try:
        result = os.system(f'rclone sync "{local_path}" "{destination}" --quiet')
        if result == 0:
            print("  ✓ Upload complete.")
            return True
        print("  ✗ Upload failed.")
        return False
    except Exception as exc:
        print(f"  ✗ Error uploading to R2: {exc}")
        return False


def clear_r2_archetypes():
    """Clear the R2 archetype bucket using rclone."""
    print(f"\nClearing R2 bucket: {R2_REMOTE}:{R2_BASE_PATH}")
    try:
        result = os.system(f'rclone purge "{R2_REMOTE}:{R2_BASE_PATH}" 2>nul' if os.name == 'nt' else f'rclone purge "{R2_REMOTE}:{R2_BASE_PATH}" 2>/dev/null')
        if result == 0:
            print("✓ R2 bucket cleared successfully.")
            return True
        else:
            print(f"✗ Failed to clear R2 bucket (exit code: {result})")
            return False
    except Exception as e:
        print(f"✗ Error clearing R2 bucket: {e}")
        return False


def upload_archetype_to_r2(local_archetype_path, tournament_name, archetype_name, r2_remote=None, r2_path=None):
    """Upload a single archetype's include-exclude data to R2."""
    try:
        # Only upload include-exclude data
        include_exclude_dir = os.path.join(local_archetype_path, "include-exclude", archetype_name)
        if not os.path.exists(include_exclude_dir):
            return True  # No include-exclude data to upload

        # Construct the R2 destination path
        remote = r2_remote or R2_REMOTE
        base_path = r2_path or R2_BASE_PATH
        r2_dest = f"{base_path}/{tournament_name}/archetypes/include-exclude/{archetype_name}"

        result = os.system(f'rclone sync "{include_exclude_dir}" "{remote}:{r2_dest}" --quiet')
        if result != 0:
            print(f"      ✗ Failed to upload include-exclude for {archetype_name} to R2")
            return False

        print(f"      ✓ Uploaded {archetype_name} include-exclude to R2")
        return True
    except Exception as e:
        print(f"      ✗ Error uploading archetype to R2: {e}")
        return False


# --- MAIN WORKFLOW ---

def process_rk9_roster(session, args, url: str):
    rk9_url = _normalize_rk9_url(url)
    soup, headers, html_text = get_soup(rk9_url, session)
    if not soup:
        print(f"Skip: failed to fetch {rk9_url}")
        return False

    roster_entries = _extract_rk9_roster_entries(soup, rk9_url)
    if not roster_entries:
        print("No roster entries found on RK9 page.")
        return False

    masters = [entry for entry in roster_entries if (entry.get('division') or '').lower().startswith('master')]
    total_masters = len(masters)
    if not masters:
        print("No Masters players found on RK9 roster.")
        return False

    cutoff = getattr(args, 'rk9_cutoff', None) if hasattr(args, 'rk9_cutoff') else None
    if cutoff is not None and cutoff <= 0:
        cutoff = None
    if cutoff is None:
        while True:
            try:
                prompt = f"Enter Masters Day 2 cutoff (1-{total_masters}) or press Enter to include everyone: "
                user_input = input(prompt).strip()
            except (EOFError, KeyboardInterrupt):
                print()
                user_input = ''
            if not user_input:
                break
            try:
                value = int(user_input)
                if value <= 0:
                    print("  Please enter a positive number.")
                    continue
                cutoff = min(value, total_masters)
                setattr(args, 'rk9_cutoff', cutoff)
                break
            except ValueError:
                print("  Please enter a valid number or leave blank.")

    if cutoff is not None:
        masters = masters[:cutoff]

    print(f"Processing {len(masters)} Masters player(s) from RK9 roster...")

    roster_id = urlparse(rk9_url).path.rstrip('/').split('/')[-1] or 'rk9-roster'
    folder_name = sanitize_for_path(f"RK9 {roster_id}")
    base_report_path = os.path.join("reports", folder_name)
    archetype_report_path = os.path.join(base_report_path, "archetypes")
    os.makedirs(archetype_report_path, exist_ok=True)

    if getattr(args, 'save_raw_html', False) and html_text:
        html_path = os.path.join(base_report_path, "source.html")
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(html_text)

    def _maybe_anonymize(name: str) -> str:
        if not getattr(args, 'anonymize', False):
            return name
        digest = hashlib.sha1(name.encode('utf-8')).hexdigest()[:10]
        return f"Player-{digest}"

    all_decks = []
    total_selected = len(masters)
    for idx, entry in enumerate(masters, 1):
        player_name = entry.get('name') or entry.get('player_id')
        deck_url = entry.get('deck_url')
        print(f"  [{idx}/{total_selected}] Fetching decklist for {player_name}...")
        if not deck_url:
            print(f"  - Skipping {player_name}: decklist link unavailable.")
            continue

        deck_soup, _, _ = get_soup(deck_url, session)
        if not deck_soup:
            print(f"  - Skipping {player_name}: failed to fetch decklist.")
            continue

        cards = extract_rk9_decklist(deck_soup)
        if not cards:
            print(f"  - Skipping {player_name}: no cards found on decklist page.")
            continue

        canonical_card_list = sorted([f"{c['count']}x{c['name']}{c['set']}{c['number']}" for c in cards])
        deck_hash = hashlib.sha1(json.dumps(canonical_card_list).encode()).hexdigest()

        deck_record = {
            "id": deck_hash[:10],
            "player": _maybe_anonymize(player_name or "Unknown"),
            "playerId": entry.get('player_id'),
            "country": entry.get('country'),
            "placement": entry.get('standing'),
            "division": entry.get('division'),
            "archetype": "Unknown",
            "cards": cards,
            "deckHash": deck_hash,
            "sources": {
                "rk9DecklistUrl": deck_url,
                "rk9RosterUrl": rk9_url
            }
        }
        all_decks.append(deck_record)

    if not all_decks:
        print("No decklists were successfully parsed from RK9 roster.")
        return False

    prototypes = {}
    if getattr(args, 'skip_rk9_archetypes', False):
        print("Skipping RK9 archetype assignment (per flag).")
    else:
        prototypes = build_limitless_archetype_prototypes(session)
        if prototypes:
            assign_archetypes_from_prototypes(all_decks, prototypes)
        else:
            print("Warning: Could not build Limitless archetype prototypes; archetypes remain unknown.")

    metadata = {
        "name": folder_name,
        "sourceUrl": rk9_url,
        "reportVersion": "2.0",
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "source": "rk9",
        "rosterId": roster_id,
        "totalMasters": total_masters,
        "processedMasters": len(all_decks),
        "cutoff": getattr(args, 'rk9_cutoff', None),
        "etag": headers.get('ETag') if headers else None,
        "lastModified": headers.get('Last-Modified') if headers else None
    }
    write_json_atomic(os.path.join(base_report_path, "meta.json"), metadata)
    print("Metadata saved to meta.json.")

    write_json_atomic(os.path.join(base_report_path, "decks.json"), all_decks)
    print("Raw deck data saved to decks.json.")

    print("Generating master report...")
    master_report = generate_report_json(all_decks, len(all_decks), all_decks)
    write_json_atomic(os.path.join(base_report_path, "master.json"), master_report)
    print("Master report saved.")

    print("Generating card index...")
    card_index = generate_card_index(all_decks)
    write_json_atomic(os.path.join(base_report_path, "cardIndex.json"), card_index)
    print("Card index saved.")

    if getattr(args, 'generate_synonyms', False):
        print("\nGenerating card synonyms...")
        global_synonyms_path = os.path.join("assets", "card-synonyms.json")
        existing_data = {"synonyms": {}, "canonicals": {}, "metadata": {}}
        if os.path.exists(global_synonyms_path):
            try:
                with open(global_synonyms_path, 'r', encoding='utf-8') as f:
                    existing_data = json.load(f)
                    if "synonyms" not in existing_data:
                        existing_data = {"synonyms": existing_data, "canonicals": {}, "metadata": {}}
            except Exception:
                pass

        new_data = generate_card_synonyms(all_decks, session)
        if new_data and (new_data.get("synonyms") or new_data.get("canonicals")):
            existing_data["synonyms"].update(new_data.get("synonyms", {}))
            existing_data["canonicals"].update(new_data.get("canonicals", {}))
            existing_data["metadata"] = new_data.get("metadata", {})
            write_json_atomic(global_synonyms_path, existing_data)
            print(f"Card synonyms updated: total canonicals now {len(existing_data['canonicals'])}.")
        else:
            print("No new card synonyms found")

    print("Generating archetype reports...")
    archetype_groups = defaultdict(list)
    archetype_casing = {}
    for deck in all_decks:
        norm_name = normalize_archetype_name(deck["archetype"])
        archetype_groups[norm_name].append(deck)
        if norm_name not in archetype_casing:
            archetype_casing[norm_name] = deck["archetype"]

    archetype_index_list = []
    for norm_name, deck_list in archetype_groups.items():
        proper_name = archetype_casing[norm_name]
        print(f"  - Analyzing {proper_name} ({len(deck_list)} decks)...")
        archetype_data = generate_report_json(deck_list, len(deck_list), all_decks)
        json_filename_base = sanitize_for_filename(proper_name)
        archetype_filename = f"{json_filename_base}.json"
        archetype_index_list.append(json_filename_base)
        write_json_atomic(os.path.join(archetype_report_path, archetype_filename), archetype_data)

        if getattr(args, 'include_exclude', False):
            include_exclude_dir = os.path.join(archetype_report_path, "include-exclude", json_filename_base)
            generate_include_exclude_reports(proper_name, json_filename_base, deck_list, archetype_data, include_exclude_dir)

        if getattr(args, 'upload_archetypes_r2', False):
            r2_remote = getattr(args, 'r2_remote', 'r2')
            r2_path = getattr(args, 'r2_path', 'reports')
            upload_archetype_to_r2(archetype_report_path, folder_name, json_filename_base, r2_remote, r2_path)
    print("Archetype reports saved.")

    write_json_atomic(os.path.join(archetype_report_path, "index.json"), sorted(archetype_index_list))
    print("Archetype index saved.")

    if getattr(args, 'upload_archetypes_r2', False):
        r2_remote = getattr(args, 'r2_remote', 'r2')
        r2_path = getattr(args, 'r2_path', 'reports')
        index_file = os.path.join(archetype_report_path, "index.json")
        r2_dest = f"{r2_path}/{folder_name}/archetypes"
        result = os.system(f'rclone copy "{index_file}" "{r2_remote}:{r2_dest}" --quiet')
        if result == 0:
            print("  ✓ Uploaded archetype index to R2")

    try:
        tournaments_path = os.path.join("reports", "tournaments.json")
        existing = []
        if os.path.exists(tournaments_path):
            try:
                with open(tournaments_path, 'r', encoding='utf-8') as f:
                    existing = json.load(f)
            except Exception:
                existing = []
        existing = [x for x in existing if x != folder_name]
        updated = [folder_name] + existing
        updated.sort(reverse=True)
        write_json_atomic(tournaments_path, updated)
        print("tournaments.json updated.")
    except Exception as e:
        print(f"Could not update tournaments.json: {e}")

    if not args.skip_thumbs:
        missing_thumbs = download_thumbnails(
            all_decks,
            ".",
            session,
            workers=args.thumb_workers,
            download_log_path=getattr(args, 'download_log', None),
            tournament_name=folder_name,
            force=getattr(args, 'force', False)
        )
        if missing_thumbs:
            with open(os.path.join(base_report_path, "missingThumbs.json"), 'w') as f:
                json.dump(missing_thumbs, f, indent=2)
            print("Missing thumbnails report saved.")

    print("\nProcess complete!")
    print(f"All reports saved in: {base_report_path}")
    if not args.skip_thumbs:
        print("Thumbnails saved in: thumbnails/")
    return True


def _finalize_tournament_outputs(args, session, folder_name, base_report_path, archetype_report_path, metadata, all_decks, html_text=None):
    """Shared reporting pipeline for tournament-like sources."""
    os.makedirs(base_report_path, exist_ok=True)
    os.makedirs(archetype_report_path, exist_ok=True)

    if getattr(args, 'save_raw_html', False) and html_text:
        html_path = os.path.join(base_report_path, "source.html")
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(html_text)

    write_json_atomic(os.path.join(base_report_path, "meta.json"), metadata)
    print("Metadata saved to meta.json.")

    write_json_atomic(os.path.join(base_report_path, "decks.json"), all_decks)
    print("Raw deck data saved to decks.json.")

    print("Generating master report...")
    master_report = generate_report_json(all_decks, len(all_decks), all_decks)
    write_json_atomic(os.path.join(base_report_path, "master.json"), master_report)
    print("Master report saved.")

    print("Generating card index...")
    card_index = generate_card_index(all_decks)
    write_json_atomic(os.path.join(base_report_path, "cardIndex.json"), card_index)
    print("Card index saved.")

    if getattr(args, 'generate_synonyms', False):
        print("\nGenerating card synonyms...")
        global_synonyms_path = os.path.join("assets", "card-synonyms.json")
        existing_data = {"synonyms": {}, "canonicals": {}, "metadata": {}}
        if os.path.exists(global_synonyms_path):
            try:
                with open(global_synonyms_path, 'r', encoding='utf-8') as f:
                    existing_data = json.load(f)
                    if "synonyms" not in existing_data:
                        existing_data = {"synonyms": existing_data, "canonicals": {}, "metadata": {}}
            except Exception:
                existing_data = {"synonyms": {}, "canonicals": {}, "metadata": {}}

        new_data = generate_card_synonyms(all_decks, session)

        if new_data and (new_data.get("synonyms") or new_data.get("canonicals")):
            existing_data["synonyms"].update(new_data.get("synonyms", {}))
            existing_data["canonicals"].update(new_data.get("canonicals", {}))
            existing_data["metadata"] = new_data.get("metadata", {})
            write_json_atomic(global_synonyms_path, existing_data)
            new_count = len(new_data.get("canonicals", {}))
            total_count = len(existing_data["canonicals"])
            print(f"Card synonyms updated: Added/updated {new_count} cards")
            print(f"  Global file now contains {total_count} unique cards with {len(existing_data['synonyms'])} total variants")
        else:
            print("No new card synonyms found")

    print("Generating archetype reports...")
    archetype_groups = defaultdict(list)
    archetype_casing = {}
    for deck in all_decks:
        archetype_label = deck.get("archetype", "Unknown")
        norm_name = normalize_archetype_name(archetype_label)
        archetype_groups[norm_name].append(deck)
        if norm_name not in archetype_casing:
            archetype_casing[norm_name] = archetype_label

    archetype_index_list = []
    for norm_name, deck_list in archetype_groups.items():
        proper_name = archetype_casing[norm_name]
        print(f"  - Analyzing {proper_name} ({len(deck_list)} decks)...")
        archetype_data = generate_report_json(deck_list, len(deck_list), all_decks)
        json_filename_base = sanitize_for_filename(proper_name)
        archetype_filename = f"{json_filename_base}.json"
        archetype_index_list.append(json_filename_base)
        write_json_atomic(os.path.join(archetype_report_path, archetype_filename), archetype_data)

        if getattr(args, 'include_exclude', False):
            include_exclude_dir = os.path.join(archetype_report_path, "include-exclude", json_filename_base)
            generate_include_exclude_reports(proper_name, json_filename_base, deck_list, archetype_data, include_exclude_dir)

        if getattr(args, 'upload_archetypes_r2', False):
            r2_remote = getattr(args, 'r2_remote', 'r2')
            r2_path = getattr(args, 'r2_path', 'reports')
            upload_archetype_to_r2(archetype_report_path, folder_name, json_filename_base, r2_remote, r2_path)
    print("Archetype reports saved.")

    print("Generating archetype index file...")
    write_json_atomic(os.path.join(archetype_report_path, "index.json"), sorted(archetype_index_list))
    print("Archetype index saved.")

    if getattr(args, 'upload_archetypes_r2', False):
        r2_remote = getattr(args, 'r2_remote', 'r2')
        r2_path = getattr(args, 'r2_path', 'reports')
        index_file = os.path.join(archetype_report_path, "index.json")
        r2_dest = f"{r2_path}/{folder_name}/archetypes"
        result = os.system(f'rclone copy "{index_file}" "{r2_remote}:{r2_dest}" --quiet')
        if result == 0:
            print("  ✓ Uploaded archetype index to R2")

    try:
        tournaments_path = os.path.join("reports", "tournaments.json")
        existing = []
        if os.path.exists(tournaments_path):
            try:
                with open(tournaments_path, 'r', encoding='utf-8') as f:
                    existing = json.load(f)
            except Exception:
                existing = []
        existing = [x for x in existing if x != folder_name]
        updated = [folder_name] + existing

        def _date_key(value):
            try:
                pref = value.split(',', 1)[0].strip()
                return datetime.fromisoformat(pref)
            except Exception:
                return datetime.min

        updated.sort(key=_date_key, reverse=True)
        write_json_atomic(tournaments_path, updated)
        print("tournaments.json updated.")
    except Exception as e:
        print(f"Could not update tournaments.json: {e}")

    if not getattr(args, 'skip_thumbs', False):
        missing_thumbs = download_thumbnails(
            all_decks,
            ".",
            session,
            workers=getattr(args, 'thumb_workers', 1),
            download_log_path=getattr(args, 'download_log', None),
            tournament_name=folder_name,
            force=getattr(args, 'force', False)
        )
        if missing_thumbs:
            with open(os.path.join(base_report_path, "missingThumbs.json"), 'w') as f:
                json.dump(missing_thumbs, f, indent=2)
            print("Missing thumbnails report saved.")

    print("\nProcess complete!")
    print(f"All reports saved in: {base_report_path}")
    if not getattr(args, 'skip_thumbs', False):
        print("Thumbnails saved in: thumbnails/")
    return True


def _normalize_url_for_tournament(u: str) -> str:
    """Normalize user input to a full https URL ending with /decklists."""
    if not u:
        return u
    s = u.strip()
    if not s.startswith('http://') and not s.startswith('https://'):
        s = 'https://' + s
    s = s.rstrip('/')
    if not s.endswith('/decklists'):
        s = s + '/decklists'
    return s

def process_tournament(session, args, url: str):
    """Process a single tournament URL end-to-end."""
    norm_url = _normalize_url_for_tournament(url)
    soup, headers, html_text = get_soup(norm_url, session)
    if not soup:
        print(f"Skip: failed to fetch {norm_url}")
        return False

    # Determine base folder name including start date (YYYY-MM-DD) when available
    heading_node = soup.find('div', class_='infobox-heading')
    heading_text = heading_node.text.strip() if heading_node and heading_node.text else 'Tournament'
    info_line = soup.find('div', class_='infobox-line')
    start_iso = None
    if info_line:
        date_text_full = info_line.get_text(separator=' ', strip=True)
        parts = [p.strip() for p in re.split(r"\s•\s|•", date_text_full) if p.strip()]
        if parts:
            start_iso, _ = _parse_start_date(parts[0])
    folder_name = sanitize_for_path(f"{start_iso}, {heading_text}" if start_iso else heading_text)
    tournament_name = folder_name

    base_report_path = os.path.join("reports", tournament_name)
    archetype_report_path = os.path.join(base_report_path, "archetypes")

    # Extract and save metadata
    metadata = extract_metadata(soup, norm_url, headers)

    # Extract all deck data
    all_decks = extract_all_decklists(soup, getattr(args, 'anonymize', False))
    if not all_decks:
        print("No decklists found. Exiting.")
        return False
    return _finalize_tournament_outputs(
        args,
        session,
        tournament_name,
        base_report_path,
        archetype_report_path,
        metadata,
        all_decks,
        html_text,
    )


# --- LIMITLESS LABS SUPPORT ---

def _is_labs_url(value: str) -> bool:
    if not value:
        return False
    return 'labs.limitlesstcg.com' in value.lower()


def _normalize_labs_url(value: str) -> str:
    if not value:
        return value
    s = value.strip()
    if s.lower().startswith('labs:'):
        s = s.split(':', 1)[1]
    if not s.startswith(('http://', 'https://')):
        s = s.lstrip('/')
        s = urljoin(LIMITLESS_LABS_BASE_URL + '/', s)
    parsed = urlparse(s)
    scheme = parsed.scheme or 'https'
    netloc = parsed.netloc or urlparse(LIMITLESS_LABS_BASE_URL).netloc
    path = (parsed.path or '').rstrip('/')
    segments = [seg for seg in path.split('/') if seg]
    if not any(seg.lower() == 'standings' for seg in segments):
        path = f"{path}/standings" if path else '/standings'
    if not path.startswith('/'):
        path = '/' + path
    normalized = f"{scheme}://{netloc}{path}"
    if parsed.query:
        normalized = f"{normalized}?{parsed.query}"
    return normalized


def _format_labs_tokens(tokens):
    special_upper = {'ex', 'gx', 'v', 'vmax', 'vstar', 'glc'}
    formatted = []
    for token in tokens:
        cleaned = token.strip()
        if not cleaned:
            continue
        lower = cleaned.lower()
        if lower in special_upper:
            formatted.append(lower.upper())
        else:
            formatted.append(cleaned.capitalize())
    return ' '.join(formatted)


def _clean_labs_deck_name(title):
    if not title:
        return None
    working = title.strip()
    if '|' in working:
        working = working.split('|', 1)[0].strip()
    for sep in (' – ', ' — ', ' - '):
        if sep in working:
            parts = [p.strip() for p in working.split(sep) if p.strip()]
            if len(parts) >= 2:
                working = parts[-1]
    working = re.sub(r'\bDecklist\b', '', working, flags=re.IGNORECASE).strip()
    return working or None


def _derive_labs_archetype_name(anchor, slug=None):
    if anchor:
        labels = []
        for img in anchor.find_all('img', alt=True):
            alt_text = (img.get('alt') or '').strip()
            if alt_text:
                tokens = re.split(r'[-_/]+', alt_text)
                labels.append(_format_labs_tokens(tokens))
        labels = [label for label in labels if label]
        if labels:
            return ' '.join(labels)
    if slug:
        tokens = re.split(r'[-_/]+', slug)
        return _format_labs_tokens(tokens)
    return "Unknown"


def extract_labs_metadata(soup, url, headers):
    if not soup:
        return {}
    header_candidates = [
        soup.find('h1'),
        soup.select_one('header h1'),
        soup.select_one('main h1')
    ]
    name = None
    for node in header_candidates:
        if node and node.get_text(strip=True):
            name = node.get_text(strip=True)
            break
    if not name:
        title_tag = soup.find('title')
        if title_tag and title_tag.text:
            name = title_tag.text.split('|')[0].strip()

    month_pattern = re.compile(r'(January|February|March|April|May|June|July|August|September|October|November|December)', re.I)
    date_text = None
    for candidate in soup.select('h1 + p, header p, .event-info p, .event-header p, .text-sm, .uppercase'):
        text = candidate.get_text(' ', strip=True)
        if text and month_pattern.search(text) and any(ch.isdigit() for ch in text):
            date_text = text
            break

    start_iso = start_text = None
    if date_text:
        start_iso, start_text = _parse_start_date(date_text)

    format_name = None
    format_pattern = re.compile(r'\b(Standard|Expanded|GLC)\b', re.I)
    for candidate in soup.select('h1 + p, header p, .event-info p, .event-header p, .text-sm, .uppercase'):
        text = candidate.get_text(' ', strip=True)
        if not text:
            continue
        match = format_pattern.search(text)
        if match:
            format_name = match.group(1).title()
            break

    metadata = {
        "name": name,
        "sourceUrl": url,
        "date": date_text,
        "format": format_name,
        "players": None,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "etag": headers.get('ETag') if headers else None,
        "lastModified": headers.get('Last-Modified') if headers else None,
        "reportVersion": "2.0",
        "startDate": start_iso,
        "startDateText": start_text,
        "formatCode": format_name.lower() if format_name else None,
        "formatName": format_name,
        "source": "limitless-labs"
    }
    return metadata


def extract_labs_day2_players(soup, base_url):
    table = soup.find('table', class_=re.compile(r'data-table'))
    if not table:
        print("Warning: Limitless Labs standings table not found.")
        return []
    tbody = table.find('tbody') or table
    players = []
    for row in tbody.find_all('tr'):
        classes = [c.lower() for c in (row.get('class') or [])]
        if not any('day2' in c for c in classes):
            continue
        cells = row.find_all('td')
        if len(cells) < 2:
            continue

        def _text(cell):
            return cell.get_text(strip=True)

        try:
            placement = int(_text(cells[0]))
        except Exception:
            placement = None

        player_link = cells[1].find('a', href=True)
        player_name = player_link.get_text(strip=True) if player_link else _text(cells[1])
        player_url = urljoin(base_url, player_link['href']) if player_link else None

        deck_cell = cells[-2] if len(cells) >= 2 else None
        deck_anchor = deck_cell.find('a', href=True) if deck_cell else None
        deck_href = deck_anchor['href'] if deck_anchor else None
        deck_slug = deck_href.strip('/').split('/')[-1] if deck_href else None
        deck_name = _derive_labs_archetype_name(deck_anchor, deck_slug)
        deck_url = urljoin(base_url, deck_href) if deck_href else None

        decklist_cell = cells[-1] if len(cells) >= 1 else None
        decklist_anchor = decklist_cell.find('a', href=True) if decklist_cell else None
        decklist_url = urljoin(base_url, decklist_anchor['href']) if decklist_anchor else None

        country = None
        if len(cells) > 2:
            flag_img = cells[2].find('img', alt=True)
            if flag_img:
                country = (flag_img.get('alt') or flag_img.get('title') or '').strip() or None

        points = _text(cells[3]) if len(cells) > 3 else None
        record = _text(cells[4]) if len(cells) > 4 else None
        opw = _text(cells[5]) if len(cells) > 5 else None
        oopw = _text(cells[6]) if len(cells) > 6 else None

        player_id = None
        if player_url:
            player_id = player_url.rstrip('/').split('/')[-1]

        players.append({
            "placement": placement,
            "player_name": player_name,
            "player_url": player_url,
            "player_id": player_id,
            "country": country,
            "points": points,
            "record": record,
            "opw": opw,
            "oopw": oopw,
            "deck_name": deck_name,
            "deck_url": deck_url,
            "deck_slug": deck_slug,
            "decklist_url": decklist_url
        })
    return players


def _is_card_number_token(token):
    if not token:
        return False
    token = token.strip()
    if not token:
        return False
    token_upper = token.upper()
    cleaned = token_upper.replace('-', '').replace('_', '')
    if not any(ch.isdigit() for ch in cleaned):
        return False
    if not re.fullmatch(r'[A-Z0-9/]+', token_upper):
        return False
    return True


def _parse_labs_decklist_text(deck_text):
    if not deck_text:
        return []
    suffix_tokens = {'EX', 'GX', 'V', 'VMAX', 'VSTAR', 'LV.X', 'BREAK', 'V-UNION', 'SP'}
    cards = []
    current_category = None
    for raw_line in deck_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        lowered = line.lower()
        if lowered.startswith('total cards') or lowered.startswith('deck list') or lowered.startswith('decklist') or lowered.startswith('format:'):
            continue
        category_match = re.match(r'^(pok[eé]mon|pokemon|trainer[s]?|energy|energies)(?:\s*\(\d+\))?$', lowered)
        if category_match:
            key = category_match.group(1)
            if key.startswith('pok'):
                current_category = 'pokemon'
            elif key.startswith('train'):
                current_category = 'trainer'
            else:
                current_category = 'energy'
            continue
        card_match = re.match(r'^(\d+)\s+(.+)$', line)
        if not card_match:
            continue
        count = int(card_match.group(1))
        rest = card_match.group(2).strip()
        tokens = rest.split()
        set_code = ''
        number = ''
        if tokens:
            last_token = tokens[-1]
            if _is_card_number_token(last_token):
                number = _normalize_card_number(last_token)
                tokens = tokens[:-1]
                if tokens:
                    potential_set = tokens[-1]
                    if re.fullmatch(r'[A-Za-z0-9]{2,5}', potential_set) and potential_set.upper() not in suffix_tokens:
                        set_code = potential_set.upper()
                        tokens = tokens[:-1]
        name = ' '.join(tokens).strip() if tokens else rest
        if not name:
            name = rest
        category = current_category
        if not category:
            if 'energy' in name.lower():
                category = 'energy'
            else:
                category = 'pokemon'
        meta = _ensure_card_metadata(name, category)
        card_entry = {
            "count": count,
            "name": name,
            "set": set_code,
            "number": number,
            "category": meta.get('category') or category
        }
        if meta.get('trainerType'):
            card_entry['trainerType'] = meta['trainerType']
        if meta.get('energyType'):
            card_entry['energyType'] = meta['energyType']
        if meta.get('displayCategory'):
            card_entry['displayCategory'] = meta['displayCategory']
        cards.append(card_entry)
    return cards


def _extract_labs_decklist_text(soup, html_text):
    if not soup:
        return None
    for node in soup.select('textarea'):
        text = node.get_text()
        if text:
            candidate = text.strip()
            if candidate and candidate.count('\n') >= 4:
                return candidate
    for attr in ('data-clipboard-text', 'data-copy', 'data-list'):
        for node in soup.select(f'[{attr}]'):
            raw = node.get(attr)
            if raw:
                candidate = raw.strip()
                if candidate and candidate.count('\n') >= 4:
                    return candidate
    for node in soup.select('pre, code'):
        text = node.get_text()
        if text:
            candidate = text.strip()
            if candidate and candidate.count('\n') >= 4:
                return candidate
    if html_text:
        patterns = [
            r'"decklist"\s*:\s*"(.*?)"',
            r'"decklistText"\s*:\s*"(.*?)"',
            r'"list"\s*:\s*"(.*?)"'
        ]
        for pattern in patterns:
            for match in re.finditer(pattern, html_text, re.S):
                raw = match.group(1)
                try:
                    decoded = json.loads(f'"{raw}"')
                except json.JSONDecodeError:
                    decoded = raw.encode('utf-8').decode('unicode_escape')
                candidate = decoded.strip()
                if candidate and candidate.count('\n') >= 4:
                    return candidate
    return None


def fetch_labs_decklist(session, decklist_url):
    if not decklist_url:
        return None
    deck_soup, _, html_text = get_soup(decklist_url, session)
    if not deck_soup:
        return None
    deck_title = None
    for heading in deck_soup.select('h1, h2'):
        text = heading.get_text(' ', strip=True)
        if text:
            deck_title = text
            break
    deck_name = _clean_labs_deck_name(deck_title) or None
    deck_text = _extract_labs_decklist_text(deck_soup, html_text)
    cards = _parse_labs_decklist_text(deck_text)
    if not cards:
        print(f"  - Warning: No cards parsed from {decklist_url}")
    return {
        "deck_name": deck_name,
        "cards": cards,
        "raw_text": deck_text
    }


def process_labs_tournament(session, args, url: str):
    labs_url = _normalize_labs_url(url)
    soup, headers, html_text = get_soup(labs_url, session)
    if not soup:
        print(f"Skip: failed to fetch {labs_url}")
        return False

    metadata = extract_labs_metadata(soup, labs_url, headers)
    parsed = urlparse(labs_url)
    path_parts = [part for part in parsed.path.split('/') if part]
    event_id = path_parts[0] if path_parts else None
    if event_id:
        metadata['labsEventId'] = event_id

    players = extract_labs_day2_players(soup, labs_url)
    if not players:
        print("No Day 2 players found on Limitless Labs standings page.")
        return False

    metadata['totalDay2'] = len(players)

    start_iso = metadata.get('startDate')
    base_name = metadata.get('name') or (f"Limitless Labs {event_id}" if event_id else "Limitless Labs Event")
    folder_name = sanitize_for_path(f"{start_iso}, {base_name}" if start_iso else base_name)
    base_report_path = os.path.join("reports", folder_name)
    archetype_report_path = os.path.join(base_report_path, "archetypes")

    def _maybe_anonymize(name: str) -> str:
        if not name:
            return "Unknown"
        if not getattr(args, 'anonymize', False):
            return name
        digest = hashlib.sha1(name.encode('utf-8')).hexdigest()[:10]
        return f"Player-{digest}"

    all_decks = []
    total_players = len(players)
    for idx, player in enumerate(players, 1):
        label = player.get('player_name') or 'Unknown'
        print(f"  [{idx}/{total_players}] Fetching decklist for {label}...")
        decklist_url = player.get('decklist_url')
        deck_data = fetch_labs_decklist(session, decklist_url)
        cards = deck_data.get('cards') if deck_data else []
        if not cards:
            print(f"  - Skipping {label}: decklist missing or empty.")
            continue
        deck_name = deck_data.get('deck_name') or player.get('deck_name') or "Unknown"
        player_label = _maybe_anonymize(player.get('player_name'))
        canonical_card_list = sorted([f"{c['count']}x{c['name']}{c.get('set', '')}{c.get('number', '')}" for c in cards])
        deck_hash = hashlib.sha1(json.dumps(canonical_card_list).encode()).hexdigest()
        deck_record = {
            "id": deck_hash[:10],
            "player": player_label,
            "placement": player.get('placement'),
            "archetype": deck_name,
            "cards": cards,
            "deckHash": deck_hash,
            "sources": {
                "labsStandingsUrl": labs_url,
                "labsDecklistUrl": decklist_url,
                "labsPlayerUrl": player.get('player_url')
            },
            "points": player.get('points'),
            "record": player.get('record'),
            "opw": player.get('opw'),
            "oopw": player.get('oopw'),
            "playerId": player.get('player_id'),
            "country": player.get('country')
        }
        all_decks.append(deck_record)

    if not all_decks:
        print("No decklists were successfully parsed from Limitless Labs.")
        return False

    return _finalize_tournament_outputs(
        args,
        session,
        folder_name,
        base_report_path,
        archetype_report_path,
        metadata,
        all_decks,
        html_text,
    )

def regenerate_synonyms_only(session, tournament_path=None):
    """Regenerate synonyms for existing tournament(s) without re-downloading.

    Creates a single global cardSynonyms.json file in the reports directory
    containing all unique card synonyms across all tournaments.
    """
    if tournament_path:
        # Single tournament mode
        paths = [tournament_path]
    else:
        # All tournaments mode
        tournaments_file = os.path.join("reports", "tournaments.json")
        if not os.path.exists(tournaments_file):
            print("No tournaments.json found. Have you downloaded any tournaments?")
            return False

        with open(tournaments_file, 'r', encoding='utf-8') as f:
            tournament_names = json.load(f)

        paths = [os.path.join("reports", name) for name in tournament_names]

    total = len(paths)

    # Collect all decks from all tournaments
    all_decks = []

    print(f"\nCollecting decks from {total} tournament(s)...")
    for i, path in enumerate(paths, 1):
        print(f"  [{i}/{total}] Loading: {os.path.basename(path)}")

        decks_file = os.path.join(path, "decks.json")
        if not os.path.exists(decks_file):
            print(f"    Skipping: decks.json not found")
            continue

        # Load existing deck data
        try:
            with open(decks_file, 'r', encoding='utf-8') as f:
                decks = json.load(f)
                all_decks.extend(decks)
                print(f"    Loaded {len(decks)} decks")
        except Exception as e:
            print(f"    Error loading decks.json: {e}")
            continue

    if not all_decks:
        print("\nNo decks found across all tournaments")
        return False

    print(f"\nTotal decks collected: {len(all_decks)}")

    # Generate synonyms for ALL decks at once
    print("\nGenerating global synonym mapping...")
    synonym_data = generate_card_synonyms(all_decks, session)

    if synonym_data and (synonym_data.get("synonyms") or synonym_data.get("canonicals")):
        # Write single global file
        global_output_path = os.path.join("assets", "card-synonyms.json")
        write_json_atomic(global_output_path, synonym_data)
        num_cards = len(synonym_data.get("canonicals", {}))
        num_variants = len(synonym_data.get("synonyms", {}))
        print(f"\n✓ Saved synonym data to {global_output_path}")
        print(f"  {num_cards} unique cards with {num_variants} total variants")
        print(f"  This file covers {len(all_decks)} decks from {total} tournament(s)")
        return True
    else:
        print("\nNo synonyms found")
        return False


def main(args):
    """Main function to run the entire process or a batch."""
    # Create a session for connection reuse and retries
    session = requests.Session()
    session.headers.update({'User-Agent': 'Mozilla/5.0'})

    # R2 clear mode: clear the R2 bucket
    if getattr(args, 'clear_r2', False):
        r2_remote = getattr(args, 'r2_remote', 'r2')
        r2_path = getattr(args, 'r2_path', 'reports')
        clear_r2_bucket(r2_remote, r2_path)
        return

    # Synonym regeneration mode: generate synonyms from existing data
    if getattr(args, 'regenerate_synonyms', False):
        tournament_path = args.tournament_path if hasattr(args, 'tournament_path') and args.tournament_path else None
        regenerate_synonyms_only(session, tournament_path)
        return

    # Replay mode: bulk re-download from log and exit
    if getattr(args, 'replay_log', None):
        replay_downloads(args.replay_log, session, workers=args.thumb_workers, force=args.force)
        return

    # Interactive prompts for include-exclude and R2 upload when not in batch mode
    if not getattr(args, 'download_all', False) and not args.url:
        # Ask about synonym generation
        if not hasattr(args, 'generate_synonyms'):
            try:
                response = input("\nGenerate card synonyms from print variations? (scrapes Limitless for each card) [y/N]: ").strip().lower()
                args.generate_synonyms = response in ('y', 'yes')
            except (EOFError, KeyboardInterrupt):
                print()
                args.generate_synonyms = False

        # Ask about include-exclude generation
        if not hasattr(args, 'include_exclude'):
            try:
                response = input("Generate include-exclude filter reports? (can take extra time) [y/N]: ").strip().lower()
                args.include_exclude = response in ('y', 'yes')
            except (EOFError, KeyboardInterrupt):
                print()
                args.include_exclude = False

        # Ask about R2 upload
        if not hasattr(args, 'upload_r2'):
            try:
                response = input("Upload to R2 after processing? [y/N]: ").strip().lower()
                args.upload_r2 = response in ('y', 'yes')
            except (EOFError, KeyboardInterrupt):
                print()
                args.upload_r2 = False

    # Batch mode: process URLs from file
    if getattr(args, 'download_all', False):
        list_path = args.batch_file
        urls = []
        try:
            with open(list_path, 'r', encoding='utf-8') as f:
                for line in f:
                    s = line.strip()
                    if not s or s.startswith('#'):
                        continue
                    urls.append(s)
        except FileNotFoundError:
            print(f"Batch file not found: {list_path}")
            return
        if not urls:
            print("No URLs found in batch file.")
            return
        total = len(urls)
        ok = fail = 0
        for i, u in enumerate(urls, start=1):
            print(f"\n=== [{i}/{total}] Processing: {u} ===")
            try:
                if _is_rk9_url(u):
                    succeeded = process_rk9_roster(session, args, u)
                else:
                    succeeded = process_tournament(session, args, u)
                if succeeded:
                    ok += 1
                else:
                    fail += 1
            except Exception as e:
                fail += 1
                print(f"Error processing {u}: {e}")
        print(f"\nBatch complete. Success: {ok}, Failed: {fail}, Total: {total}")

        # After batch processing, offer to upload to R2
        if getattr(args, 'upload_r2', False):
            r2_remote = getattr(args, 'r2_remote', 'r2')
            r2_path = getattr(args, 'r2_path', 'reports')
            upload_to_r2('reports', r2_remote, r2_path)

        return

    # Single URL mode
    if not args.url:
        try:
            user_input = input("Enter LimitlessTCG tournament URL or id (e.g. '500' or 'limitlesstcg.com/tournaments/500'): ").strip()
        except (EOFError, KeyboardInterrupt):
            print("No URL provided. Exiting.")
            sys.exit(1)
        if not user_input:
            print("No URL provided. Exiting.")
            sys.exit(1)
        args.url = user_input

    # Map simple inputs (ids, base URL) and normalize to full decklists URL
    def _normalize_input(u):
        return re.sub(r'^https?://', '', (u or '').strip()).rstrip('/').lower()

    raw_url = (args.url or '').strip()
    normalized_input = _normalize_input(raw_url)
    processed = False

    if raw_url.lower().startswith('labs:') or _is_labs_url(raw_url) or normalized_input.startswith('labs.limitlesstcg.com'):
        url = _normalize_labs_url(raw_url)
        processed = process_labs_tournament(session, args, url)
    elif _is_rk9_url(raw_url):
        url = _normalize_rk9_url(raw_url)
        processed = process_rk9_roster(session, args, url)
    else:
        special_inputs = {
            'limitlesstcg.com/tournaments/500/decklists',
            'limitlesstcg.com/tournaments/500',
            '500',
            'https://limitlesstcg.com/tournaments/500/decklists',
            'https://limitlesstcg.com/tournaments/500'
        }

        if normalized_input in {_normalize_input(s) for s in special_inputs}:
            url = 'https://limitlesstcg.com/tournaments/500/decklists'
        else:
            url = _normalize_url_for_tournament(raw_url)

        processed = process_tournament(session, args, url)

    # After single tournament processing, offer to upload to R2
    if getattr(args, 'upload_r2', False):
        r2_remote = getattr(args, 'r2_remote', 'r2')
        r2_path = getattr(args, 'r2_path', 'reports')
        upload_to_r2('reports', r2_remote, r2_path)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Scrape and analyze Pokémon TCG tournament data from LimitlessTCG.",
        epilog="""
USAGE MODES:

  1. SINGLE TOURNAMENT MODE (default)
     Process a single tournament and generate reports.
     Example: python download.py https://limitlesstcg.com/tournaments/500/decklists
     Example: python download.py 500
     Example: python download.py  (prompts for URL)

  2. BATCH MODE
     Process multiple tournaments from a file.
     Example: python download.py --download-all --batch-file tournaments.txt

  3. SYNONYM REGENERATION MODE
     Regenerate card synonyms from existing tournament data without re-downloading.
     Example: python download.py --regenerate-synonyms  (all tournaments)
     Example: python download.py --regenerate-synonyms --tournament-path "reports/2025-08-15, World Championships 2025"

  4. REPLAY MODE
     Re-download missing thumbnails from a download log.
     Example: python download.py --replay-log tools/download_log.jsonl

  5. R2 MANAGEMENT MODE
     Clear or upload tournament reports to R2 storage.
     Example: python download.py --clear-r2
     Example: python download.py --url 500 --upload-r2

OPTIONAL FEATURES:
  - Card synonyms: Add --generate-synonyms to scrape print variations (slower)
  - Include/exclude reports: Add --include-exclude for archetype filtering analysis
  - R2 upload: Add --upload-r2 to automatically upload reports after processing
  - Archetype R2 upload: Add --upload-archetypes-r2 to upload individual archetype reports

For more details on each option, see the argument descriptions below.
        """,
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    # Make the URL positional optional; if missing we'll prompt the user interactively.
    parser.add_argument("url", nargs='?', help="The URL or identifier of the Limitless TCG tournament (if omitted you'll be prompted).")
    parser.add_argument("--anonymize", action="store_true", help="Anonymize player names using a hash.")
    parser.add_argument("--skip-thumbs", action="store_true", help="Skip downloading card thumbnails.")
    parser.add_argument("--thumb-workers", type=int, default=4, help="Parallel workers for thumbnail downloads (default 4). Use 1 to disable parallelism.")
    parser.add_argument("--save-raw-html", action="store_true", help="Save raw HTML snapshot to source.html in the tournament folder.")
    parser.add_argument("--download-log", default=os.path.join("tools", "download_log.jsonl"), help="Path to append-only JSONL log for thumbnail downloads.")
    parser.add_argument("--replay-log", help="Re-download thumbnails listed in the given JSONL log and exit.")
    parser.add_argument("--force", action="store_true", help="Force re-download even if local files exist.")
    parser.add_argument("--download-all", action="store_true", help="Process all tournaments listed in --batch-file and exit.")
    parser.add_argument("--batch-file", default=os.path.join("tools", "download_list.txt"), help="Path to a text file with one tournament URL per line.")
    parser.add_argument("--rk9-cutoff", type=int, help="Masters Day 2 cutoff when processing RK9 rosters (prompts when omitted).")
    parser.add_argument("--skip-rk9-archetypes", action="store_true", help="Skip Limitless archetype matching when processing RK9 rosters.")

    # Synonym generation options
    parser.add_argument("--generate-synonyms", action="store_true", help="Generate card synonyms by scraping print variations from Limitless. Optional, not generated by default.")
    parser.add_argument("--regenerate-synonyms", action="store_true", help="Regenerate synonyms for existing tournament(s) without re-downloading. Use with --tournament-path for a specific tournament, or alone to process all tournaments.")
    parser.add_argument("--tournament-path", help="Path to a specific tournament folder (e.g., 'reports/2025-08-15, World Championships 2025'). Used with --regenerate-synonyms.")

    # Include-exclude and R2 options
    parser.add_argument("--include-exclude", action="store_true", help="Generate include/exclude filter reports (deduplicated). Optional, not generated by default.")
    parser.add_argument("--upload-r2", action="store_true", help="Upload reports to R2 after processing.")
    parser.add_argument("--upload-archetypes-r2", action="store_true", help="Upload individual archetype reports to R2 as they are generated. Useful for real-time updates during processing.")
    parser.add_argument("--clear-r2", action="store_true", help="Clear the R2 bucket before uploading. Requires confirmation.")
    parser.add_argument("--r2-remote", default="r2", help="rclone remote name for R2 (default: r2)")
    parser.add_argument("--r2-path", default="reports", help="Path in R2 bucket (default: reports)")

    args = parser.parse_args()

    # If no URL was provided on the command line, prompt the user.
    main(args)
