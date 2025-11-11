#!/usr/bin/env node

import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const LIMITLESS_API_BASE = 'https://play.limitlesstcg.com/api';
const WINDOW_DAYS = 14;
const TARGET_FOLDER = 'Online - Last 14 Days';
const PAGE_SIZE = 100;
const MAX_PAGES = 15;
const SUPPORTED_FORMATS = new Set(['STANDARD']);

function env(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

const LIMITLESS_API_KEY = env('LIMITLESS_API_KEY');
const R2_ACCOUNT_ID = env('R2_ACCOUNT_ID');
const R2_ACCESS_KEY_ID = env('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = env('R2_SECRET_ACCESS_KEY');
const R2_BUCKET_NAME = env('R2_BUCKET_NAME');
const R2_REPORTS_PREFIX = process.env.R2_REPORTS_PREFIX || 'reports';

// Feature flags - default to true if not specified
const GENERATE_MASTER = process.env.GENERATE_MASTER !== 'false';
const GENERATE_ARCHETYPES = process.env.GENERATE_ARCHETYPES !== 'false';
const GENERATE_INCLUDE_EXCLUDE = process.env.GENERATE_INCLUDE_EXCLUDE !== 'false';
const GENERATE_DECKS = process.env.GENERATE_DECKS !== 'false';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  }
});

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function buildLimitlessUrl(path, params = {}) {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const base = LIMITLESS_API_BASE.endsWith('/') ? LIMITLESS_API_BASE : `${LIMITLESS_API_BASE}/`;
  const url = new URL(normalizedPath, base);
  url.searchParams.set('key', LIMITLESS_API_KEY);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url;
}

