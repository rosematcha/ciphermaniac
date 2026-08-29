#!/usr/bin/env python3
"""
Ingest Limitless Labs tournaments that are not in the dataset yet.

Until this script existed, every event reached R2 through a manual
`download-tournament` dispatch, one URL at a time. Nothing noticed when nobody
ran it: labs published codes 0055-0071 while the dataset sat at 0054, so six
months of events were missing from the reports, the catalog, and every player
profile derived from them.

The scan is: read the labs index for published codes, read the `labsCode` of
every report folder already in R2, and run `download-tournament.py` for the
difference (oldest first, so a partial run still leaves a chronologically
contiguous dataset). Each ingest rebuilds `reports/tournaments.json` itself, so
the catalog and the downstream aggregators pick the events up on their next run.

Environment:
  R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME
  DRY_RUN         - list what would be ingested without downloading (default false)
  MAX_INGEST      - cap per run so a first run cannot fan out unbounded (default 5)
  ANONYMIZE       - forwarded to download-tournament.py (default false)
"""

from __future__ import annotations

import importlib.util
import os
import re
import subprocess
import sys
from pathlib import Path

import requests

# Shared R2 helpers (retrying client + typed read results).
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import r2  # noqa: E402

LABS_INDEX_URL = "https://labs.limitlesstcg.com/"
LABS_CODE_PATTERN = re.compile(r'href="/(\d{4})/standings"')
DEFAULT_MAX_INGEST = 5


def parse_bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return default


def parse_int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        return default
    return value if value > 0 else default


def load_download_module():
    """Import download-tournament.py for its R2 listing + meta helpers."""
    script_path = Path(__file__).with_name("download-tournament.py")
    spec = importlib.util.spec_from_file_location("download_tournament", script_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Unable to load module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fetch_published_codes(session: requests.Session) -> list[str]:
    """Every 4-digit labs code linked from the labs index, ascending."""
    response = session.get(LABS_INDEX_URL, timeout=30)
    response.raise_for_status()
    codes = sorted(set(LABS_CODE_PATTERN.findall(response.text)))
    return codes


def fetch_ingested_codes(download_module, r2_client, bucket_name: str) -> set[str]:
    """
    Labs codes already in R2, read from each report folder's meta.json.

    Folder names carry no code, so the meta is the only authority. Folders whose
    meta is missing or codeless are ignored — the worst case is re-downloading
    an event, which is idempotent, rather than skipping one forever.
    """
    folders = download_module.list_report_folders(r2_client, bucket_name)
    codes: set[str] = set()
    for folder in folders:
        # build_tournament_meta_map is not reusable here: it deliberately skips
        # date-prefixed folders (the catalog only needs metas for undated ones),
        # which is every event we care about.
        meta = download_module.fetch_tournament_meta(r2_client, bucket_name, folder)
        code = meta.get("labsCode") if isinstance(meta, dict) else None
        if isinstance(code, str) and code.strip():
            codes.add(code.strip())
    return codes


def ingest(code: str, anonymize: bool) -> None:
    """Run download-tournament.py for one labs code, raising on failure."""
    script_path = os.path.join(".github", "scripts", "download-tournament.py")
    env = os.environ.copy()
    env["LIMITLESS_INPUT"] = code
    env["ANONYMIZE"] = "true" if anonymize else "false"
    subprocess.run([sys.executable, script_path], env=env, check=True)


def main() -> int:
    r2_account_id = os.environ.get("R2_ACCOUNT_ID")
    r2_access_key_id = os.environ.get("R2_ACCESS_KEY_ID")
    r2_secret_access_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    bucket_name = os.environ.get("R2_BUCKET_NAME", "ciphermaniac-reports")
    dry_run = parse_bool_env("DRY_RUN", False)
    anonymize = parse_bool_env("ANONYMIZE", False)
    max_ingest = parse_int_env("MAX_INGEST", DEFAULT_MAX_INGEST)

    if not all([r2_account_id, r2_access_key_id, r2_secret_access_key]):
        print("[ingest] Error: R2 credentials not set")
        return 1

    r2_client = r2.make_r2_client(r2_account_id, r2_access_key_id, r2_secret_access_key)
    download_module = load_download_module()
    session = requests.Session()

    published = fetch_published_codes(session)
    if not published:
        print("[ingest] Error: labs index returned no tournament codes")
        return 1
    ingested = fetch_ingested_codes(download_module, r2_client, bucket_name)
    missing = [code for code in published if code not in ingested]

    print(f"[ingest] labs published: {len(published)} (latest {published[-1]})")
    print(f"[ingest] already ingested: {len(ingested)}")
    print(f"[ingest] missing: {len(missing)}{' -> ' + ', '.join(missing) if missing else ''}")

    if not missing:
        print("[ingest] Nothing to ingest")
        return 0

    batch = missing[:max_ingest]
    if len(missing) > len(batch):
        print(f"[ingest] Ingesting the {len(batch)} oldest this run (MAX_INGEST={max_ingest})")

    if dry_run:
        print(f"[ingest] Dry run: would ingest {', '.join(batch)}")
        return 0

    failures: list[tuple[str, str]] = []
    for code in batch:
        print(f"[ingest] Downloading labs {code}...")
        try:
            ingest(code, anonymize)
        except subprocess.CalledProcessError as error:
            failures.append((code, f"exit code {error.returncode}"))
        except Exception as error:  # noqa: BLE001
            failures.append((code, str(error)))

    succeeded = len(batch) - len(failures)
    print(f"[ingest] ===== SUMMARY =====\n  ingested : {succeeded}\n  failed   : {len(failures)}")
    for code, reason in failures:
        print(f"  - {code}: {reason}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
