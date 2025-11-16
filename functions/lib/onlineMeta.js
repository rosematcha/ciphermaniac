import { fetchLimitlessJson } from './limitless.js';
import {
  generateReportFromDecks,
  normalizeArchetypeName,
  sanitizeForFilename,
  sanitizeForPath
} from './reportBuilder.js';
import {
  generateIncludeExcludeReports,
  writeIncludeExcludeReports
} from './onlineMetaIncludeExclude.js';
import { loadCardTypesDatabase, enrichCardWithType } from './cardTypesDatabase.js';
import { enrichDecksWithOnTheFlyFetch } from './cardTypeFetcher.js';

const WINDOW_DAYS = 14;
const MIN_USAGE_PERCENT = 0.5;
const TARGET_FOLDER = 'Online - Last 14 Days';
const REPORT_BASE_KEY = `reports/${TARGET_FOLDER}`;
const PAGE_SIZE = 100;
const MAX_TOURNAMENT_PAGES = 10;
const SUPPORTED_FORMATS = new Set(['STANDARD']);
const DEFAULT_DETAILS_CONCURRENCY = 5;
const DEFAULT_STANDINGS_CONCURRENCY = 4;

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

async function fetchRecentOnlineTournaments(env, since, options = {}) {
  const sinceMs = since.getTime();
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
      if (!Number.isFinite(dateMs) || dateMs < sinceMs) {
        sawOlder = true;
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
      let entry = {
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

async function gatherDecks(env, tournaments, diagnostics, cardTypesDb = null, options = {}) {
  if (!Array.isArray(tournaments) || tournaments.length === 0) {
    return [];
  }

  const fetchJson = options.fetchJson || fetchLimitlessJson;
  const standingsConcurrency = options.standingsConcurrency || DEFAULT_STANDINGS_CONCURRENCY;

  const perTournamentDecks = await runWithConcurrency(
    tournaments,
    standingsConcurrency,
    async tournament => {
      const limit = determinePlacementLimit(tournament?.players);
      if (limit === 0) {
        diagnostics?.tournamentsBelowMinimum.push({
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
        diagnostics?.standingsFetchFailures.push({
          tournamentId: tournament.id,
          name: tournament.name,
          message: error?.message || 'Unknown standings fetch error'
        });
        return [];
      }

      if (!Array.isArray(standings)) {
        diagnostics?.invalidStandingsPayload.push({
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

      const cappedStandings = sortedStandings.slice(0, limit);
      const decks = [];

      for (const entry of cappedStandings) {
        if (!Number.isFinite(entry?.placing)) {
          diagnostics?.entriesWithoutPlacing.push({
            tournamentId: tournament.id,
            name: tournament.name,
            player: entry?.name || entry?.player || 'Unknown Player'
          });
        }

        const cards = toCardEntries(entry?.decklist, cardTypesDb);
        if (!cards.length) {
          diagnostics?.entriesWithoutDecklists.push({
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
          tournamentFormat: tournament.format,
          tournamentPlatform: tournament.platform,
          tournamentOrganizer: tournament.organizer,
          deckSource: 'limitless-online'
        });
      }

      return decks;
    }
  );

  return perTournamentDecks.flat();
}

function buildArchetypeReports(decks, minPercent) {
  const groups = new Map();

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
    const data = generateReportFromDecks(group.decks, group.decks.length, decks);
    archetypeFiles.push({
      filename,
      base: group.filenameBase,
      data,
      deckCount: group.decks.length
    });
    deckMap.set(group.filenameBase, group.decks);
  });

  archetypeFiles.sort((a, b) => b.deckCount - a.deckCount);

  return {
    archetypeFiles,
    archetypeIndex: archetypeFiles.map(file => file.base).sort((a, b) => a.localeCompare(b)),
    minDecks,
    deckMap
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
  // Unknown player counts default to the maximum capture to keep data rich.
  return 32;
}

export async function runOnlineMetaJob(env, options = {}) {
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
  const masterReport = generateReportFromDecks(decks, deckTotal, decks);
  const { archetypeFiles, archetypeIndex, minDecks, deckMap } = buildArchetypeReports(
    decks,
    MIN_USAGE_PERCENT
  );

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

  await putJson(env, `${REPORT_BASE_KEY}/master.json`, masterReport);
  await putJson(env, `${REPORT_BASE_KEY}/meta.json`, meta);
  await putJson(env, `${REPORT_BASE_KEY}/decks.json`, decks);
  await putJson(env, `${REPORT_BASE_KEY}/archetypes/index.json`, archetypeIndex);

  for (const file of archetypeFiles) {
    await putJson(env, `${REPORT_BASE_KEY}/archetypes/${file.filename}`, file.data);
  }

  // Generate include-exclude reports for eligible archetypes
  console.info('[OnlineMeta] Generating include-exclude reports...');
  let includeExcludeCount = 0;
  const includeExcludeErrors = [];
  
  for (const file of archetypeFiles) {
    const archetypeName = file.base.replace(/_/g, ' ');
    const archetypeDecks = deckMap.get(file.base) || [];

    try {
      const reports = await generateIncludeExcludeReports(
        archetypeName,
        archetypeDecks,
        file.data,
        env
      );

      if (reports) {
        await writeIncludeExcludeReports(archetypeName, reports, env, TARGET_FOLDER);
        includeExcludeCount++;
      }
    } catch (error) {
      console.error(`[OnlineMeta] Failed to generate include-exclude for ${archetypeName}:`, error);
      includeExcludeErrors.push({
        archetype: archetypeName,
        error: error.message || String(error)
      });
    }
  }

  console.info('[OnlineMeta] Include-exclude generation complete', {
    archetypesWithReports: includeExcludeCount,
    errors: includeExcludeErrors.length
  });

  // Note: Online tournaments are NOT added to tournaments.json
  // They are treated as a special case in the UI

  console.info('[OnlineMeta] Aggregated online tournaments', {
    deckTotal,
    tournamentCount: tournaments.length,
    archetypes: archetypeFiles.length,
    includeExcludeReports: includeExcludeCount
  });

  return {
    success: true,
    decks: deckTotal,
    tournaments: tournaments.length,
    archetypes: archetypeFiles.length,
    includeExcludeReports: includeExcludeCount,
    includeExcludeErrors,
    folder: TARGET_FOLDER,
    diagnostics
  };
}

export { fetchRecentOnlineTournaments, gatherDecks, buildArchetypeReports };
