import { fetchLimitlessJson } from './limitless.js';
import {
  generateReportFromDecks,
  normalizeArchetypeName,
  sanitizeForFilename,
  sanitizeForPath
} from './reportBuilder.js';
import { loadCardTypesDatabase, enrichCardWithType } from './cardTypesDatabase.js';
import { enrichDecksWithOnTheFlyFetch } from './cardTypeFetcher.js';
import { loadCardSynonyms } from './cardSynonyms.js';
import archetypeThumbnails from '../../public/assets/data/archetype-thumbnails.json';

const WINDOW_DAYS = 30;
const MIN_USAGE_PERCENT = 0.5;
const TARGET_FOLDER = 'Online - Last 14 Days';


const REPORT_BASE_KEY = `reports/${TARGET_FOLDER}`;
const PAGE_SIZE = 100;
const MAX_TOURNAMENT_PAGES = 10;
const SUPPORTED_FORMATS = new Set(['STANDARD']);
const DEFAULT_DETAILS_CONCURRENCY = 5;
const DEFAULT_STANDINGS_CONCURRENCY = 4;
const DEFAULT_R2_CONCURRENCY = 6;
const DEFAULT_MIN_TREND_APPEARANCES = 3;
const MIN_TREND_PLAYERS = 0;

// Placement tagging thresholds (absolute finishing positions)
const PLACEMENT_TAG_RULES = [
  { tag: 'winner', maxPlacing: 1, minPlayers: 2 },
  { tag: 'top2', maxPlacing: 2, minPlayers: 4 },
  { tag: 'top4', maxPlacing: 4, minPlayers: 8 },
  { tag: 'top8', maxPlacing: 8, minPlayers: 16 },
  { tag: 'top16', maxPlacing: 16, minPlayers: 32 }
];

// Percentile-based placement tagging thresholds
const PERCENT_TAG_RULES = [
  { tag: 'top10', fraction: 0.1, minPlayers: 20 },
  { tag: 'top25', fraction: 0.25, minPlayers: 12 },
  { tag: 'top50', fraction: 0.5, minPlayers: 8 }
];

const SUCCESS_TAGS = Array.from(
  new Set([
    ...PLACEMENT_TAG_RULES.map(rule => rule.tag),
    ...PERCENT_TAG_RULES.map(rule => rule.tag)
  ])
);
const DEFAULT_CARD_TREND_MIN_APPEARANCES = 2;
const DEFAULT_CARD_TREND_TOP = 12;
type AnyOptions = Record<string, any>;
type ThumbnailConfig = Record<string, string[]>;
const ARCHETYPE_THUMBNAILS: ThumbnailConfig = (archetypeThumbnails as ThumbnailConfig) || {};

async function runWithConcurrency(items, limit, handler) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const maxConcurrency = Math.max(1, Math.min(Number(limit) || 1, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      results[currentIndex] = await handler(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: maxConcurrency }, () => worker()));
  return results;
}

function daysAgo(count) {
  return new Date(Date.now() - count * 24 * 60 * 60 * 1000);
}

// Lightweight heuristics to enrich trainer/energy subtypes without extra API calls
// These mirror client-side logic where possible to keep categories consistent.
const ACE_SPEC_KEYWORDS = [
  'ace spec',
  'prime catcher',
  'reboot pod',
  'legacy energy',
  'enriching energy',
  'neo upper energy',
  'master ball',
  'secret box',
  'sparkling crystal',
  "hero's cape",
  'scramble switch',
  'dowsing machine',
  'computer search',
  'life dew',
  'scoop up cyclone',
  'gold potion',
  'victory piece',
  'g booster',
  'g scope',
  'g spirit',
  'crystal edge',
  'crystal wall',
  'rock guard',
  'surprise megaphone',
  'chaotic amplifier',
  'precious trolley',
  'poke vital a',
  'unfair stamp',
  'brilliant blender'
].map(k => k.toLowerCase());

function isAceSpecName(name) {
  const normalized = String(name || '').toLowerCase();
  return ACE_SPEC_KEYWORDS.some(k => normalized.includes(k));
}

function inferEnergyType(name, setCode) {
  // Basic Energy cards (SVE set)
  if ((setCode || '').toUpperCase() === 'SVE') {
    return 'basic';
  }
  // Special Energy cards - "Energy" is always the last word
  if ((name || '').endsWith(' Energy') && (setCode || '').toUpperCase() !== 'SVE') {
    return 'special';
  }
  return null;
}

