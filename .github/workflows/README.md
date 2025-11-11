# GitHub Actions Documentation

This document describes all GitHub Actions workflows for the Ciphermaniac project, their purpose, what they do, and when they run.

## Overview

All automation for Ciphermaniac is centralized in GitHub Actions. This includes:
- Deploying the site to Cloudflare Pages
- Generating the daily online meta report
- Updating card prices daily
- Downloading individual tournament reports (manual)

---

## 1. Deploy Pages

**File**: `.github/workflows/deploy-pages.yml`

### Purpose
Deploys the Ciphermaniac website to Cloudflare Pages, including building and bundling Cloudflare Functions.

### What It Does
1. Checks out the repository
2. Sets up Node.js 20
3. Installs npm dependencies
4. Builds Cloudflare Pages Functions (from `functions/` directory)
5. Deploys the `public/` directory to Cloudflare Pages
6. Updates cron triggers defined in `wrangler.toml`

### When It Runs
**Automatic**: Runs on every push to the `main` branch

### Trigger Type
- Push to `main` branch

### Required Secrets
- `CLOUDFLARE_API_TOKEN` - Cloudflare API token with Pages deploy permissions
- `CF_ACCOUNT_ID` - Cloudflare account ID

### Output
- Deploys site to: `https://ciphermaniac.com`
- Updates Cloudflare Pages project: `ciphermaniac`

### Notes
This workflow handles the deployment of the static site and any remaining Cloudflare Functions (like feedback submission, Limitless API proxies, etc.). Most automation has moved to GitHub Actions, but some functions remain on Cloudflare for real-time API access.

---

## 2. Online Meta Report

**File**: `.github/workflows/online-meta.yml`

### Purpose
Generates the "Online - Last 14 Days" meta report by aggregating recent online tournament data from Limitless TCG.

### What It Does
1. Fetches recent online tournaments from Limitless API (last 14 days)
2. Filters for PTCG Standard format tournaments
3. Downloads decklists from top placements (scaled by player count)
4. Aggregates card usage statistics
5. Generates archetype reports
6. **Generates include/exclude filtered reports for each archetype**
7. Uploads to R2:
   - `reports/Online - Last 14 Days/master.json` - Card statistics
   - `reports/Online - Last 14 Days/meta.json` - Tournament metadata
   - `reports/Online - Last 14 Days/decks.json` - All raw deck data
   - `reports/Online - Last 14 Days/archetypes/*.json` - Per-archetype reports
   - `include-exclude/Online - Last 14 Days/{archetype}/` - Filtered archetype variants

### When It Runs
**Automatic**: Daily at 12:00 UTC (7:00 AM EST / 6:00 AM CST)

**Manual**: Can be triggered via "Run workflow" button in GitHub Actions with optional granular control:
- **Generate master.json**: Aggregated card statistics (default: enabled)
- **Generate archetype reports**: Per-archetype breakdowns (default: enabled)
- **Generate include-exclude filtered reports**: Archetype variants (default: enabled)
- **Upload decks.json**: Raw deck data (default: enabled)

*Note: You can disable any of these to speed up runs or test specific components. For example, to regenerate only include-exclude reports without touching other data.*

### Trigger Type
- `schedule`: `cron: '0 12 * * *'` (daily)
- `workflow_dispatch`: Manual trigger with optional inputs

### Required Secrets
- `LIMITLESS_API_KEY` - API key for Limitless TCG
- `R2_ACCOUNT_ID` - Cloudflare R2 account ID
- `R2_ACCESS_KEY_ID` - R2 access key
- `R2_SECRET_ACCESS_KEY` - R2 secret key
- `R2_BUCKET_NAME` - Target R2 bucket (typically `ciphermaniac-reports`)

### Script
`.github/scripts/run-online-meta.mjs` (Node.js/JavaScript)

**Configuration Flags** (environment variables):
- `GENERATE_MASTER` - Generate master.json (default: true)
- `GENERATE_ARCHETYPES` - Generate archetype reports (default: true)
- `GENERATE_INCLUDE_EXCLUDE` - Generate include-exclude reports (default: true)
- `GENERATE_DECKS` - Upload decks.json (default: true)

### Output
- Creates/updates: `reports/Online - Last 14 Days/` in R2
- Creates/updates: `include-exclude/Online - Last 14 Days/{archetype}/` for each archetype
- Typical size: 500-800 decks
- Include-exclude reports: Filtered card statistics for archetype variants
- Processing time: 3-5 minutes

