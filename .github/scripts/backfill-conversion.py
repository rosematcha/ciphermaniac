#!/usr/bin/env python3
"""Backfill reports/{tournament}/conversion.json for legacy events.

Tournaments downloaded before the pipeline learned to precompute the Day 1 ->
Day 2 conversion index have no conversion.json, so CardPage falls back to
downloading the full multi-MB decks.json in the browser. This script walks
reports/tournaments.json, computes the index for any event that has decks.json
but no conversion.json, and uploads it — reusing build_conversion_index and
the synonym canonicalization from download-tournament.py so the UIDs match
what the frontend expects. Skips events with no Day 2 flag (build returns
None), matching pipeline behavior. Safe to re-run; already-backfilled events
are skipped via a HEAD check.

Usage:
  R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
  R2_BUCKET_NAME=ciphermaniac-reports python3 .github/scripts/backfill-conversion.py [--dry-run]
"""

import importlib.util
import json
import os
import sys
from pathlib import Path

_dt_path = Path(__file__).parent / "download-tournament.py"
_spec = importlib.util.spec_from_file_location("download_tournament", _dt_path)
dt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dt)

# Shared R2 helpers (retrying client + typed read results).
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import r2  # noqa: E402


def get_json(client, bucket, key):
    try:
        obj = client.get_object(Bucket=bucket, Key=key)
        return json.loads(obj["Body"].read())
    except client.exceptions.NoSuchKey:
        return None
    except Exception as error:  # noqa: BLE001 — 404s surface differently per botocore version
        if getattr(error, "response", {}).get("Error", {}).get("Code") in ("404", "NoSuchKey"):
            return None
        raise


def key_exists(client, bucket, key):
    # Raises on transport errors (a swallowed error here would rewrite a
    # conversion.json that already exists but was momentarily unreadable).
    return r2.object_exists(client, bucket, key)


def main():
    dry_run = "--dry-run" in sys.argv
    account_id = os.environ["R2_ACCOUNT_ID"]
    bucket = os.environ.get("R2_BUCKET_NAME", "ciphermaniac-reports")
    client = r2.make_r2_client(
        account_id, os.environ["R2_ACCESS_KEY_ID"], os.environ["R2_SECRET_ACCESS_KEY"]
    )

    tournaments = get_json(client, bucket, "reports/tournaments.json")
    if not tournaments:
        print("Error: could not read reports/tournaments.json")
        sys.exit(1)

    # Same global synonym set the pipeline uses when no tournament-specific
    # synonyms were generated, so backfilled UIDs line up with master.json.
    synonyms, canonicals = dt.load_existing_canonicals(client, bucket)

    done = skipped = missing = no_day2 = 0
    for name in tournaments:
        base = f"reports/{name}"
        if key_exists(client, bucket, f"{base}/conversion.json"):
            skipped += 1
            continue
        decks = get_json(client, bucket, f"{base}/decks.json")
        if not decks:
            missing += 1
            print(f"  – {name}: no decks.json")
            continue
        conversion = dt.build_conversion_index(decks, synonyms, canonicals)
        if conversion is None:
            no_day2 += 1
            print(f"  – {name}: no Day 2 flags")
            continue
        if dry_run:
            print(f"  ✓ {name}: would upload ({len(conversion['cards'])} cards)")
        else:
            dt.upload_to_r2(client, bucket, f"{base}/conversion.json", conversion)
            print(f"  ✓ {name}: uploaded ({len(conversion['cards'])} cards)")
        done += 1

    print(
        f"Backfill complete: {done} written, {skipped} already present, "
        f"{missing} without decks.json, {no_day2} without Day 2 data."
    )


if __name__ == "__main__":
    main()
