#!/usr/bin/env python3
"""
One-time tournament refresh helper.
Downloads tournaments list, clears each corresponding folder in R2,
and re-downloads the tournament using the existing download script.
"""

import json
import os
import subprocess
import sys
from typing import List, Dict, Optional
from urllib.parse import quote

import boto3
import requests

ONLINE_FOLDER = 'Online - Last 14 Days'
PUBLIC_R2_BASE = os.environ.get('PUBLIC_R2_BASE_URL', 'https://r2.ciphermaniac.com')
DOWNLOAD_SCRIPT = '.github/scripts/download-tournament.py'


def log(message: str) -> None:
  print(message, flush=True)


def run_command(cmd: List[str], env: Optional[Dict[str, str]] = None) -> None:
  log(f'Running: {" ".join(cmd)}')
  subprocess.run(cmd, check=True, env=env)


def load_tournaments(client, bucket: str) -> List[Dict]:
  response = client.get_object(Bucket=bucket, Key='reports/tournaments.json')
  payload = response['Body'].read().decode('utf-8')
  data = json.loads(payload)
  if isinstance(data, list):
    return data
  if isinstance(data, dict):
    return data.get('tournaments', [])
  return []


def fetch_source_url(folder: str) -> Optional[str]:
  encoded = quote(folder, safe='')
  url = f'{PUBLIC_R2_BASE}/reports/{encoded}/meta.json'
  log(f'  Fetching meta for "{folder}" -> {url}')
  resp = requests.get(url, timeout=30)
  if resp.status_code != 200:
    log(f'    Warning: meta fetch failed with HTTP {resp.status_code}')
    return None
  meta = resp.json()
  source = meta.get('sourceUrl') or meta.get('sourceURL')
  if not source:
    log('    Warning: meta does not include sourceUrl')
    return None
  source = source.rstrip('/')
  if source.endswith('/decklists'):
    source = source[: -len('/decklists')]
  return source


def purge_folder(remote: str, bucket: str, folder: str) -> None:
  target = f'{remote}:{bucket}/reports/{folder}'
  log(f'  Clearing R2 path {target}')
  run_command(['rclone', 'purge', target])


def redownload_tournament(limitless_url: str) -> None:
  env = os.environ.copy()
  env['LIMITLESS_URL'] = limitless_url
  env.setdefault('ANONYMIZE', 'false')
  log(f'  Re-downloading from {limitless_url}')
  run_command([sys.executable, DOWNLOAD_SCRIPT], env=env)


def main() -> None:
  r2_account = os.environ['R2_ACCOUNT_ID']
  r2_access = os.environ['R2_ACCESS_KEY_ID']
  r2_secret = os.environ['R2_SECRET_ACCESS_KEY']
  bucket = os.environ.get('R2_BUCKET_NAME', 'ciphermaniac-reports')
  remote = os.environ.get('RCLONE_REMOTE_NAME', 'r2')

  client = boto3.client(
    's3',
    endpoint_url=f'https://{r2_account}.r2.cloudflarestorage.com',
    region_name='auto',
    aws_access_key_id=r2_access,
    aws_secret_access_key=r2_secret
  )

  tournaments = load_tournaments(client, bucket)
  log(f'Loaded {len(tournaments)} tournament entries')

  refreshed = 0
  skipped = 0

  for entry in tournaments:
    folder = entry.get('folder') or entry.get('name') or entry.get('path')
    if not folder:
      continue
    if folder == ONLINE_FOLDER:
      skipped += 1
      continue
    log(f'Refreshing "{folder}"')
    source_url = fetch_source_url(folder)
    if not source_url:
      log('  Skipping due to missing source url')
      skipped += 1
      continue
    try:
      purge_folder(remote, bucket, folder)
      redownload_tournament(source_url)
      refreshed += 1
    except subprocess.CalledProcessError as exc:
      log(f'  Error refreshing {folder}: {exc}')
      skipped += 1

  log(f'Completed. Refreshed: {refreshed}, Skipped: {skipped}')


if __name__ == '__main__':
  main()
