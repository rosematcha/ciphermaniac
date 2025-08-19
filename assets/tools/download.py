import os
import re
import json
import requests
from bs4 import BeautifulSoup
from collections import Counter, defaultdict

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

def get_soup(url_or_path):
    """Gets a BeautifulSoup object from a URL or a local file path."""
    if url_or_path.startswith('http'):
        try:
            print(f"Downloading webpage from {url_or_path}...")
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'}
            response = requests.get(url_or_path, headers=headers)
            response.raise_for_status()
            print("Download successful.")
            return BeautifulSoup(response.text, 'html.parser')
        except requests.exceptions.RequestException as e:
            print(f"Error: Could not download the webpage. {e}")
            return None
    else:
        try:
            with open(url_or_path, 'r', encoding='utf-8') as f:
                return BeautifulSoup(f.read(), 'html.parser')
        except FileNotFoundError:
            print(f"Error: Local file not found at {url_or_path}")
            return None

# --- DATA EXTRACTION ---

def extract_all_decklists(soup):
    """Extracts all decklists from the HTML into a list of dictionaries."""
    print("Extracting decklists from HTML...")
    all_decks = []
    deck_containers = soup.find_all('div', class_='tournament-decklist')

    for container in deck_containers:
        deck_info = {
            "player": container.find('div', class_='decklist-toggle').text.strip(),
            "archetype": container.find('div', class_='decklist-title').text.strip().split('\n')[0].strip(),
            "cards": []
        }
        
        cards_container = container.find('div', attrs={'data-text-decklist': True})
        if not cards_container:
            continue

        for card_div in cards_container.find_all('div', class_='decklist-card'):
            card_category_div = card_div.find_parent('div', class_='decklist-column')
            heading_div = card_category_div.find('div', class_='decklist-column-heading')
            if not heading_div: continue
            
            category_text = heading_div.text.strip().lower()
            category = "pokemon" if "pokémon" in category_text else "trainer" if "trainer" in category_text else "energy"

            deck_info["cards"].append({
                "count": int(card_div.find('span', class_='card-count').text.strip()),
                "name": card_div.find('span', class_='card-name').text.strip(),
                "set": card_div['data-set'],
                "number": card_div['data-number'],
                "category": category
            })
        all_decks.append(deck_info)
    
    print(f"Extracted {len(all_decks)} decks.")
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

def generate_report_json(deck_list, deck_total):
    """Generates the JSON structure for a list of decks."""
    pokemon_variants = identify_pokemon_variants(deck_list)
    card_data = defaultdict(list)
    name_casing = {}

    for deck in deck_list:
        cards_in_this_deck = set()
        for card in deck["cards"]:
            name = card["name"]
            
            if card["category"] == "pokemon" and name in pokemon_variants:
                unique_name = f"{name} {card['set']} {card['number']}"
            else:
                unique_name = name

            if unique_name not in name_casing:
                name_casing[unique_name.lower()] = unique_name
            
            cards_in_this_deck.add((unique_name.lower(), card["count"]))
        
        for lname, count in cards_in_this_deck:
            card_data[lname].append(count)

    sorted_card_keys = sorted(card_data.keys(), key=lambda k: len(card_data[k]), reverse=True)
    
    report_items = []
    for rank, lname in enumerate(sorted_card_keys, 1):
        counts_list = card_data[lname]
        found_count = len(counts_list)
        dist_counter = Counter(counts_list)
        
        card_obj = {
            "rank": rank,
            "name": name_casing[lname],
            "found": found_count,
            "total": deck_total,
            "pct": round((found_count / deck_total) * 100, 2),
            "dist": []
        }

        for copies, players in sorted(dist_counter.items()):
            card_obj["dist"].append({
                "copies": copies,
                "players": players,
                "percent": round((players / found_count) * 100, 2)
            })
        report_items.append(card_obj)
        
    return {"deckTotal": deck_total, "items": report_items}

# --- THUMBNAIL DOWNLOADER ---