async function fetchLimitless(path, params) {
  const url = buildLimitlessUrl(path, params);
  const response = await fetch(url, {
    headers: {
      'X-Access-Key': LIMITLESS_API_KEY,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Limitless request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Unexpected response type (${contentType}): ${text.slice(0, 200)}`);
  }

  return response.json();
}

async function fetchRecentOnlineTournaments(since) {
  const sinceMs = since.getTime();
  const found = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const list = await fetchLimitless('/tournaments', {
      game: 'PTCG',
      limit: PAGE_SIZE,
      page
    });

    if (!Array.isArray(list) || list.length === 0) {
      break;
    }

    let sawOlder = false;
    for (const entry of list) {
      const dateMs = Date.parse(entry?.date);
      if (!Number.isFinite(dateMs) || dateMs < sinceMs) {
        sawOlder = true;
        continue;
      }

      const details = await fetchLimitless(`/tournaments/${entry.id}/details`);
      if (details.decklists === false) {
        continue;
      }
      if (details.isOnline === false) {
        continue;
      }
      const formatId = (details.format || entry.format || '').toUpperCase();
      if (formatId && !SUPPORTED_FORMATS.has(formatId)) {
        continue;
      }

      found.push({
        id: entry.id,
        name: entry.name,
        date: entry.date,
        format: formatId || 'UNKNOWN',
        platform: details.platform || null,
        game: entry.game,
        players: details.players || entry.players || null,
        organizer: details.organizer?.name || null
      });
    }

    if (sawOlder) {
      break;
    }
  }

  return found.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

function determinePlacementLimit(players) {
  const count = Number(players) || 0;
  if (count > 0 && count <= 4) {
    return 0;
  }
  if (count <= 8) {
    return 4;
  }
  if (count <= 16) {
    return 8;
  }
  if (count <= 32) {
    return 16;
  }
  if (count <= 64) {
    return 24;
  }
  if (count >= 65) {
    return 32;
  }
  return 32;
}

function toCardEntries(decklist) {
  if (!decklist || typeof decklist !== 'object') {
    return [];
  }

  const cards = [];
  for (const [section, entries] of Object.entries(decklist)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const card of entries) {
      const count = Number(card?.count) || 0;
      if (!count) {
        continue;
      }
      const sectionLower = section.toLowerCase();
      let category = 'trainer';
      if (sectionLower === 'pokemon') {
        category = 'pokemon';
      } else if (sectionLower === 'energy') {
        category = 'energy';
      }
      cards.push({
        count,
        name: card?.name || 'Unknown Card',
        set: card?.set || null,
        number: card?.number || null,
        category,
        displayCategory: composeDisplayCategory(category)
      });
    }
  }
  return cards;
}

async function gatherDecks(tournaments) {
  const decks = [];

  for (const tournament of tournaments) {
    const limit = determinePlacementLimit(tournament.players);
    if (!limit) {
      continue;
    }

    let standings;
    try {
      standings = await fetchLimitless(`/tournaments/${tournament.id}/standings`);
    } catch (error) {
      console.warn(`Failed to fetch standings for ${tournament.name}: ${error.message}`);
      continue;
    }

    const sorted = [...standings].sort((a, b) => {
      const placingA = Number.isFinite(a?.placing) ? a.placing : Number.POSITIVE_INFINITY;
      const placingB = Number.isFinite(b?.placing) ? b.placing : Number.POSITIVE_INFINITY;
      return placingA - placingB;
    });

    const topEntries = sorted.slice(0, limit);
    for (const entry of topEntries) {
      const cards = toCardEntries(entry?.decklist);
      if (!cards.length) {
        continue;
      }

      const hash = crypto
        .createHash('sha1')
        .update(
          cards
            .map(card => `${card.count}x${card.name}::${card.set || ''}::${card.number || ''}`)
            .sort()
            .join('|')
        )
        .digest('hex');

      decks.push({
        id: hash.slice(0, 12),
        player: entry?.name || entry?.player || 'Unknown Player',
        playerId: entry?.player || null,
        country: entry?.country || null,
        placement: entry?.placing ?? null,
        archetype: entry?.deck?.name || 'Unknown',
        archetypeId: entry?.deck?.id || null,
        cards,
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        tournamentDate: tournament.date,
        tournamentFormat: tournament.format,
        tournamentPlatform: tournament.platform,
        tournamentOrganizer: tournament.organizer
      });
    }
  }

  return decks;
}

function composeDisplayCategory(category, trainerType, energyType) {
  const base = (category || '').toLowerCase();
  if (!base) {
    return '';
  }
  if (base === 'trainer' && trainerType) {
    return `trainer-${trainerType.toLowerCase()}`;
  }
  if (base === 'energy' && energyType) {
    return `energy-${energyType.toLowerCase()}`;
  }
  return base;
}

function sanitizeForFilename(text) {
  return (text || '').replace(/ /g, '_').replace(/[<>:"/\\|?*]/g, '');
}

function normalizeArchetypeName(name) {
  const cleaned = (name || '').replace(/_/g, ' ').trim();
  if (!cleaned) {
    return 'unknown';
  }
  return cleaned.replace(/\s+/g, ' ');
}

function canonicalizeVariant(setCode, number) {
  const sc = (setCode || '').toUpperCase().trim();
  if (!sc) {
    return [null, null];
  }
  const match = /^(\d+)([A-Za-z]*)$/.exec(String(number || '').trim());
  if (!match) {
    return [sc, String(number || '').trim().toUpperCase()];
  }
  const [, digits, suffix = ''] = match;
  const normalized = digits.padStart(3, '0');
  return [sc, suffix ? `${normalized}${suffix.toUpperCase()}` : normalized];
}

function generateReportFromDecks(deckList, deckTotal) {
  const cardData = new Map();
  const nameCasing = new Map();
  const uidMeta = new Map();
  const uidCategory = new Map();

  for (const deck of deckList) {
    const perDeckCounts = new Map();
    const perDeckMeta = new Map();

    for (const card of deck.cards || []) {
      const count = Number(card?.count) || 0;
      if (!count) {
        continue;
      }
      const [setCode, number] = canonicalizeVariant(card.set, card.number);
      const uid = setCode && number ? `${card.name}::${setCode}::${number}` : card.name;

      perDeckCounts.set(uid, (perDeckCounts.get(uid) || 0) + count);
      perDeckMeta.set(uid, {
        set: setCode || undefined,
        number: number || undefined,
        category: card.category || undefined,
        trainerType: card.trainerType || undefined,
        energyType: card.energyType || undefined,
        displayCategory: card.displayCategory || undefined
      });

      if (!nameCasing.has(uid)) {
        nameCasing.set(uid, card.name);
      }
      if ((card.category || card.trainerType || card.energyType || card.displayCategory) && !uidCategory.has(uid)) {
        uidCategory.set(uid, {
          category: card.category || undefined,
          trainerType: card.trainerType || undefined,
          energyType: card.energyType || undefined,
          displayCategory: card.displayCategory || undefined
        });
      }
    }

    perDeckCounts.forEach((total, uid) => {
      if (!cardData.has(uid)) {
        cardData.set(uid, []);
      }
      cardData.get(uid).push(total);
      if (!uidMeta.has(uid)) {
        uidMeta.set(uid, perDeckMeta.get(uid));
      }
    });
  }

  const sortedKeys = Array.from(cardData.keys()).sort(
    (a, b) => cardData.get(b).length - cardData.get(a).length
  );

  const items = sortedKeys.map((uid, index) => {
    const counts = cardData.get(uid) || [];
    const found = counts.length;
    const distMap = new Map();
    counts.forEach(value => {
      const copies = Number(value) || 0;
      distMap.set(copies, (distMap.get(copies) || 0) + 1);
    });
    const dist = Array.from(distMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([copies, players]) => ({
        copies,
        players,
        percent: found ? Math.round(((players / found) * 100 + Number.EPSILON) * 100) / 100 : 0
      }));

    const entry = {
      rank: index + 1,
      name: nameCasing.get(uid) || uid,
      found,
      total: deckTotal,
      pct: deckTotal ? Math.round(((found / deckTotal) * 100 + Number.EPSILON) * 100) / 100 : 0,
      dist
    };

    if (uid.includes('::')) {
      const meta = uidMeta.get(uid);
      if (meta?.set) {
        entry.set = meta.set;
      }
      if (meta?.number) {
        entry.number = meta.number;
      }
      entry.uid = uid;
    }

    const categoryInfo = uidCategory.get(uid) || uidMeta.get(uid);
    if (categoryInfo) {
      if (categoryInfo.category) {
        entry.category = categoryInfo.category;
      }
      if (categoryInfo.trainerType) {
        entry.trainerType = categoryInfo.trainerType;
      }
      if (categoryInfo.energyType) {
        entry.energyType = categoryInfo.energyType;
      }
      const displayCategory =
        categoryInfo.displayCategory ||
        composeDisplayCategory(categoryInfo.category, categoryInfo.trainerType, categoryInfo.energyType);
      if (displayCategory) {
        entry.displayCategory = displayCategory;
      }
    }

    return entry;
  });

  return {
    deckTotal,
    items
  };
}

function buildArchetypeReports(decks) {
  const groups = new Map();
  const deckTotal = decks.length || 0;
  const minDecks = Math.max(1, Math.ceil(deckTotal * 0.005));

  for (const deck of decks) {
    const displayName = deck.archetype || 'Unknown';
    const normalized = normalizeArchetypeName(displayName);
    const base = sanitizeForFilename(normalized.replace(/ /g, '_')) || 'Unknown';
    if (!groups.has(normalized)) {
      groups.set(normalized, {
        base,
        decks: []
      });
    }
    groups.get(normalized).decks.push(deck);
  }

  const files = [];
  for (const { base, decks: archetypeDecks } of groups.values()) {
    if (archetypeDecks.length < minDecks) {
      continue;
    }
    files.push({
      filename: `${base}.json`,
      base,
      deckCount: archetypeDecks.length,
      data: generateReportFromDecks(archetypeDecks, archetypeDecks.length)
    });
  }

  files.sort((a, b) => b.deckCount - a.deckCount);
  return {
    minDecks,
    files,
    index: files.map(file => file.base)
  };
}

async function putJson(key, data) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json'
    })
  );
}

async function readJson(key) {
  try {
    const object = await s3Client.send(
      new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key
      })
    );
    const chunks = [];
    for await (const chunk of object.Body) {
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf-8');
    return JSON.parse(text);
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

// Note: updateTournamentsList() has been removed because online tournaments
// are now treated as a special case and are NOT added to tournaments.json

// ============================================================================
// Include-Exclude Report Generation
// ============================================================================

const MIN_DECKS_FOR_ANALYSIS = 4;
const MIN_CARD_USAGE_PERCENT = 5;
const MAX_CROSS_FILTERS = 10;
const MIN_SUBSET_SIZE = 2;
const MAX_COUNT_VARIATIONS = 3;

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

function generateCountFilters(cardInfo) {
  const dist = cardInfo.dist || [];
  const filters = [];

  const copyCounts = dist
    .map(d => d.copies)
    .filter(c => c > 0)
    .sort((a, b) => a - b);

  if (copyCounts.length === 0) {
    return filters;
  }

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

async function hashReportItems(items) {
  const itemsStr = JSON.stringify(items, null, 0);
  const hash = crypto.createHash('sha256').update(itemsStr).digest('hex');
  return hash;
}

function generateFilterCombinations(optionalCards) {
  const combinations = [];

  const meaningfulCards = optionalCards.filter(card => card.pct >= MIN_CARD_USAGE_PERCENT);
  
  console.log(`[IncludeExclude] Filtering ${optionalCards.length} cards to ${meaningfulCards.length} with ${MIN_CARD_USAGE_PERCENT}%+ usage`);

  const sortedCards = [...meaningfulCards].sort((a, b) => b.pct - a.pct);

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

  for (const card of sortedCards) {
    combinations.push({
      include: [],
      exclude: [{ cardId: card.id }]
    });
  }

  const topCardsForCross = sortedCards.slice(0, MAX_CROSS_FILTERS);
  
  console.log(`[IncludeExclude] Generating cross-filters for top ${topCardsForCross.length} cards`);

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

async function generateIncludeExcludeReports(archetypeName, archetypeDecks, archetypeReport) {
  const deckTotal = archetypeDecks.length;

  if (deckTotal < MIN_DECKS_FOR_ANALYSIS) {
    console.log(`[IncludeExclude] Skipping ${archetypeName}: only ${deckTotal} decks (minimum ${MIN_DECKS_FOR_ANALYSIS})`);
    return null;
  }

  console.log(`[IncludeExclude] Generating reports for ${archetypeName} (${deckTotal} decks)...`);

  const { alwaysIncluded, optional, cardLookup } = extractCardsFromReport(archetypeReport, deckTotal);

  if (optional.length === 0) {
    console.log(`[IncludeExclude] No optional cards for ${archetypeName}`);
    return null;
  }

  console.log(`[IncludeExclude] ${archetypeName}: ${optional.length} optional cards, ${alwaysIncluded.length} always included`);

  const { cardPresence, cardCounts, deckById } = indexDeckCardPresence(archetypeDecks);

  const combinations = generateFilterCombinations(optional);
  console.log(`[IncludeExclude] ${archetypeName}: Generated ${combinations.length} filter combinations`);

  const uniqueSubsets = new Map();
  const filterMap = new Map();
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

    if (deckIds.size < MIN_SUBSET_SIZE) {
      skippedSmallSubsets++;
      continue;
    }

    const contentHash = await hashReportItems(report.items);

    const filterKey = buildFilterKey(filters);

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

async function writeIncludeExcludeReports(archetypeName, reports, tournamentFolder) {
  if (!reports || !reports.index || !reports.subsets) {
    return;
  }

  const archetypeBase = sanitizeForFilename(archetypeName);
  const includeExcludePath = `include-exclude/${tournamentFolder}/${archetypeBase}`;

  await putJson(`${includeExcludePath}/index.json`, reports.index);

  for (const [contentHash, subset] of reports.subsets.entries()) {
    const subsetKey = `${includeExcludePath}/unique_subsets/${subset.id}.json`;
    await putJson(subsetKey, subset.data);
  }

  console.log(`[IncludeExclude] Wrote ${reports.subsets.size} subsets for ${archetypeName} to ${includeExcludePath}`);
}

// ============================================================================
// Main Function
// ============================================================================

async function main() {
  const now = new Date();
  const windowStart = daysAgo(WINDOW_DAYS);

  console.log(`[online-meta] Gathering tournaments since ${windowStart.toISOString()}`);
  const tournaments = await fetchRecentOnlineTournaments(windowStart);
  console.log(`[online-meta] Found ${tournaments.length} eligible tournaments`);

  const decks = await gatherDecks(tournaments);
  if (!decks.length) {
    throw new Error('No decklists gathered from online tournaments');
  }

  console.log(`[online-meta] Aggregating ${decks.length} decks`);
  const masterReport = generateReportFromDecks(decks, decks.length);
  const { files: archetypeFiles, index: archetypeIndex, minDecks } = buildArchetypeReports(decks);

  const meta = {
    name: TARGET_FOLDER,
    source: 'limitless-online',
    generatedAt: now.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    deckTotal: decks.length,
    tournamentCount: tournaments.length,
    archetypeMinPercent: 0.5,
    archetypeMinDecks: minDecks,
    tournaments: tournaments.map(t => ({
      id: t.id,
      name: t.name,
      date: t.date,
      players: t.players,
      format: t.format,
      platform: t.platform,
      organizer: t.organizer
    }))
  };

  const basePath = `${R2_REPORTS_PREFIX}/${TARGET_FOLDER}`;
  
  // Always upload meta.json (required for the UI)
  await putJson(`${basePath}/meta.json`, meta);

  // Conditionally upload based on feature flags
  if (GENERATE_MASTER) {
    console.log('[online-meta] Uploading master.json...');
    await putJson(`${basePath}/master.json`, masterReport);
  } else {
    console.log('[online-meta] Skipping master.json (GENERATE_MASTER=false)');
  }

  if (GENERATE_DECKS) {
    console.log('[online-meta] Uploading decks.json...');
    await putJson(`${basePath}/decks.json`, decks);
  } else {
    console.log('[online-meta] Skipping decks.json (GENERATE_DECKS=false)');
  }

  if (GENERATE_ARCHETYPES) {
    console.log('[online-meta] Uploading archetype reports...');
    await putJson(`${basePath}/archetypes/index.json`, archetypeIndex);
    for (const file of archetypeFiles) {
      await putJson(`${basePath}/archetypes/${file.filename}`, file.data);
    }
  } else {
    console.log('[online-meta] Skipping archetype reports (GENERATE_ARCHETYPES=false)');
  }

  // Generate include-exclude reports for eligible archetypes
  let includeExcludeCount = 0;
  const includeExcludeErrors = [];

  if (GENERATE_INCLUDE_EXCLUDE) {
    console.log('[online-meta] Generating include-exclude reports...');
    
    for (const file of archetypeFiles) {
      const archetypeName = file.base.replace(/_/g, ' ');
      const archetypeDecks = decks.filter(d => {
        const normalized = normalizeArchetypeName(d.archetype || 'Unknown');
        return sanitizeForFilename(normalized.replace(/ /g, '_')) === file.base;
      });

      try {
        const reports = await generateIncludeExcludeReports(
          archetypeName,
          archetypeDecks,
          file.data
        );

        if (reports) {
          await writeIncludeExcludeReports(archetypeName, reports, TARGET_FOLDER);
          includeExcludeCount++;
        }
      } catch (error) {
        console.error(`[online-meta] Failed to generate include-exclude for ${archetypeName}:`, error);
        includeExcludeErrors.push({
          archetype: archetypeName,
          error: error.message || String(error)
        });
      }
    }

    console.log('[online-meta] Include-exclude generation complete', {
      archetypesWithReports: includeExcludeCount,
      errors: includeExcludeErrors.length
    });
  } else {
    console.log('[online-meta] Skipping include-exclude reports (GENERATE_INCLUDE_EXCLUDE=false)');
  }

  // Note: Online tournaments are NOT added to tournaments.json
  // They are treated as a special case in the UI

  const uploadedComponents = [];
  if (GENERATE_MASTER) uploadedComponents.push('master');
  if (GENERATE_ARCHETYPES) uploadedComponents.push(`${archetypeFiles.length} archetypes`);
  if (GENERATE_INCLUDE_EXCLUDE) uploadedComponents.push(`${includeExcludeCount} include-exclude reports`);
  if (GENERATE_DECKS) uploadedComponents.push('decks');

  console.log(
    `[online-meta] Uploaded ${uploadedComponents.join(' + ')} to ${R2_BUCKET_NAME}/${basePath}`
  );
}

main().catch(error => {
  console.error('[online-meta] Failed:', error);
  process.exit(1);
});
