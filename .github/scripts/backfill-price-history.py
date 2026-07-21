#!/usr/bin/env python3
"""Rebuild reports/prices-history.json from TCGCSV's daily price archives.

The daily price job originally keyed prices by card UID with last-row-wins
over TCGCSV's per-variant rows, so ~40% of cards carried a Reverse Holofoil
price instead of the standard printing's — and the recorded history flapped
between variants. This script rebuilds the rolling 90-day window from
TCGCSV's archived daily prices (https://tcgcsv.com/archive/...), applying the
same variant-preference selection the fixed daily job now uses, so the
history reflects the standard printing throughout.

Covers [today - window, yesterday]; the daily job appends today's point on
its next run. Cards are matched via the *current* products endpoints —
TCGplayer product IDs are stable, so the mapping holds across the window.

Requires a 7z binary (7zz/7z/7za) for the PPMd archives.

Usage:
  R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
  python3 .github/scripts/backfill-price-history.py [--dry-run] [--days N] \
      [--cache-dir DIR]
"""

import argparse
import importlib.util
import json
import shutil
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

_up_path = Path(__file__).parent / "update-prices.py"
_spec = importlib.util.spec_from_file_location("update_prices", _up_path)
up = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(up)

ARCHIVE_URL = "https://tcgcsv.com/archive/tcgplayer/prices-{date}.ppmd.7z"


def find_7z():
    for name in ("7zz", "7z", "7za"):
        if shutil.which(name):
            return name
    print("Error: no 7z binary found (need 7zz, 7z, or 7za for PPMd archives)")
    sys.exit(1)


def download_archive(day_str, cache_dir):
    """Download one day's price archive; returns path or None if unavailable.

    Retries transient network failures with backoff and writes atomically via a
    temp file so a killed download never leaves a truncated .7z behind.
    """
    import requests
    path = cache_dir / f"prices-{day_str}.ppmd.7z"
    if path.exists():
        return path
    url = ARCHIVE_URL.format(date=day_str)

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
            print(f"    download {day_str} attempt {attempt} failed: {error}", flush=True)
            time.sleep(min(2 ** attempt, 30))
    raise RuntimeError(f"Failed to download {day_str} after retries: {last_error}")


def extract_group_prices(seven_zip, archive_path, day_str, group_ids, cache_dir):
    """Extract the needed group price files; returns {group_id: [price records]}."""
    out_dir = cache_dir / "extracted"
    include_paths = [f"{day_str}/3/{gid}/prices" for gid in group_ids]
    subprocess.run(
        [seven_zip, "x", "-y", str(archive_path), f"-o{out_dir}", *include_paths],
        check=True, capture_output=True
    )
    prices_by_group = {}
    for gid in group_ids:
        prices_file = out_dir / day_str / "3" / str(gid) / "prices"
        if not prices_file.exists():
            continue
        data = json.loads(prices_file.read_text())
        if data.get("success"):
            prices_by_group[gid] = data.get("results", [])
    return prices_by_group


def build_history(daily_prices, dates):
    """Collapse per-day {uid: price} maps into change-point history."""
    history = defaultdict(list)
    for day_str in dates:
        for uid, price in daily_prices.get(day_str, {}).items():
            points = history[uid]
            price = round(float(price), 2)
            if not points or points[-1]["p"] != price:
                points.append({"d": day_str, "p": price})
    return dict(history)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="write locally, skip R2 upload")
    parser.add_argument("--days", type=int, default=up.HISTORY_WINDOW_DAYS)
    parser.add_argument("--cache-dir", default=".price-archives")
    args = parser.parse_args()

    seven_zip = find_7z()
    cache_dir = Path(args.cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    r2_client = up.initialize_r2_client()
    bucket = up.os.environ.get("R2_BUCKET_NAME", "ciphermaniac-reports")

    # Same card universe as the daily job: every printing in every cluster, not
    # just the canonicals, so newly tracked collector/cheap siblings get their
    # full 90 days rather than the single point the daily job seeds them with.
    master_report = up.load_online_meta_report(r2_client, bucket)
    synonyms_data = up.load_card_synonyms(r2_client, bucket)
    card_list = up.extract_unique_cards(master_report, synonyms_data) | up.build_print_universe(synonyms_data)
    card_sets_map = up.group_cards_by_set(card_list)
    set_mappings = up.map_sets_to_group_ids(card_sets_map.keys())

    # productId -> UID per group, from current product catalogs.
    print("\nFetching product catalogs...")
    group_products = {}
    group_to_set = {}
    for set_code, card_uids in card_sets_map.items():
        gid = set_mappings.get(set_code)
        if not gid:
            print(f"  Skipping {set_code} (no group ID)")
            continue
        products = up.fetch_tcgcsv_results(f"https://tcgcsv.com/tcgplayer/3/{gid}/products")
        group_products[gid] = (products, set_code, card_uids)
        group_to_set[gid] = set_code
        print(f"  {set_code}: {len(products)} products")
        time.sleep(0.25)

    energy_uids = {
        uid for uid in card_list
        if uid in up.BASIC_ENERGY_CANONICALS.values()
    }

    today = datetime.now(timezone.utc).date()
    dates = [
        (today - timedelta(days=offset)).isoformat()
        for offset in range(args.days, 0, -1)
    ]

    print(f"\nBackfilling {dates[0]} .. {dates[-1]} ({len(dates)} days)...")
    daily_prices = {}
    missing_days = []
    for day_str in dates:
        archive_path = download_archive(day_str, cache_dir)
        if archive_path is None:
            missing_days.append(day_str)
            continue
        prices_by_group = extract_group_prices(
            seven_zip, archive_path, day_str, group_products.keys(), cache_dir
        )
        day_prices = {}
        for gid, (products, set_code, card_uids) in group_products.items():
            records = prices_by_group.get(gid)
            if not records:
                continue
            extracted = up.extract_set_prices(products, records, set_code, card_uids)
            for uid, entry in extracted.items():
                day_prices[uid] = entry["price"]
        for uid in energy_uids:
            day_prices[uid] = 0.01
        daily_prices[day_str] = day_prices
        print(f"  {day_str}: {len(day_prices)} cards priced", flush=True)

    if missing_days:
        print(f"\nMissing archives for {len(missing_days)} days: {missing_days}")

    history = build_history(daily_prices, dates)
    total_points = sum(len(v) for v in history.values())
    print(f"\nRebuilt history: {len(history)} cards, {total_points} change points")

    if args.dry_run:
        out_path = cache_dir / "prices-history.rebuilt.json"
        out_path.write_text(json.dumps({"history": history}, separators=(",", ":")))
        print(f"Dry run: wrote {out_path}")
        return

    up.upload_price_history_to_r2(r2_client, bucket, history)

    # Refresh the client-facing derivatives from the rebuilt window so trends and
    # sparklines pick up the backfilled prints immediately, without waiting for
    # the next daily run. Standard-print classification needs each cluster's
    # current prices; the last point per UID in the rebuilt history is exactly
    # that (we priced the whole universe above).
    price_data = {
        uid: {"price": points[-1]["p"]}
        for uid, points in history.items()
        if points
    }
    up.upload_derived_artifacts(r2_client, bucket, history, price_data, synonyms_data, today)
    print("\n✓ Backfill complete!")


if __name__ == "__main__":
    main()
