#!/usr/bin/env python3
"""
Refresh the most recent tournament report folders in R2 by re-running download-tournament.py.

This script is intended to run before online-meta when CLEAN_MONTH_CACHE=true.
It targets folders listed in reports/tournaments.json within the last LOOKBACK_DAYS.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from typing import Iterable

import boto3


TOURNAMENTS_KEY = "reports/tournaments.json"
FOLDER_DATE_PATTERN = re.compile(r"^(\d{4}-\d{2}-\d{2}),\s+")


def parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return default


def parse_folder_date(folder_name: str) -> datetime | None:
    if not isinstance(folder_name, str):
        return None
    match = FOLDER_DATE_PATTERN.match(folder_name)
    if not match:
        return None
    try:
        return datetime.strptime(match.group(1), "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def list_recent_folders(folders: Iterable[str], cutoff: datetime) -> list[str]:
    selected: list[str] = []
    for folder in folders:
        folder_date = parse_folder_date(folder)
        if folder_date and folder_date >= cutoff:
            selected.append(folder)
    selected.sort()
    return selected


def delete_prefix(r2_client, bucket_name: str, prefix: str) -> tuple[int, int]:
    deleted = 0
    total_keys = 0
    continuation_token = None

    while True:
        kwargs = {
            "Bucket": bucket_name,
            "Prefix": prefix,
        }
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token

        response = r2_client.list_objects_v2(**kwargs)
        keys = [obj["Key"] for obj in response.get("Contents", []) if obj.get("Key")]
        total_keys += len(keys)

        for index in range(0, len(keys), 1000):
            chunk = keys[index : index + 1000]
            if not chunk:
                continue
            r2_client.delete_objects(
                Bucket=bucket_name,
                Delete={"Objects": [{"Key": key} for key in chunk], "Quiet": True},
            )
            deleted += len(chunk)

        if not response.get("IsTruncated"):
            break
        continuation_token = response.get("NextContinuationToken")

    return deleted, total_keys


def fetch_json(r2_client, bucket_name: str, key: str):
    response = r2_client.get_object(Bucket=bucket_name, Key=key)
    raw = response["Body"].read().decode("utf-8")
    return json.loads(raw)


def get_source_url(r2_client, bucket_name: str, folder_name: str) -> str | None:
    meta_key = f"reports/{folder_name}/meta.json"
    try:
        meta = fetch_json(r2_client, bucket_name, meta_key)
    except Exception as error:  # noqa: BLE001
        print(f"[refresh] Could not read {meta_key}: {error}")
        return None

    if not isinstance(meta, dict):
        return None

    source_url = meta.get("sourceUrl") or meta.get("sourceURL")
    if isinstance(source_url, str) and source_url.strip():
        return source_url.strip()
    return None


def main() -> int:
    account_id = os.environ.get("R2_ACCOUNT_ID")
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    bucket_name = os.environ.get("R2_BUCKET_NAME", "ciphermaniac-reports")

    if not account_id or not access_key or not secret_key:
        print("[refresh] Missing required R2 credentials")
        return 1

    lookback_days = int(os.environ.get("REFRESH_LOOKBACK_DAYS", "30"))
    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days - 1)
    delete_before_rebuild = parse_bool(os.environ.get("REFRESH_DELETE_EXISTING"), True)

    r2_client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )

    try:
        folders = fetch_json(r2_client, bucket_name, TOURNAMENTS_KEY)
    except Exception as error:  # noqa: BLE001
        print(f"[refresh] Failed to load {TOURNAMENTS_KEY}: {error}")
        return 1

    if not isinstance(folders, list):
        print(f"[refresh] {TOURNAMENTS_KEY} is not an array")
        return 1

    recent_folders = list_recent_folders(folders, cutoff)
    print(
        f"[refresh] Found {len(recent_folders)} tournament folders in the last {lookback_days} days (cutoff={cutoff.date()})"
    )
    if not recent_folders:
        print("[refresh] Nothing to refresh")
        return 0

    script_path = os.path.join(".github", "scripts", "download-tournament.py")
    failures: list[tuple[str, str]] = []
    refreshed = 0

    for folder_name in recent_folders:
        source_url = get_source_url(r2_client, bucket_name, folder_name)
        if not source_url:
            print(f"[refresh] Skipping {folder_name}: missing sourceUrl in meta.json")
            continue

        if delete_before_rebuild:
            prefix = f"reports/{folder_name}/"
            deleted, total = delete_prefix(r2_client, bucket_name, prefix)
            print(f"[refresh] Cleared {deleted}/{total} objects under {prefix}")

        print(f"[refresh] Rebuilding {folder_name} from {source_url}")
        env = os.environ.copy()
        env["LIMITLESS_URL"] = source_url
        env["ANONYMIZE"] = "false"

        try:
            subprocess.run([sys.executable, script_path], env=env, check=True)
            refreshed += 1
        except subprocess.CalledProcessError as error:
            failures.append((folder_name, f"exit code {error.returncode}"))
        except Exception as error:  # noqa: BLE001
            failures.append((folder_name, str(error)))

    print(f"[refresh] Refreshed {refreshed} tournament folders")
    if failures:
        print(f"[refresh] {len(failures)} failures:")
        for folder_name, message in failures:
            print(f"  - {folder_name}: {message}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
