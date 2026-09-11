import type { fetchLimitlessJson } from '../api/limitless.js';

/** Configuration for archetype thumbnail mappings */
export type ThumbnailConfig = Record<string, string[]>;

/** Card entry created from decklist parsing */
export interface CardEntry {
  count: number;
  name: string;
  set: string | null;
  number: string | null;
  category: 'pokemon' | 'trainer' | 'energy';
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  regulationMark?: string;
}

/** Tournament summary returned by fetchRecentOnlineTournaments */
export interface OnlineTournamentSummary {
  id: string;
  name: string;
  date: string;
  format: string | null;
  platform: string | null;
  game?: string;
  players?: number | null;
  organizer?: string | null;
  organizerId?: string | null;
}

/** Deck record produced by gatherDecks from tournament standings */
export interface GatheredDeck {
  id: string;
  player: string;
  playerId: string | null;
  country: string | null;
  placement: number | null;
  archetype: string;
  archetypeId: string | null;
  archetypeSource: string;
  cards: CardEntry[];
  hasDecklist: boolean;
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string;
  tournamentPlayers: number | null;
  tournamentFormat: string | null;
  tournamentPlatform: string | null;
  tournamentOrganizer?: string | null;
  deckSource: string;
  successTags: string[];
}

/** Base options for functions that accept env and diagnostic options */
interface BaseOptions {
  diagnostics?: DiagnosticsCollector;
  fetchJson?: typeof fetchLimitlessJson;
}

/** Diagnostics collector for tracking issues during processing */
interface ArchetypeClassificationDiagnostics {
  deckRulesLoaded: number;
  apiName: number;
  deckId: number;
  decklistMatch: number;
  fallback: number;
  unknown: number;
}

/**
 * How big a tournament's field really was. `registered` is what Limitless
 * lists (late registrations and no-shows included); `fieldSize` is the number
 * of players who actually posted a placing, which is what shares and
 * success-tag cutoffs are computed against.
 */
export interface TournamentFieldCounts {
  registered: number | null;
  /** Standings rows with a placing. */
  placed: number;
  /** Standings rows without a placing (registered, never played). */
  unplaced: number;
  /** max(placed, highest placing) — players who played but have no row. */
  fieldSize: number;
}

export interface ExcludedTournament {
  tournamentId: string;
  name: string;
  organizer: string | null;
  reason: string;
  matched: string;
}

export interface DiagnosticsCollector {
  /** Tournaments whose /details fetch threw (transient/network/API failures). */
  detailsFetchFailures?: Array<{ tournamentId: string; name: string; message: string }>;
  detailsWithoutDecklists?: Array<{ tournamentId: string; name: string }>;
  detailsOffline?: Array<{ tournamentId: string; name: string }>;
  detailsUnsupportedFormat?: Array<{ tournamentId: string; name: string; format: string }>;
  /** Tournaments dropped by the hand-maintained exclusion config. */
  excludedTournaments?: ExcludedTournament[];
  standingsFetchFailures?: Array<{ tournamentId: string; name: string; message: string }>;
  invalidStandingsPayload?: Array<{ tournamentId: string; name: string }>;
  entriesWithoutDecklists?: Array<{ tournamentId: string; player: string }>;
  entriesWithoutPlacing?: Array<{ tournamentId: string; name: string; player: string }>;
  tournamentsBelowMinimum?: Array<{ tournamentId: string; name: string; players?: number | null; fieldSize?: number }>;
  /** Per-tournament field counts, keyed by tournament id. */
  tournamentFields?: Record<string, TournamentFieldCounts>;
  archetypeClassification?: ArchetypeClassificationDiagnostics;
}

/** Options for fetchRecentOnlineTournaments */
export interface FetchTournamentsOptions extends BaseOptions {
  windowEnd?: string | Date;
  /** Compiled hand-maintained exclusions (see shared/onlineMeta/exclusions). */
  exclusions?: import('./exclusions').CompiledExclusions | null;
  pageSize?: number;
  maxPages?: number;
  detailsConcurrency?: number;
  /**
   * Fraction of tournament-detail fetches allowed to fail before the run is
   * aborted (throws) rather than silently publishing trends from the survivors.
   * Default 0.25.
   */
  maxDetailsFailureRatio?: number;
  /**
   * Absolute number of detail-fetch failures always tolerated regardless of the
   * ratio (covers tiny windows). Default 2.
   */
  detailsFailureAllowance?: number;
}

/** Options for gatherDecks */
export interface GatherDecksOptions extends BaseOptions {
  standingsConcurrency?: number;
  /**
   * Smallest field (players with a placing) an event needs to contribute
   * decks. Default 8: below that a single result moves an archetype's share
   * for the day by whole points.
   */
  minFieldPlayers?: number;
  /** Fraction of standings fetches allowed to fail before the run aborts. Default 0.25. */
  maxStandingsFailureRatio?: number;
  /** Absolute standings-fetch failures always tolerated. Default 2. */
  standingsFailureAllowance?: number;
}

