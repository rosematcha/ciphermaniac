#!/usr/bin/env python3
"""
Rebuild reports/tournaments.json from existing R2 report folders.

Uses the same date-derivation and ordering logic as download-tournament.py.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import boto3


def load_download_module():
    script_path = Path(__file__).with_name("download-tournament.py")
    spec = importlib.util.spec_from_file_location("download_tournament", script_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Unable to load module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    r2_account_id = os.environ.get("R2_ACCOUNT_ID")
    r2_access_key_id = os.environ.get("R2_ACCESS_KEY_ID")
    r2_secret_access_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    r2_bucket_name = os.environ.get("R2_BUCKET_NAME", "ciphermaniac-reports")

    if not all([r2_account_id, r2_access_key_id, r2_secret_access_key]):
        print("Error: R2 credentials not set")
        sys.exit(1)

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=r2_access_key_id,
        aws_secret_access_key=r2_secret_access_key,
        region_name="auto",
    )

    module = load_download_module()
    rebuilt = module.rebuild_tournaments_json_from_reports(client, r2_bucket_name)
    print(f"✓ Rebuilt reports/tournaments.json with {len(rebuilt)} entries")


if __name__ == "__main__":
    main()
