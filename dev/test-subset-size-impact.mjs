#!/usr/bin/env node

/**
 * Dry Run: Compare Include-Exclude Upload Sizes
 * 
 * This script evaluates the impact of MIN_SUBSET_SIZE threshold on:
 * 1. Total data uploaded to R2
 * 2. Number of unique subsets generated
 * 3. Performance implications
 * 
 * Usage: node dev/test-subset-size-impact.mjs
 */

import { generateReportFromDecks, sanitizeForFilename } from '../functions/lib/reportBuilder.js';

const MIN_DECKS_FOR_ANALYSIS = 4;
const ALWAYS_INCLUDED_THRESHOLD = 1.0;
const MIN_CARD_USAGE_PERCENT = 5;
const MAX_CROSS_FILTERS = 10;
const MAX_COUNT_VARIATIONS = 3;

// We'll test with different MIN_SUBSET_SIZE values
const MIN_SUBSET_SIZES_TO_TEST = [0, 1, 2, 3, 4, 5];

/**
 * Normalizes a card number to 3-digit format with optional suffix
 */
function normalizeCardNumber(value) {
  if (value === undefined || value === null) {
    return '';
  }
  const raw = String(value).trim();
  if (!raw) {
    return '';
  }
  const match = /^(\d+)([A-Za-z]*)$/.exec(raw);
  if (!match) {
    return raw.toUpperCase();
  }
  const [, digits, suffix = ''] = match;
  const normalized = digits.padStart(3, '0');
  return suffix ? `${normalized}${suffix.toUpperCase()}` : normalized;
}

/**
 * Builds a card identifier string (e.g., "SVI~118")
 */
function buildCardIdentifier(setCode, number) {
  const sc = (setCode || '').toString().toUpperCase().trim();
  if (!sc) {
    return null;
  }
  const normalized = normalizeCardNumber(number);
  if (!normalized) {
    return null;
  }
  return `${sc}~${normalized}`;
}

/**
 * Extracts unique cards from archetype report data
 */
function extractCardsFromReport(reportData, deckTotal) {
  const cardLookup = new Map();
  const alwaysIncluded = [];
  const optional = [];

  const items = reportData?.items || [];
  
  for (const item of items) {
    const setCode = item.set;
    const number = item.number;
    const cardId = buildCardIdentifier(setCode, number);
    
    if (!cardId) {
      continue;
    }

    const found = Number(item.found) || 0;
    const total = Number(item.total) || deckTotal;
    const pct = total ? Math.round(((found / total) * 100 + Number.EPSILON) * 100) / 100 : 0;
    const isAlwaysIncluded = found === total;
    
    const dist = item.dist || [];
    const hasVaryingCounts = dist.length > 1;

    const cardInfo = {
      id: cardId,
      name: item.name,
      set: setCode,
      number: normalizeCardNumber(number),
      found,
      total,
      pct,
      alwaysIncluded: isAlwaysIncluded,
      dist,
      hasVaryingCounts
    };

    cardLookup.set(cardId, cardInfo);

    if (isAlwaysIncluded && !hasVaryingCounts) {
      alwaysIncluded.push(cardInfo);
    } else {
      optional.push(cardInfo);
    }
  }

  return { alwaysIncluded, optional, cardLookup };
}

/**
 * Indexes which decks contain which cards and at what counts
 */
function indexDeckCardPresence(decks) {
  const cardPresence = new Map();
  const cardCounts = new Map();
  const deckById = new Map();

  for (const deck of decks) {
    const deckId = deck.id || deck.deckHash || `deck-${Math.random()}`;
    deckById.set(deckId, deck);

    const seenCards = new Map();
    
    for (const card of deck.cards || []) {
      const cardId = buildCardIdentifier(card.set, card.number);
      if (!cardId) {
        continue;
      }

      const count = Number(card.count) || 0;
      seenCards.set(cardId, (seenCards.get(cardId) || 0) + count);
    }

    for (const [cardId, totalCount] of seenCards.entries()) {
      if (!cardPresence.has(cardId)) {
        cardPresence.set(cardId, new Set());
      }
      cardPresence.get(cardId).add(deckId);

      if (!cardCounts.has(cardId)) {
        cardCounts.set(cardId, new Map());
      }
      cardCounts.get(cardId).set(deckId, totalCount);
    }
  }

  return { cardPresence, cardCounts, deckById };
}

