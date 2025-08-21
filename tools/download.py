import os
import re
import json
import hashlib
import requests
import argparse
import tempfile
import time
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs
from bs4 import BeautifulSoup
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import sys
import shutil

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

        cards = []
        cards_container = container.find('div', attrs={'data-text-decklist': True})
        if not cards_container: continue

        for card_div in cards_container.find_all('div', class_='decklist-card'):
            category_text = card_div.find_parent('div', class_='decklist-column').find('div', class_='decklist-column-heading').text.strip().lower()
            category = "pokemon" if "pokémon" in category_text else "trainer" if "trainer" in category_text else "energy"
            cards.append({
                "count": int(card_div.find('span', class_='card-count').text.strip()),
                "name": card_div.find('span', class_='card-name').text.strip(),
                "set": card_div['data-set'],
                "number": card_div['data-number'],
                "category": category
            })
        
        # Create a canonical string for hashing by sorting cards
        canonical_card_list = sorted([f"{c['count']}x{c['name']}{c['set']}{c['number']}" for c in cards])
        deck_hash = hashlib.sha1(json.dumps(canonical_card_list).encode()).hexdigest()

        all_decks.append({
            "id": deck_hash[:10],
            "player": hashlib.sha1(player_name.encode()).hexdigest()[:10] if anonymize else player_name,
            "placement": placement,
            "archetype": container.find('div', class_='decklist-title').text.strip().split('\n')[0].strip(),
            "cards": cards,
            "deckHash": deck_hash
        })
    
    print(f"Extracted and processed {len(all_decks)} decks.")
    return all_decks

# --- REPORT GENERATION ---

def identify_pokemon_variants(all_decks):
    """Identifies Pokémon that have more than one version in the dataset."""
    pokemon_versions = defaultdict(set)
    for deck in all_decks:
        for card in deck["cards"]:
            if card["category"] == "pokemon":
                pokemon_versions[card["name"]].add(f"{card['set']} {card['number']}")
    return {name for name, versions in pokemon_versions.items() if len(versions) > 1}

# Map exact reprint pairs to a canonical (set, number). Keys and values are (set_code, number) strings.
# For pairs provided, map PRE or older code to the modern/main set.
REPRINT_EQUIV = {
    ("PRE", "012"): ("TWM", "025"),  # Teal Mask Ogerpon ex
    ("TWM", "025"): ("TWM", "025"),
    ("PRE", "027"): ("TWM", "064"),  # Wellspring Mask Ogerpon ex
    ("TWM", "064"): ("TWM", "064"),
    ("TWM", "167"): ("TWM", "064"),  # alt numbering reprint maps to 064
    ("PRE", "031"): ("PAR", "072"),  # Iron Hands ex
    ("PAR", "072"): ("PAR", "072"),
    ("PRE", "032"): ("TWM", "077"),  # Iron Thorns ex
    ("TWM", "077"): ("TWM", "077"),
    ("PRE", "035"): ("SFA", "018"),  # Duskull
    ("SFA", "018"): ("SFA", "018"),
    ("PRE", "036"): ("SFA", "019"),  # Dusclops
    ("SFA", "019"): ("SFA", "019"),
    ("PRE", "037"): ("SFA", "020"),  # Dusknoir
    ("SFA", "020"): ("SFA", "020"),
    ("PRE", "041"): ("SSP", "086"),  # Sylveon ex
    ("SSP", "086"): ("SSP", "086"),
    ("PRE", "042"): ("PAR", "086"),  # Scream Tail
    ("PAR", "086"): ("PAR", "086"),
    ("PRE", "043"): ("TEF", "078"),  # Flutter Mane
    ("TEF", "078"): ("TEF", "078"),
    ("PRE", "044"): ("TWM", "095"),  # Munkidori
    ("TWM", "095"): ("TWM", "095"),
    ("PRE", "055"): ("TEF", "097"),  # Great Tusk
    ("TEF", "097"): ("TEF", "097"),
    ("PRE", "057"): ("TWM", "111"),  # Okidogi
    ("TWM", "111"): ("TWM", "111"),
    ("PRE", "058"): ("TWM", "112"),  # Cornerstone Mask Ogerpon ex
    ("TWM", "112"): ("TWM", "112"),
    ("PRE", "065"): ("TEF", "109"),  # Roaring Moon
    ("TEF", "109"): ("TEF", "109"),
    ("PRE", "069"): ("SCR", "106"),  # Duraludon
    ("SCR", "106"): ("SCR", "106"),
    ("PRE", "071"): ("TWM", "128"),  # Dreepy
    ("TWM", "128"): ("TWM", "128"),
    ("PRE", "072"): ("TWM", "129"),  # Drakloak
    ("TWM", "129"): ("TWM", "129"),
    ("PRE", "073"): ("TWM", "130"),  # Dragapult ex
    ("TWM", "130"): ("TWM", "130"),
    ("PRE", "078"): ("SCR", "115"),  # Noctowl
    ("SCR", "115"): ("SCR", "115"),
    ("PRE", "079"): ("TEF", "128"),  # Dunsparce
    ("TEF", "128"): ("TEF", "128"),
    ("PRE", "080"): ("TEF", "129"),  # Dudunsparce
    ("TEF", "129"): ("TEF", "129"),
    ("PRE", "085"): ("SCR", "118"),  # Fan Rotom
    ("SCR", "118"): ("SCR", "118"),
    ("PRE", "092"): ("SCR", "128"),  # Terapagos ex
    ("SCR", "128"): ("SCR", "128"),
}

