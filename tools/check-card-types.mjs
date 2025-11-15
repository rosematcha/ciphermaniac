#!/usr/bin/env node
/**
 * Check card types database for missing cards
 * Reports which cards are in tournament data but not in the card types database
 */

import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CARD_TYPES_DB_PATH = join(__dirname, '..', 'public', 'assets', 'data', 'card-types.json');
const REPORTS_BASE_PATH = join(__dirname, '..', 'public', 'reports');
const MASTER_FILE_NAME = 'master.json';

/**
 * Load existing card types database
 * @returns {Promise<Object>}
 */
async function loadDatabase() {
  try {
    const content = await fs.readFile(CARD_TYPES_DB_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
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
  const allCards = new Set();
  const jsonFiles = await findMasterReports(REPORTS_BASE_PATH);
  
  for (const file of jsonFiles) {
    const cards = await extractCardsFromReport(file);
    cards.forEach(card => allCards.add(card));
  }
  
  return allCards;
}

/**
 * Main execution
 */
async function main() {
  console.log('🔍 Card Types Database Check\n');
  
  // Load database
  const database = await loadDatabase();
  const dbCardCount = Object.keys(database).length;
  console.log(`📚 Database contains ${dbCardCount} cards`);
  
  // Collect all cards from reports
  console.log('📦 Scanning all tournament reports...');
  const allCards = await collectAllCards();
  console.log(`   Found ${allCards.size} unique cards in reports\n`);
  
  // Find missing cards
  const missingCards = [];
  for (const cardKey of allCards) {
    if (!database[cardKey]) {
      missingCards.push(cardKey);
    }
  }
  
  if (missingCards.length === 0) {
    console.log('✅ All cards are in the database!');
    process.exit(0);
  }
  
  console.log(`⚠️  Found ${missingCards.length} cards missing from database:\n`);
  
  // Group by set for better readability
  const bySet = {};
  for (const card of missingCards) {
    const [set, number] = card.split('::');
    if (!bySet[set]) {
      bySet[set] = [];
    }
    bySet[set].push(number);
  }
  
  const sets = Object.keys(bySet).sort();
  for (const set of sets) {
    const numbers = bySet[set].sort((a, b) => {
      const numA = parseInt(a) || 0;
      const numB = parseInt(b) || 0;
      return numA - numB;
    });
    console.log(`  ${set}: ${numbers.join(', ')}`);
  }
  
  console.log(`\n💡 Run 'npm run build:card-types' to fetch missing cards`);
  
  // Exit with error code if cards are missing
  process.exit(1);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