function inferTrainerType(name) {
  const n = String(name || '');
  const lower = n.toLowerCase();
  // Stadiums often include these tokens explicitly
  if (n.includes('Stadium') || n.includes('Tower') || n.includes('Artazon') || n.includes('Mesagoza') || n.includes('Levincia')) {
    return 'stadium';
  }
  // Tools typically have equipment-like words or TM
  const toolHints = [
    'tool',
    'belt',
    'helmet',
    'cape',
    'charm',
    'vest',
    'band',
    'mask',
    'glasses',
    'rescue board',
    'seal stone',
    'technical machine',
    'tm:'
  ];
  if (toolHints.some(h => lower.includes(h))) {
    return 'tool';
  }
  // Ace Specs override other trainer subtypes
  if (isAceSpecName(n)) {
    return 'tool';
  }
  // Common supporter indicators
  const supporterHints = [
    'professor',
    "boss's orders",
    'orders',
    'research',
    'judge',
    'scenario',
    'vitality',
    'grant',
    'roxanne',
    'miriam',
    'iono',
    'arven',
    'jacq',
    'penny',
    'briar',
    'carmine',
    'kieran',
    'geeta',
    'grusha',
    'ryme',
    'clavell',
    'giacomo'
  ];
  if (supporterHints.some(h => lower.includes(h))) {
    return 'supporter';
  }
  // Item catch-alls (keep broad; many trainers are items)
  const itemHints = [
    'ball',
    'rod',
    'catcher',
    'switch',
    'machine',
    'basket',
    'retrieval',
    'hammer',
    'potion',
    'stretcher',
    'vessel',
    'candy',
    'poffin',
    'powerglass',
    'energy search',
    'ultra ball'
  ];
  if (itemHints.some(h => lower.includes(h))) {
    return 'item';
  }
  // Default to item for unknown trainers
  return 'item';
}

async function fetchRecentOnlineTournaments(env, since, options: AnyOptions = {}) {
  const sinceMs = since.getTime();
  const windowEndMs = options.windowEnd ? new Date(options.windowEnd).getTime() : null;
  const pageSize = options.pageSize || PAGE_SIZE;
  const maxPages = options.maxPages || MAX_TOURNAMENT_PAGES;
  const diagnostics = options.diagnostics;
  const fetchJson = options.fetchJson || fetchLimitlessJson;
  const detailsConcurrency = options.detailsConcurrency || DEFAULT_DETAILS_CONCURRENCY;
  const unique = new Map();

  for (let page = 1; page <= maxPages; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const list = await fetchJson('/tournaments', {
      env,
      searchParams: {
        game: 'PTCG',
        limit: pageSize,
        page
      }
    });

    if (!Array.isArray(list) || list.length === 0) {
      break;
    }

    let sawOlder = false;
    for (const entry of list) {
      const dateMs = Date.parse(entry?.date);
      if (!Number.isFinite(dateMs)) {
        continue;
      }
      if (dateMs < sinceMs) {
        sawOlder = true;
        continue;
      }
      if (windowEndMs && dateMs > windowEndMs) {
        continue;
      }
      unique.set(entry.id, entry);
    }

    if (sawOlder) {
      break;
    }
  }

  const summaries = Array.from(unique.values());
  const detailed = await runWithConcurrency(
    summaries,
    detailsConcurrency,
    async summary => {
      try {
        const details = await fetchJson(`/tournaments/${summary.id}/details`, { env });
        if (details.decklists === false) {
          diagnostics?.detailsWithoutDecklists.push({
            tournamentId: summary.id,
            name: summary.name
          });
          return null;
        }
        if (details.isOnline === false) {
          diagnostics?.detailsOffline.push({
            tournamentId: summary.id,
            name: summary.name
          });
          return null;
        }

        const formatId = (details.format || summary.format || '').toUpperCase();
        if (formatId && !SUPPORTED_FORMATS.has(formatId)) {
          diagnostics?.detailsUnsupportedFormat.push({
            tournamentId: summary.id,
            name: summary.name,
            format: formatId
          });
          return null;
        }
        return {
          id: summary.id,
          name: summary.name,
          date: summary.date,
          format: details.format || summary.format || null,
          platform: details.platform || null,
          game: summary.game,
          players: summary.players,
          organizer: details.organizer?.name || null,
          organizerId: details.organizer?.id || null
        };
      } catch (error) {
        console.warn('Failed to fetch tournament details', summary?.id, error?.message || error);
        return null;
      }
    }
  );

  return detailed.filter(Boolean).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

function toCardEntries(decklist, cardTypesDb = null) {
  if (!decklist || typeof decklist !== 'object') {
    return [];
  }

  const sections = Object.entries(decklist);
  const cards = [];

  for (const [sectionName, entries] of sections) {
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const card of entries) {
      const count = Number(card?.count) || 0;
      if (!count) {
        continue;
      }
      const rawCategory = sectionName.toLowerCase();
      let category = 'trainer';
      if (rawCategory === 'pokemon') {
        category = 'pokemon';
      } else if (rawCategory === 'energy') {
        category = 'energy';
      }

      const name = card?.name || 'Unknown Card';
      const set = card?.set || null;
      const number = card?.number || null;

      // Build base entry
      let entry: any = {
        count,
        name,
        set,
        number,
        category
      };

      // Try to enrich from database first
      if (cardTypesDb && set && number) {
        entry = enrichCardWithType(entry, cardTypesDb);
      }

      // Fall back to heuristics if database didn't provide the info
      if (!entry.trainerType && !entry.energyType) {
        if (category === 'trainer') {
          const trainerType = inferTrainerType(name);
          if (trainerType) {
            entry.trainerType = trainerType;
          }
        } else if (category === 'energy') {
          const energyType = inferEnergyType(name, set);
          if (energyType) {
            entry.energyType = energyType;
          }
        }
      }

      if (category === 'trainer' && !entry.aceSpec && isAceSpecName(name)) {
        entry.aceSpec = true;
      }

      cards.push(entry);
    }
  }

  return cards;
}