/**
 * Generates card count filter options
 */
function generateCountFilters(cardInfo) {
  const dist = cardInfo.dist || [];
  const filters = [];

  const topCounts = dist
    .sort((a, b) => b.players - a.players)
    .slice(0, MAX_COUNT_VARIATIONS)
    .map(d => d.copies)
    .sort((a, b) => a - b);

  for (const count of topCounts) {
    filters.push({
      operator: '=',
      count,
      label: `exactly ${count}`,
      key: `eq${count}`
    });
  }

  if (topCounts.length >= 2) {
    const minForCore = topCounts[1];
    filters.push({
      operator: '>=',
      count: minForCore,
      label: `${minForCore}+`,
      key: `gte${minForCore}`
    });
  }

  return filters;
}

/**
 * Applies filters to determine which decks match
 */
function applyFilters(filters, cardPresence, cardCounts, allDeckIds) {
  let eligible = new Set(allDeckIds);

  for (const filter of filters.include || []) {
    const cardId = filter.cardId;
    const decksWithCard = cardPresence.get(cardId) || new Set();
    
    if (filter.count !== undefined) {
      const matchingDecks = new Set();
      const cardCountMap = cardCounts.get(cardId) || new Map();
      
      for (const deckId of decksWithCard) {
        const deckCount = cardCountMap.get(deckId) || 0;
        
        if (filter.operator === '=') {
          if (deckCount === filter.count) {
            matchingDecks.add(deckId);
          }
        } else if (filter.operator === '>=') {
          if (deckCount >= filter.count) {
            matchingDecks.add(deckId);
          }
        }
      }
      
      eligible = new Set([...eligible].filter(id => matchingDecks.has(id)));
    } else {
      eligible = new Set([...eligible].filter(id => decksWithCard.has(id)));
    }
  }

  for (const filter of filters.exclude || []) {
    const cardId = filter.cardId;
    const decksWithCard = cardPresence.get(cardId) || new Set();
    eligible = new Set([...eligible].filter(id => !decksWithCard.has(id)));
  }

  return eligible;
}

/**
 * Builds a subset report
 */
function buildSubsetReport(filters, cardPresence, cardCounts, deckById, allDecks, cardLookup, deckTotal, archetypeName) {
  const allDeckIds = new Set(deckById.keys());
  const eligibleDeckIds = applyFilters(filters, cardPresence, cardCounts, allDeckIds);

  if (eligibleDeckIds.size === 0) {
    return null;
  }

  if ((!filters.include || filters.include.length === 0) && eligibleDeckIds.size === allDeckIds.size) {
    return null;
  }

  const subsetDecks = Array.from(eligibleDeckIds).map(id => deckById.get(id)).filter(Boolean);
  const report = generateReportFromDecks(subsetDecks, subsetDecks.length);

  report.filters = {
    include: (filters.include || []).map(f => ({
      id: f.cardId,
      name: cardLookup.get(f.cardId)?.name,
      set: cardLookup.get(f.cardId)?.set,
      number: cardLookup.get(f.cardId)?.number,
      operator: f.operator,
      count: f.count,
      label: f.label
    })),
    exclude: (filters.exclude || []).map(f => ({
      id: f.cardId,
      name: cardLookup.get(f.cardId)?.name,
      set: cardLookup.get(f.cardId)?.set,
      number: cardLookup.get(f.cardId)?.number
    })),
    baseDeckTotal: deckTotal
  };

  report.source = {
    archetype: archetypeName,
    generatedAt: new Date().toISOString()
  };

  return { report, deckIds: eligibleDeckIds };
}

