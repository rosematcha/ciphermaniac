#!/usr/bin/env python3
"""Backfill per-event-date print prices from TCGCSV's daily price archives.

Rolling-canonical selection needs to know, for each tournament date, what every
*print* of a card would have cost on that day — so it can choose the print a
player would actually have bought at that event. The daily pricing job only ever
records the current canonical's price, and only for cards in the live meta, so it
can't answer "what did print X cost on 2025-05-17".

This job fills that gap. For each distinct event date in the dataset it writes one
R2 artifact — ``assets/print-prices/{YYYY-MM-DD}.json`` — mapping every print UID
(``Name::SET::NUMBER``) in the synonyms clusters to its TCGplayer market price on
that date, sourced from TCGCSV's archived daily prices
(https://tcgcsv.com/archive/...).

Why the products come from the *live* endpoints and the prices from the archive:
the archives contain only ``prices`` files, no product catalogs. TCGplayer product
IDs are stable, so the current products→UID mapping holds across the whole window
(the sibling backfill-price-history.py already relies on this).

Requires a 7z binary (7zz/7z/7za) for the PPMd archives.

Usage:
  R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
  python3 .github/scripts/backfill-print-prices.py \
      [--dates 2025-09-13,2025-05-17] [--synonyms path.json] \
      [--force] [--dry-run] [--cache-dir DIR]
"""

import argparse
import importlib.util
import json
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent

# Reuse update-prices' pure joining functions (product parsing, UID mapping,
# market-price selection) rather than re-deriving them here — they encode the
# variant-preference rules the whole pipeline depends on.
_up_path = _SCRIPTS_DIR / "update-prices.py"
_spec = importlib.util.spec_from_file_location("update_prices", _up_path)
up = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(up)

# Shared R2 helpers (retrying client + typed reads). lib/ is underscore-free so
# ``import r2`` works regardless of the caller's cwd.
sys.path.insert(0, str(_SCRIPTS_DIR / "lib"))
import r2  # noqa: E402

ARCHIVE_URL = "https://tcgcsv.com/archive/tcgplayer/prices-{date}.ppmd.7z"
GROUPS_URL = "https://tcgcsv.com/tcgplayer/3/groups"
TOURNAMENTS_KEY = "reports/tournaments.json"
CARD_SYNONYMS_KEY = "assets/card-synonyms.json"
SET_CATALOG_PATH = _SCRIPTS_DIR / "data" / "set-catalog.json"

# TCGCSV's oldest daily archive. Older event dates simply have no source data;
# warn and skip rather than hammering the origin for 404s.
ARCHIVE_FLOOR = "2024-02-08"

PRINT_PRICES_PREFIX = "assets/print-prices/"
# Match the other R2 writers so the edge caches these the same 6 hours.
PRINT_PRICES_CACHE_CONTROL = "public, max-age=21600"
SCHEMA_VERSION = 1

# Sets whose TCGCSV group can't be reached by abbreviation or by catalog-name
# match. SWSH promos: abbreviation is "SWSD" (not our "SP") and the group name is
# "SWSH: Sword & Shield Promo Cards" while the catalog calls it "Sword & Shield
# Promos" — neither key lines up, so pin it explicitly. update-prices'
# MANUAL_GROUP_ID_MAP ({'MEP', 'SVP'}) is merged in on top of this.
LOCAL_MANUAL_GROUP_ID_MAP = {
    "SP": 2545,
}


def find_7z():
    """Locate a 7z binary capable of the PPMd archives, or exit loudly."""
    for name in ("7zz", "7z", "7za"):
        if shutil.which(name):
            return name
    print("Error: no 7z binary found (need 7zz, 7z, or 7za for PPMd archives)")
    sys.exit(1)


# --------------------------------------------------------------------------- #
# Pure helpers (unit-tested; no network, no credentials).
# --------------------------------------------------------------------------- #

def extract_event_dates(tournaments_data, floor=ARCHIVE_FLOOR):
    """Return sorted distinct ``YYYY-MM-DD`` dates on/after ``floor``.

    ``tournaments.json`` is either a bare list or ``{"tournaments": [...]}``, and
    each entry is either a string like ``"2025-09-13, Regional Championship
    Monterrey"`` or a dict carrying ``folder``/``name``/``path`` in that same
    ``"<date>, <name>"`` shape (mirrors load_event_folders in reprocess /
    update-card-synonyms). Undated or malformed entries are skipped, not fatal.

    Returns ``(dates, skipped_old)`` so the caller can warn about pre-archive
    dates it dropped.
    """
    if isinstance(tournaments_data, list):
        entries = tournaments_data
    elif isinstance(tournaments_data, dict):
        entries = tournaments_data.get("tournaments", [])
    else:
        entries = []

    dates = set()
    skipped_old = set()
    for entry in entries:
        if isinstance(entry, str):
            label = entry
        elif isinstance(entry, dict):
            label = entry.get("folder") or entry.get("name") or entry.get("path") or ""
        else:
            continue

        day = _leading_date(label)
        if not day:
            continue
        if day < floor:
            skipped_old.add(day)
            continue
        dates.add(day)

    return sorted(dates), sorted(skipped_old)