async function hashDeck(cards, playerId = '') {
  const cryptoImpl = globalThis.crypto;
  if (!cryptoImpl?.subtle) {
    throw new Error('Web Crypto API not available for hashing decks');
  }
  const canonical = cards
    .map(card => `${card.count}x${card.name || ''}::${card.set || ''}::${card.number || ''}`)
    .sort()
    .join('|');
  const source = canonical || playerId || `${Date.now()}-${Math.random()}`;
  const digest = await cryptoImpl.subtle.digest('SHA-1', new TextEncoder().encode(source));
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function determinePlacementTags(placing, players) {
  const place = Number.isFinite(placing) ? placing : null;
  const fieldSize = Number.isFinite(players) ? players : null;
  if (!place || !fieldSize || place <= 0 || fieldSize <= 1) {
    return [];
  }

  const tags = [];

  for (const rule of PLACEMENT_TAG_RULES) {
    if (fieldSize >= rule.minPlayers && place <= rule.maxPlacing) {
      tags.push(rule.tag);
    }
  }

  for (const rule of PERCENT_TAG_RULES) {
    if (fieldSize < rule.minPlayers) {
      continue;
    }
    const cutoff = Math.max(1, Math.ceil(fieldSize * rule.fraction));
    if (place <= cutoff) {
      tags.push(rule.tag);
    }
  }

  return tags;
}

async function gatherDecks(env, tournaments, diagnostics, cardTypesDb = null, options: AnyOptions = {}) {
  if (!Array.isArray(tournaments) || tournaments.length === 0) {
    return [];
  }

  const diag = diagnostics || {};
  diag.detailsWithoutDecklists = diag.detailsWithoutDecklists || [];
  diag.detailsOffline = diag.detailsOffline || [];
  diag.detailsUnsupportedFormat = diag.detailsUnsupportedFormat || [];
  diag.standingsFetchFailures = diag.standingsFetchFailures || [];
  diag.invalidStandingsPayload = diag.invalidStandingsPayload || [];
  diag.entriesWithoutDecklists = diag.entriesWithoutDecklists || [];
  diag.entriesWithoutPlacing = diag.entriesWithoutPlacing || [];
  diag.tournamentsBelowMinimum = diag.tournamentsBelowMinimum || [];

  const fetchJson = options.fetchJson || fetchLimitlessJson;
  const standingsConcurrency = options.standingsConcurrency || DEFAULT_STANDINGS_CONCURRENCY;

  const perTournamentDecks = await runWithConcurrency(
    tournaments,
    standingsConcurrency,
    async tournament => {
      const limit = determinePlacementLimit(tournament?.players);
      if (limit === 0) {
        diag.tournamentsBelowMinimum.push({
          tournamentId: tournament.id,
          name: tournament.name,
          players: tournament.players
        });
        return [];
      }

      let standings;
      try {
        standings = await fetchJson(`/tournaments/${tournament.id}/standings`, { env });
      } catch (error) {
        console.warn('Failed to fetch standings', tournament.id, error?.message || error);
        diag.standingsFetchFailures.push({
          tournamentId: tournament.id,
          name: tournament.name,
          message: error?.message || 'Unknown standings fetch error'
        });
        return [];
      }

      if (!Array.isArray(standings)) {
        diag.invalidStandingsPayload.push({
          tournamentId: tournament.id,
          name: tournament.name
        });
        return [];
      }

      const sortedStandings = [...standings].sort((a, b) => {
        const placingA = Number.isFinite(a?.placing) ? a.placing : Number.POSITIVE_INFINITY;
        const placingB = Number.isFinite(b?.placing) ? b.placing : Number.POSITIVE_INFINITY;
        return placingA - placingB;
      });

      // Derive tournament size when Limitless doesn't provide it (common for online)
      const maxReportedPlacing = Number.isFinite(sortedStandings.at(-1)?.placing)
        ? Number(sortedStandings.at(-1).placing)
        : 0;
      const derivedPlayers = Number(tournament?.players) || Math.max(sortedStandings.length, maxReportedPlacing);

      const cappedStandings = sortedStandings.slice(0, limit);
      const decks = [];

      for (const entry of cappedStandings) {
        if (!Number.isFinite(entry?.placing)) {
          diag.entriesWithoutPlacing.push({
            tournamentId: tournament.id,
            name: tournament.name,
            player: entry?.name || entry?.player || 'Unknown Player'
          });
        }

        const cards = toCardEntries(entry?.decklist, cardTypesDb);
        if (!cards.length) {
          diag.entriesWithoutDecklists.push({
            tournamentId: tournament.id,
            player: entry?.name || entry?.player || 'Unknown Player'
          });
          continue;
        }

        const archetypeName = entry?.deck?.name || 'Unknown';
        // eslint-disable-next-line no-await-in-loop
        const id = await hashDeck(cards, entry?.player);
        decks.push({
          id,
          player: entry?.name || entry?.player || 'Unknown Player',
          playerId: entry?.player || null,
          country: entry?.country || null,
          placement: entry?.placing ?? null,
          archetype: archetypeName,
          archetypeId: entry?.deck?.id || null,
          cards,
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          tournamentDate: tournament.date,
          tournamentPlayers: derivedPlayers || tournament.players || null,
          tournamentFormat: tournament.format,
          tournamentPlatform: tournament.platform,
          tournamentOrganizer: tournament.organizer,
          deckSource: 'limitless-online',
          successTags: determinePlacementTags(entry?.placing, derivedPlayers || tournament?.players)
        });
      }

      return decks;
    }
  );

  return perTournamentDecks.flat();
}

function normalizeDeckLabel(label: string) {
  return String(label || '')
    .replace(/['']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function resolveArchetypeThumbnails(
  baseName: string,
  displayName: string,
  config: ThumbnailConfig
): string[] {
  const attempts = [displayName, displayName?.replace(/_/g, ' '), baseName];
  for (const candidate of attempts) {
    if (candidate && Array.isArray(config[candidate])) {
      return config[candidate];
    }
  }

  const normalizedTarget = normalizeDeckLabel(displayName || baseName || '');
  if (!normalizedTarget) {
    return [];
  }

  for (const [key, ids] of Object.entries(config)) {
    if (normalizeDeckLabel(key) === normalizedTarget) {
      return ids;
    }
  }
  return [];
}

function buildArchetypeReports(decks, minPercent, synonymDb, options: AnyOptions = {}) {
  const groups = new Map();
  const thumbnailConfig: ThumbnailConfig = options.thumbnailConfig || {};

  for (const deck of decks) {
    const displayName = deck?.archetype || 'Unknown';
    const normalized = normalizeArchetypeName(displayName);
    const filenameBase = sanitizeForFilename(normalized.replace(/ /g, '_')) || 'Unknown';
    if (!groups.has(normalized)) {
      groups.set(normalized, {
        displayName,
        filenameBase,
        decks: []
      });
    }
    groups.get(normalized).decks.push(deck);
  }

  const deckTotal = decks.length || 0;
  const minDecks = Math.max(1, Math.ceil(deckTotal * (minPercent / 100)));
  const archetypeFiles = [];
  const deckMap = new Map();

  groups.forEach(group => {
    if (group.decks.length < minDecks) {
      return;
    }
    const filename = `${group.filenameBase}.json`;
    const data = generateReportFromDecks(group.decks, group.decks.length, decks, synonymDb);
    archetypeFiles.push({
      filename,
      base: group.filenameBase,
      displayName: group.displayName,
      data,
      deckCount: group.decks.length
    });
    deckMap.set(group.filenameBase, group.decks);
  });

  archetypeFiles.sort((a, b) => b.deckCount - a.deckCount);

  const archetypeIndex = archetypeFiles.map(file => ({
    name: file.base,
    label: file.displayName || file.base.replace(/_/g, ' '),
    deckCount: file.deckCount,
    percent: deckTotal ? file.deckCount / deckTotal : 0,
    thumbnails: resolveArchetypeThumbnails(file.base, file.displayName, thumbnailConfig)
  }));

  return {
    archetypeFiles,
    archetypeIndex,
    minDecks,
    deckMap
  };
}

function buildTrendReport(decks, tournaments, options: AnyOptions = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const windowStart = options.windowStart ? new Date(options.windowStart) : null;
  const windowEnd = options.windowEnd ? new Date(options.windowEnd) : now;
  const minAppearances = Math.max(
    1,
    Number.isFinite(options.minAppearances) ? Number(options.minAppearances) : DEFAULT_MIN_TREND_APPEARANCES
  );

  const tournamentIndex = new Map();
  const sortedTournaments = (Array.isArray(tournaments) ? tournaments : [])
    .filter(t => t && t.id && (Number(t.players) || 0) >= MIN_TREND_PLAYERS)
    .map(t => ({
      ...t,
      date: t.date || null
    }))
    .sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0));

  sortedTournaments.forEach(t => {
    tournamentIndex.set(t.id, {
      ...t,
      deckTotal: 0
    });
  });

  const archetypes = new Map();
  const successTagSet = new Set(SUCCESS_TAGS);
  const deckList = Array.isArray(decks) ? decks : [];

  for (const deck of deckList) {
    const tournamentId = deck?.tournamentId;
    if (!tournamentId || !tournamentIndex.has(tournamentId)) {
      continue;
    }
    const normalizedName = normalizeArchetypeName(deck?.archetype || 'Unknown');
    const base = sanitizeForFilename(normalizedName.replace(/ /g, '_')) || 'unknown';
    const displayName = deck?.archetype || 'Unknown';

    const archetype = archetypes.get(base) || {
      base,
      displayName,
      totalDecks: 0,
      timeline: new Map()
    };

    const tournamentMeta = tournamentIndex.get(tournamentId);
    tournamentMeta.deckTotal += 1;

    const timelineEntry =
      archetype.timeline.get(tournamentId) || {
        tournamentId,
        tournamentName: deck?.tournamentName || tournamentMeta?.name || 'Unknown Tournament',
        date: deck?.tournamentDate || tournamentMeta?.date || null,
        decks: 0,
        success: {}
      };

    timelineEntry.decks += 1;
    for (const tag of Array.isArray(deck?.successTags) ? deck.successTags : []) {
      if (!successTagSet.has(tag)) {
        continue;
      }
      timelineEntry.success[tag] = (timelineEntry.success[tag] || 0) + 1;
    }

    archetype.timeline.set(tournamentId, timelineEntry);
    archetype.totalDecks += 1;
    archetype.displayName = archetype.displayName || displayName;

    archetypes.set(base, archetype);
  }

  const series = [];
  archetypes.forEach(archetype => {
    const timeline = sortedTournaments.map(tournamentMeta => {
      const entry = archetype.timeline.get(tournamentMeta.id);
      const totalDecks = tournamentMeta.deckTotal || 0;

      if (entry) {
        const share = totalDecks ? Math.round((entry.decks / totalDecks) * 10000) / 100 : 0;
        return {
          ...entry,
          totalDecks,
          share
        };
      }

      // Backfill missing tournament
      return {
        tournamentId: tournamentMeta.id,
        tournamentName: tournamentMeta.name,
        date: tournamentMeta.date,
        decks: 0,
        totalDecks,
        share: 0,
        success: {}
      };
    });

    const appearances = timeline.length;
    if (appearances < minAppearances) {
      return;
    }

    const aggregateSuccess = {};
    for (const entry of timeline) {
      Object.entries(entry.success || {}).forEach(([tag, count]) => {
        aggregateSuccess[tag] = (aggregateSuccess[tag] || 0) + (Number(count) || 0);
      });
    }

    const shares = timeline.map(entry => entry.share || 0);
    const avgShare = shares.length ? Math.round((shares.reduce((sum, value) => sum + value, 0) / shares.length) * 10) / 10 : 0;
    const maxShare = shares.length ? Math.max(...shares) : 0;
    const peakShare = maxShare; // Alias for clarity
    const minShare = shares.length ? Math.min(...shares) : 0;

    series.push({
      base: archetype.base,
      displayName: archetype.displayName,
      totalDecks: archetype.totalDecks,
      appearances,
      avgShare,
      maxShare,
      peakShare,
      minShare,
      successTotals: aggregateSuccess,
      timeline
    });
  });

  series.sort((a, b) => b.totalDecks - a.totalDecks || b.avgShare - a.avgShare);

  const tournamentsWithTotals = sortedTournaments.map(t => ({
    ...t,
    deckTotal: tournamentIndex.get(t.id)?.deckTotal || 0
  }));

  return {
    generatedAt: now.toISOString(),
    windowStart: windowStart ? windowStart.toISOString() : null,
    windowEnd: windowEnd ? windowEnd.toISOString() : null,
    deckTotal: deckList.length,
    tournamentCount: tournamentsWithTotals.length,
    minAppearances,
    archetypeCount: series.length,
    tournaments: tournamentsWithTotals,
    series
  };
}

function buildCardTrendReport(decks, tournaments, options: AnyOptions = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const windowStart = options.windowStart ? new Date(options.windowStart) : null;
  const windowEnd = options.windowEnd ? new Date(options.windowEnd) : now;
  const minAppearances = Math.max(
    1,
    Number.isFinite(options.minAppearances) ? Number(options.minAppearances) : DEFAULT_CARD_TREND_MIN_APPEARANCES
  );
  const topCount = Math.max(1, Number.isFinite(options.topCount) ? Number(options.topCount) : DEFAULT_CARD_TREND_TOP);

  const tournamentsMap = new Map();
  (Array.isArray(tournaments) ? tournaments : [])
    .filter(t => t && t.id && (Number(t.players) || 0) >= MIN_TREND_PLAYERS)
    .forEach(t => {
      tournamentsMap.set(t.id, {
        id: t.id,
        date: t.date || null,
        deckTotal: Number(t.deckTotal) || 0
      });
    });

  const cardPresence = new Map(); // key -> Map<tournamentId, presentCount>
  const cardMeta = new Map();

  const deckList = Array.isArray(decks) ? decks : [];
  for (const deck of deckList) {
    const tournamentId = deck?.tournamentId;
    if (!tournamentId || !tournamentsMap.has(tournamentId)) {
      continue;
    }
    const uniqueCards = new Set();
    for (const card of Array.isArray(deck?.cards) ? deck.cards : []) {
      const name = card?.name || 'Unknown Card';
      const set = (card?.set || '').toString().toUpperCase();
      const number = card?.number || '';
      const key = set && number ? `${name}::${set}::${number}` : name;
      uniqueCards.add(key);
      if (!cardMeta.has(key)) {
        cardMeta.set(key, { name, set: set || null, number: number || null });
      }
    }
    uniqueCards.forEach(key => {
      if (!cardPresence.has(key)) {
        cardPresence.set(key, new Map());
      }
      const counts = cardPresence.get(key);
      counts.set(tournamentId, (counts.get(tournamentId) || 0) + 1);
    });
  }

  const series = [];
  cardPresence.forEach((presenceMap, key) => {
    const timeline = Array.from(tournamentsMap.values())
      .sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0))
      .map(meta => {
        const present = presenceMap.get(meta.id) || 0;
        const share = meta.deckTotal ? Math.round((present / meta.deckTotal) * 10000) / 100 : 0;
        return {
          tournamentId: meta.id,
          date: meta.date || null,
          present,
          total: meta.deckTotal,
          share
        };
      });

    const presentEvents = timeline.filter(entry => entry.present > 0).length;
    if (presentEvents < minAppearances) {
      return;
    }

    const chunk = Math.max(1, Math.ceil(timeline.length / 3));
    const startAvg =
      Math.round(
        (timeline.slice(0, chunk).reduce((sum, entry) => sum + (entry.share || 0), 0) / chunk) * 10
      ) / 10;
    const endAvg =
      Math.round(
        (timeline.slice(-chunk).reduce((sum, entry) => sum + (entry.share || 0), 0) / chunk) * 10
      ) / 10;
    const delta = Math.round((endAvg - startAvg) * 10) / 10;
    const latestShare = timeline.at(-1)?.share || 0;

    series.push({
      key,
      ...cardMeta.get(key),
      appearances: timeline.length,
      startShare: startAvg,
      endShare: endAvg,
      delta,
      currentShare: latestShare
    });
  });

  const rising = [...series]
    .filter(item => item.currentShare > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, topCount);
  const falling = [...series].sort((a, b) => a.delta - b.delta).slice(0, topCount);

  return {
    generatedAt: now.toISOString(),
    windowStart: windowStart ? windowStart.toISOString() : null,
    windowEnd: windowEnd ? windowEnd.toISOString() : null,
    cardsAnalyzed: series.length,
    minAppearances,
    topCount,
    rising,
    falling
  };
}

