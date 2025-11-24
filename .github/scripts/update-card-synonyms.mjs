#!/usr/bin/env node

/**
 * Generate card synonyms by analyzing all tournaments in R2 storage.
 * Creates canonical mappings for card reprints across all sets.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PUBLIC_R2_BASE = process.env.PUBLIC_R2_BASE_URL || 'https://r2.ciphermaniac.com';
const OUTPUT_PATH = join(__dirname, '../../public/assets/card-synonyms.json');

// Standard-legal sets (Scarlet & Violet era onwards, including Mega Evolution)
const STANDARD_LEGAL_SETS = new Set([
    'MEG', 'MEE', 'MEP',
    'WHT', 'BLK', 'DRI', 'JTG', 'PRE', 'SSP', 'SCR', 'SFA', 'TWM', 'TEF',
    'PAF', 'PAR', 'MEW', 'M23', 'OBF', 'PAL', 'SVE', 'SVI', 'SVP'
]);

// Promo sets (should be deprioritized)
const PROMO_SETS = new Set(['SVP', 'MEP', 'PRE', 'M23', 'PAF']);

function log(message) {
    console.log(message);
}

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing environment variable: ${name}`);
    }
    return value;
}

const R2_ACCOUNT_ID = requireEnv('R2_ACCOUNT_ID');
const R2_ACCESS_KEY_ID = requireEnv('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = requireEnv('R2_SECRET_ACCESS_KEY');
const R2_BUCKET_NAME = requireEnv('R2_BUCKET_NAME');

const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY
    }
});

async function getObject(key) {
    const command = new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key
    });
    const response = await s3Client.send(command);
    const str = await response.Body.transformToString();
    return JSON.parse(str);
}

async function putObject(key, data) {
    const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: 'application/json'
    });
    await s3Client.send(command);
}

async function loadTournamentsList() {
    log('Loading tournaments list...');
    try {
        const data = await getObject('reports/tournaments.json');
        const tournaments = Array.isArray(data) ? data : (data.tournaments || []);
        log(`  Found ${tournaments.length} tournaments`);
        return tournaments;
    } catch (error) {
        log(`  Error loading tournaments: ${error.message}`);
        return [];
    }
}

async function loadTournamentDecks(folder) {
    const key = `reports/${folder}/decks.json`;
    try {
        const decks = await getObject(key);
        return Array.isArray(decks) ? decks : [];
    } catch {
        // Silently skip tournaments without decks.json
        return [];
    }
}

async function collectAllCards(tournaments) {
    log('\nCollecting cards from all tournaments...');
    const cardsByName = new Map();
    let processed = 0;
    let skipped = 0;

    for (const tournament of tournaments) {
        const folder = typeof tournament === 'object'
            ? (tournament.folder || tournament.name || tournament.path)
            : tournament;

        if (!folder) {
            continue;
        }

        const decks = await loadTournamentDecks(folder);
        if (!decks.length) {
            skipped++;
            continue;
        }

        for (const deck of decks) {
            for (const card of deck.cards || []) {
                const cardName = (card.name || '').trim();
                const setCode = ((card.set || '').toUpperCase() || '').trim();
                const number = (card.number || '').replace(/^0+/, '').padStart(3, '0');

                if (cardName && setCode && number) {
                    if (!cardsByName.has(cardName)) {
                        cardsByName.set(cardName, new Set());
                    }
                    cardsByName.get(cardName).add(`${setCode}::${number}`);
                }
            }
        }

        processed++;
        if (processed % 5 === 0) {
            log(`  Processed ${processed}/${tournaments.length} tournaments...`);
        }
    }

    log(`  Processed ${processed} tournaments, skipped ${skipped}`);
    log(`  Found ${cardsByName.size} unique card names`);
    return cardsByName;
}

function buildNumberVariants(number) {
    if (!number) return [];
    const raw = String(number).trim();
    if (!raw) return [];

    const normalized = raw.toUpperCase();
    const match = normalized.match(/^0*(\d+)([A-Z]*)$/);
    if (!match) return [normalized];

    const [, digits, suffix] = match;
    const trimmedDigits = digits.replace(/^0+/, '') || '0';
    const primary = `${trimmedDigits}${suffix}`;
    const variants = [primary];

    const padded = `${digits}${suffix}`;
    if (primary !== padded) {
        variants.push(padded);
    }

    return variants;
}

async function requestWithRetries(url, retries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            if (response.ok) {
                return response;
            }
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }

        if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt - 1)));
        }
    }
    return null;
}

async function scrapeCardPrintVariations(setCode, number) {
    const numberVariants = buildNumberVariants(number);
    if (!numberVariants.length) return [];

    let html;
    for (const variant of numberVariants) {
        const url = `https://limitlesstcg.com/cards/${setCode}/${variant}`;
        const resp = await requestWithRetries(url, 2);
        if (!resp) continue;

        html = await resp.text();
        const $ = cheerio.load(html);
        const table = $('table.card-prints-versions');
        if (table.length) break;
        html = null;
    }

    if (!html) return [];

    const $ = cheerio.load(html);
    const table = $('table.card-prints-versions');
    if (!table.length) return [];

    const variations = [];
    let inJpSection = false;

    table.find('tr').each((_, row) => {
        const $row = $(row);
        const th = $row.find('th');

        if (th.length && th.text().includes('JP. Prints')) {
            inJpSection = true;
            return;
        }

        if (inJpSection || th.length) return;

        const cells = $row.find('td');
        if (cells.length < 2) return;

        const firstCell = $(cells[0]);
        const numberElem = firstCell.find('span.prints-table-card-number');
        if (!numberElem.length) return;

        const cardNum = numberElem.text().trim().replace(/^#/, '');
        const setNameElem = firstCell.find('a');
        let setAcronym;

        if (setNameElem.length) {
            const href = setNameElem.attr('href') || '';
            const match = href.match(/\/cards\/([A-Z0-9]+)\/\d+/);
            if (match) {
                setAcronym = match[1];
            }
        }

        if (!setAcronym) return;

        const normalizedNum = cardNum.padStart(3, '0');

        let priceUsd = null;
        if (cells.length >= 2) {
            const priceLink = $(cells[1]).find('a.card-price');
            if (priceLink.length) {
                const priceText = priceLink.text().trim();
                const priceMatch = priceText.match(/\$?([\d.]+)/);
                if (priceMatch) {
                    priceUsd = parseFloat(priceMatch[1]);
                }
            }
        }

        variations.push({
            set: setAcronym,
            number: normalizedNum,
            price_usd: priceUsd
        });
    });

    return variations;
}

function chooseCanonicalPrint(variations) {
    if (!variations.length) return null;

    function getSetPriority(setCode) {
        return STANDARD_LEGAL_SETS.has(setCode) ? 0 : 1;
    }

    function isPromo(setCode) {
        return PROMO_SETS.has(setCode);
    }

    function sortKey(var_) {
        const setPriority = getSetPriority(var_.set);
        const promoPriority = isPromo(var_.set) ? 1 : 0;
        const price = var_.price_usd || 999999;
        const cardNum = /^\d+$/.test(var_.number) ? parseInt(var_.number) : 999999;
        return [setPriority, promoPriority, price, cardNum];
    }

    const sorted = [...variations].sort((a, b) => {
        const aKey = sortKey(a);
        const bKey = sortKey(b);
        for (let i = 0; i < aKey.length; i++) {
            if (aKey[i] !== bKey[i]) return aKey[i] - bKey[i];
        }
        return 0;
    });

    return sorted[0];
}

async function generateSynonyms(cardsByName) {
    log('\nGenerating canonical mappings...');
    const synonymsDict = {};
    const canonicalsDict = {};

    const totalCards = cardsByName.size;
    let current = 0;
    let processedCount = 0;

    for (const [cardName, printSet] of cardsByName.entries()) {
        current++;
        if (current % 50 === 0 || current === totalCards) {
            log(`  Progress: ${current}/${totalCards} cards (${processedCount} with multiple prints)`);
        }

        // Skip if only one print exists in our data
        if (printSet.size < 2) continue;

        // Pick any print to scrape variations
        const [samplePrint] = printSet;
        const [sampleSet, sampleNum] = samplePrint.split('::');

        // Scrape all print variations from Limitless
        const variations = await scrapeCardPrintVariations(sampleSet, sampleNum);

        if (!variations || variations.length < 2) continue;

        // Choose the canonical print
        const canonicalVar = chooseCanonicalPrint(variations);
        if (!canonicalVar) continue;

        const canonicalUid = `${cardName}::${canonicalVar.set}::${canonicalVar.number}`;

        // Build synonyms for all variations
        for (const var_ of variations) {
            const variantUid = `${cardName}::${var_.set}::${var_.number}`;
            if (variantUid !== canonicalUid) {
                synonymsDict[variantUid] = canonicalUid;
            }
        }

        // Add canonical mapping
        canonicalsDict[cardName] = canonicalUid;
        processedCount++;
    }

    log(`  Completed: ${processedCount} cards with multiple prints`);
    log(`  Generated ${Object.keys(synonymsDict).length} synonym mappings`);
    log(`  Generated ${Object.keys(canonicalsDict).length} canonical mappings`);

    return {
        synonyms: synonymsDict,
        canonicals: canonicalsDict,
        metadata: {
            generated: new Date().toISOString(),
            totalSynonyms: Object.keys(synonymsDict).length,
            totalCanonicals: Object.keys(canonicalsDict).length,
            totalCardsAnalyzed: totalCards,
            description: 'Canonical card mappings for handling reprints and alternate versions'
        }
    };
}

async function saveSynonyms(data) {
    log(`\nSaving to ${OUTPUT_PATH}...`);
    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    log('  ✓ Saved successfully');
}

async function uploadToR2(data) {
    log('\nUploading to R2...');
    await putObject('assets/card-synonyms.json', data);
    log('  ✓ Uploaded successfully');
}

async function main() {
    log('='.repeat(60));
    log('Card Synonyms Generator');
    log('='.repeat(60));

    // Load all tournaments
    const tournaments = await loadTournamentsList();
    if (!tournaments.length) {
        log('No tournaments found');
        process.exit(1);
    }

    // Collect all cards from all tournaments
    const cardsByName = await collectAllCards(tournaments);

    // Generate canonical synonyms
    const synonymsData = await generateSynonyms(cardsByName);

    // Save to file
    await saveSynonyms(synonymsData);

    // Upload to R2
    await uploadToR2(synonymsData);

    log('\n' + '='.repeat(60));
    log('Summary');
    log('='.repeat(60));
    log(`  Total unique card names: ${cardsByName.size}`);
    log(`  Cards with multiple prints: ${synonymsData.metadata.totalCanonicals}`);
    log(`  Total synonym mappings: ${synonymsData.metadata.totalSynonyms}`);
    log('\n✓ Card synonyms generation complete!');
}

main().catch(error => {
    console.error('[update-card-synonyms] Failed', error);
    process.exit(1);
});
