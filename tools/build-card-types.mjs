#!/usr/bin/env node
/**
 * Build card type database by scraping Limitless TCG card pages
 * Fetches card type information (Pokemon, Trainer - Item, Energy - Special, etc.)
 * for all cards found in tournament reports and online meta
 */

import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CARD_TYPES_DB_PATH = join(__dirname, '..', 'public', 'assets', 'data', 'card-types.json');
const REPORTS_BASE_PATH = join(__dirname, '..', 'public', 'reports');
const RATE_LIMIT_MS = 250; // 4 requests per second to be respectful
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const MASTER_FILE_NAME = 'master.json';

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch card type from Limitless TCG
 * @param {string} setCode
 * @param {string} number
 * @returns {Promise<{cardType: string, subType: string|null, evolutionInfo: string|null} | null>}
 */
async function fetchCardTypeFromLimitless(setCode, number) {
  const url = `https://limitlesstcg.com/cards/${setCode}/${number}`;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url);
      
      if (response.status === 404) {
        console.log(`  ⚠️  Card not found: ${setCode}/${number}`);
        return null;
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const html = await response.text();
      
      // Extract card-text-type div content
      // Example formats:
      // "Trainer - Item"
      // "Trainer - Stadium"
      // "Energy - Special Energy"
      // "Energy - Basic"
      // "Pokémon - Stage 2 - Evolves from Kirlia"
      // "Pokémon - Basic"
      const match = html.match(/<(?:div|p)[^>]*class="card-text-type"[^>]*>([^<]+)<\/(?:div|p)>/i);
      
      if (!match) {
        console.log(`  ⚠️  Could not find card type for ${setCode}/${number}`);
        return null;
      }
      
      const fullType = match[1].trim();
      const parts = fullType.split(' - ').map(p => p.trim());
      const normalize = value =>
        value
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();

      // Parse the type information
      const cardType = normalize(parts[0]); // "pokemon", "trainer", "energy"
      let subType = null;
      let evolutionInfo = null;
      let aceSpec = false;
      
      if (cardType === 'trainer' && parts.length > 1) {
        const subtypeText = normalize(parts[1]);
        if (subtypeText.includes('tool')) {
          subType = 'tool';
        } else if (subtypeText.includes('supporter')) {
          subType = 'supporter';
        } else if (subtypeText.includes('stadium')) {
          subType = 'stadium';
        } else if (subtypeText.includes('item')) {
          subType = 'item';
        } else {
          subType = subtypeText;
        }
        aceSpec = parts.some(part => normalize(part).includes('ace spec'));
        if (aceSpec && subType !== 'tool') {
          subType = 'tool';
        }
      } else if (cardType === 'energy' && parts.length > 1) {
        // "Special Energy" or just "Basic"
        const subtypeText = normalize(parts[1]);
        if (subtypeText.includes('special')) {
          subType = 'special';
        } else {
          subType = 'basic';
        }
      } else if (cardType === 'pokemon') {
        if (parts.length > 1) {
          evolutionInfo = parts.slice(1).join(' - '); // "Stage 2 - Evolves from Kirlia"
        }
      }

      return {
        cardType,
        subType,
        evolutionInfo,
        fullType,
        ...(aceSpec ? { aceSpec: true } : {})
      };
      
    } catch (error) {
      if (attempt < MAX_RETRIES - 1) {
        console.log(`  ⚠️  Retry ${attempt + 1}/${MAX_RETRIES} for ${setCode}/${number}: ${error.message}`);
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(`  ❌ Failed to fetch ${setCode}/${number} after ${MAX_RETRIES} attempts:`, error.message);
        return null;
      }
    }
  }
  
  return null;
}

/**
 * Load existing card types database
 * @returns {Promise<Object>}
 */
async function loadExistingDatabase() {
  try {
    const content = await fs.readFile(CARD_TYPES_DB_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No existing database found, creating new one...');
      return {};
    }
    throw error;
  }
}

/**
 * Save card types database
 * @param {Object} database
 * @returns {Promise<void>}
 */