async function putJson(env, key, data) {
  if (!env?.REPORTS?.put) {
    throw new Error('REPORTS bucket not configured');
  }
  const payload = JSON.stringify(data, null, 2);
  await env.REPORTS.put(key, payload, {
    httpMetadata: {
      contentType: 'application/json'
    }
  });
}

async function batchPutJson(env, entries, concurrency = DEFAULT_R2_CONCURRENCY) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return;
  }

  const normalized = entries
    .filter(entry => entry && entry.key && entry.data !== undefined)
    .map(entry => ({ key: entry.key, data: entry.data }));

  if (!normalized.length) {
    return;
  }

  const limit = Math.max(1, Number(concurrency) || DEFAULT_R2_CONCURRENCY);
  await runWithConcurrency(normalized, limit, async entry => putJson(env, entry.key, entry.data));
}

async function readJson(env, key) {
  if (!env?.REPORTS?.get) {
    return null;
  }
  const object = await env.REPORTS.get(key);
  if (!object) {
    return null;
  }
  try {
    const text = await object.text();
    return JSON.parse(text);
  } catch (error) {
    console.warn('Failed to parse JSON from', key, error?.message || error);
    return null;
  }
}

// Note: updateTournamentsList() has been removed because online tournaments
// are now treated as a special case and are NOT added to tournaments.json