def _leading_date(label):
    """Extract a leading ``YYYY-MM-DD`` from a label, or None.

    Validates via ``date.fromisoformat`` so a stray digit run can't pass as a
    date.
    """
    if not isinstance(label, str):
        return None
    head = label.strip()[:10]
    try:
        datetime.strptime(head, "%Y-%m-%d")
    except ValueError:
        return None
    return head


def build_uid_universe(synonyms_data):
    """Every print UID across every synonyms cluster, canonical included.

    Universe = keys of ``synonyms`` (the alias prints) + values of ``synonyms``
    (their canonicals) + values of ``canonicals`` (base-name → canonical). That
    is exactly the set of prints rolling-canonical selection might choose, so
    those are the prints we must price.
    """
    universe = set()
    synonyms = synonyms_data.get("synonyms", {}) if isinstance(synonyms_data, dict) else {}
    canonicals = synonyms_data.get("canonicals", {}) if isinstance(synonyms_data, dict) else {}

    for alias_uid, canonical_uid in synonyms.items():
        if alias_uid:
            universe.add(alias_uid)
        if canonical_uid:
            universe.add(canonical_uid)
    for canonical_uid in canonicals.values():
        if canonical_uid:
            universe.add(canonical_uid)

    return universe


def group_uids_by_set(uids):
    """Group print UIDs by their set code (middle ``::`` segment)."""
    by_set = {}
    for uid in uids:
        parts = uid.split("::")
        if len(parts) >= 3 and parts[1]:
            by_set.setdefault(parts[1], []).append(uid)
    return by_set


def build_catalog_name_index(catalog):
    """Map lowercased set *name* → set code from the local set catalog.

    Used for the name-based group fallback: TCGCSV group names look like
    ``"SWSH09: Brilliant Stars"``, so matching the portion after ``": "`` against
    catalog names resolves the group when abbreviations don't line up.
    """
    index = {}
    for entry in catalog.get("sets", []):
        name = (entry.get("name") or "").strip().lower()
        code = entry.get("code")
        if name and code:
            # First writer wins so newest-first catalog order is respected on the
            # (rare) chance two sets share a display name.
            index.setdefault(name, code)
    return index


def _group_name_tail(name):
    """The comparable tail of a TCGCSV group name.

    ``"SWSH09: Brilliant Stars"`` → ``"brilliant stars"``; a bare
    ``"Brilliant Stars"`` → ``"brilliant stars"``.
    """
    if not name:
        return ""
    tail = name.split(": ", 1)[1] if ": " in name else name
    return tail.strip().lower()


