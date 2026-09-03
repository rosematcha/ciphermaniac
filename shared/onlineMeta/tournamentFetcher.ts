/**
 * The ONE fetch-and-gather path for online (Limitless) tournament windows,
 * shared by the 14-day meta and the 30-day trends runners.
 *
 * Field-size policy: the population is the players who posted a placing.
 * Limitless standings for late-registration events list everyone who signed
 * up, and a quarter of those rows can be players who never played a round.
 * They used to count as decks in the meta and inflate the field the
 * success-tag cutoffs are computed against (a 274-registration event with 91
 * placings put its top-25% cutoff at placing 69 instead of 23). Those rows are
 * now dropped and counted on the diagnostics collector.
 */
import { computeSuccessTags } from '../data/contracts';
import { fetchLimitlessJson, type LimitlessEnv } from '../api/limitless.js';
import {
  decodeStandings,
  decodeTournamentDetails,
  decodeTournamentList,
  detectDecodeBreakage,
  type StandingsRow
} from '../api/limitlessDecoders.js';
import { type CardTypesDatabase, enrichCardWithType } from '../data/cardTypesDatabase.js';
import { inferEnergyType, inferTrainerType, isAceSpecName } from '../analysis/cardTypeInference.js';
import {
  buildArchetypeDeckIndex,
  type DeckIndex,
  resolveArchetypeClassification
} from '../analysis/archetypeClassifier.js';
import { matchExclusion } from './exclusions';
import type {
  CardEntry,
  DiagnosticsCollector,
  FetchTournamentsOptions,
  GatherDecksOptions,
  GatheredDeck,
  OnlineTournamentSummary,
  TournamentFieldCounts
} from './types';

const PAGE_SIZE = 100;
const MAX_TOURNAMENT_PAGES = 10;
const SUPPORTED_FORMATS = new Set(['STANDARD']);
const DEFAULT_DETAILS_CONCURRENCY = 5;
const DEFAULT_STANDINGS_CONCURRENCY = 4;
/** Smallest field (players with a placing) that contributes decks. */
export const DEFAULT_MIN_FIELD_PLAYERS = 8;
const DEFAULT_FAILURE_RATIO = 0.25;
const DEFAULT_FAILURE_ALLOWANCE = 2;

