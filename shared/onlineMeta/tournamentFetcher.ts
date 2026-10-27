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
  ExcludedTournament,
  FetchTournamentsOptions,
  GatherDecksOptions,
  GatheredDeck,
  OnlineTournamentSummary,
  TournamentFieldCounts
} from './types';

const PAGE_SIZE = 100;
const MAX_TOURNAMENT_PAGES = 10;
const DEFAULT_FORMATS: readonly string[] = ['STANDARD'];
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

type SummaryRow = ReturnType<typeof decodeTournamentList>['rows'][number];

interface SummaryFilter {
  sinceMs: number;
  windowEndMs: number | null;
  /** Lower-cased name fragment, when the scope filters by name. */
  nameIncludes?: string;
}

function summaryMatches(entry: SummaryRow, dateMs: number, filter: SummaryFilter): boolean {
  const inWindow = dateMs >= filter.sinceMs && (!filter.windowEndMs || dateMs <= filter.windowEndMs);
  return inWindow && (!filter.nameIncludes || entry.name.toLowerCase().includes(filter.nameIncludes));
}

/**
 * Keep a page's rows that fall in the window and match the name filter.
 * @returns True once the page reaches past the window's start, which ends paging
 */
function collectSummaryPage(rows: SummaryRow[], filter: SummaryFilter, unique: Map<string, SummaryRow>): boolean {
  let sawOlder = false;
  for (const entry of rows) {
    const dateMs = Date.parse(entry.date);
    sawOlder ||= dateMs < filter.sinceMs;
    if (summaryMatches(entry, dateMs, filter)) {
      unique.set(entry.id, entry);
    }
  }
  return sawOlder;
}

async function fetchSummaryPage(
  env: LimitlessEnv | undefined,
  options: FetchTournamentsOptions,
  page: number
): Promise<SummaryRow[]> {
  const fetchJson = options.fetchJson || fetchLimitlessJson;
  const raw = await fetchJson('/tournaments', {
    env,
    searchParams: { ...options.query, game: 'PTCG', limit: options.pageSize || PAGE_SIZE, page }
  });
  const decoded = decodeTournamentList(raw);
  const breakage = detectDecodeBreakage(decoded, `tournament list page ${page}`);
  if (breakage) {
    console.warn(`[online-meta] ${breakage}`);
  }
  return decoded.rows;
}

async function fetchTournamentSummaries(
  env: LimitlessEnv | undefined,
  since: Date,
  options: FetchTournamentsOptions
): Promise<Map<string, SummaryRow>> {
  const filter: SummaryFilter = {
    sinceMs: since.getTime(),
    windowEndMs: options.windowEnd ? new Date(options.windowEnd).getTime() : null,
    nameIncludes: options.nameIncludes?.toLowerCase()
  };
  const maxPages = options.maxPages || MAX_TOURNAMENT_PAGES;
  const unique = new Map<string, SummaryRow>();

  for (let page = 1; page <= maxPages; page += 1) {
    const rows = await fetchSummaryPage(env, options, page);
    if (rows.length === 0 || collectSummaryPage(rows, filter, unique)) {
      break;
    }
  }

  return unique;
}

/** What screening a tournament's details needs, and where rejections are recorded. */
interface DetailsScreen {
  formats: ReadonlySet<string>;
  exclusions: FetchTournamentsOptions['exclusions'];
  diagnostics: DiagnosticsCollector | undefined;
  excluded: ExcludedTournament[];
}

type TournamentDetails = ReturnType<typeof decodeTournamentDetails>;

function detailsFormat(summary: SummaryRow, details: TournamentDetails): string {
  return (details.format || summary.format || '').toUpperCase();
}

