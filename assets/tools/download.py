import os
import re
import json
import hashlib
import requests
import argparse
import tempfile
import time
from datetime import datetime, timezone
from bs4 import BeautifulSoup
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import sys

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

# --- DATA EXTRACTION ---

def extract_metadata(soup, url, headers):
    """Extracts tournament metadata from the page. Defensive about missing nodes."""
    if not soup:
        return {}

    infobox = soup.find('div', class_='infobox')
    name = None
    date_val = None
    fmt = None
    players = None

    if infobox:
        heading = infobox.find('div', class_='infobox-heading')
        if heading and heading.text:
            name = heading.text.strip()

        line = infobox.find('div', class_='infobox-line')
        if line and line.text:
            date_line = line.text.strip()
            parts = [p.strip() for p in date_line.split('•')]
            if parts:
                date_val = parts[0]
            if len(parts) > 1:
                fmt = parts[-1]
            m = re.search(r"(\d+)\s+Players", date_line)
            if m:
                try:
                    players = int(m.group(1))
                except Exception:
                    players = None

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
        "reportVersion": "2.0"
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

def generate_report_json(deck_list, deck_total, all_decks_for_variants):
    """Generates the JSON structure for a list of decks."""
    pokemon_variants = identify_pokemon_variants(all_decks_for_variants)
    card_data = defaultdict(list)
    name_casing = {}

    for deck in deck_list:
        cards_in_this_deck = set()
        for card in deck["cards"]:
            name = card["name"]
            unique_name = f"{name} {card['set']} {card['number']}" if card["category"] == "pokemon" and name in pokemon_variants else name
            if unique_name.lower() not in name_casing: name_casing[unique_name.lower()] = unique_name
            cards_in_this_deck.add((unique_name.lower(), card["count"]))
        
        for lname, count in cards_in_this_deck:
            card_data[lname].append(count)

    sorted_card_keys = sorted(card_data.keys(), key=lambda k: len(card_data[k]), reverse=True)
    
    report_items = []
    for rank, lname in enumerate(sorted_card_keys, 1):
        counts_list, found_count = card_data[lname], len(card_data[lname])
        dist_counter = Counter(counts_list)
        
        card_obj = {
            "rank": rank, "name": name_casing[lname], "found": found_count,
            "total": deck_total, "pct": round((found_count / deck_total) * 100, 2),
            "dist": [{"copies": c, "players": p, "percent": round((p / found_count) * 100, 2)} for c, p in sorted(dist_counter.items())]
        }
        report_items.append(card_obj)
        
    return {"deckTotal": deck_total, "items": report_items}

# --- THUMBNAIL DOWNLOADER ---

def download_thumbnails(all_decks, base_path, session, workers=1):
    """Downloads XS and SM thumbnails for every unique card using session. Returns missing thumbnails list.

    workers > 1 enables simple parallel downloads.
    """
    print("Starting thumbnail downloads...")
    pokemon_variants = identify_pokemon_variants(all_decks)

    processed_filenames, missing_thumbs = set(), []
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
        base_filename = f"{sanitize_for_filename(name)}_{set_code}_{number}" if card.get("category") == "pokemon" and name in pokemon_variants and set_code and number else sanitize_for_filename(name)

        if base_filename in processed_filenames:
            continue
        processed_filenames.add(base_filename)
        print(f"  - Queueing images for: {name} ({set_code} {number})")

        for size in sizes_to_download:
            padded_number = number.zfill(3) if number else ''
            img_filename = f"{set_code}_{padded_number}_R_EN_{size}.png" if set_code and padded_number else ''
            full_url = f"{base_url}{set_code}/{img_filename}" if img_filename else ''
            file_path = os.path.join(base_path, "thumbnails", size.lower(), f"{base_filename}.png")
            jobs.append((name, set_code, number, size, full_url, file_path))

    def fetch_one(job):
        name, set_code, number, size, full_url, file_path = job
        if not full_url:
            return {"name": name, "set": set_code, "number": number, "size": size, "url_tried": full_url}
        try:
            resp = request_with_retries(session, 'GET', full_url, stream=True, timeout=15)
            if resp and resp.status_code == 200:
                with open(file_path, 'wb') as f:
                    f.write(resp.content)
                return None
            else:
                return {"name": name, "set": set_code, "number": number, "size": size, "url_tried": full_url}
        except requests.exceptions.RequestException:
            return {"name": name, "set": set_code, "number": number, "size": size, "url_tried": full_url}

    if workers and workers > 1 and len(jobs) > 1:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(fetch_one, j) for j in jobs]
            for fut in as_completed(futures):
                miss = fut.result()
                if miss:
                    print(f"    - Could not download size {miss['size']} for {miss['name']}")
                    missing_thumbs.append(miss)
    else:
        for j in jobs:
            miss = fetch_one(j)
            if miss:
                print(f"    - Could not download size {miss['size']} for {miss['name']}")
                missing_thumbs.append(miss)

    print(f"Thumbnail download complete for {len(processed_filenames)} unique cards.")
    return missing_thumbs


