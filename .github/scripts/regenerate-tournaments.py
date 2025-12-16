#!/usr/bin/env python3
"""
Regenerate Tournament Reports
=============================
Regenerates tournament reports for tournaments that need updated with the new
folder structure (per-archetype decks.json files).

This script:
1. Fetches meta.json for each tournament to get the sourceUrl
2. Deletes the existing R2 data for that tournament
3. Re-downloads from the source URL to regenerate with new structure
"""

import os
import sys
import json
import time
import requests
import boto3
from botocore.exceptions import ClientError
from urllib.parse import quote

# Import the download-tournament functionality
sys.path.insert(0, os.path.dirname(__file__))
from pathlib import Path

# Backlog of tournaments that need regeneration
TOURNAMENT_BACKLOG = [
    "2025-11-29, Regional Stuttgart",
    "2025-11-21, LAIC 2025–26, São Paulo",
    "2025-11-12, Regional Las Vegas, NV",
    "2025-11-01, Regional Gdańsk",
    "2025-11-01, Regional Brisbane",
    "2025-10-25, Regional Lille",
    "2025-10-11, Regional Milwaukee, WI",
    "2025-09-20, Regional Pittsburgh, PA",
    "2025-09-13, Regional Monterrey",
    "2025-09-13, Regional Frankfurt",
    "2025-08-15, World Championships 2025",
    "2025-06-13, NAIC 2025, New Orleans",
    "2025-05-24, Regional Portland, OR",
    "2025-05-17, Regional Santiago",
    "2025-05-17, Regional Melbourne",
    "2025-05-03, Regional Milwaukee, WI",
    "2025-04-19, Regional Monterrey",
    "2025-04-12, Regional Atlanta, GA"
]

R2_BASE_URL = "https://r2.ciphermaniac.com"


def get_r2_client():
    """Create and return R2 client."""
    r2_account_id = os.environ.get('R2_ACCOUNT_ID')
    r2_access_key_id = os.environ.get('R2_ACCESS_KEY_ID')
    r2_secret_access_key = os.environ.get('R2_SECRET_ACCESS_KEY')
    
    if not all([r2_account_id, r2_access_key_id, r2_secret_access_key]):
        print("Error: R2 credentials not set")
        sys.exit(1)
    
    return boto3.client(
        's3',
        endpoint_url=f'https://{r2_account_id}.r2.cloudflarestorage.com',
        aws_access_key_id=r2_access_key_id,
        aws_secret_access_key=r2_secret_access_key,
        region_name='auto'
    )


