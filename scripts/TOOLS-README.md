# Card Types Database

This directory contains tools for building and maintaining a comprehensive database of card type information scraped from Limitless TCG.

## Overview

The card types database provides accurate type classification for every card in your tournament reports, including:
- **Card type**: `pokemon`, `trainer`, or `energy`
- **Trainer subtype**: `supporter`, `item`, `stadium`, `tool`, or `ace-spec`
- **Energy subtype**: `basic` or `special`
- **Evolution info**: For Pokémon cards (e.g., "Stage 2 - Evolves from Kirlia")
- **Full type string**: Raw type from Limitless (e.g., "Trainer - Stadium")

## Tools

### Build Card Types Database

Scrapes card type information from Limitless TCG for all cards found in your reports:

```bash
npm run build:card-types
```

**What it does:**
1. Scans all JSON files in `public/reports/`
2. Extracts unique card identifiers (set + number)
3. Fetches missing cards from Limitless TCG (rate-limited to 4/sec)
4. Saves to `public/assets/data/card-types.json`
5. Automatically skips cards already in the database

**Features:**
- Respects Limitless TCG with rate limiting
- Incremental updates (only fetches new cards)
- Progress saving every 10 cards
- Retry logic for failed requests
- Detailed logging

### Check Card Types Database

Verifies that all cards in your reports have type information:

```bash
npm run check:card-types
```

**What it does:**
1. Loads the existing database
2. Scans all reports for cards
3. Reports which cards are missing from the database
4. Groups missing cards by set for easy review
5. Exits with error code if cards are missing

**Use this to:**
- Verify database completeness before deployment
- Find cards that need type information
- Integrate into CI/CD pipelines

## GitHub Action

The repository includes a daily GitHub Action (`.github/workflows/update-card-types.yml`) for **optional bulk updates**:

1. **Runs daily at 3 AM UTC** (after online meta cron)
2. Downloads latest reports from Cloudflare R2
3. Builds/updates the card types database
4. Commits changes back to the repository
5. Can also be triggered manually via workflow dispatch

**Note:** With on-the-fly fetching enabled, this action is now **optional**. The database will automatically grow during normal report generation. This action is useful for:
- Initial bulk database creation
- Periodic verification and cleanup
- Ensuring the database is complete before deployments

### Setup Requirements

Add these secrets to your GitHub repository:
- `CF_ACCOUNT_ID`: Your Cloudflare account ID
- `CF_API_TOKEN`: Cloudflare API token with R2 read access
- `R2_BUCKET_NAME`: Your R2 bucket name (default: `ciphermaniac-reports`)

## Database Format

The database is stored as a JSON file at `public/assets/data/card-types.json`:

```json
{
  "PAL::188": {
    "cardType": "trainer",
    "subType": "item",
    "fullType": "Trainer - Item",
    "lastUpdated": "2025-11-12T10:30:00.000Z"
  },
  "PAR::159": {
    "cardType": "trainer",
    "subType": "stadium",
    "fullType": "Trainer - Stadium",
    "lastUpdated": "2025-11-12T10:30:15.000Z"
  },
  "PAL::265": {
    "cardType": "energy",
    "subType": "special",
    "fullType": "Energy - Special Energy",
    "lastUpdated": "2025-11-12T10:30:30.000Z"
  },
  "PAL::59": {
    "cardType": "pokemon",
    "evolutionInfo": "Stage 2 - Evolves from Kirlia",
    "fullType": "Pokémon - Stage 2 - Evolves from Kirlia",
    "lastUpdated": "2025-11-12T10:30:45.000Z"
  }
}
```

## Integration

### Server-Side (Cloudflare Workers)

The database is automatically loaded and used during report generation:

```javascript
import { loadCardTypesDatabase, enrichCardWithType } from './cardTypesDatabase.js';

// Load database
const cardTypesDb = await loadCardTypesDatabase(env);

// Enrich a card
const card = { name: 'Super Rod', set: 'PAL', number: '188', count: 2 };
const enrichedCard = enrichCardWithType(card, cardTypesDb);
// enrichedCard now has: category (slug), trainerType, etc.
```