def map_sets_to_group_ids(set_codes, groups, catalog_name_index, manual_map):
    """Resolve set codes to TCGCSV group IDs.

    Resolution order per set: abbreviation match → manual map → catalog-name
    match against the group name tail. Returns ``(mappings, unmapped)`` where
    ``unmapped`` is the sorted list of set codes with no group so the caller can
    log them loudly. Never fails the run for an unmapped set — a missing set just
    yields no prices for its prints.
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


def assemble_artifact(date_str, prices_by_uid, now=None):
    """Build the compact print-price artifact for one date.

    Prices are rounded to whole cents to match the rest of the pipeline.
    """
    generated = (now or datetime.now(timezone.utc)).isoformat()
    prices = {uid: round(float(price), 2) for uid, price in prices_by_uid.items()}
    return {
        "schemaVersion": SCHEMA_VERSION,
        "date": date_str,
        "generated": generated,
        "source": "tcgcsv.com archive",
        "prices": prices,
    }


def build_date_prices(group_products, prices_by_group):
    """Join one day's archived prices against the cached product→UID maps.

    ``group_products`` is ``{gid: (products, set_code, card_uids)}``;
    ``prices_by_group`` is ``{gid: [price records]}`` from the archive. Reuses
    update-prices' extract_set_prices so the variant-preference selection is
    identical to the live job. Returns ``{uid: price}``.
    """
    day_prices = {}
    for gid, (products, set_code, card_uids) in group_products.items():
        records = prices_by_group.get(gid)
        if not records:
            continue
        extracted = up.extract_set_prices(products, records, set_code, card_uids)
        for uid, entry in extracted.items():
            day_prices[uid] = entry["price"]
    return day_prices


# --------------------------------------------------------------------------- #
# I/O helpers.
# --------------------------------------------------------------------------- #

def download_archive(date_str, cache_dir):
    """Download one day's price archive; returns path or None if unavailable.

    Retries transient network failures with backoff and writes atomically via a
    temp file so a killed download never leaves a truncated .7z behind. A 404
    (no archive for that day) returns None rather than raising.
    """
    import requests
    path = cache_dir / f"prices-{date_str}.ppmd.7z"
    if path.exists():
        return path
    url = ARCHIVE_URL.format(date=date_str)

    last_error = None
    for attempt in range(1, 6):
        try:
            response = requests.get(
                url, timeout=120, headers={"User-Agent": up.TCGCSV_USER_AGENT}
            )
            if response.status_code == 404:
                return None
            response.raise_for_status()
            tmp = path.with_suffix(path.suffix + ".part")
            tmp.write_bytes(response.content)
            tmp.replace(path)
            return path
        except requests.RequestException as error:
            last_error = error
            print(f"    download {date_str} attempt {attempt} failed: {error}", flush=True)
            time.sleep(min(2 ** attempt, 30))
    raise RuntimeError(f"Failed to download {date_str} after retries: {last_error}")


def extract_group_prices(seven_zip, archive_path, date_str, group_ids, cache_dir):
    """Extract the needed group price files; returns {group_id: [price records]}."""
    out_dir = cache_dir / "extracted"
    include_paths = [f"{date_str}/3/{gid}/prices" for gid in group_ids]
    subprocess.run(
        [seven_zip, "x", "-y", str(archive_path), f"-o{out_dir}", *include_paths],
        check=True, capture_output=True
    )
    prices_by_group = {}
    for gid in group_ids:
        prices_file = out_dir / date_str / "3" / str(gid) / "prices"
        if not prices_file.exists():
            continue
        data = json.loads(prices_file.read_text())
        if data.get("success"):
            prices_by_group[gid] = data.get("results", [])
    return prices_by_group


def load_synonyms(r2_client, bucket, local_path):
    """Load the synonyms DB from a local override or from R2.

    A transport failure or corrupt payload aborts the run: silently continuing on
    an empty universe would write empty price artifacts over good ones (P-06).
    """
    if local_path:
        print(f"Loading synonyms from {local_path}...")
        data = json.loads(Path(local_path).read_text())
        print(f"  {len(data.get('synonyms', {}))} synonyms, "
              f"{len(data.get('canonicals', {}))} canonicals")
        return data

    print(f"Loading synonyms from R2 ({CARD_SYNONYMS_KEY})...")
    result = r2.read_json(r2_client, bucket, CARD_SYNONYMS_KEY)
    if result.status != "found":
        print(f"Error: could not load synonyms ({result.status}): {result.error}")
        sys.exit(1)
    data = result.value if isinstance(result.value, dict) else {}
    print(f"  {len(data.get('synonyms', {}))} synonyms, "
          f"{len(data.get('canonicals', {}))} canonicals")
    return data


def load_tournaments(r2_client, bucket):
    """Load reports/tournaments.json from R2; abort on any non-found read."""
    print(f"Loading event dates from R2 ({TOURNAMENTS_KEY})...")
    result = r2.read_json(r2_client, bucket, TOURNAMENTS_KEY)
    if result.status != "found":
        print(f"Error: could not load tournaments ({result.status}): {result.error}")
        sys.exit(1)
    return result.value


def upload_artifact(r2_client, bucket, date_str, artifact):
    """Upload one date's print-price artifact to R2 (compact JSON)."""
    key = f"{PRINT_PRICES_PREFIX}{date_str}.json"
    r2_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(artifact, separators=(",", ":")),
        ContentType="application/json",
        CacheControl=PRINT_PRICES_CACHE_CONTROL,
    )