/** Options for buildArchetypeReports */
export interface BuildArchetypeReportsOptions {
  thumbnailConfig?: ThumbnailConfig;
}

/** Options for buildTrendReport */
export interface BuildTrendReportOptions {
  now?: string | Date;
  windowStart?: string | Date;
  windowEnd?: string | Date;
  minAppearances?: number;
  seriesLimit?: number;
  /**
   * Days with fewer decks than this across every event are left out of the
   * daily timelines. A day carried by one small event plots as a cliff for
   * every archetype at once. Default 0 (keep every day).
   */
  minDayDecks?: number;
}

/** Options for buildCardTrendReport */
export interface BuildCardTrendReportOptions {
  now?: string | Date;
  windowStart?: string | Date;
  windowEnd?: string | Date;
  minAppearances?: number;
  topCount?: number;
  /**
   * Synonym database used to collapse reprints / variant printings into a
   * single trend entry. When omitted, card keys are kept raw and reprints
   * appear as separate rows.
   */
  synonymDb?: import('../data/cardIdentity').SynonymDatabase | null;
}

/** Trend report result structure */
export interface TrendReportResult {
  generatedAt: string;
  windowStart: string | null;
  windowEnd: string | null;
  deckTotal: number;
  tournamentCount: number;
  minAppearances: number;
  archetypeCount: number;
  series: TrendSeriesEntry[];
  tournaments: TournamentWithDeckCount[];
  totalArchetypes?: number;
  cardTrends?: CardTrendsResult;
}

/** Single archetype trend series entry */
export interface TrendSeriesEntry {
  base: string;
  displayName: string;
  totalDecks: number;
  appearances: number;
  avgShare: number;
  maxShare: number;
  peakShare: number;
  minShare: number;
  successTotals: Record<string, number>;
  timeline: DailyTimelineEntry[];
}

/** Daily aggregated timeline entry */
interface DailyTimelineEntry {
  date: string;
  decks: number;
  totalDecks: number;
  share: number;
}

/** Tournament with deck count for trend reports */
interface TournamentWithDeckCount {
  id: string;
  name?: string;
  date?: string | null;
  deckTotal: number;
  players?: number | null;
  format?: string | null;
  platform?: string | null;
}

/** Loose card input: a partial CardEntry as found in snapshots and fixtures */
export interface CardEntryInput {
  count?: number;
  name?: string;
  set?: string | null;
  number?: string | number | null;
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  regulationMark?: string;
}

/**
 * Loose deck input accepted by the trend builders. Production decks are
 * `GatheredDeck`, but persisted snapshots and test fixtures may omit fields;
 * the builders access everything defensively.
 */
export interface TrendDeckInput {
  tournamentId?: string;
  archetype?: string;
  successTags?: string[];
  cards?: CardEntryInput[];
  tournamentName?: string;
  tournamentDate?: string;
}

/** Loose tournament input accepted by the trend builders */
export interface TrendTournamentInput {
  id: string;
  name?: string;
  date?: string | null;
  players?: number | null;
  format?: string | null;
  platform?: string | null;
  deckTotal?: number;
}

/** Card trends result structure */
export interface CardTrendsResult {
  generatedAt: string;
  windowStart: string | null;
  windowEnd: string | null;
  cardsAnalyzed: number;
  rising: CardTrendItem[];
  falling: CardTrendItem[];
}

// Player-aggregate types live in `shared/playerTypes.ts` so the cron-side
// writer (functions/lib/onlineMeta/playerAggregator.ts) and the SPA-side
// reader (src/pages/PlayerProfilePage.tsx, src/pages/PlayersPage.tsx) can't
// drift. Re-exported here for the existing in-folder imports.
export type {
  PlayerAggregateManifest,
  PlayerArchetypeBreakdown,
  PlayerDeckCard,
  PlayerDecks,
  PlayerIndexEntry,
  PlayerProfile,
  PlayerRound,
  PlayerRoundOutcome,
  PlayerTournamentEntry
} from '../playerTypes';

/** Individual card trend item */
export interface CardTrendItem {
  key: string;
  name: string;
  set: string | null;
  number: string | null;
  appearances: number;
  startShare: number;
  endShare: number;
  delta: number;
  currentShare: number;
  recentAvg: number;
  startAvg: number;
}

// ---------------------------------------------------------------------------
// Weekly report: this week against last, built by shared/onlineMeta/weeklyBuilder.ts
// ---------------------------------------------------------------------------

