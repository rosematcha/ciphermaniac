/**
 * Include-Exclude Report Generator for Online Meta
 * 
 * This module generates include-exclude analysis reports for archetypes based on
 * online tournament data. It supports:
 * - Traditional include/exclude filtering (card present/absent)
 * - Card count filtering (e.g., 2+ copies, exactly 1 copy, 3+ copies)
 * - Automatic deduplication of reports with identical card distributions
 * 
 */

import { generateReportFromDecks, sanitizeForFilename } from './reportBuilder.js';

const MIN_DECKS_FOR_ANALYSIS = 4;
const ALWAYS_INCLUDED_THRESHOLD = 1.0; // 100% of decks must have the card

// Optimization thresholds
const MIN_CARD_USAGE_PERCENT = 5; // Only generate filters for cards in 5%+ of decks
const MAX_CROSS_FILTERS = 10; // Limit cross-combinations to top N cards by usage
const MIN_SUBSET_SIZE = 2; // Skip subsets with fewer than 2 decks
const MAX_COUNT_VARIATIONS = 3; // Limit count variations (e.g., only =1, =2, >=2)

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
 * Extracts unique cards from archetype report data and categorizes them
 * Returns: { alwaysIncluded: [], optional: [], cardLookup: Map }
 * 
 * Note: Cards that appear in 100% of decks but with varying counts are treated
 * as "optional" for count-filtering purposes (e.g., Kirlia appearing in all decks
 * but with 1-3 copies each should still generate count-based filters)
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
    
    // Check if card has varying counts (makes it filterable even if always present)
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

    // Cards with varying counts are treated as "optional" for filtering purposes
    // even if they appear in 100% of decks
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
 * Returns: { cardPresence: Map<cardId, Set<deckId>>, cardCounts: Map<cardId, Map<deckId, count>> }
 */