### Notes
- Does NOT update `tournaments.json` (online meta is treated as a special case)
- Uses Limitless API to fetch tournament data
- Filters by format and date range
- Scales deck inclusion by tournament size (larger tournaments = more decks analyzed)

---

## 3. Daily Price Check

**File**: `.github/workflows/daily-pricing.yml`

### Purpose
Updates card prices for all cards in the online meta by fetching current market prices from TCGCSV.

### What It Does
1. Downloads `reports/Online - Last 14 Days/master.json` from R2
2. Extracts all unique canonical cards (~500-800 cards)
3. Loads card synonyms for proper UID resolution
4. Groups cards by set code
5. Maps sets to TCGCSV group IDs
6. Downloads price CSV files from TCGCSV for each set
7. Parses market prices and TCGPlayer product IDs
8. Adds hardcoded $0.10 prices for basic energy
9. Uploads to R2:
   - `reports/prices.json` - Complete pricing data

### When It Runs
**Automatic**: Daily at 12:00 UTC (7:00 AM EST / 6:00 AM CST)

**Manual**: Can be triggered via "Run workflow" button in GitHub Actions

### Trigger Type
- `schedule`: `cron: '0 12 * * *'` (daily)
- `workflow_dispatch`: Manual trigger

### Required Secrets
- `R2_ACCOUNT_ID` - Cloudflare R2 account ID
- `R2_ACCESS_KEY_ID` - R2 access key
- `R2_SECRET_ACCESS_KEY` - R2 secret key

### Script
`.github/scripts/update-prices.py` (Python)

### Dependencies
- Python 3.11
- `requests` - HTTP client
- `boto3` - AWS S3/R2 client

### Output
- Creates/updates: `reports/prices.json` in R2
- Format: `{ "cardPrices": { "Card::SET::NUM": { "price": 12.34, "tcgPlayerId": "..." } } }`
- Frontend loads from: `https://r2.ciphermaniac.com/reports/prices.json`
- Processing time: 2-3 minutes
- Coverage: 95-98% of online meta cards

### Notes
- Only prices cards from the online meta (not all historical tournaments)
- Uses TCGCSV.com for pricing data (TCGPlayer market prices)
- Frontend expects `cardPrices` key for compatibility
- Replaces old Cloudflare Functions + KV storage approach

---

## 4. Download Tournament Report

**File**: `.github/workflows/download-tournament.yml`

### Purpose
Downloads and processes an individual tournament report from Limitless Labs (manual trigger only).

### What It Does
1. Downloads tournament page HTML from provided Limitless Labs URL
2. Extracts tournament metadata (date, name, format, players)
3. Parses all decklists from the page
4. Generates card synonym mappings by scraping Limitless for print variations
5. Generates reports:
   - `master.json` - Aggregated card statistics
   - `meta.json` - Tournament metadata
   - `decks.json` - Raw deck data
   - `cardIndex.json` - Card usage index
   - `synonyms.json` - Card reprint mappings
   - `archetypes/*.json` - Per-archetype statistics
6. Uploads all files to R2 at `reports/{YYYY-MM-DD, Tournament Name}/`
7. Updates `reports/tournaments.json` with the new tournament entry

### When It Runs
**Manual Only**: Must be triggered via "Run workflow" button in GitHub Actions

### Trigger Type
- `workflow_dispatch`: Manual trigger only

### Inputs
- `limitless_url` (required) - Full Limitless Labs tournament URL
  - Example: `https://labs.limitlesstcg.com/tournaments/...`
- `anonymize` (optional, default: false) - Anonymize player names

### Required Secrets
- `R2_ACCOUNT_ID` - Cloudflare R2 account ID
- `R2_ACCESS_KEY_ID` - R2 access key
- `R2_SECRET_ACCESS_KEY` - R2 secret key

### Script
`.github/scripts/download-tournament.py` (Python)

### Dependencies
- Python 3.11
- `requests` - HTTP client
- `beautifulsoup4` - HTML parser
- `boto3` - AWS S3/R2 client

### Output
- Creates: `reports/{YYYY-MM-DD, Tournament Name}/` in R2
- Updates: `reports/tournaments.json` (adds new entry at top)
- Folder naming: `{YYYY-MM-DD}, {Tournament Name}`
  - Example: `2025-11-11, Regional Fakecitytownville`
- Processing time: 5-15 minutes (depending on synonym generation)

### Notes
- Only supports Limitless Labs tournaments (RK9 support removed)
- Generates synonyms by scraping Limitless for all card printings
- Chooses canonical print intelligently (prefers standard-legal, non-promo, lowest price)
- Does NOT download card images (no longer hosting images)
- Automatically inserts tournament into `tournaments.json` in chronological order