def fetch_tournament_meta(tournament_name):
    """Fetch meta.json for a tournament to get its sourceUrl."""
    encoded_name = quote(tournament_name)
    meta_url = f"{R2_BASE_URL}/reports/{encoded_name}/meta.json"
    
    print(f"  Fetching meta from: {meta_url}")
    
    headers = {'User-Agent': 'Mozilla/5.0 (compatible; CiphermaniacBot/1.0)'}
    
    try:
        response = requests.get(meta_url, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.HTTPError as e:
        # R2 sometimes returns 403 for non-existent files
        if e.response.status_code in (403, 404):
            print(f"  Warning: meta.json not found for {tournament_name} (HTTP {e.response.status_code})")
            return None
        print(f"  Error fetching meta: HTTP {e.response.status_code}")
        return None
    except Exception as e:
        print(f"  Error fetching meta: {e}")
        return None


def delete_tournament_from_r2(r2_client, bucket_name, tournament_name, dry_run=False):
    """Delete all objects for a tournament from R2."""
    prefix = f"reports/{tournament_name}/"
    
    print(f"  Listing objects with prefix: {prefix}")
    
    try:
        # List all objects with this prefix
        paginator = r2_client.get_paginator('list_objects_v2')
        objects_to_delete = []
        
        for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
            if 'Contents' in page:
                for obj in page['Contents']:
                    objects_to_delete.append({'Key': obj['Key']})
        
        if not objects_to_delete:
            print(f"  No objects found for {tournament_name}")
            return 0
        
        print(f"  Found {len(objects_to_delete)} objects to delete")
        
        if dry_run:
            print(f"  [DRY RUN] Would delete {len(objects_to_delete)} objects")
            for obj in objects_to_delete[:5]:
                print(f"    - {obj['Key']}")
            if len(objects_to_delete) > 5:
                print(f"    ... and {len(objects_to_delete) - 5} more")
            return len(objects_to_delete)
        
        # Delete objects in batches of 1000 (AWS limit)
        batch_size = 1000
        total_deleted = 0
        
        for i in range(0, len(objects_to_delete), batch_size):
            batch = objects_to_delete[i:i + batch_size]
            response = r2_client.delete_objects(
                Bucket=bucket_name,
                Delete={'Objects': batch}
            )
            deleted_count = len(response.get('Deleted', []))
            total_deleted += deleted_count
            print(f"  Deleted batch: {deleted_count} objects")
        
        print(f"  Total deleted: {total_deleted} objects")
        return total_deleted
        
    except Exception as e:
        print(f"  Error deleting objects: {e}")
        return 0


def regenerate_tournament(r2_client, bucket_name, tournament_name, source_url, dry_run=False):
    """Regenerate a tournament by running download-tournament.py."""
    print(f"\n  Re-downloading from: {source_url}")
    
    if dry_run:
        print(f"  [DRY RUN] Would download from {source_url}")
        return True
    
    # Set environment variables for download-tournament.py
    os.environ['LIMITLESS_URL'] = source_url
    os.environ['ANONYMIZE'] = 'false'
    
    # Import and run the download-tournament main function
    try:
        # We need to import it fresh each time to pick up env changes
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "download_tournament",
            os.path.join(os.path.dirname(__file__), "download-tournament.py")
        )
        download_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(download_module)
        
        download_module.main()
        return True
    except Exception as e:
        print(f"  Error regenerating tournament: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    mode = os.environ.get('MODE', 'all-backlog')
    single_tournament = os.environ.get('SINGLE_TOURNAMENT', '')
    dry_run = os.environ.get('DRY_RUN', 'false').lower() == 'true'
    bucket_name = os.environ.get('R2_BUCKET_NAME', 'ciphermaniac-reports')
    
    print("=" * 60)
    print("Regenerate Tournament Reports")
    print("=" * 60)
    print(f"Mode: {mode}")
    print(f"Dry run: {dry_run}")
    print()
    
    # Determine which tournaments to process
    if mode == 'single':
        if not single_tournament:
            print("Error: SINGLE_TOURNAMENT not specified for single mode")
            sys.exit(1)
        tournaments = [single_tournament]
    else:
        tournaments = TOURNAMENT_BACKLOG
    
    print(f"Tournaments to process: {len(tournaments)}")
    for t in tournaments:
        print(f"  - {t}")
    print()
    
    # Initialize R2 client
    r2_client = get_r2_client()
    
    # Track results
    results = {
        'success': [],
        'failed': [],
        'skipped': []
    }
    
    for i, tournament_name in enumerate(tournaments, 1):
        print("=" * 60)
        print(f"[{i}/{len(tournaments)}] Processing: {tournament_name}")
        print("=" * 60)
        
        # Step 1: Fetch meta.json to get sourceUrl
        print("\nStep 1: Fetching tournament metadata...")
        meta = fetch_tournament_meta(tournament_name)
        
        if not meta:
            print(f"  Skipping: Could not fetch metadata")
            results['skipped'].append(tournament_name)
            continue
        
        source_url = meta.get('sourceUrl')
        if not source_url:
            print(f"  Skipping: No sourceUrl in metadata")
            results['skipped'].append(tournament_name)
            continue
        
        print(f"  Source URL: {source_url}")
        print(f"  Original date: {meta.get('date')}")
        print(f"  Players: {meta.get('players')}")
        
        # Step 2: Delete existing R2 data
        print("\nStep 2: Deleting existing R2 data...")
        deleted_count = delete_tournament_from_r2(r2_client, bucket_name, tournament_name, dry_run)
        
        if deleted_count == 0 and not dry_run:
            print(f"  Warning: No objects were deleted")
        
        # Step 3: Regenerate tournament
        print("\nStep 3: Regenerating tournament with new structure...")
        success = regenerate_tournament(r2_client, bucket_name, tournament_name, source_url, dry_run)
        
        if success:
            results['success'].append(tournament_name)
            print(f"\n✓ Successfully processed: {tournament_name}")
        else:
            results['failed'].append(tournament_name)
            print(f"\n✗ Failed to process: {tournament_name}")
        
        # Add a small delay between tournaments to avoid rate limiting
        if i < len(tournaments):
            print("\nWaiting 2 seconds before next tournament...")
            time.sleep(2)
    
    # Print summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Total processed: {len(tournaments)}")
    print(f"Successful: {len(results['success'])}")
    print(f"Failed: {len(results['failed'])}")
    print(f"Skipped: {len(results['skipped'])}")
    
    if results['failed']:
        print("\nFailed tournaments:")
        for t in results['failed']:
            print(f"  - {t}")
    
    if results['skipped']:
        print("\nSkipped tournaments:")
        for t in results['skipped']:
            print(f"  - {t}")
    
    # Exit with error if any failed
    if results['failed']:
        sys.exit(1)


if __name__ == '__main__':
    main()
