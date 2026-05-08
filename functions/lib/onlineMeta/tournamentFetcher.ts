import { fetchLimitlessJson } from '../api/limitless.js';
import { enrichCardWithType } from '../data/cardTypesDatabase.js';
import { inferEnergyType, inferTrainerType, isAceSpecName } from '../analysis/cardTypeInference.js';
import { buildArchetypeDeckIndex, resolveArchetypeClassification } from '../analysis/archetypeClassifier.js';
import type { CardEntry, FetchTournamentsOptions, GatherDecksOptions, TournamentDetailsResponse } from './types';

const PAGE_SIZE = 100;
const MAX_TOURNAMENT_PAGES = 10;
const SUPPORTED_FORMATS = new Set(['STANDARD']);
const DEFAULT_DETAILS_CONCURRENCY = 5;
const DEFAULT_STANDINGS_CONCURRENCY = 4;

export async function runWithConcurrency(items, limit, handler) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const maxConcurrency = Math.max(1, Math.min(Number(limit) || 1, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
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

export function daysAgo(count) {
  return new Date(Date.now() - count * 24 * 60 * 60 * 1000);
}

export async function fetchRecentOnlineTournaments(env, since, options: FetchTournamentsOptions = {}) {
  const sinceMs = since.getTime();
  const windowEndMs = options.windowEnd ? new Date(options.windowEnd).getTime() : null;
  const pageSize = options.pageSize || PAGE_SIZE;
  const maxPages = options.maxPages || MAX_TOURNAMENT_PAGES;
  const { diagnostics } = options;
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
  const detailed = await runWithConcurrency(summaries, detailsConcurrency, async summary => {
    try {
      const details = (await fetchJson(`/tournaments/${summary.id}/details`, { env })) as TournamentDetailsResponse;
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
  });

  return detailed.filter(Boolean).sort((first, second) => Date.parse(second.date) - Date.parse(first.date));
}

export function toCardEntries(decklist, cardTypesDb = null) {
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
      let category: 'pokemon' | 'trainer' | 'energy' = 'trainer';
      if (rawCategory === 'pokemon') {
        category = 'pokemon';
      } else if (rawCategory === 'energy') {
        category = 'energy';
      }

      const name = card?.name || 'Unknown Card';
      const set = card?.set || null;
      const number = card?.number || null;

      // Build base entry
      let entry: CardEntry = {
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

export async function hashDeck(cards, fallbackKey = '') {
  const cryptoImpl = globalThis.crypto;
  if (!cryptoImpl?.subtle) {
    throw new Error('Web Crypto API not available for hashing decks');
  }
  const canonical = cards
    .map(card => `${card.count}x${card.name || ''}::${card.set || ''}::${card.number || ''}`)
    .sort()
    .join('|');
  const source = canonical || fallbackKey || 'unknown-deck';
  const digest = await cryptoImpl.subtle.digest('SHA-1', new TextEncoder().encode(source));
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

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

export function determinePlacementTags(placing, players) {
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

export function determinePlacementLimit(players) {
  const count = Number(players) || 0;
  // Drop ultra-tiny events
  if (count > 0 && count <= 3) {
    return 0;
  }
  // Use full standings so archetype shares represent what was actually played.
  return Number.POSITIVE_INFINITY;
}

export async function gatherDecks(env, tournaments, diagnostics, cardTypesDb = null, options: GatherDecksOptions = {}) {
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
  diag.archetypeClassification = diag.archetypeClassification || {
    deckRulesLoaded: 0,
    apiName: 0,
    deckId: 0,
    decklistMatch: 0,
    fallback: 0,
    unknown: 0
  };

  const fetchJson = options.fetchJson || fetchLimitlessJson;
  const standingsConcurrency = options.standingsConcurrency || DEFAULT_STANDINGS_CONCURRENCY;
  let deckIndex = null;

  try {
    const deckRulesPayload = await fetchJson('/games/PTCG/decks', { env });
    deckIndex = buildArchetypeDeckIndex(deckRulesPayload);
    diag.archetypeClassification.deckRulesLoaded = Number(deckIndex?.ruleCount) || 0;
  } catch (error) {
    console.warn('Failed to fetch deck rules for archetype classification', error?.message || error);
    deckIndex = null;
  }

  const perTournamentDecks = await runWithConcurrency(tournaments, standingsConcurrency, async tournament => {
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

    const sortedStandings = [...standings].sort((first, second) => {
      const placingA = Number.isFinite(first?.placing) ? first.placing : Number.POSITIVE_INFINITY;
      const placingB = Number.isFinite(second?.placing) ? second.placing : Number.POSITIVE_INFINITY;
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
        const hasDeckDescriptor = Boolean(entry?.deck?.name || entry?.deck?.id);
        if (!hasDeckDescriptor) {
          continue;
        }
      }

      const classification = resolveArchetypeClassification(
        {
          deckName: entry?.deck?.name,
          deckId: entry?.deck?.id,
          decklist: entry?.decklist
        },
        deckIndex
      );
      const archetypeName = classification?.name || 'Unknown';
      const classificationSource = classification?.source || 'unknown';

      switch (classificationSource) {
        case 'api-name':
          diag.archetypeClassification.apiName += 1;
          break;
        case 'deck-id':
          diag.archetypeClassification.deckId += 1;
          break;
        case 'decklist-match':
          diag.archetypeClassification.decklistMatch += 1;
          break;
        case 'fallback':
          diag.archetypeClassification.fallback += 1;
          break;
        default:
          diag.archetypeClassification.unknown += 1;
          break;
      }

      // eslint-disable-next-line no-await-in-loop
      const id = await hashDeck(
        cards,
        `${tournament.id}::${entry?.player || entry?.name || ''}::${entry?.placing ?? ''}::${classification?.id || entry?.deck?.id || classification?.name || entry?.deck?.name || ''}`
      );
      decks.push({
        id,
        player: entry?.name || entry?.player || 'Unknown Player',
        playerId: entry?.player || null,
        country: entry?.country || null,
        placement: entry?.placing ?? null,
        archetype: archetypeName,
        archetypeId: classification?.id || entry?.deck?.id || null,
        archetypeSource: classificationSource,
        cards,
        hasDecklist: cards.length > 0,
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
  });

  return perTournamentDecks.flat();
}
