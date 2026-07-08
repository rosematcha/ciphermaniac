#!/usr/bin/env python3
"""Re-bake per-event cardUsage.json and conversion.json against current synonyms.

The per-event report bodies (master.json, per-archetype cards.json, decks.json)
store raw printings and are canonicalized by the frontend at read time, so they
self-correct when card-synonyms.json changes. But two derived indexes bake the
canonical UID at build time:

  - cardUsage.json   (canonical UID -> archetypes that play it)
  - conversion.json  (canonical UID -> Day 1/Day 2 counts)

After a synonyms rebuild these stay keyed to the OLD canonicals until the event
is regenerated. download-tournament.py only rebuilds them one event at a time by
re-downloading from Labs, and refresh-recent-tournaments.py only covers a recent
window. This script re-bakes both indexes for EVERY stored event straight from
the data already in R2 — no Labs round-trip — by feeding the stored decks.json
and per-archetype cards.json back through the same builders download-tournament
uses, with the current synonyms.

Usage:
  R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
  R2_BUCKET_NAME=ciphermaniac-reports \
  python3 .github/scripts/reprocess-event-indexes.py [--dry-run] \
      [--only "<folder>"] [--limit N]
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

# Reuse the exact builders and helpers download-tournament.py bakes with, so the
# reprocessed indexes are byte-for-byte what a fresh event run would produce.
_DT_PATH = Path(__file__).parent / "download-tournament.py"
_spec = importlib.util.spec_from_file_location("download_tournament", _DT_PATH)
dt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dt)

CARD_SYNONYMS_KEY = "assets/card-synonyms.json"
TOURNAMENTS_KEY = "reports/tournaments.json"


def make_client():
    account_id = os.environ["R2_ACCOUNT_ID"]
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def get_json(client, bucket, key):
    """Return the parsed JSON object at key, or None if it does not exist."""
    try:
        obj = client.get_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
            return None
        raise
    return json.loads(obj["Body"].read().decode("utf-8"))


def list_subprefixes(client, bucket, prefix):
    """List immediate sub-'folders' under prefix (S3 CommonPrefixes), paginated."""
    names = []
    token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix, "Delimiter": "/"}
        if token:
            kwargs["ContinuationToken"] = token
        resp = client.list_objects_v2(**kwargs)
        for cp in resp.get("CommonPrefixes", []):
            sub = cp["Prefix"][len(prefix):].rstrip("/")
            if sub:
                names.append(sub)
        if resp.get("IsTruncated"):
            token = resp.get("NextContinuationToken")
        else:
            break
    return names


def load_synonyms_from_r2(client, bucket):
    """Read synonyms straight from the R2 bucket (bypasses the public edge cache)."""
    data = get_json(client, bucket, CARD_SYNONYMS_KEY)
    if not data:
        raise SystemExit(f"No synonyms found at {CARD_SYNONYMS_KEY}")
    syn = data.get("synonyms", {})
    can = data.get("canonicals", {})
    print(f"Loaded synonyms from R2: {len(syn)} synonyms, {len(can)} canonicals")
    return syn, can


def load_event_folders(client, bucket):
    data = get_json(client, bucket, TOURNAMENTS_KEY)
    if data is None:
        raise SystemExit(f"No {TOURNAMENTS_KEY} found")
    folders = data if isinstance(data, list) else data.get("tournaments", [])
    result = []
    for entry in folders:
        if isinstance(entry, str):
            result.append(entry)
        elif isinstance(entry, dict):
            name = entry.get("folder") or entry.get("name") or entry.get("path")
            if name:
                result.append(name)
    return result


def reprocess_event(client, bucket, folder, synonyms, canonicals, dry_run=False):
    """Re-bake cardUsage.json + conversion.json for one event. Returns a summary."""
    base = f"reports/{folder}"
    summary = {"folder": folder, "cardUsage": None, "conversion": None, "errors": []}

    # cardUsage.json — assemble the archetype map from stored per-archetype
    # cards.json (each is exactly the payload["cards"] download-tournament wrote),
    # then rebuild the inverted index against the current synonyms.
    archetype_map = {}
    for slug in list_subprefixes(client, bucket, f"{base}/archetypes/"):
        cards = get_json(client, bucket, f"{base}/archetypes/{slug}/cards.json")
        if cards:
            archetype_map[slug] = {"cards": cards}
    if archetype_map:
        usage = dt.build_card_usage_index(archetype_map, synonyms, canonicals)
        old = get_json(client, bucket, f"{base}/cardUsage.json") or {}
        old_keys = len((old or {}).get("usage", {}))
        new_keys = len(usage.get("usage", {}))
        summary["cardUsage"] = {"archetypes": len(archetype_map),
                                "old_keys": old_keys, "new_keys": new_keys}
        if not dry_run:
            dt.upload_to_r2(client, bucket, f"{base}/cardUsage.json", usage)
    else:
        summary["errors"].append("no archetype cards.json found")

    # conversion.json — rebuild from the stored decks.json. build_conversion_index
    # returns None when no deck made Day 2; match download-tournament and only
    # write when there is a cut (leave any existing file untouched otherwise).
    decks = get_json(client, bucket, f"{base}/decks.json")
    if decks:
        conversion = dt.build_conversion_index(decks, synonyms, canonicals)
        if conversion is not None:
            old = get_json(client, bucket, f"{base}/conversion.json") or {}
            summary["conversion"] = {"old_cards": len((old or {}).get("cards", {})),
                                     "new_cards": len(conversion.get("cards", {}))}
            if not dry_run:
                dt.upload_to_r2(client, bucket, f"{base}/conversion.json", conversion)
        else:
            summary["conversion"] = {"skipped": "no Day 2 cut"}
    else:
        summary["errors"].append("no decks.json found")

    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                        help="compute and log changes without uploading")
    parser.add_argument("--only", help="process a single event folder by name")
    parser.add_argument("--limit", type=int, help="process at most N events")
    args = parser.parse_args()

    bucket = os.environ.get("R2_BUCKET_NAME", "ciphermaniac-reports")
    client = make_client()

    synonyms, canonicals = load_synonyms_from_r2(client, bucket)
    folders = [args.only] if args.only else load_event_folders(client, bucket)
    if args.limit:
        folders = folders[:args.limit]

    mode = "DRY RUN" if args.dry_run else "LIVE"
    print(f"\n{mode}: reprocessing {len(folders)} event(s)\n" + "=" * 60)

    processed = 0
    failures = []
    for folder in folders:
        try:
            s = reprocess_event(client, bucket, folder, synonyms, canonicals, args.dry_run)
        except Exception as exc:  # noqa: BLE001
            print(f"  ✗ {folder}: {exc}")
            failures.append((folder, str(exc)))
            continue
        cu = s["cardUsage"]
        cv = s["conversion"]
        cu_txt = f"cardUsage {cu['old_keys']}→{cu['new_keys']} keys ({cu['archetypes']} archetypes)" if cu else "cardUsage —"
        cv_txt = (f"conversion {cv['old_cards']}→{cv['new_cards']} cards" if cv and "new_cards" in cv
                  else ("conversion skipped (no cut)" if cv else "conversion —"))
        flag = "  ⚠ " + "; ".join(s["errors"]) if s["errors"] else ""
        print(f"  ✓ {folder}: {cu_txt}; {cv_txt}{flag}")
        processed += 1

    print("=" * 60)
    print(f"{mode} complete: {processed}/{len(folders)} events processed, {len(failures)} failed")
    if failures:
        for folder, err in failures:
            print(f"  FAILED {folder}: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