/**
 * Generates a hash of report items for deduplication
 */
async function hashReportItems(items) {
  const cryptoImpl = globalThis.crypto;
  if (!cryptoImpl?.subtle) {
    throw new Error('Web Crypto API not available for hashing reports');
  }
  
  const itemsStr = JSON.stringify(items, null, 0);
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(itemsStr));
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates filter combinations
 */
function generateFilterCombinations(optionalCards) {
  const combinations = [];

  const meaningfulCards = optionalCards.filter(card => card.pct >= MIN_CARD_USAGE_PERCENT);
  const sortedCards = [...meaningfulCards].sort((a, b) => b.pct - a.pct);

  // Single card include filters with count variations
  for (const card of sortedCards) {
    const countFilters = generateCountFilters(card);
    
    combinations.push({
      include: [{ cardId: card.id }],
      exclude: []
    });

    for (const countFilter of countFilters) {
      combinations.push({
        include: [{
          cardId: card.id,
          operator: countFilter.operator,
          count: countFilter.count,
          label: countFilter.label
        }],
        exclude: []
      });
    }
  }

  // Single card exclude filters
  for (const card of sortedCards) {
    combinations.push({
      include: [],
      exclude: [{ cardId: card.id }]
    });
  }

  // Cross include-exclude combinations
  const topCardsForCross = sortedCards.slice(0, MAX_CROSS_FILTERS);

  for (const includeCard of topCardsForCross) {
    for (const excludeCard of topCardsForCross) {
      if (includeCard.id === excludeCard.id) {
        continue;
      }

      combinations.push({
        include: [{ cardId: includeCard.id }],
        exclude: [{ cardId: excludeCard.id }]
      });

      const countFilters = generateCountFilters(includeCard);
      if (countFilters.length > 0) {
        const topFilter = countFilters[0];
        combinations.push({
          include: [{
            cardId: includeCard.id,
            operator: topFilter.operator,
            count: topFilter.count,
            label: topFilter.label
          }],
          exclude: [{ cardId: excludeCard.id }]
        });
      }
    }
  }

  return combinations;
}

/**
 * Main function to generate reports with a specific MIN_SUBSET_SIZE
 */
