"""
Proof-of-concept: Content-based deduplication for include/exclude reports

This module shows how to modify generate_include_exclude_reports() to eliminate
duplicate JSON files that represent the same deck subset.

USAGE:
    Replace the generate_include_exclude_reports function in download.py with
    the version below, or integrate the deduplication logic into your existing code.
"""

import os
import json
import hashlib
import shutil
from datetime import datetime, timezone
from collections import defaultdict
from itertools import product


def write_json_atomic(path, data):
    """Atomically write JSON to path with UTF-8 encoding."""
    dirpath = os.path.dirname(path)
    if dirpath and not os.path.exists(dirpath):
        os.makedirs(dirpath, exist_ok=True)

    import tempfile
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


def generate_include_exclude_reports_deduplicated(
    archetype_label, archetype_base, deck_list, archetype_data, output_root
):
    """
    Generate include/exclude analysis JSON files for an archetype with deduplication.

    This version generates all combinations as before, but then deduplicates by content
    hash, keeping only unique deck subsets.
    """

    deck_total = len(deck_list)
    if deck_total < 4:
        print(f"    - Skipping include/exclude analysis for {archetype_label}: only {deck_total} decks available.")
        if os.path.exists(output_root):
            try:
                shutil.rmtree(output_root)
            except Exception:
                pass
        return

    os.makedirs(output_root, exist_ok=True)

    # Extract candidate cards (non-always-included)
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

        info = {
            "id": card_id,
            "name": item.get("name"),
            "set": (set_code or "").upper().strip() or None,
            "number": _normalize_card_number(number),
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

    # Build deck presence index
    deck_by_id = {}
    card_presence = defaultdict(set)
    all_deck_ids = set()

    for deck in deck_list:
        deck_id = deck.get("deckHash") or deck.get("id") or deck.get("player")
        if not deck_id:
            deck_id = hashlib.sha1(json.dumps(deck, sort_keys=True).encode()).hexdigest()
        deck_by_id[deck_id] = deck
        all_deck_ids.add(deck_id)

        seen_cards = set()
        for card in deck.get("cards", []):
            card_id = _build_card_identifier(card.get("set"), card.get("number"))
            if not card_id or card_id in seen_cards:
                continue
            seen_cards.add(card_id)
            card_presence[card_id].add(deck_id)

    def build_subset(include_ids, exclude_ids):
        """Build a deck subset report for given filters."""
        include_ids = tuple(sorted(include_ids))
        exclude_ids = tuple(sorted(exclude_ids))

        if include_ids:
            candidate_sets = [set(card_presence.get(cid, set())) for cid in include_ids]
            if not all(candidate_sets):
                return None, set()
            eligible = set.intersection(*candidate_sets) if candidate_sets else set(deck_by_id.keys())
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
            "include": [_serialize_filter_card(card_lookup.get(cid)) for cid in include_ids if card_lookup.get(cid)],
            "exclude": [_serialize_filter_card(card_lookup.get(cid)) for cid in exclude_ids if card_lookup.get(cid)],
            "baseDeckTotal": deck_total
        }
        report["source"] = {
            "archetype": archetype_label,
            "generatedAt": datetime.now(timezone.utc).isoformat()
        }
        return report, eligible

    print(f"    - Building include/exclude reports for {archetype_label} ({len(candidate_cards)} variable cards)")

    # PHASE 1: Generate all combinations
    all_reports = {}  # filename -> (report, include_ids, exclude_ids)

    # Single includes
    for card in candidate_cards:
        include_ids = (card["id"],)
        exclude_ids = ()
        report, deck_ids = build_subset(include_ids, exclude_ids)
        if report and deck_ids:
            include_label = "+".join(include_ids)
            exclude_label = "null"
            filename = f"{archetype_base}_{include_label}_{exclude_label}.json"
            all_reports[filename] = (report, include_ids, exclude_ids, deck_ids)

    # Single excludes
    for card in candidate_cards:
        include_ids = ()
        exclude_ids = (card["id"],)
        report, deck_ids = build_subset(include_ids, exclude_ids)
        if report and deck_ids and deck_ids != all_deck_ids:
            include_label = "null"
            exclude_label = "+".join(exclude_ids)
            filename = f"{archetype_base}_{include_label}_{exclude_label}.json"
            all_reports[filename] = (report, include_ids, exclude_ids, deck_ids)

    # Cross include-exclude combinations
    for include_card, exclude_card in product(candidate_cards, repeat=2):
        if include_card["id"] == exclude_card["id"]:
            continue

        include_ids = (include_card["id"],)
        exclude_ids = (exclude_card["id"],)
        report, deck_ids = build_subset(include_ids, exclude_ids)
        if report and deck_ids:
            include_label = "+".join(include_ids)
            exclude_label = "+".join(exclude_ids)
            filename = f"{archetype_base}_{include_label}_{exclude_label}.json"
            all_reports[filename] = (report, include_ids, exclude_ids, deck_ids)

    # PHASE 2: Deduplicate by content hash
    unique_subsets = {}  # content_hash -> (report, primary_filename, [all_filenames])

    for filename, (report, inc_ids, exc_ids, deck_ids) in all_reports.items():
        # Hash the items array (actual deck data)
        items_str = json.dumps(report.get("items", []), sort_keys=True)
        content_hash = hashlib.sha256(items_str.encode()).hexdigest()

        if content_hash not in unique_subsets:
            # First occurrence - this becomes the primary
            unique_subsets[content_hash] = (report, filename, [filename])
        else:
            # Duplicate - add to list of alternate filenames
            unique_subsets[content_hash][2].append(filename)

    # PHASE 3: Write only unique subsets
    written_files = set()
    summaries = []

    duplicates_dropped = len(all_reports) - len(unique_subsets)

    for content_hash, (report, primary_filename, all_filenames) in unique_subsets.items():
        path = os.path.join(output_root, primary_filename)

        # Optionally: Store alternate filter combinations in metadata
        if len(all_filenames) > 1:
            report["_duplicateFilters"] = {
                "note": f"This deck subset can also be accessed via {len(all_filenames)-1} other filter combinations",
                "alternateFiles": all_filenames[1:]  # Don't include the primary
            }

        write_json_atomic(path, report)
        written_files.add(primary_filename)

        summaries.append({
            "include": list(report["filters"]["include"]),
            "exclude": list(report["filters"]["exclude"]),
            "deckTotal": report["deckTotal"],
            "file": primary_filename
        })

    print(f"      • Saved {len(unique_subsets)} unique subsets (dropped {duplicates_dropped} duplicates, {duplicates_dropped/len(all_reports)*100:.1f}% reduction)")

    # Write index
    index_payload = {
        "archetype": archetype_label,
        "deckTotal": deck_total,
        "cards": cards_summary,
        "combinations": summaries,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "_deduplication": {
            "totalCombinationsGenerated": len(all_reports),
            "uniqueSubsets": len(unique_subsets),
            "duplicatesDropped": duplicates_dropped,
            "reductionPercentage": round(duplicates_dropped / len(all_reports) * 100, 2)
        }
    }

    index_path = os.path.join(output_root, "index.json")
    write_json_atomic(index_path, index_payload)
    written_files.add("index.json")

    # Clean up stale files
    try:
        existing_files = {name for name in os.listdir(output_root) if name.endswith('.json')}
        stale_files = existing_files - written_files
        for filename in stale_files:
            try:
                os.remove(os.path.join(output_root, filename))
            except Exception:
                pass
    except FileNotFoundError:
        pass


# Helper functions (copy from download.py)
def _normalize_card_number(value):
    """Normalize card numbers to a consistent three-digit format with optional suffix."""
    if value is None:
        return ""
    raw = str(value).strip()
    if not raw:
        return ""
    import re
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


def generate_report_json(deck_list, deck_total, all_decks_for_variants):
    """
    Placeholder - use the actual implementation from download.py
    This function generates the card statistics report for a deck list.
    """
    # Import from download.py or copy the implementation
    from download import generate_report_json as _gen
    return _gen(deck_list, deck_total, all_decks_for_variants)


if __name__ == "__main__":
    print("This is a proof-of-concept module.")
    print("To use: Replace generate_include_exclude_reports() in download.py")
    print("with generate_include_exclude_reports_deduplicated() from this file.")