def download_thumbnails(all_decks, base_path):
    """Downloads XS and SM thumbnails for every unique card."""
    print("Starting thumbnail downloads...")
    pokemon_variants = identify_pokemon_variants(all_decks)
    
    processed_filenames = set()
    base_url = "https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/"
    sizes_to_download = ["XS", "SM"]

    for size in sizes_to_download:
        os.makedirs(os.path.join(base_path, "thumbnails", size.lower()), exist_ok=True)

    for deck in all_decks:
        for card in deck["cards"]:
            name, set_code, number = card["name"], card["set"], card["number"]
            if card["category"] == "pokemon" and name in pokemon_variants:
                base_filename = f"{sanitize_for_filename(name)}_{set_code}_{number}"
            else:
                base_filename = sanitize_for_filename(name)
            if base_filename not in processed_filenames:
                processed_filenames.add(base_filename)
                print(f"  - Downloading images for: {name} ({set_code} {number})")
                for size in sizes_to_download:
                    padded_number = number.zfill(3)
                    img_filename = f"{set_code}_{padded_number}_R_EN_{size}.png"
                    full_url = f"{base_url}{set_code}/{img_filename}"
                    file_path = os.path.join(base_path, "thumbnails", size.lower(), f"{base_filename}.png")
                    # Skip download if file already exists
                    if os.path.exists(file_path):
                        print(f"    - Skipping {size} thumbnail (already exists)")
                        continue
                    try:
                        response = requests.get(full_url, stream=True)
                        if response.status_code == 200:
                            with open(file_path, 'wb') as f:
                                f.write(response.content)
                    except requests.exceptions.RequestException:
                        print(f"    - Could not download size {size}")
    
    print(f"Thumbnail download complete for {len(processed_filenames)} unique cards.")

# --- MAIN WORKFLOW ---

def main(url):
    """Main function to run the entire process."""
    soup = get_soup(url)
    if not soup:
        return

    tournament_name_div = soup.find('div', class_='infobox-heading')
    if not tournament_name_div:
        print("Could not find tournament name on the page. Exiting.")
        return
    tournament_name = sanitize_for_path(tournament_name_div.text.strip())
    
    base_report_path = os.path.join("reports", tournament_name)
    archetype_report_path = os.path.join(base_report_path, "archetypes")
    os.makedirs(archetype_report_path, exist_ok=True)
    
    all_decks = extract_all_decklists(soup)
    if not all_decks:
        print("No decklists found. Exiting.")
        return
        
    print("Generating master report...")
    master_report_data = generate_report_json(all_decks, len(all_decks))
    with open(os.path.join(base_report_path, "master.json"), 'w', encoding='utf-8') as f:
        json.dump(master_report_data, f, indent=2)
    print("Master report saved.")
    
    print("Generating archetype reports...")
    archetype_groups = defaultdict(list)
    archetype_casing = {}
    for deck in all_decks:
        normalized_name = normalize_archetype_name(deck["archetype"])
        archetype_groups[normalized_name].append(deck)
        if normalized_name not in archetype_casing:
            archetype_casing[normalized_name] = deck["archetype"]

    archetype_index_list = []
    for norm_name, deck_list in archetype_groups.items():
        proper_name = archetype_casing[norm_name]
        print(f"  - Analyzing {proper_name} ({len(deck_list)} decks)...")
        archetype_data = generate_report_json(deck_list, len(deck_list))
        
        # Sanitize name for the JSON filename (e.g., "Gardevoir EX" -> "Gardevoir_EX")
        json_filename_base = sanitize_for_filename(proper_name)
        archetype_filename = f"{json_filename_base}.json"
        
        # Add the base name to our index list
        archetype_index_list.append(json_filename_base)
        
        with open(os.path.join(archetype_report_path, archetype_filename), 'w', encoding='utf-8') as f:
            json.dump(archetype_data, f, indent=2)
    print("Archetype reports saved.")

    # Create and save the index.json file
    print("Generating archetype index file...")
    index_file_path = os.path.join(archetype_report_path, "index.json")
    with open(index_file_path, 'w', encoding='utf-8') as f:
        json.dump(sorted(archetype_index_list), f, indent=2) # Sort the list for consistency
    print("Archetype index saved.")

    download_thumbnails(all_decks, ".")
    
    print("\nProcess complete!")
    print(f"Reports saved in: {base_report_path}")
    print("Thumbnails saved in: thumbnails/")

if __name__ == "__main__":
    url_input = input("Enter the Limitless TCG tournament URL: ").strip()

    if url_input and not url_input.endswith('/decklists'):
        if not url_input.endswith('/'):
            url_input += '/'
        url_input += 'decklists'
    
    if url_input:
        main(url_input)
    else:
        print("No URL entered. Exiting.")