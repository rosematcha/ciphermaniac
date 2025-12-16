
import os
import sys
import json
import boto3
from botocore.config import Config

# Configuration
# Matches download-tournament.py defaults
DEFAULT_BUCKET = 'ciphermaniac-reports' 
REPORTS_PREFIX = 'reports/'
TOURNAMENTS_JSON_KEY = f'{REPORTS_PREFIX}tournaments.json'

def get_r2_client():
    account_id = os.environ.get('R2_ACCOUNT_ID')
    access_key_id = os.environ.get('R2_ACCESS_KEY_ID')
    secret_access_key = os.environ.get('R2_SECRET_ACCESS_KEY')
    
    if not all([account_id, access_key_id, secret_access_key]):
        # Try looking in a local .env file logic if needed, but usually we expect env vars
        print("Error: R2 credentials not found in environment variables (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).")
        sys.exit(1)

    return boto3.client(
        service_name='s3',
        endpoint_url=f'https://{account_id}.r2.cloudflarestorage.com',
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name='auto' 
    )

def main():
    bucket_name = os.environ.get('R2_BUCKET_NAME', DEFAULT_BUCKET)
    print(f"Connecting to R2 bucket: {bucket_name}")
    s3 = get_r2_client()
    
    # 1. Fetch current tournaments.json
    print(f"Fetching {TOURNAMENTS_JSON_KEY}...")
    try:
        response = s3.get_object(Bucket=bucket_name, Key=TOURNAMENTS_JSON_KEY)
        tournaments = json.loads(response['Body'].read().decode('utf-8'))
        print(f"Current tournaments.json has {len(tournaments)} items.")
    except Exception as e:
        print(f"Error fetching tournaments.json: {e}")
        sys.exit(1)

    # 2. List actual folders in reports/
    print("\nListing actual tournament folders in R2...")
    paginator = s3.get_paginator('list_objects_v2')
    pages = paginator.paginate(
        Bucket=bucket_name, 
        Prefix=REPORTS_PREFIX, 
        Delimiter='/'
    )
    
    valid_folders = set()
    for page in pages:
        if 'CommonPrefixes' in page:
            for prefix in page['CommonPrefixes']:
                # prefix['Prefix'] is like "reports/2025-11-15, Regional Las Vegas, NV/"
                # We want just the folder name "2025-11-15, Regional Las Vegas, NV"
                folder_path = prefix['Prefix']
                folder_name = folder_path.replace(REPORTS_PREFIX, '').strip('/')
                if folder_name:
                    valid_folders.add(folder_name)
    
    print(f"Found {len(valid_folders)} valid report folders in storage.")
    
    # 3. Filter the list
    new_tournaments = []
    removed_tournaments = []
    
    for t in tournaments:
        # Check if the tournament string exactly matches a folder name
        if t in valid_folders:
            new_tournaments.append(t)
        else:
            removed_tournaments.append(t)
            
    # 4. Report and Update
    if not removed_tournaments:
        print("\n✅ Verification complete. No invalid tournaments found in the JSON list.")
        return

    print(f"\n⚠️  Found {len(removed_tournaments)} entries in tournaments.json that do NOT exist as folders:")
    for t in removed_tournaments:
        print(f"   ❌ {t}")
        
    print(f"\nNew list will have {len(new_tournaments)} items (removed {len(removed_tournaments)}).")
    
    confirm = input("\nDo you want to upload the fixed tournaments.json? (y/n): ")
    if confirm.lower() != 'y':
        print("Aborted.")
        return

    print(f"\nUploading updated {TOURNAMENTS_JSON_KEY}...")
    try:
        s3.put_object(
            Bucket=bucket_name,
            Key=TOURNAMENTS_JSON_KEY,
            Body=json.dumps(new_tournaments, indent=2),
            ContentType='application/json'
        )
        print("✅ Successfully updated tournaments.json!")
    except Exception as e:
        print(f"❌ Error uploading file: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
