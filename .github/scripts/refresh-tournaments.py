#!/usr/bin/env python3
"""
One-time tournament refresh helper.
Downloads tournaments list, clears each corresponding folder in R2,
and re-downloads the tournament using the existing download script.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from typing import List, Dict, Optional, Tuple
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
  # Ensure the URL points to the decklists page
  if not source.endswith('/decklists'):
    source = f'{source}/decklists'
  return source


def purge_folder(remote: str, bucket: str, folder: str) -> None:
  target = f'{remote}:{bucket}/reports/{folder}'
  log(f'  Clearing R2 path {target}')
  run_command(['rclone', 'purge', target])


def upload_folder(remote: str, bucket: str, folder: str, source_path: str) -> None:
  target = f'{remote}:{bucket}/reports/{folder}'
  log(f'  Uploading staged data to {target}')
  run_command(['rclone', 'copy', '--transfers', '16', '--check-first', source_path, target])


def stage_tournament(source_url: str, folder: str) -> Tuple[str, str]:
  tmp_dir = tempfile.mkdtemp(prefix='tournament-refresh-')
  env = os.environ.copy()
  env['LIMITLESS_URL'] = source_url
  env['LOCAL_EXPORT_DIR'] = tmp_dir
  env.setdefault('ANONYMIZE', 'false')
  try:
    run_command([sys.executable, DOWNLOAD_SCRIPT], env=env)
    staged_path = os.path.join(tmp_dir, 'reports', folder)
    if not os.path.isdir(staged_path):
      raise RuntimeError(f'Staged data missing for {folder}')
    return tmp_dir, staged_path
  except Exception:
    shutil.rmtree(tmp_dir, ignore_errors=True)
    raise


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
    if isinstance(entry, str):
      folder = entry
      source_hint = None
    else:
      folder = entry.get('folder') or entry.get('name') or entry.get('path')
      source_hint = entry.get('sourceUrl') or entry.get('sourceURL')
    if not folder:
      continue
    if folder == ONLINE_FOLDER:
      skipped += 1
      continue
    log(f'Refreshing "{folder}"')
    source_url = source_hint.rstrip('/') if isinstance(source_hint, str) and source_hint else None
    # Ensure the URL points to the decklists page
    if source_url and not source_url.endswith('/decklists'):
      source_url = f'{source_url}/decklists'
    if not source_url:
      source_url = fetch_source_url(folder)
    if not source_url:
      log('  Skipping due to missing source url')
      skipped += 1
      continue
    tmp_dir = None
    try:
      tmp_dir, staged_path = stage_tournament(source_url, folder)
      purge_folder(remote, bucket, folder)
      upload_folder(remote, bucket, folder, staged_path)
      refreshed += 1
    except subprocess.CalledProcessError as exc:
      log(f'  Error refreshing {folder}: {exc}')
      skipped += 1
    except Exception as exc:
      log(f'  Unexpected error refreshing {folder}: {exc}')
      skipped += 1
    finally:
      if tmp_dir:
        shutil.rmtree(tmp_dir, ignore_errors=True)

  log(f'Completed. Refreshed: {refreshed}, Skipped: {skipped}')


if __name__ == '__main__':
  main()