---

## Workflow Execution Order

On a typical day:

```
12:00 UTC (Daily)
├─ Online Meta Report (runs first)
│  └─ Generates latest online meta data
│
└─ Daily Price Check (runs at same time)
   └─ Prices all cards from online meta
   
Manual (as needed)
└─ Download Tournament Report
   └─ Adds individual regional/special tournaments
```

The online meta and pricing workflows run concurrently and independently. They don't depend on each other.

---

## Required GitHub Secrets

Configure these in your repository settings (`Settings` → `Secrets and variables` → `Actions`):

### Cloudflare
- `CLOUDFLARE_API_TOKEN` - For deploying to Cloudflare Pages
- `CF_ACCOUNT_ID` - Cloudflare account ID

### Limitless TCG
- `LIMITLESS_API_KEY` - API key for Limitless TCG API access

### Cloudflare R2 Storage
- `R2_ACCOUNT_ID` - R2 account ID
- `R2_ACCESS_KEY_ID` - R2 access key ID
- `R2_SECRET_ACCESS_KEY` - R2 secret access key
- `R2_BUCKET_NAME` - Target bucket (typically `ciphermaniac-reports`)

---

## Manual Workflow Execution

To manually trigger a workflow:

1. Go to the **Actions** tab in GitHub
2. Select the workflow you want to run (left sidebar)
3. Click the **"Run workflow"** dropdown (top right)
4. For "Download Tournament Report":
   - Enter the Limitless Labs tournament URL
   - Optionally enable anonymization
5. Click **"Run workflow"** button

---

## Monitoring and Logs

- **View runs**: Actions tab → Select workflow → View run history
- **Live logs**: Click on a running workflow to see real-time logs
- **Failure notifications**: GitHub will email you if a workflow fails
- **Duration**: Most workflows complete in 2-5 minutes

---

## Maintenance

### Updating Scripts

To update a workflow script:

1. Edit the script file (e.g., `.github/scripts/update-prices.py`)
2. Test locally if possible
3. Commit and push to `main`
4. The workflow will use the new version on next run

### Updating Secrets

To update secrets:

1. Go to `Settings` → `Secrets and variables` → `Actions`
2. Click on the secret name
3. Click "Update secret"
4. Enter new value and save

### Disabling a Workflow

To temporarily disable a workflow:

1. Edit the `.github/workflows/*.yml` file
2. Comment out the schedule trigger:
   ```yaml
   # schedule:
   #   - cron: '0 12 * * *'
   ```
3. Commit and push

Or disable via GitHub UI:
1. Actions tab → Select workflow
2. Click "..." menu → "Disable workflow"

---

## Migration History

### November 2025 - Centralization to GitHub Actions

All automation was moved from Cloudflare to GitHub Actions:

**Moved to GitHub Actions**:
- Online meta generation (was: Cloudflare Pages Function)
- Daily pricing (was: Cloudflare Worker + Pages Function + KV)
- Tournament downloads (new: was manual Python script)

**Still on Cloudflare**:
- Site deployment (Cloudflare Pages)
- Feedback API endpoint (Cloudflare Function)
- Limitless API proxies (Cloudflare Functions)

**Removed**:
- Cloudflare Workers for pricing cron
- Cloudflare KV storage for pricing
- Complex multi-function pricing pipeline
- Image hosting and download scripts
- RK9 tournament support

This centralization provides:
- ✅ Single place for all automation
- ✅ Better visibility (GitHub Actions UI)
- ✅ Easier debugging (better logs)
- ✅ Simpler architecture
- ✅ No Cloudflare KV costs

---

## Troubleshooting

### Workflow fails with "secret not found"
- Check that all required secrets are configured
- Verify secret names match exactly (case-sensitive)

### Python dependencies fail to install
- Check that `requirements.txt` or install commands are correct
- Verify Python version matches (3.11)

### R2 upload fails
- Verify R2 credentials are correct and not expired
- Check R2 bucket exists and is accessible
- Ensure bucket name matches secret

### Limitless API fails
- Check that API key is valid and not rate-limited
- Verify tournament URL format is correct
- Check Limitless TCG website is accessible

### Schedule doesn't run
- Verify cron syntax is correct
- GitHub Actions may delay up to 15 minutes during high load
- Check workflow file has no syntax errors

---

## Future Enhancements

Potential additions:
- Automatic archetype classification using ML
- Price trend tracking over time
- Tournament result predictions
- Slack/Discord notifications for workflow completion
- Automatic tournament discovery and download
- Integration with Play! Pokémon official events