/** One comparison period: whole UTC days, `end` exclusive. */
export interface WeeklyPeriod {
  start: string;
  end: string;
  /** Placed lists in the period, every archetype including the Other bucket. */
  lists: number;
  /** Lists carrying the `top10` success tag. */
  top10: number;
}

/** One calendar day of an archetype's daily series. */
export interface WeeklyDailyPoint {
  date: string;
  lists: number;
  /** Lists carrying the `top10` success tag. */
  top10: number;
  /** Share of the day's lists, or null on a day below the floor. */
  share: number | null;
  /** Share of the day's top-10% finishes, or null when the day has too few. */
  top10Share: number | null;
}

export interface WeeklyDailyTotal {
  date: string;
  lists: number;
  top10: number;
}

export interface WeeklyArchetype {
  base: string;
  displayName: string;
  lists: number;
  priorLists: number;
  /** Share of all lists this week, 0..100 one decimal. */
  share: number;
  priorShare: number;
  /** Share points, this week minus last. */
  delta: number;
  /** Share of this week's top-10% finishes. */
  top10Share: number;
  priorTop10Share: number;
  daily: WeeklyDailyPoint[];
}

/** A card whose inclusion inside one archetype's lists moved. */
export interface WeeklyDeckCard {
  uid: string;
  name: string;
  set: string | null;
  number: string | null;
  /** Share of the archetype's lists this week, 0..100 one decimal. */
  inclusion: number;
  priorInclusion: number;
  delta: number;
  /** Went from under 5% of lists to 5% or more. */
  isNew: boolean;
  /** Inclusion per day over the daily window; null where the deck had too few lists. */
  daily: (number | null)[];
}

export interface WeeklyDeck {
  base: string;
  displayName: string;
  lists: number;
  priorLists: number;
  added: WeeklyDeckCard[];
  cut: WeeklyDeckCard[];
}

/** One archetype's contribution to a card's share change. */
export interface WeeklyMoverDriver {
  base: string;
  displayName: string;
  /** Share points of the card's change attributable to this archetype. */
  total: number;
  /** The part from the archetype itself growing or shrinking. */
  mix: number;
  /** The part from the archetype's lists adding or cutting the card. */
  adoption: number;
}

export interface WeeklyMover {
  uid: string;
  name: string;
  set: string | null;
  number: string | null;
  /** Share of all lists this week, 0..100 one decimal. */
  share: number;
  priorShare: number;
  delta: number;
  mix: number;
  adoption: number;
  drivers: WeeklyMoverDriver[];
}

export interface WeeklyReport {
  generatedAt: string;
  /** Length of each comparison period in days. */
  days: number;
  recent: WeeklyPeriod;
  prior: WeeklyPeriod;
  /** The calendar days of every `daily` series, ascending. */
  dates: string[];
  /** All lists and top-10% finishes per day of the daily window, every archetype. */
  dailyTotals: WeeklyDailyTotal[];
  archetypes: WeeklyArchetype[];
  decks: WeeklyDeck[];
  movers: { rising: WeeklyMover[]; falling: WeeklyMover[] };
}

export interface BuildWeeklyReportOptions {
  /** Exclusive end of the recent period, at a UTC midnight. */
  windowEnd: string | Date | number;
  /** Comparison period length in days. Default 7. */
  days?: number;
  /** Length of the daily series in days, ending at `windowEnd`. Default 14. */
  dailyDays?: number;
  synonymDb?: import('../data/cardIdentity').SynonymDatabase | null;
  /** Days with fewer lists than this plot as null. Default 100. */
  minDayLists?: number;
  /** An archetype needs this many lists in BOTH periods to get a deck block. Default 20. */
  minDeckLists?: number;
  /** A day inside an archetype needs this many lists for its inclusion point. Default 8. */
  minDeckDayLists?: number;
  /** Archetype rows kept. Default 32. */
  archetypeLimit?: number;
  /** Deck blocks kept, by this week's share. Default 8. */
  deckLimit?: number;
  /** Added and cut cards kept per deck. Default 8. */
  deckCardLimit?: number;
  /** Rising and falling movers kept. Default 12. */
  moverLimit?: number;
  /** A card needs this many list appearances across both periods to be a mover. Default 40. */
  minMoverLists?: number;
  /** Drivers kept per mover. Default 3. */
  driverLimit?: number;
  now?: string | Date;
}

/**
 * The forward-rolling day ledger. One row per UTC day, appended by every
 * trends run, so the meta keeps a memory longer than the 30-day window.
 */
export interface TrendHistoryDay {
  date: string;
  lists: number;
  top10: number;
  archetypes: Record<string, { displayName: string; lists: number; top10: number }>;
}

export interface TrendHistory {
  schemaVersion: 1;
  generatedAt: string;
  days: TrendHistoryDay[];
}
