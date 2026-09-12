#!/usr/bin/env python3
"""
Refresh the most recent immutable tournaments by re-running download-tournament.py.

This script is intended to run before online-meta when CLEAN_MONTH_CACHE=true.
It targets production and pending events within the last LOOKBACK_DAYS.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

# Shared R2 helpers (retrying client + typed read results).
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import r2  # noqa: E402


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


def get_source_url(r2_client, bucket_name: str, event_root: str) -> str | None:
    meta_key = f"{event_root.lstrip('/')}/meta.json"
    result = r2.read_json(r2_client, bucket_name, meta_key)
    if result.status == "missing":
        return None
    if result.status != "found":
        # A transport blip or corrupt payload must abort — treating it as "no
        # source URL" would silently skip refreshing a live event.
        raise result.error
    meta = result.value

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
    r2_client = r2.make_r2_client(account_id, access_key, secret_key)

    try:
        _, sources = r2.load_event_sources(r2_client, bucket_name)
    except Exception as error:  # noqa: BLE001
        print(f"[refresh] Failed to load immutable event sources: {error}")
        return 1
    recent_folders = list_recent_folders(sources, cutoff)
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
        source_url = get_source_url(r2_client, bucket_name, sources[folder_name])
        if not source_url:
            print(f"[refresh] Skipping {folder_name}: missing sourceUrl in meta.json")
            continue

        print(f"[refresh] Rebuilding {folder_name} from {source_url}")
        env = os.environ.copy()
        env["LIMITLESS_INPUT"] = source_url
        env["ANONYMIZE"] = "false"

        try:
            subprocess.run([sys.executable, script_path], env=env, check=True)
            refreshed += 1
        except subprocess.CalledProcessError as error:
            failures.append((folder_name, f"exit code {error.returncode}"))
            continue
        except Exception as error:  # noqa: BLE001
            failures.append((folder_name, str(error)))
            continue

    print(f"[refresh] Refreshed {refreshed} immutable tournament(s)")
    if failures:
        print(f"[refresh] {len(failures)} failures:")
        for folder_name, message in failures:
            print(f"  - {folder_name}: {message}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