async function generateReportsWithThreshold(archetypeName, archetypeDecks, archetypeReport, minSubsetSize) {
  const deckTotal = archetypeDecks.length;

  if (deckTotal < MIN_DECKS_FOR_ANALYSIS) {
    return null;
  }

  const { alwaysIncluded, optional, cardLookup } = extractCardsFromReport(archetypeReport, deckTotal);

  if (optional.length === 0) {
    return null;
  }

  const { cardPresence, cardCounts, deckById } = indexDeckCardPresence(archetypeDecks);
  const combinations = generateFilterCombinations(optional);

  const uniqueSubsets = new Map();
  const filterMap = new Map();
  let skippedSmallSubsets = 0;
  const subsetSizeDistribution = new Map(); // size -> count

  for (const filters of combinations) {
    const result = buildSubsetReport(
      filters,
      cardPresence,
      cardCounts,
      deckById,
      archetypeDecks,
      cardLookup,
      deckTotal,
      archetypeName
    );

    if (!result) {
      continue;
    }

    const { report, deckIds } = result;
    const subsetSize = deckIds.size;

    // Track distribution
    subsetSizeDistribution.set(subsetSize, (subsetSizeDistribution.get(subsetSize) || 0) + 1);

    // Apply threshold
    if (subsetSize < minSubsetSize) {
      skippedSmallSubsets++;
      continue;
    }

    const contentHash = await hashReportItems(report.items);

    if (!uniqueSubsets.has(contentHash)) {
      const subsetId = `subset_${String(uniqueSubsets.size + 1).padStart(3, '0')}`;
      uniqueSubsets.set(contentHash, {
        id: subsetId,
        data: report,
        primaryFilter: filters,
        alternateFilters: []
      });
    } else {
      uniqueSubsets.get(contentHash).alternateFilters.push(filters);
    }

    const subsetId = uniqueSubsets.get(contentHash).id;
  }

  // Calculate estimated upload size
  let totalSize = 0;
  
  // Index.json
  const cardsSummary = {};
  for (const [cardId, info] of cardLookup.entries()) {
    cardsSummary[cardId] = {
      name: info.name,
      set: info.set,
      number: info.number,
      pct: info.pct,
      found: info.found,
      total: info.total,
      alwaysIncluded: info.alwaysIncluded,
      dist: info.dist
    };
  }

  const subsetsMetadata = {};
  for (const [contentHash, subset] of uniqueSubsets.entries()) {
    subsetsMetadata[subset.id] = {
      deckTotal: subset.data.deckTotal,
      primaryFilters: {
        include: subset.primaryFilter.include || [],
        exclude: subset.primaryFilter.exclude || []
      },
      alternateFilters: subset.alternateFilters.map(f => ({
        include: f.include || [],
        exclude: f.exclude || []
      }))
    };
  }

  const index = {
    archetype: archetypeName,
    deckTotal,
    totalCombinations: combinations.length,
    uniqueSubsets: uniqueSubsets.size,
    cards: cardsSummary,
    filterMap: {},
    subsets: subsetsMetadata,
    generatedAt: new Date().toISOString()
  };

  const indexSize = JSON.stringify(index, null, 2).length;
  totalSize += indexSize;

  // Subset files
  for (const [contentHash, subset] of uniqueSubsets.entries()) {
    const subsetSize = JSON.stringify(subset.data, null, 2).length;
    totalSize += subsetSize;
  }

  return {
    totalCombinations: combinations.length,
    uniqueSubsets: uniqueSubsets.size,
    skippedSmallSubsets,
    totalSize,
    indexSize,
    avgSubsetSize: uniqueSubsets.size > 0 ? Math.round((totalSize - indexSize) / uniqueSubsets.size) : 0,
    subsetSizeDistribution: Array.from(subsetSizeDistribution.entries()).sort((a, b) => a[0] - b[0])
  };
}

/**
 * Test with sample data
 */
