/**
 * CloudFlare Pages function for daily TCGCSV pricing scraping
 * Simple, focused approach: get only the sets we actually need
 */

const TCGCSV_GROUPS_URL = 'https://tcgcsv.com/tcgplayer/3/groups';

// Known set mappings to avoid API calls where possible
// Update this list as new sets are added to your database
const KNOWN_SET_MAPPINGS = {
  'SVI': null,    // Will be populated from TCGCSV
  'PAL': null,
  'DRI': null,
  'TWM': null,
  'SFA': null,
  'TEF': null,
  'JTG': null,
  'MEW': null,
  'OBF': null,
  'PAR': null,
  'SSP': null,
  'SCR': null,
  'PRE': null,
  'BLK': null,
  'WHT': null,
  'PAF': null,
  'SVP': null,
  'SVE': null
};

export async function onRequestGet({ env }) {
  try {
    console.log('Starting daily pricing update...');
    
    // Step 1: Get TCGCSV groups data
    const groupsResponse = await fetch(TCGCSV_GROUPS_URL);
    if (!groupsResponse.ok) {
      throw new Error(`TCGCSV groups API error: ${groupsResponse.status}`);
    }
    
    const groupsData = await groupsResponse.json();
    if (!groupsData.success) {
      throw new Error('TCGCSV groups API returned success: false');
    }

    // Step 2: Map our set abbreviations to TCGCSV group IDs
    const setMappings = mapSetsToGroupIds(groupsData.results);
    
    // Step 3: Download CSVs for each set and extract prices
    const priceData = await fetchPricesForSets(setMappings);
    
    // Step 4: Store the results
    await storePriceData(env, priceData);
    
    return new Response(JSON.stringify({ 
      success: true,
      setsProcessed: Object.keys(setMappings).length,
      cardsProcessed: Object.keys(priceData).length,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Pricing update error:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Pricing update failed',
      message: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Map set abbreviations to TCGCSV group IDs
 * Simple approach: find exact matches by abbreviation
 */
function mapSetsToGroupIds(groups) {
  const mappings = {};
  
  for (const setAbbr of Object.keys(KNOWN_SET_MAPPINGS)) {
    // Find the group with matching abbreviation
    const group = groups.find(g => g.abbreviation === setAbbr);
    if (group) {
      mappings[setAbbr] = group.groupId;
      console.log(`Found mapping: ${setAbbr} -> ${group.groupId} (${group.name})`);
    } else {
      console.warn(`No TCGCSV group found for set: ${setAbbr}`);
    }
  }
  
  return mappings;
}

/**
 * Download and parse CSV data for each set
 * Extract only the data we need: name, set number, market price
 */
async function fetchPricesForSets(setMappings) {
  const allPrices = {};
  
  for (const [setAbbr, groupId] of Object.entries(setMappings)) {
    if (!groupId) continue;
    
    try {
      console.log(`Fetching prices for set: ${setAbbr} (${groupId})`);
      const csvUrl = `https://tcgcsv.com/tcgplayer/3/${groupId}/ProductsAndPrices.csv`;
      
      const response = await fetch(csvUrl);
      if (!response.ok) {
        console.warn(`Failed to fetch CSV for ${setAbbr}: ${response.status}`);
        continue;
      }
      
      const csvText = await response.text();
      const setPrices = parseCsvPrices(csvText, setAbbr);
      
      // Merge into main price data
      Object.assign(allPrices, setPrices);
      
      console.log(`Processed ${Object.keys(setPrices).length} cards from ${setAbbr}`);
      
    } catch (error) {
      console.error(`Error processing set ${setAbbr}:`, error);
      // Continue with other sets
    }
  }
  
  return allPrices;
}

/**
 * Parse CSV and extract price data
 * Return format: { "card_name::SET::number": marketPrice }
 */
function parseCsvPrices(csvText, setAbbr) {
  const prices = {};
  const lines = csvText.split('\n');
  
  if (lines.length < 2) {
    console.warn(`Invalid CSV format for set ${setAbbr}`);
    return prices;
  }
  
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    try {
      // Parse CSV line - be careful with commas in quoted strings
      const fields = parseCSVLine(line);
      
      if (fields.length < 14) continue; // Need at least 14 fields for marketPrice
      
      const name = fields[1]; // Card name
      const extNumber = fields[17]; // Card number  
      const marketPrice = parseFloat(fields[13]); // Market price
      
      if (!name || !extNumber || isNaN(marketPrice)) continue;
      
      // Clean up the card name and number
      const cleanName = name.replace(/['"]/g, '').trim();
      const cleanNumber = extNumber.split('/')[0]; // Take just the number part (before slash)
      
      // Create the card key in your format
      const cardKey = `${cleanName}::${setAbbr}::${cleanNumber.padStart(3, '0')}`;
      prices[cardKey] = marketPrice;
      
    } catch (error) {
      // Skip malformed lines
      continue;
    }
  }
  
  return prices;
}

/**
 * Simple CSV parser that handles quoted strings
 */
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  fields.push(current); // Don't forget the last field
  return fields;
}

/**
 * Store price data using CloudFlare KV or return for external storage
 */
async function storePriceData(env, priceData) {
  const jsonData = {
    lastUpdated: new Date().toISOString(),
    updateSource: 'TCGCSV',
    cardPrices: priceData
  };
  
  // If KV binding exists, store there
  if (env.PRICE_DATA) {
    await env.PRICE_DATA.put('current_prices', JSON.stringify(jsonData));
    console.log('Price data stored in KV');
  }
  
  // Also log summary for debugging
  console.log(`Price update complete: ${Object.keys(priceData).length} cards updated`);
  
  return jsonData;
}