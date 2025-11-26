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

const VALID_TRAINER_SUBTYPES = new Set(['supporter', 'item', 'stadium', 'tool']);
const VALID_ENERGY_SUBTYPES = new Set(['basic', 'special']);
const BASIC_ENERGY_NAMES = new Set([
  'grass energy',
  'fire energy',
  'water energy',
  'lightning energy',
  'psychic energy',
  'fighting energy',
  'darkness energy',
  'metal energy'
]);

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
  const cards = new Map();
  
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const report = JSON.parse(content);
    
    if (report.items && Array.isArray(report.items)) {
      for (const item of report.items) {
        if (item.set && item.number) {
          const key = `${item.set}::${item.number}`;
          if (!cards.has(key)) {
            cards.set(key, {
              names: new Set(),
              sampleCategory: null
            });
          }
          const entry = cards.get(key);
          if (typeof item.name === 'string' && item.name.trim()) {
            entry.names.add(item.name.trim());
          }
          if (!entry.sampleCategory && typeof item.category === 'string' && item.category.trim()) {
            entry.sampleCategory = item.category.trim().toLowerCase();
          }
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
  const allCards = new Map();
  const jsonFiles = await findMasterReports(REPORTS_BASE_PATH);
  
  for (const file of jsonFiles) {
    const cards = await extractCardsFromReport(file);
    cards.forEach((meta, key) => {
      if (!allCards.has(key)) {
        allCards.set(key, {
          names: new Set(meta.names),
          sampleCategory: meta.sampleCategory || null
        });
        return;
      }
      const aggregate = allCards.get(key);
      meta.names.forEach(name => aggregate.names.add(name));
      if (!aggregate.sampleCategory && meta.sampleCategory) {
        aggregate.sampleCategory = meta.sampleCategory;
      }
    });
  }
  
  return allCards;
}

function determineExpectedEnergySubtype(meta = {}) {
  const names = meta.names instanceof Set ? meta.names : new Set();
  if (names.size === 0) {
    return null;
  }
  for (const rawName of names) {
    const normalized = String(rawName || '').trim().toLowerCase();
    if (BASIC_ENERGY_NAMES.has(normalized)) {
      return 'basic';
    }
  }
  return 'special';
}

function evaluateClassification(entry, meta) {
  const cardType = typeof entry?.cardType === 'string' ? entry.cardType.trim().toLowerCase() : '';
  const subType = typeof entry?.subType === 'string' ? entry.subType.trim().toLowerCase() : '';
  if (!cardType) {
    return {
      complete: false,
      reason: 'missing base card type',
      actual: 'unknown'
    };
  }
  if (cardType === 'pokemon') {
    return { complete: true, slug: 'pokemon' };
  }
  if (cardType === 'trainer') {
    if (!subType) {
      return {
        complete: false,
        reason: 'missing trainer subtype',
        actual: 'trainer'
      };
    }
    if (!VALID_TRAINER_SUBTYPES.has(subType)) {
      return {
        complete: false,
        reason: `invalid trainer subtype '${subType}'`,
        actual: `trainer/${subType}`,
        expected: 'trainer/supporter|item|stadium|tool'
      };
    }
    const parts = ['trainer', subType];
    if (entry?.aceSpec) {
      parts.push('acespec');
    }
    return {
      complete: true,
      slug: parts.join('/')
    };
  }
  if (cardType === 'energy') {
    const expectedSubType = determineExpectedEnergySubtype(meta);
    if (!subType) {
      return {
        complete: false,
        reason: 'missing energy subtype',
        actual: 'energy',
        expected: expectedSubType ? `energy/${expectedSubType}` : 'energy/basic or energy/special'
      };
    }
    if (!VALID_ENERGY_SUBTYPES.has(subType)) {
      return {
        complete: false,
        reason: `invalid energy subtype '${subType}'`,
        actual: `energy/${subType}`,
        expected: 'energy/basic or energy/special'
      };
    }
    if (expectedSubType && subType !== expectedSubType) {
      return {
        complete: false,
        reason: 'energy subtype mismatch',
        actual: `energy/${subType}`,
        expected: `energy/${expectedSubType}`
      };
    }
    return {
      complete: true,
      slug: `energy/${subType}`
    };
  }
  return {
    complete: false,
    reason: `unknown card type '${cardType}'`,
    actual: cardType
  };
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
  
  const missingCards = [];
  const incompleteCards = [];
  for (const [cardKey, meta] of allCards.entries()) {
    const entry = database[cardKey];
    if (!entry) {
      missingCards.push(cardKey);
      continue;
    }
    const status = evaluateClassification(entry, meta);
    if (!status.complete) {
      incompleteCards.push({
        key: cardKey,
        reason: status.reason,
        expected: status.expected || null,
        actual: status.actual || status.slug || null,
        names: meta.names ? Array.from(meta.names) : []
      });
    }
  }
  
  if (missingCards.length === 0 && incompleteCards.length === 0) {
    console.log('[OK] All cards are in the database and fully classified.');
    process.exit(0);
  }
  
  if (missingCards.length > 0) {
    console.log(`[WARN] ${missingCards.length} cards missing from database:\n`);
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
        const numA = parseInt(a, 10) || 0;
        const numB = parseInt(b, 10) || 0;
        return numA - numB;
      });
      console.log(`  ${set}: ${numbers.join(', ')}`);
    }
  }
  
  if (incompleteCards.length > 0) {
    console.log(`\n[WARN] ${incompleteCards.length} cards with incomplete classification:\n`);
    const grouped = incompleteCards.reduce((acc, card) => {
      const reason = card.reason || 'unknown issue';
      if (!acc[reason]) {
        acc[reason] = [];
      }
      acc[reason].push(card);
      return acc;
    }, {});
    Object.keys(grouped).forEach(reason => {
      const entries = grouped[reason];
      console.log(`  ${reason} (${entries.length} cards):`);
      entries.forEach(entry => {
        const [set, number] = entry.key.split('::');
        const name = entry.names?.[0] || 'Unknown name';
        const expected = entry.expected ? ` -> expected ${entry.expected}` : '';
        const actual = entry.actual ? ` (current ${entry.actual})` : '';
        console.log(`    - ${name} (${set} ${number})${expected}${actual}`);
      });
    });
  }
  
  console.log("\n[INFO] Run 'npm run build:card-types' to fetch missing cards or refresh incomplete entries");
  
  process.exit(1);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