export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  handler: (item: T, index: number) => R | Promise<R>
): Promise<R[]> {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const maxConcurrency = Math.max(1, Math.min(Number(limit) || 1, items.length));
  const results: R[] = new Array(items.length);
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

/**
 * Abort when transient fetch failures exceed the budget. Publishing a window
 * built from an arbitrary subset of the field silently distorts every share.
 */
function enforceFailureBudget(
  what: string,
  failures: number,
  attempted: number,
  ratio: number | undefined,
  allowance: number | undefined
): void {
  const maxRatio = typeof ratio === 'number' ? ratio : DEFAULT_FAILURE_RATIO;
  const minAllowance = typeof allowance === 'number' ? allowance : DEFAULT_FAILURE_ALLOWANCE;
  const budget = Math.max(minAllowance, Math.ceil(attempted * maxRatio));
  if (failures > budget) {
    throw new Error(
      `${what} fetch failed for ${failures}/${attempted} tournaments (budget ${budget}); refusing to publish partial data.`
    );
  }
}

async function fetchTournamentSummaries(
  env: LimitlessEnv | undefined,
  since: Date,
  options: FetchTournamentsOptions
): Promise<Map<string, ReturnType<typeof decodeTournamentList>['rows'][number]>> {
  const sinceMs = since.getTime();
  const windowEndMs = options.windowEnd ? new Date(options.windowEnd).getTime() : null;
  const pageSize = options.pageSize || PAGE_SIZE;
  const maxPages = options.maxPages || MAX_TOURNAMENT_PAGES;
  const fetchJson = options.fetchJson || fetchLimitlessJson;
  const unique = new Map<string, ReturnType<typeof decodeTournamentList>['rows'][number]>();

  for (let page = 1; page <= maxPages; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const raw = await fetchJson('/tournaments', {
      env,
      searchParams: { game: 'PTCG', limit: pageSize, page }
    });
    const decoded = decodeTournamentList(raw);
    const breakage = detectDecodeBreakage(decoded, `tournament list page ${page}`);
    if (breakage) {
      console.warn(`[online-meta] ${breakage}`);
    }
    if (decoded.rows.length === 0) {
      break;
    }

    let sawOlder = false;
    for (const entry of decoded.rows) {
      const dateMs = Date.parse(entry.date);
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

  return unique;
}

export async function fetchRecentOnlineTournaments(
  env: LimitlessEnv | undefined,
  since: Date,
  options: FetchTournamentsOptions = {}
): Promise<OnlineTournamentSummary[]> {
  const { diagnostics } = options;
  const fetchJson = options.fetchJson || fetchLimitlessJson;
  const detailsConcurrency = options.detailsConcurrency || DEFAULT_DETAILS_CONCURRENCY;
  const summaries = Array.from((await fetchTournamentSummaries(env, since, options)).values());

  const detailsFetchFailures: Array<{ tournamentId: string; name: string; message: string }> = [];
  const excluded: NonNullable<DiagnosticsCollector['excludedTournaments']> = [];
  const detailed = await runWithConcurrency(
    summaries,
    detailsConcurrency,
    async (summary): Promise<OnlineTournamentSummary | null> => {
      try {
        const details = decodeTournamentDetails(await fetchJson(`/tournaments/${summary.id}/details`, { env }));
        if (details.decklists === false) {
          diagnostics?.detailsWithoutDecklists?.push({ tournamentId: summary.id, name: summary.name });
          return null;
        }
        if (details.isOnline === false) {
          diagnostics?.detailsOffline?.push({ tournamentId: summary.id, name: summary.name });
          return null;
        }

        const formatId = (details.format || summary.format || '').toUpperCase();
        if (formatId && !SUPPORTED_FORMATS.has(formatId)) {
          diagnostics?.detailsUnsupportedFormat?.push({
            tournamentId: summary.id,
            name: summary.name,
            format: formatId
          });
          return null;
        }
        const organizer = details.organizer?.name || null;
        const organizerId = details.organizer?.id || null;
        const exclusion = matchExclusion({ name: summary.name, organizer, organizerId }, options.exclusions);
        if (exclusion) {
          excluded.push({ tournamentId: summary.id, name: summary.name, organizer, ...exclusion });
          return null;
        }
        return {
          id: summary.id,
          name: summary.name,
          date: summary.date,
          format: formatId || null,
          platform: details.platform || null,
          game: summary.game ?? 'PTCG',
          players: details.players || summary.players || null,
          organizer,
          organizerId
        };
      } catch (error) {
        const message = (error as { message?: string })?.message || String(error);
        console.warn('Failed to fetch tournament details', summary?.id, message);
        detailsFetchFailures.push({ tournamentId: summary?.id, name: summary?.name, message });
        return null;
      }
    }
  );

  if (diagnostics) {
    diagnostics.detailsFetchFailures = detailsFetchFailures;
    diagnostics.excludedTournaments = excluded;
  }
  enforceFailureBudget(
    'Tournament details',
    detailsFetchFailures.length,
    summaries.length,
    options.maxDetailsFailureRatio,
    options.detailsFailureAllowance
  );

  return detailed
    .filter((entry): entry is OnlineTournamentSummary => Boolean(entry))
    .sort((first, second) => Date.parse(second.date) - Date.parse(first.date));
}

function toCardEntries(decklist: unknown, cardTypesDb: CardTypesDatabase | null = null) {
  if (!decklist || typeof decklist !== 'object') {
    return [];
  }

  const sections = Object.entries(decklist);
  const cards: CardEntry[] = [];

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

async function hashDeck(cards: CardEntry[], fallbackKey = '') {
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

/**
 * Split standings into the players who posted a placing and the field size
 * they imply. `fieldSize` takes the highest placing when it exceeds the row
 * count: a player who played but has no usable row still occupied a slot.
 */
export function countField(rows: StandingsRow[], registered: number | null | undefined): TournamentFieldCounts {
  let placed = 0;
  let maxPlacing = 0;
  for (const row of rows) {
    if (Number.isFinite(row.placing)) {
      placed += 1;
      maxPlacing = Math.max(maxPlacing, Number(row.placing));
    }
  }
  return {
    registered: Number.isFinite(registered) ? Number(registered) : null,
    placed,
    unplaced: rows.length - placed,
    fieldSize: Math.max(placed, maxPlacing)
  };
}

function initDiagnostics(diagnostics: DiagnosticsCollector | null | undefined): Required<DiagnosticsCollector> {
  const diag = (diagnostics || {}) as Required<DiagnosticsCollector>;
  diag.detailsWithoutDecklists = diag.detailsWithoutDecklists || [];
  diag.detailsOffline = diag.detailsOffline || [];
  diag.detailsUnsupportedFormat = diag.detailsUnsupportedFormat || [];
  diag.detailsFetchFailures = diag.detailsFetchFailures || [];
  diag.excludedTournaments = diag.excludedTournaments || [];
  diag.standingsFetchFailures = diag.standingsFetchFailures || [];
  diag.invalidStandingsPayload = diag.invalidStandingsPayload || [];
  diag.entriesWithoutDecklists = diag.entriesWithoutDecklists || [];
  diag.entriesWithoutPlacing = diag.entriesWithoutPlacing || [];
  diag.tournamentsBelowMinimum = diag.tournamentsBelowMinimum || [];
  diag.tournamentFields = diag.tournamentFields || {};
  diag.archetypeClassification = diag.archetypeClassification || {
    deckRulesLoaded: 0,
    apiName: 0,
    deckId: 0,
    decklistMatch: 0,
    fallback: 0,
    unknown: 0
  };
  return diag;
}

function countClassificationSource(diag: Required<DiagnosticsCollector>, source: string): void {
  const counters = diag.archetypeClassification;
  switch (source) {
    case 'api-name':
      counters.apiName += 1;
      break;
    case 'deck-id':
      counters.deckId += 1;
      break;
    case 'decklist-match':
      counters.decklistMatch += 1;
      break;
    case 'fallback':
      counters.fallback += 1;
      break;
    default:
      counters.unknown += 1;
      break;
  }
}

async function fetchStandingsRows(
  tournament: OnlineTournamentSummary,
  diag: Required<DiagnosticsCollector>,
  fetchJson: typeof fetchLimitlessJson,
  env: LimitlessEnv | undefined
): Promise<StandingsRow[] | null> {
  let raw: unknown;
  try {
    raw = await fetchJson(`/tournaments/${tournament.id}/standings`, { env });
  } catch (error) {
    const message = (error as { message?: string })?.message || 'Unknown standings fetch error';
    console.warn('Failed to fetch standings', tournament.id, message);
    diag.standingsFetchFailures.push({ tournamentId: tournament.id, name: tournament.name, message });
    return null;
  }
  if (!Array.isArray(raw)) {
    diag.invalidStandingsPayload.push({ tournamentId: tournament.id, name: tournament.name });
    return null;
  }
  const decoded = decodeStandings(raw);
  const breakage = detectDecodeBreakage(decoded, `standings for ${tournament.name}`);
  if (breakage) {
    console.warn(`[online-meta] ${breakage}`);
  }
  return decoded.rows;
}

interface PendingDeck {
  fallbackKey: string;
  deck: Omit<GatheredDeck, 'id'>;
}

function buildPendingDeck(
  entry: StandingsRow,
  tournament: OnlineTournamentSummary,
  fieldSize: number,
  cardTypesDb: CardTypesDatabase | null,
  deckIndex: DeckIndex | null,
  diag: Required<DiagnosticsCollector>
): PendingDeck | null {
  const cards = toCardEntries(entry.decklist, cardTypesDb);
  if (!cards.length) {
    diag.entriesWithoutDecklists.push({
      tournamentId: tournament.id,
      player: entry.name || entry.player || 'Unknown Player'
    });
    if (!entry.deck?.name && !entry.deck?.id) {
      return null;
    }
  }

  const classification = resolveArchetypeClassification(
    { deckName: entry.deck?.name, deckId: entry.deck?.id, decklist: entry.decklist },
    deckIndex
  );
  const classificationSource = classification?.source || 'unknown';
  countClassificationSource(diag, classificationSource);

  const archetypeId = classification?.id || entry.deck?.id || null;
  const fallbackKey = `${tournament.id}::${entry.player || entry.name || ''}::${entry.placing ?? ''}::${archetypeId || classification?.name || entry.deck?.name || ''}`;
  return {
    fallbackKey,
    deck: {
      player: entry.name || entry.player || 'Unknown Player',
      playerId: entry.player || null,
      country: entry.country || null,
      placement: entry.placing ?? null,
      archetype: classification?.name || 'Unknown',
      archetypeId,
      archetypeSource: classificationSource,
      cards,
      hasDecklist: cards.length > 0,
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      tournamentDate: tournament.date,
      tournamentPlayers: fieldSize,
      tournamentFormat: tournament.format,
      tournamentPlatform: tournament.platform,
      tournamentOrganizer: tournament.organizer,
      deckSource: 'limitless-online',
      // Online windows never carry Day-2 phases, so phase tags are not
      // appended (appendPhaseTags defaults false) — see divergence D7.
      successTags: computeSuccessTags(entry.placing, fieldSize)
    }
  };
}

export async function gatherDecks(
  env: LimitlessEnv | undefined,
  tournaments: OnlineTournamentSummary[],
  diagnostics: DiagnosticsCollector | null | undefined,
  cardTypesDb: CardTypesDatabase | null = null,
  options: GatherDecksOptions = {}
): Promise<GatheredDeck[]> {
  if (!Array.isArray(tournaments) || tournaments.length === 0) {
    return [];
  }

  // Mutates the caller-provided diagnostics object in place.
  const diag = initDiagnostics(diagnostics);
  const fetchJson = options.fetchJson || fetchLimitlessJson;
  const standingsConcurrency = options.standingsConcurrency || DEFAULT_STANDINGS_CONCURRENCY;
  const minFieldPlayers = options.minFieldPlayers ?? DEFAULT_MIN_FIELD_PLAYERS;
  let deckIndex: DeckIndex | null = null;

  try {
    deckIndex = buildArchetypeDeckIndex(await fetchJson('/games/PTCG/decks', { env }));
    diag.archetypeClassification.deckRulesLoaded = Number(deckIndex?.ruleCount) || 0;
  } catch (error) {
    console.warn(
      'Failed to fetch deck rules for archetype classification',
      (error as { message?: string })?.message || error
    );
    deckIndex = null;
  }

  let attempted = 0;
  const perTournamentDecks = await runWithConcurrency(tournaments, standingsConcurrency, async tournament => {
    // Registered is an upper bound on the field, so a tiny registration list
    // can be skipped without a fetch.
    const registered = Number(tournament.players) || 0;
    if (registered > 0 && registered < minFieldPlayers) {
      diag.tournamentsBelowMinimum.push({
        tournamentId: tournament.id,
        name: tournament.name,
        players: tournament.players,
        fieldSize: registered
      });
      return [];
    }

    attempted += 1;
    const rows = await fetchStandingsRows(tournament, diag, fetchJson, env);
    if (!rows) {
      return [];
    }

    const field = countField(rows, tournament.players);
    diag.tournamentFields[tournament.id] = field;
    if (field.fieldSize < minFieldPlayers) {
      diag.tournamentsBelowMinimum.push({
        tournamentId: tournament.id,
        name: tournament.name,
        players: tournament.players,
        fieldSize: field.fieldSize
      });
      return [];
    }

    const pending: PendingDeck[] = [];
    for (const entry of rows) {
      if (!Number.isFinite(entry.placing)) {
        diag.entriesWithoutPlacing.push({
          tournamentId: tournament.id,
          name: tournament.name,
          player: entry.name || entry.player || 'Unknown Player'
        });
        continue;
      }
      const item = buildPendingDeck(entry, tournament, field.fieldSize, cardTypesDb, deckIndex, diag);
      if (item) {
        pending.push(item);
      }
    }
    pending.sort((first, second) => Number(first.deck.placement) - Number(second.deck.placement));

    const ids = await Promise.all(pending.map(item => hashDeck(item.deck.cards, item.fallbackKey)));
    return pending.map((item, index): GatheredDeck => ({ id: ids[index], ...item.deck }));
  });

  enforceFailureBudget(
    'Standings',
    diag.standingsFetchFailures.length,
    attempted,
    options.maxStandingsFailureRatio,
    options.standingsFailureAllowance
  );

  return perTournamentDecks.flat();
}