function determinePlacementLimit(players) {
  const count = Number(players) || 0;
  // Drop ultra-tiny events
  if (count > 0 && count <= 3) {
    return 0;
  }
  // Known small events: capture full field
  if (count > 0 && count <= 16) {
    return count;
  }
  // Medium events: capture top 75%
  if (count > 0 && count <= 32) {
    return 32;
  }
  if (count > 0 && count <= 64) {
    return 64;
  }
  if (count > 0 && count <= 128) {
    return 96;
  }
  // Large events: capture top 128
  if (count >= 129) {
    return 128;
  }
  // Unknown player counts: grab a richer slice to avoid under-sampling
  return 64;
}

export async function runOnlineMetaJob(env, options: AnyOptions = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const since = options.since ? new Date(options.since) : daysAgo(WINDOW_DAYS);

  const diagnostics = {
    detailsWithoutDecklists: [],
    detailsOffline: [],
    detailsUnsupportedFormat: [],
    standingsFetchFailures: [],
    invalidStandingsPayload: [],
    entriesWithoutDecklists: [],
    entriesWithoutPlacing: [],
    tournamentsBelowMinimum: []
  };

  // Load card types database for enrichment
  console.info('[OnlineMeta] Loading card types database...');
  const cardTypesDb = await loadCardTypesDatabase(env);
  const dbCardCount = Object.keys(cardTypesDb).length;
  console.info(`[OnlineMeta] Loaded ${dbCardCount} cards from types database`);

  // Load card synonyms for canonicalization
  console.info('[OnlineMeta] Loading card synonyms...');
  const synonymDb = await loadCardSynonyms(env);
  const synonymCount = Object.keys(synonymDb.synonyms || {}).length;
  console.info(`[OnlineMeta] Loaded ${synonymCount} synonyms`);

  const tournaments = await fetchRecentOnlineTournaments(env, since, {
    diagnostics,
    fetchJson: options.fetchJson,
    pageSize: options.pageSize,
    maxPages: options.maxPages,
    detailsConcurrency: options.detailsConcurrency
  });
  if (!tournaments.length) {
    return {
      success: false,
      reason: 'No online tournaments found within the lookback window',
      windowStart: since.toISOString(),
      diagnostics
    };
  }

  const decks = await gatherDecks(env, tournaments, diagnostics, cardTypesDb, {
    fetchJson: options.fetchJson,
    standingsConcurrency: options.standingsConcurrency
  });
  if (!decks.length) {
    console.error('[OnlineMeta] No decklists aggregated', diagnostics);
    return {
      success: false,
      reason: 'No decklists available for online tournaments',
      windowStart: since.toISOString(),
      diagnostics
    };
  }

  // Fetch missing card types on-the-fly and update database
  console.info('[OnlineMeta] Checking for missing card types...');
  await enrichDecksWithOnTheFlyFetch(decks, cardTypesDb, env);
  console.info('[OnlineMeta] Card type enrichment complete');

  const deckTotal = decks.length;
  const masterReport = generateReportFromDecks(decks, deckTotal, decks, synonymDb);
  const { archetypeFiles, archetypeIndex, minDecks } = buildArchetypeReports(
    decks,
    MIN_USAGE_PERCENT,
    synonymDb,
    { thumbnailConfig: ARCHETYPE_THUMBNAILS }
  );
  const trendReport: AnyOptions = buildTrendReport(decks, tournaments, {
    windowStart: since,
    windowEnd: now,
    now,
    minAppearances: options.minTrendAppearances
  });
  const cardTrends = buildCardTrendReport(decks, trendReport.tournaments, {
    windowStart: since,
    windowEnd: now
  });
  trendReport.cardTrends = cardTrends;

  const meta = {
    name: TARGET_FOLDER,
    source: 'limitless-online',
    generatedAt: now.toISOString(),
    windowStart: since.toISOString(),
    windowEnd: now.toISOString(),
    deckTotal,
    tournamentCount: tournaments.length,
    archetypeMinPercent: MIN_USAGE_PERCENT,
    archetypeMinDecks: minDecks,
    tournaments: tournaments.map(t => ({
      id: t.id,
      name: t.name,
      date: t.date,
      format: t.format,
      platform: t.platform,
      players: t.players,
      organizer: t.organizer
    }))
  };

  const r2Concurrency = Math.max(1, options.r2Concurrency || DEFAULT_R2_CONCURRENCY);
  const baseWrites = [
    { key: `${REPORT_BASE_KEY}/master.json`, data: masterReport },
    { key: `${REPORT_BASE_KEY}/meta.json`, data: meta },
    { key: `${REPORT_BASE_KEY}/decks.json`, data: decks },
    { key: `${REPORT_BASE_KEY}/trends.json`, data: trendReport },
    { key: `${REPORT_BASE_KEY}/archetypes/index.json`, data: archetypeIndex }
  ];
  const archetypeWrites = archetypeFiles.map(file => ({
    key: `${REPORT_BASE_KEY}/archetypes/${file.filename}`,
    data: file.data
  }));
  await batchPutJson(env, [...baseWrites, ...archetypeWrites], r2Concurrency);

  // Note: Online tournaments are NOT added to tournaments.json
  // They are treated as a special case in the UI

  console.info('[OnlineMeta] Aggregated online tournaments', {
    deckTotal,
    tournamentCount: tournaments.length,
    archetypes: archetypeFiles.length,
    trendArchetypes: trendReport.archetypeCount
  });

  return {
    success: true,
    decks: deckTotal,
    tournaments: tournaments.length,
    archetypes: archetypeFiles.length,
    trendArchetypes: trendReport.archetypeCount,
    folder: TARGET_FOLDER,
    diagnostics
  };
}

export {
  fetchRecentOnlineTournaments,
  gatherDecks,
  buildArchetypeReports,
  buildTrendReport,
  buildCardTrendReport
};