function indexDeckCardPresence(decks) {
  const cardPresence = new Map(); // cardId -> Set of deckIds
  const cardCounts = new Map();    // cardId -> Map of deckId -> count
  const deckById = new Map();

  for (const deck of decks) {
    const deckId = deck.id || deck.deckHash || `deck-${Math.random()}`;
    deckById.set(deckId, deck);

    const seenCards = new Map(); // cardId -> total count in this deck
    
    for (const card of deck.cards || []) {
      const cardId = buildCardIdentifier(card.set, card.number);
      if (!cardId) {
        continue;
      }

      const count = Number(card.count) || 0;
      seenCards.set(cardId, (seenCards.get(cardId) || 0) + count);
    }

    // Record presence and counts for each card in this deck
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
 * Generates card count filter options for a card based on its distribution
 * Returns array of count filters like: [{ operator: '>=', count: 2 }, { operator: '=', count: 1 }]
 * 
 * Optimization: Limits to most meaningful count variations to reduce combinatorial explosion
 */
function generateCountFilters(cardInfo) {
  const dist = cardInfo.dist || [];
  const filters = [];

  // Collect all unique copy counts that appear in decks
  const copyCounts = dist
    .map(d => d.copies)
    .filter(c => c > 0)
    .sort((a, b) => a - b);

  if (copyCounts.length === 0) {
    return filters;
  }

  // Only generate filters for the most common counts (top 3)
  const topCounts = dist
    .sort((a, b) => b.players - a.players) // Sort by popularity
    .slice(0, MAX_COUNT_VARIATIONS)
    .map(d => d.copies)
    .sort((a, b) => a - b);

  // Generate "exactly N" filters for most popular counts only
  for (const count of topCounts) {
    filters.push({
      operator: '=',
      count,
      label: `exactly ${count}`,
      key: `eq${count}`
    });
  }

  // Generate ONE ">= N" filter for the second-most-common count
  // This captures "tech vs core" distinction
  if (topCounts.length >= 2) {
    const minForCore = topCounts[1]; // e.g., if counts are [1, 2, 3], use >=2
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
 * Applies include/exclude/count filters to determine which decks match
 */
function applyFilters(filters, cardPresence, cardCounts, allDeckIds) {
  let eligible = new Set(allDeckIds);

  // Apply include filters (card must be present)
  for (const filter of filters.include || []) {
    const cardId = filter.cardId;
    const decksWithCard = cardPresence.get(cardId) || new Set();
    
    if (filter.count !== undefined) {
      // Count-based include: filter by specific count or count range
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
        } else if (filter.operator === '<=') {
          if (deckCount <= filter.count) {
            matchingDecks.add(deckId);
          }
        } else if (filter.operator === '>') {
          if (deckCount > filter.count) {
            matchingDecks.add(deckId);
          }
        } else if (filter.operator === '<') {
          if (deckCount < filter.count) {
            matchingDecks.add(deckId);
          }
        }
      }
      
      eligible = new Set([...eligible].filter(id => matchingDecks.has(id)));
    } else {
      // Simple presence-based include
      eligible = new Set([...eligible].filter(id => decksWithCard.has(id)));
    }
  }

  // Apply exclude filters (card must be absent)
  for (const filter of filters.exclude || []) {
    const cardId = filter.cardId;
    const decksWithCard = cardPresence.get(cardId) || new Set();
    eligible = new Set([...eligible].filter(id => !decksWithCard.has(id)));
  }

  return eligible;
}

/**
 * Builds a subset report based on filter criteria
 */
function buildSubsetReport(filters, cardPresence, cardCounts, deckById, allDecks, cardLookup, deckTotal, archetypeName) {
  const allDeckIds = new Set(deckById.keys());
  const eligibleDeckIds = applyFilters(filters, cardPresence, cardCounts, allDeckIds);

  if (eligibleDeckIds.size === 0) {
    return null;
  }

  // Skip exclude-only combinations that match the baseline
  if ((!filters.include || filters.include.length === 0) && eligibleDeckIds.size === allDeckIds.size) {
    return null;
  }

  const subsetDecks = Array.from(eligibleDeckIds).map(id => deckById.get(id)).filter(Boolean);
  const report = generateReportFromDecks(subsetDecks, subsetDecks.length);

  // Add filter metadata
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
 * Generates all filter combinations for an archetype
 * 
 * Optimization strategy:
 * 1. Only include cards used in MIN_CARD_USAGE_PERCENT% or more of decks
 * 2. Limit cross-combinations to top cards by usage (avoid N² explosion)
 * 3. Limit count variations to most meaningful options
 * 4. Skip combinations that result in very small subsets
 */
function generateFilterCombinations(optionalCards) {
  const combinations = [];

  // Filter to only cards with meaningful usage (5%+)
  const meaningfulCards = optionalCards.filter(card => card.pct >= MIN_CARD_USAGE_PERCENT);
  
  console.log(`[IncludeExclude] Filtering ${optionalCards.length} cards to ${meaningfulCards.length} with ${MIN_CARD_USAGE_PERCENT}%+ usage`);

  // Sort by usage for prioritization
  const sortedCards = [...meaningfulCards].sort((a, b) => b.pct - a.pct);

  // Single card include filters with count variations
  for (const card of sortedCards) {
    const countFilters = generateCountFilters(card);
    
    // Basic presence filter
    combinations.push({
      include: [{ cardId: card.id }],
      exclude: []
    });

    // Count-based filters (limited by generateCountFilters)
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

  // Cross include-exclude combinations - LIMITED to avoid explosion
  // Only use top N most-used cards for cross-combinations
  const topCardsForCross = sortedCards.slice(0, MAX_CROSS_FILTERS);
  
  console.log(`[IncludeExclude] Generating cross-filters for top ${topCardsForCross.length} cards`);

  for (const includeCard of topCardsForCross) {
    for (const excludeCard of topCardsForCross) {
      if (includeCard.id === excludeCard.id) {
        continue;
      }

      // Basic include + exclude (no count variation on cross-filters to reduce combinations)
      combinations.push({
        include: [{ cardId: includeCard.id }],
        exclude: [{ cardId: excludeCard.id }]
      });

      // Only add ONE count-based variation for the most common count
      const countFilters = generateCountFilters(includeCard);
      if (countFilters.length > 0) {
        // Use the first filter (most common exact count)
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
 * Builds a filter key for indexing
 */
function buildFilterKey(filters) {
  const includeKeys = (filters.include || []).map(f => {
    if (f.count !== undefined) {
      return `${f.cardId}:${f.operator}${f.count}`;
    }
    return f.cardId;
  }).sort().join('+');

  const excludeKeys = (filters.exclude || [])
    .map(f => f.cardId)
    .sort()
    .join('+');

  return `inc:${includeKeys}|exc:${excludeKeys}`;
}

/**
 * Main function to generate include-exclude reports for an archetype
 */
export async function generateIncludeExcludeReports(archetypeName, archetypeDecks, archetypeReport, env) {
  const deckTotal = archetypeDecks.length;

  // Skip if not enough decks
  if (deckTotal < MIN_DECKS_FOR_ANALYSIS) {
    console.log(`[IncludeExclude] Skipping ${archetypeName}: only ${deckTotal} decks (minimum ${MIN_DECKS_FOR_ANALYSIS})`);
    return null;
  }

  console.log(`[IncludeExclude] Generating reports for ${archetypeName} (${deckTotal} decks)...`);

  // Extract cards from archetype report
  const { alwaysIncluded, optional, cardLookup } = extractCardsFromReport(archetypeReport, deckTotal);

  if (optional.length === 0) {
    console.log(`[IncludeExclude] No optional cards for ${archetypeName}`);
    return null;
  }

  console.log(`[IncludeExclude] ${archetypeName}: ${optional.length} optional cards, ${alwaysIncluded.length} always included`);

  // Index deck card presence
  const { cardPresence, cardCounts, deckById } = indexDeckCardPresence(archetypeDecks);

  // Generate all filter combinations
  const combinations = generateFilterCombinations(optional);
  console.log(`[IncludeExclude] ${archetypeName}: Generated ${combinations.length} filter combinations`);

  // Build subsets and deduplicate
  const uniqueSubsets = new Map(); // contentHash -> subset info
  const filterMap = new Map();      // filterKey -> subsetId
  let skippedSmallSubsets = 0;

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

    // Skip subsets that are too small (< MIN_SUBSET_SIZE decks)
    if (deckIds.size < MIN_SUBSET_SIZE) {
      skippedSmallSubsets++;
      continue;
    }

    // Hash the report items for deduplication
    const contentHash = await hashReportItems(report.items);

    // Build filter key
    const filterKey = buildFilterKey(filters);

    // Store or update unique subset
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
    filterMap.set(filterKey, subsetId);
  }

  console.log(`[IncludeExclude] ${archetypeName}: ${uniqueSubsets.size} unique subsets from ${combinations.length} combinations (skipped ${skippedSmallSubsets} small subsets)`);


  // Build cards summary
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

  // Build subsets metadata
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

  // Build index
  const index = {
    archetype: archetypeName,
    deckTotal,
    totalCombinations: combinations.length,
    uniqueSubsets: uniqueSubsets.size,
    deduplicationRate: combinations.length > 0
      ? Math.round(((combinations.length - uniqueSubsets.size) / combinations.length * 100 + Number.EPSILON) * 100) / 100
      : 0,
    cards: cardsSummary,
    filterMap: Object.fromEntries(filterMap),
    subsets: subsetsMetadata,
    generatedAt: new Date().toISOString()
  };

  return {
    index,
    subsets: uniqueSubsets
  };
}

/**
 * Writes include-exclude reports to R2 storage
 * 
 * Path structure: include-exclude/{tournament_folder}/{archetype}/
 * Example: include-exclude/Online - Last 14 Days/Gardevoir/
 * 
 * This places include-exclude at the root level and allows for multiple tournaments
 */
export async function writeIncludeExcludeReports(archetypeName, reports, env, tournamentFolder) {
  if (!reports || !reports.index || !reports.subsets) {
    return;
  }

  const archetypeBase = sanitizeForFilename(archetypeName);
  const includeExcludePath = `include-exclude/${tournamentFolder}/${archetypeBase}`;

  // Write index
  const indexKey = `${includeExcludePath}/index.json`;
  await env.REPORTS.put(indexKey, JSON.stringify(reports.index, null, 2), {
    httpMetadata: { contentType: 'application/json' }
  });

  // Write unique subset files
  for (const [contentHash, subset] of reports.subsets.entries()) {
    const subsetKey = `${includeExcludePath}/unique_subsets/${subset.id}.json`;
    await env.REPORTS.put(subsetKey, JSON.stringify(subset.data, null, 2), {
      httpMetadata: { contentType: 'application/json' }
    });
  }

  console.log(`[IncludeExclude] Wrote ${reports.subsets.size} subsets for ${archetypeName} to ${includeExcludePath}`);
}