/** True, with the reason recorded, when the details rule the tournament out before exclusions. */
function rejectedByDetails(summary: SummaryRow, details: TournamentDetails, screen: DetailsScreen): boolean {
  const ref = { tournamentId: summary.id, name: summary.name };
  const { diagnostics } = screen;
  if (details.decklists === false) {
    diagnostics?.detailsWithoutDecklists?.push(ref);
    return true;
  }
  if (details.isOnline === false) {
    diagnostics?.detailsOffline?.push(ref);
    return true;
  }
  const format = detailsFormat(summary, details);
  if (format && !screen.formats.has(format)) {
    diagnostics?.detailsUnsupportedFormat?.push({ ...ref, format });
    return true;
  }
  return false;
}

/** The tournament as the window uses it, or null when its details or the exclusion list rule it out. */
function screenTournament(
  summary: SummaryRow,
  details: TournamentDetails,
  screen: DetailsScreen
): OnlineTournamentSummary | null {
  if (rejectedByDetails(summary, details, screen)) {
    return null;
  }
  const organizer = details.organizer?.name || null;
  const organizerId = details.organizer?.id || null;
  const exclusion = matchExclusion({ name: summary.name, organizer, organizerId }, screen.exclusions);
  if (exclusion) {
    screen.excluded.push({ tournamentId: summary.id, name: summary.name, organizer, ...exclusion });
    return null;
  }
  return {
    id: summary.id,
    name: summary.name,
    date: summary.date,
    format: detailsFormat(summary, details) || null,
    platform: details.platform || null,
    game: summary.game ?? 'PTCG',
    players: details.players || summary.players || null,
    organizer,
    organizerId
  };
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
  const screen: DetailsScreen = {
    formats: new Set(options.formats ?? DEFAULT_FORMATS),
    exclusions: options.exclusions,
    diagnostics,
    excluded: []
  };
  const { excluded } = screen;
  const detailed = await runWithConcurrency(
    summaries,
    detailsConcurrency,
    async (summary): Promise<OnlineTournamentSummary | null> => {
      try {
        const details = decodeTournamentDetails(await fetchJson(`/tournaments/${summary.id}/details`, { env }));
        return screenTournament(summary, details, screen);
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

/** Diagnostics fields that collect one row per occurrence. */
const DIAGNOSTIC_LISTS = [
  'detailsWithoutDecklists',
  'detailsOffline',
  'detailsUnsupportedFormat',
  'detailsFetchFailures',
  'excludedTournaments',
  'standingsFetchFailures',
  'invalidStandingsPayload',
  'entriesWithoutDecklists',
  'entriesWithoutPlacing',
  'tournamentsBelowMinimum'
] as const;

function initDiagnostics(diagnostics: DiagnosticsCollector | null | undefined): Required<DiagnosticsCollector> {
  const diag = (diagnostics || {}) as Required<DiagnosticsCollector>;
  const lists = diag as unknown as Record<(typeof DIAGNOSTIC_LISTS)[number], unknown[]>;
  for (const field of DIAGNOSTIC_LISTS) {
    lists[field] ??= [];
  }
  diag.tournamentFields ??= {};
  diag.archetypeIcons ??= {};
  diag.archetypeClassification ??= {
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

/**
 * Keep the first sprite set Limitless gave an archetype label. Formats without
 * a hand-maintained icon map draw their archetype icons from these.
 */
function rememberArchetypeIcons(
  diag: Required<DiagnosticsCollector>,
  label: string | null | undefined,
  icons: string[] | undefined
): void {
  const known = diag.archetypeIcons;
  const sprites = (icons ?? []).filter(icon => icon !== 'substitute');
  if (label && sprites.length && !known[label]) {
    known[label] = sprites;
  }
}

interface PendingDeck {
  fallbackKey: string;
  deck: Omit<GatheredDeck, 'id'>;
}

/** One event's standings, and what turning its rows into decks needs. */
interface StandingsContext {
  tournament: OnlineTournamentSummary;
  fieldSize: number;
  cardTypesDb: CardTypesDatabase | null;
  deckIndex: DeckIndex | null;
  diag: Required<DiagnosticsCollector>;
}

function playerName(entry: StandingsRow): string {
  return entry.name || entry.player || 'Unknown Player';
}

/** The deck fields that come from the event rather than the player. */
function eventFields(context: StandingsContext) {
  const { tournament, fieldSize } = context;
  return {
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    tournamentDate: tournament.date,
    tournamentPlayers: fieldSize,
    tournamentFormat: tournament.format,
    tournamentPlatform: tournament.platform,
    tournamentOrganizer: tournament.organizer,
    deckSource: 'limitless-online'
  };
}

/** The archetype fields a deck carries, from the classifier's answer and the row's own label. */
function rowArchetype(
  entry: StandingsRow,
  classification: ReturnType<typeof resolveArchetypeClassification> | null
): { name: string; id: string | null; label: string } {
  const name = classification?.name;
  return {
    name: name || 'Unknown',
    id: classification?.id || entry.deck?.id || null,
    label: name || entry.deck?.name || ''
  };
}

/** The row's archetype, counted on the diagnostics and with its sprites remembered. */
function classifyRow(entry: StandingsRow, context: StandingsContext) {
  const { deck } = entry;
  const classification = resolveArchetypeClassification(
    { deckName: deck?.name, deckId: deck?.id, decklist: entry.decklist },
    context.deckIndex
  );
  const source = classification?.source || 'unknown';
  countClassificationSource(context.diag, source);
  rememberArchetypeIcons(context.diag, classification?.name, deck?.icons);
  return { ...rowArchetype(entry, classification), source };
}

/** A stable stand-in identity for a deck whose card list can't be hashed on its own. */
function fallbackDeckKey(entry: StandingsRow, tournamentId: string, archetype: { id: string | null; label: string }) {
  return `${tournamentId}::${entry.player || entry.name || ''}::${entry.placing ?? ''}::${archetype.id || archetype.label}`;
}

function buildPendingDeck(entry: StandingsRow, context: StandingsContext): PendingDeck | null {
  const { tournament, fieldSize, diag } = context;
  const cards = toCardEntries(entry.decklist, context.cardTypesDb);
  if (!cards.length) {
    diag.entriesWithoutDecklists.push({ tournamentId: tournament.id, player: playerName(entry) });
    if (!entry.deck?.name && !entry.deck?.id) {
      return null;
    }
  }

  const archetype = classifyRow(entry, context);
  return {
    fallbackKey: fallbackDeckKey(entry, tournament.id, archetype),
    deck: {
      player: playerName(entry),
      playerId: entry.player || null,
      country: entry.country || null,
      placement: entry.placing ?? null,
      archetype: archetype.name,
      archetypeId: archetype.id,
      archetypeSource: archetype.source,
      cards,
      hasDecklist: cards.length > 0,
      ...eventFields(context),
      // Online windows never carry Day-2 phases, so phase tags are not
      // appended (`appendPhaseTags` defaults to false).
      successTags: computeSuccessTags(entry.placing, fieldSize)
    }
  };
}

/** Limitless's archetype rules, or null (classification then falls back to names) when they can't be fetched. */
async function loadDeckIndex(
  fetchJson: typeof fetchLimitlessJson,
  env: LimitlessEnv | undefined
): Promise<DeckIndex | null> {
  try {
    return buildArchetypeDeckIndex(await fetchJson('/games/PTCG/decks', { env }));
  } catch (error) {
    console.warn(
      'Failed to fetch deck rules for archetype classification',
      (error as { message?: string })?.message || error
    );
    return null;
  }
}

export async function gatherDecks(
  env: LimitlessEnv | undefined,
  tournaments: OnlineTournamentSummary[],
  diagnostics: DiagnosticsCollector | null | undefined,
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
  const cardTypesDb = options.cardTypesDb ?? null;
  const deckIndex = await loadDeckIndex(fetchJson, env);
  diag.archetypeClassification.deckRulesLoaded = Number(deckIndex?.ruleCount) || 0;

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
      const item = buildPendingDeck(entry, { tournament, fieldSize: field.fieldSize, cardTypesDb, deckIndex, diag });
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
