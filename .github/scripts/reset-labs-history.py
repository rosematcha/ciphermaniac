#!/usr/bin/env python3
"""
One-time destructive reset + full Labs backfill for offline tournament reports.

Preserves only:
  - reports/Online - Last 14 Days/**
  - reports/Trends - Last 30 Days/**
  - reports/prices.json

Then rebuilds Labs Masters tournaments sequentially for a configurable ID range.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterable, List, Tuple

import boto3

REPORTS_PREFIX = "reports/"
TOURNAMENTS_KEY = "reports/tournaments.json"
PROTECTED_PREFIXES = (
    "reports/Online - Last 14 Days/",
    "reports/Trends - Last 30 Days/",
)
PROTECTED_KEYS = {
    "reports/prices.json",
}


def parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return default


def chunked(items: List[str], size: int = 1000) -> Iterable[List[str]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def should_preserve(key: str) -> bool:
    if key in PROTECTED_KEYS:
        return True
    return any(key.startswith(prefix) for prefix in PROTECTED_PREFIXES)


def list_report_keys(r2_client, bucket_name: str) -> List[str]:
    keys: List[str] = []
    continuation_token = None

    while True:
        kwargs = {
            "Bucket": bucket_name,
            "Prefix": REPORTS_PREFIX,
        }
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token

        response = r2_client.list_objects_v2(**kwargs)
        for obj in response.get("Contents", []):
            key = obj.get("Key")
            if key:
                keys.append(key)

        if not response.get("IsTruncated"):
            break
        continuation_token = response.get("NextContinuationToken")

    return keys


def delete_keys(r2_client, bucket_name: str, keys: List[str], dry_run: bool) -> int:
    if not keys:
        return 0

    if dry_run:
        print(f"[reset] DRY_RUN=true: would delete {len(keys)} keys")
        return 0

    deleted = 0
    for batch in chunked(keys, 1000):
        r2_client.delete_objects(
            Bucket=bucket_name,
            Delete={"Objects": [{"Key": key} for key in batch], "Quiet": True},
        )
        deleted += len(batch)

    return deleted


def reset_tournaments_index(r2_client, bucket_name: str, dry_run: bool) -> None:
    if dry_run:
        print(f"[reset] DRY_RUN=true: would write empty {TOURNAMENTS_KEY}")
        return

    r2_client.put_object(
        Bucket=bucket_name,
        Key=TOURNAMENTS_KEY,
        Body=json.dumps([], indent=2),
        ContentType="application/json",
    )
    print(f"[reset] Wrote empty {TOURNAMENTS_KEY}")


def run_download_for_code(code: str, env: dict, script_path: Path) -> Tuple[bool, str]:
    cmd = [sys.executable, str(script_path)]
    run_env = env.copy()
    run_env["LIMITLESS_INPUT"] = code
    run_env["ANONYMIZE"] = "false"
    run_env["GENERATE_TOURNAMENT_SYNONYMS"] = "false"
    run_env["WRITE_TOURNAMENT_DB"] = "true"

    completed = subprocess.run(cmd, env=run_env, check=False)
    if completed.returncode == 0:
        return True, "ok"
    return False, f"exit code {completed.returncode}"


def main() -> int:
    start_id = int(os.environ.get("LABS_START_ID", "1"))
    end_id = int(os.environ.get("LABS_END_ID", "54"))
    reset_reports = parse_bool(os.environ.get("RESET_REPORTS"), True)
    dry_run = parse_bool(os.environ.get("DRY_RUN"), False)
    fail_fast = parse_bool(os.environ.get("FAIL_FAST"), True)

    if start_id <= 0 or end_id <= 0 or end_id < start_id:
        print(f"[reset] Invalid range: start={start_id}, end={end_id}")
        return 1

    account_id = os.environ.get("R2_ACCOUNT_ID")
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    bucket_name = os.environ.get("R2_BUCKET_NAME", "ciphermaniac-reports")

    if not all([account_id, access_key, secret_key]):
        print("[reset] Missing required R2 credentials")
        return 1

    r2_client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )

    started = time.time()

    print("[reset] Configuration")
    print(f"  range: {start_id:04d}..{end_id:04d}")
    print(f"  reset_reports: {reset_reports}")
    print(f"  dry_run: {dry_run}")
    print(f"  fail_fast: {fail_fast}")

    if reset_reports:
        print("[reset] Enumerating report keys for destructive reset...")
        all_report_keys = list_report_keys(r2_client, bucket_name)
        removable_keys = [key for key in all_report_keys if not should_preserve(key)]
        print(f"[reset] Found {len(all_report_keys)} keys under {REPORTS_PREFIX}")
        print(f"[reset] Preserving protected keys/prefixes; deleting {len(removable_keys)} keys")

        deleted = delete_keys(r2_client, bucket_name, removable_keys, dry_run=dry_run)
        if not dry_run:
            print(f"[reset] Deleted {deleted} keys")

        reset_tournaments_index(r2_client, bucket_name, dry_run=dry_run)

    codes = [f"{value:04d}" for value in range(start_id, end_id + 1)]

    if dry_run:
        print(f"[reset] DRY_RUN=true: would rebuild {len(codes)} tournaments: {codes[0]}..{codes[-1]}")
        return 0

    script_path = Path(".github") / "scripts" / "download-tournament.py"
    if not script_path.is_file():
        print(f"[reset] Missing script: {script_path}")
        return 1

    success: List[str] = []
    failures: List[Tuple[str, str]] = []

    for code in codes:
        print(f"[reset] Rebuilding Labs {code}...")
        ok, message = run_download_for_code(code, os.environ.copy(), script_path)
        if ok:
            success.append(code)
            continue

        failures.append((code, message))
        print(f"[reset] Failed {code}: {message}")
        if fail_fast:
            break

    elapsed = round(time.time() - started, 2)
    print("\n[reset] Summary")
    print(f"  processed: {len(success) + len(failures)}")
    print(f"  succeeded: {len(success)}")
    print(f"  failed: {len(failures)}")
    print(f"  elapsed_sec: {elapsed}")

    if failures:
        print("  failures:")
        for code, message in failures:
            print(f"    - {code}: {message}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