async function runDryRun() {
  console.log('🔬 Include-Exclude Subset Size Impact Analysis\n');
  console.log('═══════════════════════════════════════════════\n');

  // Load sample data - you can modify this to use real data
  const sampleArchetypeDecks = generateSampleDecks(50); // Generate 50 sample decks
  const sampleArchetypeReport = generateSampleReport(sampleArchetypeDecks);

  console.log(`📊 Test Data:`);
  console.log(`   Archetype: Test Archetype`);
  console.log(`   Total Decks: ${sampleArchetypeDecks.length}`);
  console.log(`   Unique Cards: ${sampleArchetypeReport.items.length}\n`);

  const results = [];

  for (const minSubsetSize of MIN_SUBSET_SIZES_TO_TEST) {
    console.log(`\n🔍 Testing MIN_SUBSET_SIZE = ${minSubsetSize}`);
    console.log('─────────────────────────────────────────────');
    
    const result = await generateReportsWithThreshold(
      'Test Archetype',
      sampleArchetypeDecks,
      sampleArchetypeReport,
      minSubsetSize
    );

    if (!result) {
      console.log('   ❌ No reports generated');
      continue;
    }

    console.log(`   Total Combinations: ${result.totalCombinations}`);
    console.log(`   Unique Subsets: ${result.uniqueSubsets}`);
    console.log(`   Skipped (small): ${result.skippedSmallSubsets}`);
    console.log(`   Total Upload Size: ${formatBytes(result.totalSize)}`);
    console.log(`   Index Size: ${formatBytes(result.indexSize)}`);
    console.log(`   Avg Subset Size: ${formatBytes(result.avgSubsetSize)}`);
    
    console.log(`\n   Subset Size Distribution:`);
    for (const [size, count] of result.subsetSizeDistribution) {
      const skipped = size < minSubsetSize ? ' (SKIPPED)' : '';
      console.log(`     ${size} decks: ${count} subsets${skipped}`);
    }

    results.push({
      minSubsetSize,
      ...result
    });
  }

  // Summary comparison
  console.log('\n\n📈 SUMMARY COMPARISON');
  console.log('═══════════════════════════════════════════════\n');
  console.log('MIN_SIZE | Subsets | Skipped | Upload Size | vs Baseline');
  console.log('─────────┼─────────┼─────────┼─────────────┼────────────');

  const baseline = results[0]; // MIN_SUBSET_SIZE = 0
  for (const result of results) {
    const sizeReduction = baseline ? 
      Math.round((1 - result.totalSize / baseline.totalSize) * 100) : 0;
    const sign = sizeReduction > 0 ? '-' : '+';
    
    console.log(
      `${String(result.minSubsetSize).padStart(8)} │ ` +
      `${String(result.uniqueSubsets).padStart(7)} │ ` +
      `${String(result.skippedSmallSubsets).padStart(7)} │ ` +
      `${formatBytes(result.totalSize).padStart(11)} │ ` +
      `${sign}${Math.abs(sizeReduction)}%`
    );
  }

  console.log('\n💡 Recommendations:');
  console.log('─────────────────────────────────────────────\n');
  
  // Find the threshold with best balance
  const bestBalance = results.find(r => r.skippedSmallSubsets > 0 && r.uniqueSubsets > 10);
  if (bestBalance) {
    const savings = Math.round((1 - bestBalance.totalSize / baseline.totalSize) * 100);
    console.log(`✅ MIN_SUBSET_SIZE = ${bestBalance.minSubsetSize}`);
    console.log(`   - Reduces upload by ${savings}%`);
    console.log(`   - Keeps ${bestBalance.uniqueSubsets} meaningful subsets`);
    console.log(`   - Filters out ${bestBalance.skippedSmallSubsets} tiny subsets\n`);
  }

  console.log('Consider the trade-offs:');
  console.log('• Lower threshold = More granular data, larger uploads');
  console.log('• Higher threshold = Less detail, faster loads, smaller uploads');
  console.log('• Subsets with <2 decks often represent statistical noise\n');
}

/**
 * Helper to format bytes
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${Math.round(bytes / (1024 * 1024) * 10) / 10}MB`;
}

/**
 * Generate sample decks for testing
 */
function generateSampleDecks(count) {
  const decks = [];
  const cards = [
    { name: 'Card A', set: 'SVI', number: '001', baseCount: 4 },
    { name: 'Card B', set: 'SVI', number: '002', baseCount: 3 },
    { name: 'Card C', set: 'SVI', number: '003', baseCount: 2 },
    { name: 'Card D', set: 'PAR', number: '010', baseCount: 1 },
    { name: 'Card E', set: 'PAR', number: '011', baseCount: 1 },
    { name: 'Card F', set: 'PAF', number: '020', baseCount: 1 },
  ];

  for (let i = 0; i < count; i++) {
    const deckCards = [];
    
    for (const card of cards) {
      // Random variation in count
      const variance = Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      const count = Math.max(0, card.baseCount + variance);
      
      // Random inclusion (some cards optional)
      const includeProbability = card.baseCount >= 3 ? 1.0 : 0.6;
      if (count > 0 && Math.random() < includeProbability) {
        deckCards.push({
          name: card.name,
          set: card.set,
          number: card.number,
          count,
          category: 'pokemon'
        });
      }
    }

    decks.push({
      id: `deck_${i + 1}`,
      player: `Player ${i + 1}`,
      archetype: 'Test Archetype',
      cards: deckCards
    });
  }

  return decks;
}

/**
 * Generate sample report from decks
 */
function generateSampleReport(decks) {
  const report = generateReportFromDecks(decks, decks.length);
  return report;
}

// Run the dry run
runDryRun().catch(error => {
  console.error('❌ Error:', error);
  console.error(error.stack);
  process.exit(1);
});
