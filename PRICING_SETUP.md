# TCGCSV Pricing Integration Setup

This document explains how to set up and use the daily TCGCSV pricing system for Ciphermaniac.

## Overview

The system automatically scrapes TCGCSV pricing data daily at 3:30 PM CST and provides an API for accessing current market prices for Pokemon cards.

## Architecture

- **Daily Scraper**: CloudFlare cron job (`functions/_cron/daily-pricing.js`)
- **API Endpoints**: 
  - `/api/pricing` - Manual pricing update
  - `/api/get-prices` - Get current pricing data
  - `/api/test-pricing` - Test endpoint
- **Client Module**: `assets/js/pricing.js` for frontend integration
- **Storage**: CloudFlare KV for price data persistence

## Setup Instructions

### 1. Create CloudFlare KV Namespace

```bash
# Create KV namespace for price data
wrangler kv:namespace create "PRICE_DATA"
```

Update the namespace ID in `wrangler.toml`.

### 2. Deploy to CloudFlare Pages

The pricing system uses CloudFlare Pages Functions (not Workers). Deploy via:

1. Connect your GitHub repo to CloudFlare Pages
2. Set build settings:
   - Build command: `echo 'No build needed'`
   - Output directory: `.`

### 3. Configure Cron Trigger

The cron job is configured in `wrangler.toml` to run daily at 3:30 PM CST (8:30 PM UTC).

CloudFlare will automatically set up the trigger based on the configuration.

### 4. Test the System

Access the test endpoint to verify everything works:

```bash
# Test TCGCSV API connectivity
curl https://your-site.pages.dev/api/test-pricing?action=groups

# Test CSV parsing
curl https://your-site.pages.dev/api/test-pricing?action=csv&groupId=24269

# Test full pricing update
curl https://your-site.pages.dev/api/test-pricing?action=full
```

## Usage

### Frontend Integration

```javascript
// Import the pricing manager
import PricingManager from './assets/js/pricing.js';

// Or use the global instance
const pricing = window.pricingManager;

// Get price for a single card
const price = await pricing.getCardPrice('Ultra Ball', 'SVI', '196');
console.log(pricing.formatPrice(price)); // "$0.25"

// Get prices for multiple cards
const cards = [
  { name: 'Ultra Ball', set: 'SVI', number: '196' },
  { name: 'Boss\'s Orders', set: 'PAL', number: '172' }
];
const prices = await pricing.getMultiplePrices(cards);

// Get metadata
const metadata = await pricing.getPricingMetadata();
console.log(`Last updated: ${metadata.lastUpdated}`);
```

### Manual Pricing Update

```bash
# Trigger manual update
curl https://your-site.pages.dev/api/pricing
```

### Get Current Prices

```bash
# Get all current price data
curl https://your-site.pages.dev/api/get-prices
```

## Data Format

### Card Keys
Cards are identified using the format: `"Card Name::SET::NUMBER"`

Examples:
- `"Ultra Ball::SVI::196"`
- `"Boss's Orders::PAL::172"`
- `"Charizard ex::OBF::125"`

### Price Data Structure
```json
{
  "lastUpdated": "2025-08-25T20:30:00.000Z",
  "updateSource": "TCGCSV",
  "cardPrices": {
    "Ultra Ball::SVI::196": 0.25,
    "Boss's Orders::PAL::172": 0.15,
    "Charizard ex::OBF::125": 12.50
  }
}
```

## Supported Sets

The system currently maps these set abbreviations to TCGCSV data:
- SVI, PAL, DRI, TWM, SFA, TEF, JTG, MEW
- OBF, PAR, SSP, SCR, PRE, BLK, WHT, PAF
- SVP, SVE

To add new sets, update the `KNOWN_SET_MAPPINGS` object in `functions/api/pricing.js`.

## Error Handling

- If TCGCSV is unavailable, the system logs errors but continues
- Failed set downloads don't stop processing of other sets
- Client-side caching prevents repeated API failures
- Stale price data is served if updates fail

## Performance

- Full price update processes ~2000-5000 cards
- Client-side cache: 1 hour
- API cache headers: 1 hour
- KV storage has global edge distribution

## Monitoring

Check logs in CloudFlare dashboard:
- Functions > Functions > View logs
- Monitor cron job execution
- Track API response times and error rates

## Troubleshooting

### Cron Job Not Running
- Check `wrangler.toml` cron configuration
- Verify CloudFlare Pages deployment
- Check Functions logs for errors

### No Price Data
- Verify KV namespace is created and bound
- Check TCGCSV API availability
- Run manual update via `/api/pricing`

### Price Mismatches
- Verify set abbreviation mappings
- Check TCGCSV data format changes
- Test with `/api/test-pricing?action=csv`

### API Errors
- Check CORS headers
- Verify KV binding configuration
- Monitor CloudFlare error rates