The database is:
1. Stored in R2 at `assets/data/card-types.json`
2. Cached in KV for 24 hours (if `CARD_TYPES_KV` is available)
3. Automatically used by `onlineMeta.js` during report building

### Client-Side (Browser)

Access card type information in the browser:

```javascript
import { getCardType, enrichCardWithType } from './data/cardTypes.js';

// Get type for a specific card
const typeInfo = await getCardType('PAL', '188');
// Returns: { cardType: 'trainer', subType: 'item', fullType: 'Trainer - Item' }

// Enrich a card object
const card = { name: 'Super Rod', set: 'PAL', number: '188' };
const enriched = await enrichCardWithType(card);
// enriched now has: category (slug), trainerType, etc.
```

The database is:
1. Loaded from `/assets/data/card-types.json` on first access
2. Cached in memory for the session
3. Falls back gracefully if unavailable

## Data Flow

The system now features **on-the-fly card type fetching**, eliminating the need for daily batch updates:

```
┌─────────────────────────────────────────────────────────┐
│ 1. Daily Cron: Fetch online meta from Limitless        │
│    → functions/_cron/online-meta.js                     │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Build Reports: Load card types database             │
│    → functions/lib/onlineMeta.js                        │
│    → functions/lib/cardTypesDatabase.js                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Check Each Card: Database lookup + on-the-fly fetch │
│    → functions/lib/cardTypeFetcher.js                   │
│    → If card missing: Fetch from Limitless TCG         │
│    → Update R2 database immediately (persist)           │
│    → Invalidate KV cache for fresh reads               │
│    → Rate-limited: 4 requests/sec                       │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Enrich Cards: Add type info to each card            │
│    → Sets: category, trainerType, energyType           │
│    → Falls back to heuristics if fetch fails           │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 5. Generate Reports: Save enriched data                │
│    → reports/Online - Last 14 Days/*.json               │
│    → reports/Online - Last 14 Days/[archetype]/IE/     │
│    → Cards now have accurate type classification        │
│    → Database automatically grows with new cards        │
└─────────────────────────────────────────────────────────┘
```

**Key Features:**
- ✅ **Automatic database growth**: New cards are fetched and cached during normal operation
- ✅ **No daily batch needed**: The GitHub Action is now optional for bulk initial setup
- ✅ **Self-healing**: Missing cards are automatically discovered and fetched
- ✅ **Persistent storage**: Updates written to R2 immediately, KV cache invalidated
- ✅ **Rate-limited**: Respects Limitless TCG with 250ms delays between requests

## Best Practices

1. **Initial setup**: Run `npm run build:card-types` locally to create the initial database
2. **Verify completeness**: Use `npm run check:card-types` before major deployments
3. **Let it grow automatically**: The database will self-populate during normal operation
4. **Monitor logs**: Check Cloudflare Workers logs for card type fetch activity
5. **Rate limiting**: The system respects Limitless TCG with 250ms delays - don't modify this
6. **Fallback behavior**: The app still works without the database (using heuristics)
7. **GitHub Action**: Optional for bulk updates, but not required for daily operation

## Troubleshooting

### Cards not being scraped

- Check if the card exists on Limitless: `https://limitlesstcg.com/cards/SET/NUMBER`
- Verify the set code and number are correct in your reports
- Check GitHub Action logs for HTTP errors

### Database not being used

- Verify the file exists at `public/assets/data/card-types.json`
- Check browser console for loading errors
- For Workers, verify R2 bucket permissions

### Action failing

- Check R2 credentials in GitHub secrets
- Verify the reports bucket is accessible
- Review Action logs for specific error messages

## Future Enhancements

- [ ] Periodic re-scraping of old cards (metadata may change)
- [ ] Promo card support (different URL pattern)
- [ ] Batch API endpoint on Limitless (if available)
- [ ] Database versioning and migration support