def generate_card_index(all_decks):
    """Builds a per-card index similar to master report, keyed by resolved card name."""
    deck_total = len(all_decks)
    pokemon_variants = identify_pokemon_variants(all_decks)
    card_data = defaultdict(list)  # name -> counts list
    sets_map = defaultdict(set)    # name -> set codes observed
    name_casing = {}

    for deck in all_decks:
        seen = set()
        for card in deck.get('cards', []):
            name = card.get('name', '')
            set_code = card.get('set', '')
            number = card.get('number', '')
            unique_name = f"{name} {set_code} {number}" if card.get('category') == 'pokemon' and name in pokemon_variants else name
            lname = unique_name.lower()
            if lname not in name_casing:
                name_casing[lname] = unique_name
            # Only count once per deck for distribution of copies
            tup = (lname, card.get('count', 0))
            if tup not in seen:
                card_data[lname].append(card.get('count', 0))
                seen.add(tup)
            if set_code:
                sets_map[lname].add(set_code)

    index = {}
    for lname, counts in card_data.items():
        found = len(counts)
        dist_counter = Counter(counts)
        index[name_casing[lname]] = {
            "found": found,
            "total": deck_total,
            "pct": round((found / deck_total) * 100, 2) if deck_total else 0.0,
            "dist": [{"copies": c, "players": p, "percent": round((p / found) * 100, 2) if found else 0.0} for c, p in sorted(dist_counter.items())],
            "sets": sorted(list(sets_map[lname])) if sets_map[lname] else []
        }

    return {"deckTotal": deck_total, "cards": index}

# --- MAIN WORKFLOW ---

def main(args):
    """Main function to run the entire process."""
    # Create a session for connection reuse and retries
    session = requests.Session()
    session.headers.update({'User-Agent': 'Mozilla/5.0'})

    soup, headers, html_text = get_soup(args.url, session)
    if not soup: return

    tournament_name = sanitize_for_path(soup.find('div', class_='infobox-heading').text.strip())
    
    base_report_path = os.path.join("reports", tournament_name)
    archetype_report_path = os.path.join(base_report_path, "archetypes")
    os.makedirs(archetype_report_path, exist_ok=True)

    # Optionally save raw HTML snapshot
    if getattr(args, 'save_raw_html', False) and html_text:
        html_path = os.path.join(base_report_path, "source.html")
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(html_text)
    
    # Extract and save metadata
    metadata = extract_metadata(soup, args.url, headers)
    # write JSON files atomically with utf-8 encoding
    def write_json_atomic(path, data):
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

    write_json_atomic(os.path.join(base_report_path, "meta.json"), metadata)
    print("Metadata saved to meta.json.")

    # Extract all deck data
    all_decks = extract_all_decklists(soup, args.anonymize)
    if not all_decks: print("No decklists found. Exiting."); return
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
        if norm_name not in archetype_casing: archetype_casing[norm_name] = deck["archetype"]

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

    # Download thumbnails
    if not args.skip_thumbs:
        missing_thumbs = download_thumbnails(all_decks, ".", session, workers=args.thumb_workers)
        if missing_thumbs:
            with open(os.path.join(base_report_path, "missingThumbs.json"), 'w') as f: json.dump(missing_thumbs, f, indent=2)
            print("Missing thumbnails report saved.")
    
    print("\nProcess complete!")
    print(f"All reports saved in: {base_report_path}")
    if not args.skip_thumbs: print("Thumbnails saved in: thumbnails/")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape and analyze Pokémon TCG tournament data from LimitlessTCG.")
    # Make the URL positional optional; if missing we'll prompt the user interactively.
    parser.add_argument("url", nargs='?', help="The URL or identifier of the Limitless TCG tournament (if omitted you'll be prompted).")
    parser.add_argument("--anonymize", action="store_true", help="Anonymize player names using a hash.")
    parser.add_argument("--skip-thumbs", action="store_true", help="Skip downloading card thumbnails.")
    parser.add_argument("--thumb-workers", type=int, default=4, help="Parallel workers for thumbnail downloads (default 4). Use 1 to disable parallelism.")
    parser.add_argument("--save-raw-html", action="store_true", help="Save raw HTML snapshot to source.html in the tournament folder.")
    
    args = parser.parse_args()

    # If no URL was provided on the command line, prompt the user.
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

    # Normalize simple inputs and map certain inputs to the known tournament URL.
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
        args.url = 'https://limitlesstcg.com/tournaments/500/decklists'
    else:
        # If the user didn't include a scheme, assume https, and ensure /decklists suffix.
        if not args.url.startswith('http://') and not args.url.startswith('https://'):
            args.url = 'https://' + args.url
        if not args.url.endswith('/decklists'):
            args.url = args.url.rstrip('/') + '/decklists'

    main(args)