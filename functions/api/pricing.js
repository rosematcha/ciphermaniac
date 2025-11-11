/**
 * CloudFlare Pages function for daily TCGCSV pricing scraping
 *
 * APPROACH: Excel-style CSV parsing for maximum accuracy
 * 1. Parse CSV into structured table (handles multi-line fields properly)
 * 2. Extract only essential columns by name: productId, name, marketPrice, extNumber
 * 3. Use reliable marketPrice column directly (avoids corrupted highPrice data)
 *
 * This eliminates field shifting issues and ensures consistent pricing.
 */

const TCGCSV_GROUPS_URL = 'https://tcgcsv.com/tcgplayer/3/groups';
const CARD_SYNONYMS_URL = 'https://ciphermaniac.com/assets/card-synonyms.json';
const REPORTS_BASE_URL = 'https://ciphermaniac.com/reports';
const MANUAL_GROUP_ID_MAP = {
  MEP: 24451,
  SVP: 22872
};

const BASIC_ENERGY_CANONICALS = {
  'Grass Energy': 'Grass Energy::SVE::017',
  'Psychic Energy': 'Psychic Energy::SVE::021',
  'Lightning Energy': 'Lightning Energy::SVE::019',
  'Fire Energy': 'Fire Energy::SVE::018',
  'Darkness Energy': 'Darkness Energy::SVE::015',
  'Metal Energy': 'Metal Energy::SVE::020',
  'Fighting Energy': 'Fighting Energy::SVE::016',
  'Water Energy': 'Water Energy::SVE::022'
};

const BASIC_ENERGY_NAMES = new Set([
  'Darkness Energy',
  'Fighting Energy',
  'Fire Energy',
  'Grass Energy',
  'Lightning Energy',
  'Metal Energy',
  'Psychic Energy',
  'Water Energy'
]);

const SPECIAL_ENERGY_FALLBACKS = [
  'Superior Energy Retrieval::PAL::189'
];

