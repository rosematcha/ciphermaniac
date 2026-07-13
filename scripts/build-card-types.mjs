#!/usr/bin/env node
/**
 * Build card type database by scraping Limitless TCG card pages
 * Fetches card type information (Pokemon, Trainer - Item, Energy - Special, etc.)
 * for all cards found in tournament reports and online meta
 */

import { promises as fs } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CARD_TYPES_DB_PATH = join(__dirname, '..', 'public', 'assets', 'data', 'card-types.json');
const REPORTS_BASE_PATH = join(__dirname, '..', 'public', 'reports');
const RATE_LIMIT_MS = 250; // 4 requests per second to be respectful
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
// Bump when parseCardPage gains persisted enrichment fields. This lets routine
// runs backfill prior database entries once, without repeatedly force-refreshing.
const METADATA_SCHEMA_VERSION = 1;

/**
 * Produce number variants to accommodate Limitless URLs without leading zeros.
 * @param {string|number} value
 * @returns {string[]}
 */
function buildNumberVariants(value) {
  if (value === undefined || value === null) {
    return [];
  }
  const raw = String(value).trim();
  if (!raw) {
    return [];
  }
  const normalized = raw.toUpperCase();
  const match = normalized.match(/^0*(\d+)([A-Z]*)$/);
  if (!match) {
    return [normalized];
  }
  const [, digits, suffix = ''] = match;
  const trimmedDigits = digits.replace(/^0+/, '') || '0';
  const withoutLeadingZeros = `${trimmedDigits}${suffix}`;
  const variants = [];
  variants.push(withoutLeadingZeros);
  if (withoutLeadingZeros !== normalized) {
    variants.push(normalized);
  }
  return variants;
}
const MASTER_FILE_NAME = 'master.json';

/**
 * Extract ability and attack names from a Limitless card page.
 * Abilities live in `.card-text-ability-info` ("Ability: <name>"); attacks in
 * `.card-text-attack-info` (energy-cost symbols + "<name> <damage>"). We keep
 * only the names so archetype titles ("Festival Lead", "Night March") can be
 * matched against them.
 * @param {string} html
 * @returns {{abilities: string[], attacks: string[]}}
 */
function extractCardTextNames(html) {
  const abilities = [];
  const attacks = [];

  const abilityRe = /class="card-text-ability-info"[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = abilityRe.exec(html)) !== null) {
    const name = match[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^\s*ability\s*:\s*/i, '')
      .trim();
    if (name) {
      abilities.push(name);
    }
  }

  const attackRe = /class="card-text-attack-info"[^>]*>([\s\S]*?)<\/p>/gi;
  while ((match = attackRe.exec(html)) !== null) {
    const name = match[1]
      .replace(/<span class="ptcg-symbol"[^>]*>[\s\S]*?<\/span>/gi, ' ') // drop energy cost
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+\d+[+x×]?\s*$/i, '') // drop trailing damage (e.g. "20×", "30+")
      .trim();
    if (name) {
      attacks.push(name);
    }
  }

  return { abilities, attacks };
}

/** Strip tags and collapse whitespace, preserving <br> as newlines. */
function htmlToText(fragment) {
  return fragment
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract detailed ability/attack structures from a Limitless card page.
 * Complements extractCardTextNames (which archetype matching depends on):
 * here we keep the full shape — energy cost, damage, and effect text.
 * @param {string} html
 * @returns {{abilityDetails: {name: string, effect: string|null}[],
 *            attackDetails: {cost: string|null, name: string, damage: string|null, effect: string|null}[]}}
 */
function extractCardTextDetails(html) {
  const abilityDetails = [];
  const attackDetails = [];

  const abilityBlockRe = /<div class="card-text-ability">([\s\S]*?)<\/p>\s*<p class="card-text-ability-effect"[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = abilityBlockRe.exec(html)) !== null) {
    const name = htmlToText(match[1]).replace(/^\s*ability\s*:\s*/i, '').trim();
    const effect = htmlToText(match[2]) || null;
    if (name) {
      abilityDetails.push({ name, effect });
    }
  }

  const attackBlockRe = /<p class="card-text-attack-info"[^>]*>([\s\S]*?)<\/p>\s*<p class="card-text-attack-effect"[^>]*>([\s\S]*?)<\/p>/gi;
  while ((match = attackBlockRe.exec(html)) !== null) {
    const costMatch = match[1].match(/<span class="ptcg-symbol"[^>]*>([\s\S]*?)<\/span>/i);
    const cost = costMatch ? htmlToText(costMatch[1]).replace(/\s+/g, '') || null : null;
    let nameAndDamage = htmlToText(match[1].replace(/<span class="ptcg-symbol"[^>]*>[\s\S]*?<\/span>/gi, ' '));
    let damage = null;
    const damageMatch = nameAndDamage.match(/\s(\d+[+x×]?)\s*$/i);
    if (damageMatch) {
      damage = damageMatch[1];
      nameAndDamage = nameAndDamage.slice(0, damageMatch.index).trim();
    }
    const effect = htmlToText(match[2]) || null;
    if (nameAndDamage) {
      attackDetails.push({ cost, name: nameAndDamage, damage, effect });
    }
  }

  return { abilityDetails, attackDetails };
}