def canonicalize_variant(set_code: str, number: str):
    sc = (set_code or '').upper().strip()
    num = (number or '').lstrip('0')
    num = num.zfill(3) if num else num
    if not sc or not num:
        return sc, num
    canon = REPRINT_EQUIV.get((sc, num))
    if canon:
        return canon
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

    for deck in deck_list:
        cards_in_this_deck = set()
        # Aggregate total copies per UID (variant) within the deck
        per_deck_counts = defaultdict(int)
        per_deck_seen_meta = {}
        for card in deck["cards"]:
            name = card.get("name", "")
            cat = card.get("category")
            set_code = card.get("set", "")
            number = card.get("number", "")
            if cat == "pokemon":
                sc, num = canonicalize_variant(set_code, number)
                uid = f"{name}::{sc}::{num}" if sc and num else f"{name}::::"
                display = name
                per_deck_counts[uid] += int(card.get('count', 0))
                per_deck_seen_meta[uid] = {"set": sc, "number": num}
            else:
                uid = name
                display = name
                per_deck_counts[uid] += int(card.get('count', 0))
                # trainers/energy: no set/number
        # After scanning deck, record one entry per uid
        for uid, tot in per_deck_counts.items():
            card_data[uid].append(tot)
            if uid not in name_casing:
                # Display is base name (before ::)
                name_casing[uid] = uid.split('::',1)[0] if '::' in uid else uid
            if '::' in uid:
                uid_meta[uid] = per_deck_seen_meta.get(uid, uid_meta.get(uid, {}))
        
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
        # Include variant metadata for Pokémon
        if '::' in uid:
            meta = uid_meta.get(uid) or {}
            card_obj["set"] = meta.get("set")
            card_obj["number"] = meta.get("number")
            card_obj["uid"] = uid
        report_items.append(card_obj)
        
    return {"deckTotal": deck_total, "items": report_items}

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
            if c.get('set') and c.get('number'):
                key = f"{c['set']}_{c['number']}"
            else:
                key = sanitize_for_filename(c.get('name', ''))
            if key not in unique_cards:
                unique_cards[key] = c

    # Build download jobs
    jobs = []
    for card in unique_cards.values():
        name = card.get("name", "")
        set_code = card.get("set", "")
        number = card.get("number", "")
        # Always include set+number for Pokémon when available; Trainers/Energy stay plain
        if card.get("category") == "pokemon" and set_code and number:
            base_filename = f"{sanitize_for_filename(name)}_{set_code}_{number}"
        else:
            base_filename = sanitize_for_filename(name)

        plain_base = sanitize_for_filename(name)
        category = card.get("category", "")

        if base_filename in processed_filenames:
            continue
        processed_filenames.add(base_filename)
        print(f"  - Queueing images for: {name} ({set_code} {number})")

        for size in sizes_to_download:
            padded_number = number.zfill(3) if number else ''
            img_filename = f"{set_code}_{padded_number}_R_EN_{size}.png" if set_code and padded_number else ''
            full_url = f"{base_url}{set_code}/{img_filename}" if img_filename else ''
            file_path = os.path.join(base_path, "thumbnails", size.lower(), f"{base_filename}.png")
            alias_path = os.path.join(base_path, "thumbnails", size.lower(), f"{plain_base}.png")
            jobs.append((name, set_code, number, size, full_url, file_path, alias_path, category))

    def fetch_one(job):
        name, set_code, number, size, full_url, file_path, alias_path, category = job
        ts = datetime.now(timezone.utc).isoformat()
        # Skip if exists and not forcing
        if not force and os.path.exists(file_path):
            # Ensure alias exists for Pokémon thumbnails
            alias_created = False
            if category == 'pokemon':
                try:
                    if not os.path.exists(alias_path):
                        _ensure_parent_dir(alias_path)
                        shutil.copyfile(file_path, alias_path)
                        alias_created = True
                except Exception:
                    pass
            return {
                "timestamp": ts,
                "status": "skip_exists",
                "tournament": tournament_name,
                "name": name,
                "set": set_code,
                "number": number,
                "size": size,
                "url": full_url,
                "file": file_path,
                **({"alias": alias_path, "aliasCreated": True} if alias_created else {})
            }
        if not full_url:
            return {
                "timestamp": ts,
                "status": "no_url",
                "tournament": tournament_name,
                "name": name,
                "set": set_code,
                "number": number,
                "size": size,
                "url": full_url,
                "file": file_path
            }
        try:
            resp = request_with_retries(session, 'GET', full_url, stream=True, timeout=15)
            if resp and resp.status_code == 200:
                with open(file_path, 'wb') as f:
                    f.write(resp.content)
                # After successful download, create plain-name alias for Pokémon if missing
                alias_created = False
                if category == 'pokemon':
                    try:
                        if not os.path.exists(alias_path):
                            _ensure_parent_dir(alias_path)
                            shutil.copyfile(file_path, alias_path)
                            alias_created = True
                    except Exception:
                        pass
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
                    "bytes": len(resp.content),
                    **({"alias": alias_path, "aliasCreated": True} if alias_created else {})
                }
            else:
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
                    "file": file_path
                }
        except requests.exceptions.RequestException as e:
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
                "file": file_path
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
            if category == 'pokemon':
                per_deck_counts[base_key] += int(card.get('count', 0))
                if set_code:
                    sets_map[base_key].add(set_code)
            else:
                # For trainers/energy, just take the count as-is (still summed if repeated entries)
                per_deck_counts[base_key] += int(card.get('count', 0))
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