export async function onRequestGet({ env }) {
  try {
    console.log('Starting daily pricing update...');

    const context = await loadPricingContext(env);

    const groupsData = await fetchJson(TCGCSV_GROUPS_URL, 'TCGCSV groups API');
    if (!groupsData.success) {
      throw new Error('TCGCSV groups API returned success: false');
    }
    
    const setMappings = mapSetsToGroupIds(groupsData.results, context.sets);

    const priceData = await fetchPricesForSets(setMappings, context);

    await addBasicEnergyPrices(priceData, context);

    const foundCards = new Set(Object.keys(priceData));
    const missingCards = context.cardList.filter(card => !foundCards.has(card));
    
    // Group missing cards by set for better reporting
    const missingBySet = {};
    missingCards.forEach(card => {
      const parts = card.split('::');
      if (parts.length >= 2) {
        const setCode = parts[1];
        if (!missingBySet[setCode]) {
          missingBySet[setCode] = [];
        }
        missingBySet[setCode].push(card);
      }
    });
    
    // Store the results
    await storePriceData(env, priceData);
    
    const response = { 
      success: true,
      setsProcessed: Object.keys(setMappings).length,
      cardsProcessed: Object.keys(priceData).length,
      databaseCards: context.cardList.length,
      matchRate: context.cardList.length > 0
        ? `${((Object.keys(priceData).length / context.cardList.length) * 100).toFixed(1)}%`
        : '0.0%',
      timestamp: new Date().toISOString()
    };
    
    // Add missing cards info if there are any
    if (missingCards.length > 0) {
      response.missingCards = {
        count: missingCards.length,
        bySet: missingBySet,
        // Include first 10 missing cards for quick reference
        examples: missingCards.slice(0, 10)
      };
      console.log(`Missing ${missingCards.length} cards from pricing data:`, missingBySet);
    }
    
    return new Response(JSON.stringify(response), {
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
 * Map database set abbreviations to TCGCSV group IDs
 * Only maps sets that actually exist in our database
 */
function mapSetsToGroupIds(groups, databaseSets) {
  const mappings = {};
  const groupIndex = buildGroupIndex(groups);

  for (const setAbbr of databaseSets) {
    const group = groupIndex.get(setAbbr);
    if (group) {
      mappings[setAbbr] = group.groupId;
      console.log(`Found mapping: ${setAbbr} -> ${group.groupId} (${group.name})`);
    } else {
      const manualGroupId = MANUAL_GROUP_ID_MAP[setAbbr];
      if (manualGroupId) {
        mappings[setAbbr] = manualGroupId;
        console.log(`Manual group mapping applied: ${setAbbr} -> ${manualGroupId}`);
      } else {
        console.warn(`No TCGCSV group found for database set: ${setAbbr}`);
      }
    }
  }
  
  return mappings;
}

function buildGroupIndex(groups) {
  const index = new Map();
  if (!Array.isArray(groups)) {
    return index;
  }

  for (const group of groups) {
    if (group && typeof group === 'object' && group.abbreviation) {
      index.set(group.abbreviation, group);
    }
  }

  return index;
}

/**
 * Download and parse CSV data for each set using Excel-style table parsing
 */
async function fetchPricesForSets(setMappings, context) {
  const combinedEntries = new Map();
  
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
      
      // Excel-style parsing: CSV → structured table → essential columns
      const cleanedData = preprocessCsvForPricing(csvText);
      const setEntries = parseCleanedPriceData(cleanedData, setAbbr, context);

      for (const [cardKey, entry] of setEntries.entries()) {
        const existing = combinedEntries.get(cardKey);
        if (!existing || shouldReplacePrice(existing, entry)) {
          combinedEntries.set(cardKey, entry);
        }
      }
      
      console.log(`Processed ${setEntries.size} cards from ${setAbbr}`);
      
    } catch (error) {
      console.error(`Error processing set ${setAbbr}:`, error);
      // Continue with other sets
    }
  }

  const allPrices = {};
  for (const [cardKey, entry] of combinedEntries.entries()) {
    allPrices[cardKey] = {
      price: entry.price,
      tcgPlayerId: entry.tcgPlayerId
    };
  }

  return allPrices;
}

/**
 * Parse TCGCSV data using Excel-like approach: structured table parsing + column extraction
 * This eliminates field shifting issues caused by multi-line descriptions
 */
function preprocessCsvForPricing(csvText) {
  console.log('Parsing CSV into structured table (Excel-style approach)...');
  
  // Step 1: Parse CSV into proper table structure (handles multi-line quoted fields)
  const table = parseCsvToTable(csvText);
  
  if (table.length === 0) {
    console.warn('No valid CSV table parsed');
    return [];
  }
  
  // Step 2: Extract only essential columns: productId, name, marketPrice, extNumber
  const cleanedRecords = extractEssentialColumnsFromTable(table);
  
  console.log(`Excel-style parsing: ${table.length} rows → ${cleanedRecords.length} clean records`);
  return cleanedRecords;
}

/**
 * Parse CSV text into a structured table (array of row objects)
 * Handles multi-line fields properly like Excel would
 */
function parseCsvToTable(csvText) {
  const lines = csvText.split('\n');
  const rows = [];
  let currentRow = '';
  let inQuotedField = false;
  
  // First, reconstruct properly terminated rows (handle multi-line quoted fields)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Count quotes to determine if we're inside a multi-line quoted field
    const quoteCount = (line.match(/"/g) || []).length;
    const unescapedQuotes = quoteCount - (line.match(/""/g) || []).length * 2;
    
    currentRow += (currentRow ? '\n' : '') + line;
    
    // Toggle quoted field state based on unescaped quotes
    inQuotedField = unescapedQuotes % 2 !== 0 ? !inQuotedField : inQuotedField;
    
    // If we're not in a quoted field and the line has content, this row is complete
    if (!inQuotedField && line.trim()) {
      rows.push(currentRow);
      currentRow = '';
    }
  }
  
  // Add final row if it exists
  if (currentRow.trim()) {
    rows.push(currentRow);
  }
  
  console.log(`Reconstructed ${rows.length} complete CSV rows from ${lines.length} raw lines`);
  
  // Parse each complete row into fields
  const parsedRows = [];
  let headers = null;
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].trim();
    if (!row) continue;
    
    const fields = parseCSVLine(row);
    
    if (i === 0) {
      // First row is headers
      headers = fields;
      continue;
    }
    
    // Skip rows that don't look like product records
    if (fields.length < 15 || !fields[0] || !fields[0].match(/^\d{6,}$/)) {
      continue;
    }
    
    // Create row object with named columns
    const rowObj = {};
    for (let j = 0; j < Math.min(fields.length, headers.length); j++) {
      rowObj[headers[j]] = fields[j];
    }
    
    parsedRows.push(rowObj);
  }
  
  console.log(`Parsed ${parsedRows.length} valid product rows with ${headers?.length} columns`);
  return parsedRows;
}

/**
 * Extract only essential columns from the parsed table
 * Much simpler now that we have properly structured data
 */
function extractEssentialColumnsFromTable(table) {
  const cleanedRecords = [];
  
  for (const row of table) {
    // Extract the exact columns we need by name
    const productId = row.productId;
    const name = row.name;
    const marketPrice = parseFloat(row.marketPrice) || 0;
    const extNumber = row.extNumber;
    const numberInfo = normalizeCardNumberInfo(extNumber);
    
    // Validate we have the essential data
    if (!productId || !name || !numberInfo) {
      continue;
    }
    
    // Validate market price is reasonable (filter corruption)
    if (!isReasonablePrice(marketPrice)) {
      continue;
    }
    
    cleanedRecords.push({
      productId,
      name: name.replace(/"/g, '').trim(), // Clean quotes
      marketPrice,
      extNumber: numberInfo.raw,
      cardNumber: numberInfo.cardNumber
    });
  }
  
  return cleanedRecords;
}


function normalizeCardNumberInfo(extNumber) {
  if (extNumber === undefined || extNumber === null) {
    return null;
  }

  const raw = String(extNumber).trim();
  if (!raw) {
    return null;
  }

  const slashMatch = raw.match(/^(\d{1,3})\/(\d{2,3})$/);
  if (slashMatch) {
    return {
      raw,
      cardNumber: slashMatch[1].padStart(3, '0')
    };
  }

  const plainDigits = raw.match(/^(\d{1,3})$/);
  if (plainDigits) {
    return {
      raw,
      cardNumber: plainDigits[1].padStart(3, '0')
    };
  }

  const trailingDigits = raw.match(/(\d{1,4})$/);
  if (trailingDigits) {
    const digits = trailingDigits[1].slice(-3);
    return {
      raw,
      cardNumber: digits.padStart(3, '0')
    };
  }

  const digitMatches = raw.match(/\d+/g);
  if (digitMatches && digitMatches.length > 0) {
    const last = digitMatches[digitMatches.length - 1];
    const digits = last.slice(-3);
    return {
      raw,
      cardNumber: digits.padStart(3, '0')
    };
  }

  return null;
}


function deriveCardNumber(record) {
  if (record?.cardNumber) {
    return record.cardNumber;
  }

  const info = normalizeCardNumberInfo(record?.extNumber);
  return info ? info.cardNumber : null;
}


function normalizeCardName(name) {
  if (!name) {
    return '';
  }

  let cleaned = String(name).trim();

  cleaned = cleaned.replace(/\s*-\s*\d{1,3}\/?\d{0,3}$/u, '');
  cleaned = cleaned.replace(/\s+#?\d{1,3}$/u, '');
  cleaned = cleaned.replace(/\s+Promo$/iu, '');
  cleaned = cleaned.replace(/\s+Prerelease$/iu, '');
  cleaned = cleaned.replace(/\s+Alt Art$/iu, '');
  cleaned = cleaned.replace(/\s+\((Promo|Prerelease|Alt Art|Alternate Art|Illustration Rare|Special Illustration Rare)\)$/iu, '');

  return cleaned.trim();
}


/**
 * Process clean table-based price data into final format
 * Simple and reliable - no more complex field detection needed
 */
function parseCleanedPriceData(cleanedRecords, setAbbr, context) {
  const prices = new Map();
  let processedCount = 0;
  let matchedCount = 0;
  
  for (const record of cleanedRecords) {
    processedCount++;
    
  const cleanName = normalizeCardName(record.name);
    const cleanNumber = deriveCardNumber(record);
    if (!cleanNumber) {
      continue;
    }

    // Create the card key in database format
    const cardKey = `${cleanName}::${setAbbr}::${cleanNumber}`;
    const normalizedCardKey = normalizeAccentedChars(cardKey);
    const canonicalKey = resolveCanonicalUid(cardKey, context.synonymsData);
    const normalizedCanonicalKey = normalizeAccentedChars(canonicalKey);

    let finalCardKey = null;

    if (context.cardSet.has(canonicalKey)) {
      finalCardKey = canonicalKey;
    } else if (context.normalizedCardMap.has(normalizedCanonicalKey)) {
      finalCardKey = context.normalizedCardMap.get(normalizedCanonicalKey);
    } else if (context.cardSet.has(cardKey)) {
      finalCardKey = cardKey;
    } else if (context.normalizedCardMap.has(normalizedCardKey)) {
      finalCardKey = context.normalizedCardMap.get(normalizedCardKey);
    }

    if (!finalCardKey) {
      continue;
    }

    matchedCount++;

    const recordNameLower = record.name ? record.name.toLowerCase() : '';
    if (recordNameLower.includes('noctowl') ||
        recordNameLower.includes('pikachu ex') ||
        recordNameLower.includes('gholdengo ex') ||
        recordNameLower.includes('iron hands ex') ||
        recordNameLower.includes('precious trolley') ||
        recordNameLower.includes('area zero')) {

      // Debug logging for specific cards (disabled in production)
      // console.log(`TABLE-BASED PARSING: ${record.name}`);
      // console.log(`  ProductId: ${record.productId}`);
      // console.log(`  ExtNumber: ${record.extNumber}`);
      // console.log(`  MarketPrice: $${record.marketPrice} (from marketPrice column)`);
      // console.log(`  FinalCardKey: ${finalCardKey}`);
    }

    const entry = {
      price: record.marketPrice,
      tcgPlayerId: record.productId,
      sourceSet: setAbbr,
      isCanonicalSet: finalCardKey.split('::')[1] === setAbbr
    };

    const existing = prices.get(finalCardKey);
    if (!existing || shouldReplacePrice(existing, entry)) {
      prices.set(finalCardKey, entry);
    }
  }
  
  console.log(`Table-based parsing for ${setAbbr}: processed ${processedCount} records, matched ${matchedCount} database cards`);
  return prices;
}

/**
 * Validate if a price is reasonable and not corrupted data
 * Filters out TCGCSV's common data corruption patterns
 */
function isReasonablePrice(price) {
  if (!price || isNaN(price) || price <= 0) return false;
  
  // Reject TCGCSV corruption patterns:
  if (price > 500) return false;                    // Very few cards worth >$500
  if (String(price).includes('69420')) return false; // Common corruption pattern
  if (price > 100 && price % 50 === 0) return false; // Suspicious round numbers >$100
  if (price > 50 && price % 25 === 0) return false;  // Suspicious round numbers >$50
  
  return true;
}



/**
 * Add basic energy card prices if they exist in database
 * Basic energies are often in a separate set or have special pricing
 */
async function addBasicEnergyPrices(priceData, context) {
  // ONLY set the 8 basic energy types to $0.01 if missing
  // All other energy cards should get real prices from their respective sets
  // Find any missing basic energy cards and set to $0.01
  const missingBasicEnergies = context.cardList.filter(card => {
    if (priceData[card]) return false; // Already have price
    
    const cardName = card.split('::')[0];
    return BASIC_ENERGY_NAMES.has(cardName);
  });
  
  if (missingBasicEnergies.length > 0) {
    console.log(`Setting ${missingBasicEnergies.length} basic energy cards to $0.01:`, missingBasicEnergies);
    missingBasicEnergies.forEach(card => {
      priceData[card] = {
        price: 0.01, // Only basic energies are practically free
        tcgPlayerId: null // Basic energies don't have TCGPlayer IDs
      };
    });
  }
  
  // SPECIAL CASE: Handle known malformed energy cards with reasonable default prices
  SPECIAL_ENERGY_FALLBACKS.forEach(card => {
    if (!priceData[card] && context.cardSet.has(card)) {
      priceData[card] = {
        price: 0.75, // Reasonable default for special energy cards
        tcgPlayerId: null // Malformed entries don't have reliable TCGPlayer IDs
      };
      console.log(`Applied fallback price for malformed CSV entry: ${card} = $0.75`);
    }
  });
  
  // Report any other missing energy-related cards (but don't set prices - they should come from regular CSV parsing)
  const otherMissingEnergies = context.energyCards.filter(card => {
    if (priceData[card]) return false;
    const cardName = card.split('::')[0];
    return !BASIC_ENERGY_NAMES.has(cardName);
  });
  
  if (otherMissingEnergies.length > 0) {
    console.warn(`Missing prices for special energy cards (should come from regular sets):`, otherMissingEnergies);
  }
  
  console.log(`Energy processing complete: ${context.energyCards.length} total energy cards, ${missingBasicEnergies.length} set to $0.01`);
}

async function loadPricingContext(env) {
  const synonymsData = await fetchCardSynonyms();
  const cardSet = await fetchCurrentCardPool(env, synonymsData);

  if (!cardSet || cardSet.size === 0) {
    throw new Error('Card pool is empty; unable to proceed with pricing update');
  }

  const cardList = Array.from(cardSet);
  const sets = new Set();

  for (const card of cardList) {
    const parts = card.split('::');
    if (parts.length >= 2 && parts[1]) {
      sets.add(parts[1]);
    }
  }

  const normalizedCardMap = buildNormalizedCardMap(cardList);
  const energyCards = cardList.filter(card => card.toLowerCase().includes('energy'));

  console.log(`Card pool contains ${cardList.length} cards across ${sets.size} sets`);

  return {
    cardSet,
    cardList,
    sets,
    normalizedCardMap,
    energyCards,
    synonymsData
  };
}

async function fetchCardSynonyms() {
  try {
    const response = await fetch(CARD_SYNONYMS_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return {
      synonyms: data?.synonyms || {},
      canonicals: data?.canonicals || {}
    };
  } catch (error) {
    console.warn('Failed to load card synonyms; continuing without overrides', error.message);
    return { synonyms: {}, canonicals: {} };
  }
}

async function fetchCurrentCardPool(env, synonymsData) {
  const cardSet = new Set();

  // Seed with known canonical overrides so we always track their prices
  Object.values(BASIC_ENERGY_CANONICALS).forEach(uid => cardSet.add(uid));
  Object.values(synonymsData.synonyms || {}).forEach(uid => uid && cardSet.add(uid));
  Object.values(synonymsData.canonicals || {}).forEach(uid => uid && cardSet.add(uid));

  let tournaments = [];
  try {
    const tournamentsData = await fetchReportJson('tournaments.json', env, 'tournaments list');
    if (Array.isArray(tournamentsData)) {
      tournaments = tournamentsData;
    } else {
      console.warn('Tournaments list is not an array; skipping tournament-based card discovery');
    }
  } catch (error) {
    console.warn('Unable to load tournaments list; proceeding with canonical-only card pool', error.message);
  }

  for (const tournament of tournaments) {
    if (!tournament || typeof tournament !== 'string') {
      continue;
    }

    try {
      const master = await fetchReportJson(`${tournament}/master.json`, env, `master report for ${tournament}`);
      const items = Array.isArray(master?.items) ? master.items : [];

      for (const item of items) {
        const uid = item?.uid || buildUidFromParts(item?.name, item?.set, item?.number);
        if (!uid) {
          continue;
        }

        const canonicalUid = resolveCanonicalUid(uid, synonymsData);
        if (canonicalUid) {
          cardSet.add(canonicalUid);
        }
      }
    } catch (error) {
      console.warn(`Failed to load master report for ${tournament}:`, error.message);
    }
  }

  return cardSet;
}

async function fetchReportJson(path, env, description) {
  const raw = await fetchReportFromStorage(path, env);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${description} JSON parse error: ${error.message}`);
  }
}

async function fetchReportFromStorage(path, env) {
  if (env?.REPORTS && typeof env.REPORTS.get === 'function') {
    try {
      const object = await env.REPORTS.get(path);
      if (object) {
        return await object.text();
      }
    } catch (error) {
      console.warn(`R2 fetch failed for ${path}:`, error.message);
    }
  }

  const url = `${REPORTS_BASE_URL}/${encodeReportPath(path)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return await response.text();
}

function encodeReportPath(path) {
  return path.split('/').map(part => encodeURIComponent(part)).join('/');
}

function buildUidFromParts(name, setCode, number) {
  if (!name || !setCode || !number) {
    return null;
  }

  const paddedNumber = String(number).padStart(3, '0');
  return `${name}::${setCode}::${paddedNumber}`;
}

function resolveCanonicalUid(cardUid, synonymsData) {
  if (!cardUid) {
    return cardUid;
  }

  const trimmed = cardUid.trim();
  if (!trimmed) {
    return cardUid;
  }

  const [baseName] = trimmed.split('::');

  if (BASIC_ENERGY_CANONICALS[baseName]) {
    return BASIC_ENERGY_CANONICALS[baseName];
  }

  const synonyms = synonymsData?.synonyms || {};
  const canonicals = synonymsData?.canonicals || {};

  if (synonyms[trimmed]) {
    return synonyms[trimmed];
  }

  const normalizedUid = normalizeAccentedChars(trimmed);
  if (normalizedUid !== trimmed && synonyms[normalizedUid]) {
    return synonyms[normalizedUid];
  }

  if (canonicals[baseName]) {
    return canonicals[baseName];
  }

  const normalizedName = normalizeAccentedChars(baseName);
  if (normalizedName !== baseName && canonicals[normalizedName]) {
    return canonicals[normalizedName];
  }

  return trimmed;
}

function shouldReplacePrice(existing, incoming) {
  if (!existing) {
    return true;
  }

  if (incoming.isCanonicalSet && !existing.isCanonicalSet) {
    return true;
  }

  if (existing.isCanonicalSet === incoming.isCanonicalSet) {
    if (!incoming.price || incoming.price <= 0) {
      return false;
    }
    if (!existing.price || existing.price <= 0) {
      return true;
    }
    return incoming.price < existing.price;
  }

  return false;
}

async function fetchJson(url, description) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${description} error: HTTP ${response.status}`);
  }

  return await response.json();
}


/**
 * RFC 4180 compliant CSV parser that properly handles quotes and escapes
 */
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  
  while (i < line.length) {
    const char = line[i];
    
    if (char === '"') {
      if (!inQuotes) {
        // Starting quoted field
        inQuotes = true;
      } else if (i + 1 < line.length && line[i + 1] === '"') {
        // Escaped quote (double quote within quotes)
        current += '"';
        i++; // Skip the second quote
      } else {
        // Ending quoted field
        inQuotes = false;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator outside of quotes
      fields.push(current);
      current = '';
    } else {
      // Regular character
      current += char;
    }
    
    i++;
  }
  
  // Add the last field
  fields.push(current);
  
  // Trim whitespace from non-quoted fields only
  return fields.map(field => field.trim());
}

/**
 * Normalize accented characters to ASCII equivalents
 * @param {string} str - String with potential accented characters
 * @returns {string} Normalized string with ASCII characters
 */
function normalizeAccentedChars(str) {
  // Common accented character mappings used in Pokemon cards
  const accentMap = {
    'á': 'a', 'à': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a', 'å': 'a',
    'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
    'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
    'ó': 'o', 'ò': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o', 'ø': 'o',
    'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
    'ñ': 'n', 'ç': 'c',
    'Á': 'A', 'À': 'A', 'Â': 'A', 'Ä': 'A', 'Ã': 'A', 'Å': 'A',
    'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E',
    'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I',
    'Ó': 'O', 'Ò': 'O', 'Ô': 'O', 'Ö': 'O', 'Õ': 'O', 'Ø': 'O',
    'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U',
    'Ñ': 'N', 'Ç': 'C'
  };
  
  return str.replace(/[áàâäãåéèêëíìîïóòôöõøúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕØÚÙÛÜÑÇ]/g, function(match) {
    return accentMap[match] || match;
  });
}

function buildNormalizedCardMap(cards) {
  const normalizedMap = new Map();

  for (const card of cards) {
    const normalizedKey = normalizeAccentedChars(card);
    if (!normalizedMap.has(normalizedKey)) {
      normalizedMap.set(normalizedKey, card);
    }
  }

  return normalizedMap;
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