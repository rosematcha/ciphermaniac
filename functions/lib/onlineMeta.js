import { fetchLimitlessJson } from './limitless.js';
import {
  composeDisplayCategory,
  generateReportFromDecks,
  normalizeArchetypeName,
  sanitizeForFilename,
  sanitizeForPath
} from './reportBuilder.js';

const WINDOW_DAYS = 14;
const MIN_USAGE_PERCENT = 0.5;
const TARGET_FOLDER = 'Online - Last 14 Days';
const REPORT_BASE_KEY = `reports/${TARGET_FOLDER}`;
const PAGE_SIZE = 100;
const MAX_TOURNAMENT_PAGES = 10;
const SUPPORTED_FORMATS = new Set(['STANDARD']);

function daysAgo(count) {
  return new Date(Date.now() - count * 24 * 60 * 60 * 1000);
}

async function fetchRecentOnlineTournaments(env, since, options = {}) {
  const sinceMs = since.getTime();
  const pageSize = options.pageSize || PAGE_SIZE;
  const maxPages = options.maxPages || MAX_TOURNAMENT_PAGES;
const diagnostics = options.diagnostics;
  const unique = new Map();

  for (let page = 1; page <= maxPages; page += 1) {
    const list = await fetchLimitlessJson('/tournaments', {
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
  const detailed = [];
  for (const summary of summaries) {
    try {
      const details = await fetchLimitlessJson(`/tournaments/${summary.id}/details`, { env });
      if (details.decklists === false) {
        diagnostics?.detailsWithoutDecklists.push({
          tournamentId: summary.id,
          name: summary.name
        });
        continue;
      }
      if (details.isOnline === false) {
        diagnostics?.detailsOffline.push({
          tournamentId: summary.id,
          name: summary.name
        });
        continue;
      }

      const formatId = (details.format || summary.format || '').toUpperCase();
      if (formatId && !SUPPORTED_FORMATS.has(formatId)) {
        diagnostics?.detailsUnsupportedFormat.push({
          tournamentId: summary.id,
          name: summary.name,
          format: formatId
        });
        continue;
      }
      detailed.push({
        id: summary.id,
        name: summary.name,
        date: summary.date,
        format: summary.format,
        platform: details.platform || null,
        game: summary.game,
        players: summary.players,
        organizer: details.organizer?.name || null,
        organizerId: details.organizer?.id || null
      });
    } catch (error) {
      console.warn('Failed to fetch tournament details', summary?.id, error?.message || error);
    }
  }

  return detailed.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

function toCardEntries(decklist) {
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

async function gatherDecks(env, tournaments, diagnostics) {
  const decks = [];

  for (const tournament of tournaments) {
    const limit = determinePlacementLimit(tournament?.players);
    if (limit === 0) {
      diagnostics?.tournamentsBelowMinimum.push({
        tournamentId: tournament.id,
        name: tournament.name,
        players: tournament.players
      });
      continue;
    }

    let standings;
    try {
      standings = await fetchLimitlessJson(`/tournaments/${tournament.id}/standings`, { env });
    } catch (error) {
      console.warn('Failed to fetch standings', tournament.id, error?.message || error);
      diagnostics?.standingsFetchFailures.push({
        tournamentId: tournament.id,
        name: tournament.name,
        message: error?.message || 'Unknown standings fetch error'
      });
      continue;
    }

    if (!Array.isArray(standings)) {
      diagnostics?.invalidStandingsPayload.push({
        tournamentId: tournament.id,
        name: tournament.name
      });
      continue;
    }

    const sortedStandings = [...standings].sort((a, b) => {
      const placingA = Number.isFinite(a?.placing) ? a.placing : Number.POSITIVE_INFINITY;
      const placingB = Number.isFinite(b?.placing) ? b.placing : Number.POSITIVE_INFINITY;
      return placingA - placingB;
    });

    const cappedStandings = sortedStandings.slice(0, limit);

    for (const entry of cappedStandings) {
      if (!Number.isFinite(entry?.placing)) {
        diagnostics?.entriesWithoutPlacing.push({
          tournamentId: tournament.id,
          name: tournament.name,
          player: entry?.name || entry?.player || 'Unknown Player'
        });
      }

      const cards = toCardEntries(entry?.decklist);
      if (!cards.length) {
        diagnostics?.entriesWithoutDecklists.push({
          tournamentId: tournament.id,
          player: entry?.name || entry?.player || 'Unknown Player'
        });
        continue;
      }

      const archetypeName = entry?.deck?.name || 'Unknown';
      decks.push({
        id: await hashDeck(cards, entry?.player),
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
  }

  return decks;
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
  });

  archetypeFiles.sort((a, b) => b.deckCount - a.deckCount);

  return {
    archetypeFiles,
    archetypeIndex: archetypeFiles.map(file => file.base).sort((a, b) => a.localeCompare(b)),
    minDecks
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

async function updateTournamentsList(env, folderName) {
  const key = 'reports/tournaments.json';
  const current = (await readJson(env, key)) || [];
  const sanitized = sanitizeForPath(folderName);
  const deduped = Array.isArray(current)
    ? current.filter(entry => entry !== sanitized)
    : [];
  deduped.unshift(sanitized);
  await putJson(env, key, deduped);
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

  const tournaments = await fetchRecentOnlineTournaments(env, since, {
    diagnostics
  });
  if (!tournaments.length) {
    return {
      success: false,
      reason: 'No online tournaments found within the lookback window',
      windowStart: since.toISOString(),
      diagnostics
    };
  }

  const decks = await gatherDecks(env, tournaments, diagnostics);
  if (!decks.length) {
    console.error('[OnlineMeta] No decklists aggregated', diagnostics);
    return {
      success: false,
      reason: 'No decklists available for online tournaments',
      windowStart: since.toISOString(),
      diagnostics
    };
  }

  const deckTotal = decks.length;
  const masterReport = generateReportFromDecks(decks, deckTotal, decks);
  const { archetypeFiles, archetypeIndex, minDecks } = buildArchetypeReports(
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

  await updateTournamentsList(env, TARGET_FOLDER);

  console.info('[OnlineMeta] Aggregated online tournaments', {
    deckTotal,
    tournamentCount: tournaments.length,
    archetypes: archetypeFiles.length
  });

  return {
    success: true,
    decks: deckTotal,
    tournaments: tournaments.length,
    archetypes: archetypeFiles.length,
    folder: TARGET_FOLDER,
    diagnostics
  };
}