# --- MAIN WORKFLOW ---

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
    os.makedirs(archetype_report_path, exist_ok=True)

    # Optionally save raw HTML snapshot
    if getattr(args, 'save_raw_html', False) and html_text:
        html_path = os.path.join(base_report_path, "source.html")
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(html_text)

    # Extract and save metadata
    metadata = extract_metadata(soup, norm_url, headers)
    write_json_atomic(os.path.join(base_report_path, "meta.json"), metadata)
    print("Metadata saved to meta.json.")

    # Extract all deck data
    all_decks = extract_all_decklists(soup, args.anonymize)
    if not all_decks:
        print("No decklists found. Exiting.")
        return False
    write_json_atomic(os.path.join(base_report_path, "decks.json"), all_decks)
    print("Raw deck data saved to decks.json.")

    # Generate master report from deck data
    print("Generating master report...")
    master_report = generate_report_json(all_decks, len(all_decks), all_decks)
    write_json_atomic(os.path.join(base_report_path, "master.json"), master_report)
    print("Master report saved.")

    # Generate per-tournament card index
    print("Generating card index...")
    card_index = generate_card_index(all_decks)
    write_json_atomic(os.path.join(base_report_path, "cardIndex.json"), card_index)
    print("Card index saved.")

    # Generate archetype reports
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
    print("Archetype reports saved.")

    # Generate archetype index
    print("Generating archetype index file...")
    write_json_atomic(os.path.join(archetype_report_path, "index.json"), sorted(archetype_index_list))
    print("Archetype index saved.")

    # Update reports/tournaments.json (newest-first list of folder names)
    try:
        tournaments_path = os.path.join("reports", "tournaments.json")
        existing = []
        if os.path.exists(tournaments_path):
            try:
                with open(tournaments_path, 'r', encoding='utf-8') as f:
                    existing = json.load(f)
            except Exception:
                existing = []
        # Remove any prior occurrences and prepend
        existing = [x for x in existing if x != tournament_name]
        updated = [tournament_name] + existing
        # Sort by leading ISO date prefix desc when present
        def _date_key(s):
            try:
                pref = s.split(',', 1)[0].strip()
                return datetime.fromisoformat(pref)
            except Exception:
                return datetime.min
        updated.sort(key=_date_key, reverse=True)
        write_json_atomic(tournaments_path, updated)
        print("tournaments.json updated.")
    except Exception as e:
        print(f"Could not update tournaments.json: {e}")

    # Download thumbnails
    if not args.skip_thumbs:
        missing_thumbs = download_thumbnails(
            all_decks,
            ".",
            session,
            workers=args.thumb_workers,
            download_log_path=getattr(args, 'download_log', None),
            tournament_name=tournament_name,
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

def main(args):
    """Main function to run the entire process or a batch."""
    # Create a session for connection reuse and retries
    session = requests.Session()
    session.headers.update({'User-Agent': 'Mozilla/5.0'})

    # Replay mode: bulk re-download from log and exit
    if getattr(args, 'replay_log', None):
        replay_downloads(args.replay_log, session, workers=args.thumb_workers, force=args.force)
        return

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
                succeeded = process_tournament(session, args, u)
                if succeeded:
                    ok += 1
                else:
                    fail += 1
            except Exception as e:
                fail += 1
                print(f"Error processing {u}: {e}")
        print(f"\nBatch complete. Success: {ok}, Failed: {fail}, Total: {total}")
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

    special_inputs = {
        'limitlesstcg.com/tournaments/500/decklists',
        'limitlesstcg.com/tournaments/500',
        '500',
        'https://limitlesstcg.com/tournaments/500/decklists',
        'https://limitlesstcg.com/tournaments/500'
    }

    if _normalize_input(args.url) in {_normalize_input(s) for s in special_inputs}:
        url = 'https://limitlesstcg.com/tournaments/500/decklists'
    else:
        url = _normalize_url_for_tournament(args.url)

    process_tournament(session, args, url)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape and analyze Pokémon TCG tournament data from LimitlessTCG.")
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
    
    args = parser.parse_args()

    # If no URL was provided on the command line, prompt the user.
    main(args)