async function saveDatabase(database) {
  // Ensure directory exists
  await fs.mkdir(dirname(CARD_TYPES_DB_PATH), { recursive: true });
  
  // Sort by key for consistent output
  const sorted = Object.keys(database)
    .sort()
    .reduce((acc, key) => {
      acc[key] = database[key];
      return acc;
    }, {});
  
  await fs.writeFile(
    CARD_TYPES_DB_PATH,
    JSON.stringify(sorted, null, 2) + '\n',
    'utf-8'
  );
}

/**
 * Extract cards from a report JSON file
 * @param {string} filePath
 * @returns {Promise<Set<string>>}
 */
async function extractCardsFromReport(filePath) {
  const cards = new Set();
  
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const report = JSON.parse(content);
    
    if (report.items && Array.isArray(report.items)) {
      for (const item of report.items) {
        if (item.set && item.number) {
          const key = `${item.set}::${item.number}`;
          cards.add(key);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
  }
  
  return cards;
}

/**
 * Recursively find all JSON files in a directory
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function findMasterReports(dir) {
  const files = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory()) {
        const subFiles = await findMasterReports(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name === MASTER_FILE_NAME) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Error reading directory ${dir}:`, error.message);
    }
  }
  
  return files;
}

/**
 * Collect all unique cards from all tournament reports
 * @returns {Promise<Set<string>>}
 */
async function collectAllCards() {
  console.log('📦 Collecting cards from all reports...');
  
  const allCards = new Set();
  const jsonFiles = await findMasterReports(REPORTS_BASE_PATH);
  
  console.log(`   Found ${jsonFiles.length} master.json files to scan`);
  
  for (const file of jsonFiles) {
    const cards = await extractCardsFromReport(file);
    cards.forEach(card => allCards.add(card));
  }
  
  console.log(`   Found ${allCards.size} unique cards`);
  return allCards;
}

/**
 * Main execution
 */
async function main() {
  console.log('🎴 Card Type Database Builder\n');
  
  // Load existing database
  const database = await loadExistingDatabase();
  const existingCount = Object.keys(database).length;
  console.log(`📚 Loaded existing database with ${existingCount} cards\n`);
  
  // Collect all cards
  const allCards = await collectAllCards();
  
  // Find cards that need to be fetched
  const cardsToFetch = [];
  for (const cardKey of allCards) {
    if (!database[cardKey]) {
      cardsToFetch.push(cardKey);
    }
  }
  
  console.log(`\n🔍 Found ${cardsToFetch.length} cards to fetch\n`);
  
  if (cardsToFetch.length === 0) {
    console.log('✅ All cards are already in the database!');
    return;
  }
  
  // Fetch card types
  let fetched = 0;
  let errors = 0;
  
  for (const cardKey of cardsToFetch) {
    const [setCode, number] = cardKey.split('::');
    console.log(`Fetching ${cardKey} (${fetched + 1}/${cardsToFetch.length})...`);
    
    const typeInfo = await fetchCardTypeFromLimitless(setCode, number);
    
    if (typeInfo) {
      database[cardKey] = {
        cardType: typeInfo.cardType,
        ...(typeInfo.subType ? { subType: typeInfo.subType } : {}),
        ...(typeInfo.evolutionInfo ? { evolutionInfo: typeInfo.evolutionInfo } : {}),
        fullType: typeInfo.fullType,
        lastUpdated: new Date().toISOString()
      };
      fetched++;
    } else {
      errors++;
    }
    
    // Rate limiting
    await sleep(RATE_LIMIT_MS);
    
    // Save progress every 10 cards
    if (fetched % 10 === 0) {
      await saveDatabase(database);
      console.log(`   💾 Progress saved (${fetched} cards fetched)`);
    }
  }
  
  // Final save
  await saveDatabase(database);
  
  console.log(`\n✅ Complete!`);
  console.log(`   Cards in database: ${Object.keys(database).length}`);
  console.log(`   Newly fetched: ${fetched}`);
  console.log(`   Errors: ${errors}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