# --------------------------------------------------------------------------- #
# Orchestration.
# --------------------------------------------------------------------------- #

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dates",
        help="Comma-separated YYYY-MM-DD dates to backfill instead of every event date.",
    )
    parser.add_argument(
        "--synonyms",
        help="Local card-synonyms.json path (overrides the R2 copy).",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-write artifacts even if they already exist in R2.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Write artifacts to <cache-dir>/print-prices/ locally; upload nothing.",
    )
    parser.add_argument("--cache-dir", default=".price-archives")
    args = parser.parse_args()

    seven_zip = find_7z()
    cache_dir = Path(args.cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    r2_client = up.initialize_r2_client()
    bucket = up.os.environ.get("R2_BUCKET_NAME", "ciphermaniac-reports")

    # 1. Print-UID universe → per-set groups.
    synonyms_data = load_synonyms(r2_client, bucket, args.synonyms)
    universe = build_uid_universe(synonyms_data)
    uids_by_set = group_uids_by_set(universe)
    print(f"Print-UID universe: {len(universe)} prints across {len(uids_by_set)} sets")

    # 2. Set → TCGCSV group ID (abbreviation → manual → catalog-name fallback).
    catalog = json.loads(SET_CATALOG_PATH.read_text())
    catalog_name_index = build_catalog_name_index(catalog)
    print("\nFetching TCGCSV groups...")
    groups = up.fetch_tcgcsv_results(GROUPS_URL)
    manual_map = {**LOCAL_MANUAL_GROUP_ID_MAP, **up.MANUAL_GROUP_ID_MAP}
    set_mappings, unmapped = map_sets_to_group_ids(
        uids_by_set.keys(), groups, catalog_name_index, manual_map
    )
    if unmapped:
        print(f"\n!! {len(unmapped)} sets have no TCGCSV group — their prints will be "
              f"UNPRICED:")
        for set_code in unmapped:
            print(f"     {set_code}: {len(uids_by_set[set_code])} prints")

    # 3. Fetch each mapped group's live product catalog ONCE.
    print("\nFetching product catalogs (once per group)...")
    group_products = {}
    for set_code, card_uids in uids_by_set.items():
        gid = set_mappings.get(set_code)
        if not gid:
            continue
        products = up.fetch_tcgcsv_results(f"https://tcgcsv.com/tcgplayer/3/{gid}/products")
        group_products[gid] = (products, set_code, card_uids)
        print(f"  {set_code} (group {gid}): {len(products)} products")
        time.sleep(0.25)  # per TCGCSV FAQ etiquette

    # 4. Which dates?
    if args.dates:
        dates = sorted({d.strip() for d in args.dates.split(",") if d.strip()})
        old = [d for d in dates if d < ARCHIVE_FLOOR]
        if old:
            print(f"\nWarning: skipping {len(old)} dates before archive floor "
                  f"{ARCHIVE_FLOOR}: {old}")
        dates = [d for d in dates if d >= ARCHIVE_FLOOR]
    else:
        tournaments_data = load_tournaments(r2_client, bucket)
        dates, skipped_old = extract_event_dates(tournaments_data)
        if skipped_old:
            print(f"Warning: {len(skipped_old)} event dates before archive floor "
                  f"{ARCHIVE_FLOOR} skipped: {skipped_old}")
    print(f"\nBackfilling {len(dates)} dates...")

    dry_out_dir = cache_dir / "print-prices"
    if args.dry_run:
        dry_out_dir.mkdir(parents=True, exist_ok=True)

    written = 0
    skipped_existing = 0
    missing_archive = []
    for date_str in dates:
        key = f"{PRINT_PRICES_PREFIX}{date_str}.json"
        if not args.force and not args.dry_run and r2.object_exists(r2_client, bucket, key):
            skipped_existing += 1
            print(f"  {date_str}: exists, skipping (use --force to overwrite)")
            continue

        archive_path = download_archive(date_str, cache_dir)
        if archive_path is None:
            missing_archive.append(date_str)
            print(f"  {date_str}: no archive available, skipping")
            continue

        prices_by_group = extract_group_prices(
            seven_zip, archive_path, date_str, group_products.keys(), cache_dir
        )
        day_prices = build_date_prices(group_products, prices_by_group)
        artifact = assemble_artifact(date_str, day_prices)

        if args.dry_run:
            out_path = dry_out_dir / f"{date_str}.json"
            out_path.write_text(json.dumps(artifact, separators=(",", ":")))
            print(f"  {date_str}: {len(day_prices)} prints priced -> {out_path} (dry-run)")
        else:
            upload_artifact(r2_client, bucket, date_str, artifact)
            print(f"  {date_str}: {len(day_prices)} prints priced -> R2 {key}")
        written += 1

    print("\n" + "=" * 60)
    print(f"Done. Wrote {written}, skipped {skipped_existing} existing.")
    if missing_archive:
        print(f"No archive for {len(missing_archive)} dates: {missing_archive}")
    if unmapped:
        print(f"Unmapped sets (unpriced prints): {unmapped}")


if __name__ == "__main__":
    main()