/**
 * Parse everything we can from a Limitless card page.
 * Existing fields (cardType/subType/evolutionInfo/fullType/aceSpec/
 * regulationMark/abilities/attacks) keep their historical semantics —
 * archetype-title matching and the report enricher consume them — while the
 * enrichment fields (hp, rarity, attack costs, …) are additive.
 * @param {string} html
 * @returns {object|null} parsed card info, or null when no type line exists
 */
export function parseCardPage(html) {
  // Extract card-text-type content (<p> on the new site, <div> historically)
  const typeMatch = html.match(/<(?:div|p)[^>]*class="card-text-type"[^>]*>([\s\S]*?)<\/(?:div|p)>/i);
  if (!typeMatch) {
    return null;
  }

  const rawType = typeMatch[1].replace(/<[^>]+>/g, ' ');
  const fullType = rawType
    .replace(/\s+/g, ' ')
    .replace(/\s*–\s*/g, ' - ')
    .trim();
  const parts = fullType
    .split(/\s*-\s*/)
    .map(p => p.trim())
    .filter(Boolean);
  const normalize = value =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  // Parse regulation mark from div.regulation-mark
  // Format: "G Regulation Mark •" or "H Regulation Mark •" etc.
  let regulationMark = null;
  const regMarkMatch = html.match(/<div class="regulation-mark"[^>]*>\s*([A-Z])\s*Regulation\s*Mark/i);
  if (regMarkMatch) {
    regulationMark = regMarkMatch[1].toUpperCase();
  }

  // Parse the type information
  const cardType = normalize(parts[0]); // "pokemon", "trainer", "energy"
  let subType = null;
  let evolutionInfo = null;
  // ACE SPEC shows up as a segment of the type line ("Trainer - Item - ACE SPEC").
  // Limitless only marks trainers; special-energy ACE SPECs carry no marker on
  // the page, so downstream consumers still need the name heuristic for those.
  const aceSpec = parts.some(part => normalize(part).includes('ace spec'));

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

  const { abilities, attacks } = extractCardTextNames(html);
  const { abilityDetails, attackDetails } = extractCardTextDetails(html);

  // Title line: "<name> - Darkness - 210 HP" (Pokémon only carry type + HP)
  let hp = null;
  let pokemonType = null;
  const titleMatch = html.match(/<p class="card-text-title"[^>]*>([\s\S]*?)<\/p>/i);
  if (titleMatch) {
    const titleParts = htmlToText(titleMatch[1])
      .split(/\s+-\s+/)
      .map(p => p.trim())
      .filter(Boolean);
    for (const part of titleParts.slice(1)) {
      const hpMatch = part.match(/^(\d+)\s*HP$/i);
      if (hpMatch) {
        hp = Number(hpMatch[1]);
      } else if (!pokemonType) {
        pokemonType = part;
      }
    }
  }

  // Weakness / Resistance / Retreat
  let weakness = null;
  let resistance = null;
  let retreatCost = null;
  const wrrMatch = html.match(/<p class="card-text-wrr"[^>]*>([\s\S]*?)<\/p>/i);
  if (wrrMatch) {
    const wrrText = htmlToText(wrrMatch[1]);
    const grab = label => {
      const m = wrrText.match(new RegExp(`${label}:\\s*([^\\n]+)`, 'i'));
      const value = m ? m[1].trim() : null;
      return value && normalize(value) !== 'none' ? value : null;
    };
    weakness = grab('Weakness');
    resistance = grab('Resistance');
    const retreat = grab('Retreat');
    if (retreat && /^\d+$/.test(retreat)) {
      retreatCost = Number(retreat);
    }
  }

  // Rarity: ".prints-current-details" second span reads "#142 · Double Rare"
  let rarity = null;
  const printsMatch = html.match(/prints-current-details[\s\S]*?<span>\s*#[^<·]*·\s*([^<]+)<\/span>/i);
  if (printsMatch) {
    rarity = printsMatch[1].trim() || null;
  }

  // Artist
  let artist = null;
  const artistMatch = html.match(/card-text-artist[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
  if (artistMatch) {
    artist = htmlToText(artistMatch[1]) || null;
  }

  // Plain rules text (trainer/energy effect text, Tera notes, …): any
  // card-text-section without a recognized sub-block or nested markup.
  const textChunks = [];
  const sectionRe = /<div class="card-text-section"[^>]*>([\s\S]*?)<\/div>/gi;
  let sectionMatch;
  while ((sectionMatch = sectionRe.exec(html)) !== null) {
    const chunk = sectionMatch[1];
    if (/card-text-(?:ability|attack|wrr|artist|title|type)|<div/i.test(chunk)) {
      continue;
    }
    const text = htmlToText(chunk);
    if (text) {
      textChunks.push(text);
    }
  }
  const text = textChunks.length ? textChunks.join('\n\n') : null;

  // Format legality (EN formats only; JP rows link via /cards/jp)
  const legality = {};
  const legalityRe = /<a href="\/cards\?q=format:(standard|expanded)">[\s\S]*?<div class="[^"]*">\s*([\s\S]*?)\s*<\/div>/gi;
  let legalityMatch;
  while ((legalityMatch = legalityRe.exec(html)) !== null) {
    legality[legalityMatch[1]] = htmlToText(legalityMatch[2]);
  }

  return {
    metadataVersion: METADATA_SCHEMA_VERSION,
    cardType,
    subType,
    evolutionInfo,
    fullType,
    ...(aceSpec ? { aceSpec: true } : {}),
    ...(regulationMark ? { regulationMark } : {}),
    ...(abilities.length ? { abilities } : {}),
    ...(attacks.length ? { attacks } : {}),
    ...(hp !== null ? { hp } : {}),
    ...(pokemonType ? { pokemonType } : {}),
    ...(weakness ? { weakness } : {}),
    ...(resistance ? { resistance } : {}),
    ...(retreatCost !== null ? { retreatCost } : {}),
    ...(rarity ? { rarity } : {}),
    ...(artist ? { artist } : {}),
    ...(text ? { text } : {}),
    ...(abilityDetails.length ? { abilityDetails } : {}),
    ...(attackDetails.length ? { attackDetails } : {}),
    ...(Object.keys(legality).length ? { legality } : {})
  };
}

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * Fetch card type from Limitless TCG
 * @param {string} setCode
 * @param {string} number
 * @returns {Promise<{cardType: string, subType: string|null, evolutionInfo: string|null} | null>}
 */
async function fetchCardTypeFromLimitless(setCode, number) {
  const numberVariants = buildNumberVariants(number);
  if (numberVariants.length === 0) {
    return null;
  }

  for (const variant of numberVariants) {
    const result = await fetchCardTypeVariant(setCode, variant);
    if (result) {
      return result;
    }
  }

  return null;
}

async function fetchCardTypeVariant(setCode, numberVariant) {
  const url = `https://limitlesstcg.com/cards/${setCode}/${numberVariant}`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url);

      if (response.status === 404) {
        console.log(`  ⚠️  Card not found: ${setCode}/${numberVariant}`);
        break;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();

      const parsed = parseCardPage(html);
      if (!parsed) {
        console.log(`  ⚠️  Could not find card type for ${setCode}/${numberVariant}`);
        return null;
      }
      return parsed;
    } catch (error) {
      if (attempt < MAX_RETRIES - 1) {
        console.log(`  ⚠️  Retry ${attempt + 1}/${MAX_RETRIES} for ${setCode}/${numberVariant}: ${error.message}`);
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(`  ❌ Failed to fetch ${setCode}/${numberVariant} after ${MAX_RETRIES} attempts:`, error.message);
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
  const sortedKeys = Object.keys(database).sort();
  const sorted = {};
  for (const key of sortedKeys) {
    sorted[key] = database[key];
  }

  await fs.writeFile(CARD_TYPES_DB_PATH, `${JSON.stringify(sorted, null, 2)}\n`, 'utf-8');

  // Slim companion artifact: just "SET::NUMBER" → lowercase evolves-from name.
  // The frontend's evolution collapsing needs only this mapping, so it can
  // fetch ~a few KB instead of the full 700KB database (see fetchEvolutionMap).
  const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decodeEntities = s =>
    s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, ent) => {
      if (ent[0] === '#') {
        const code = ent[1].toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : all;
      }
      return NAMED_ENTITIES[ent.toLowerCase()] ?? all;
    });
  const evolvesFrom = {};
  for (const key of sortedKeys) {
    const info = sorted[key]?.evolutionInfo;
    const m = typeof info === 'string' ? info.match(/Evolves from\s+(.+?)\s*$/i) : null;
    if (m) {
      evolvesFrom[key] = decodeEntities(m[1]).trim().toLowerCase();
    }
  }
  const evolvesFromPath = join(dirname(CARD_TYPES_DB_PATH), 'evolves-from.json');
  await fs.writeFile(evolvesFromPath, `${JSON.stringify(evolvesFrom)}\n`, 'utf-8');
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
 * Parse command line arguments
 * @returns {{ forceRefresh: boolean }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    forceRefresh: args.includes('--force-refresh') || args.includes('-f')
  };
}

/**
 * Main execution
 */
async function main() {
  const { forceRefresh } = parseArgs();

  console.log('🎴 Card Type Database Builder\n');
  if (forceRefresh) {
    console.log('⚠️  FORCE REFRESH MODE: Re-fetching ALL cards to update regulation marks\n');
  }

  // Load existing database
  const database = await loadExistingDatabase();
  const existingCount = Object.keys(database).length;
  console.log(`📚 Loaded existing database with ${existingCount} cards\n`);

  // Collect all cards from reports
  const allCards = await collectAllCards();

  // Re-fetch every entry only when explicitly requested. Otherwise, include
  // entries from a prior metadata schema so additive parser changes backfill
  // automatically once, even for cards that have aged out of current reports.
  const cardsNeedingMetadataBackfill = Object.entries(database)
    .filter(([, typeInfo]) => typeInfo?.metadataVersion !== METADATA_SCHEMA_VERSION)
    .map(([cardKey]) => cardKey);
  const allCardsToProcess =
    forceRefresh || cardsNeedingMetadataBackfill.length > 0
      ? new Set([...Object.keys(database), ...allCards])
      : allCards;

  if (forceRefresh) {
    console.log(
      `📊 Database cards: ${Object.keys(database).length}, Report cards: ${allCards.length}, Combined: ${allCardsToProcess.size}`
    );
  } else if (cardsNeedingMetadataBackfill.length > 0) {
    console.log(`📊 Backfilling metadata for ${cardsNeedingMetadataBackfill.length} legacy database entries`);
  }

  // Find cards that need to be fetched
  const cardsToFetch = [];
  for (const cardKey of allCardsToProcess) {
    if (forceRefresh) {
      // In force refresh mode, re-fetch all cards
      cardsToFetch.push(cardKey);
    } else if (database[cardKey]?.metadataVersion !== METADATA_SCHEMA_VERSION) {
      // Normal mode: fetch missing cards and legacy entries requiring enrichment.
      cardsToFetch.push(cardKey);
    }
  }

  console.log(`\n🔍 Found ${cardsToFetch.length} cards to fetch\n`);

  if (cardsToFetch.length === 0) {
    console.log('✅ All cards are already in the database!');
    // Still (re)write the slim evolves-from.json companion — the CI upload step
    // expects it to exist even when no new cards were fetched (P-19).
    await saveDatabase(database);
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
      console.log(
        `  ✅ Success: ${cardKey} → ${typeInfo.cardType}${typeInfo.subType ? `/${typeInfo.subType}` : ''}${typeInfo.regulationMark ? ` [${typeInfo.regulationMark}]` : ''}`
      );
      // parseCardPage already emits only-present enrichment fields (hp, rarity,
      // attackDetails, legality, …) — persist the whole shape plus a timestamp.
      const { fullType, ...rest } = typeInfo;
      database[cardKey] = {
        ...rest,
        fullType,
        lastUpdated: new Date().toISOString()
      };
      fetched++;
    } else {
      console.log(`  ❌ Failed to fetch ${cardKey}`);
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

// Only run the CLI when executed directly — tests import parseCardPage.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
