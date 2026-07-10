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

/** Report item for thumbnail inference (subset of CardItem) */
interface ReportItem {
  name?: string;
  set?: string;
  number?: string | number;
  pct?: number;
  category?: string;
}

/** Report data structure with items array */
export interface ReportData {
  items?: ReportItem[];
}

/** Tournament details response from Limitless API */
export interface TournamentDetailsResponse {
  decklists?: boolean;
  isOnline?: boolean;
  format?: string | null;
  platform?: string | null;
  organizer?: {
    name?: string;
    id?: string;
  } | null;
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

export interface DiagnosticsCollector {
  /** Tournaments whose /details fetch threw (transient/network/API failures). */
  detailsFetchFailures?: Array<{ tournamentId: string; name: string; message: string }>;
  detailsWithoutDecklists?: Array<{ tournamentId: string; name: string }>;
  detailsOffline?: Array<{ tournamentId: string; name: string }>;
  detailsUnsupportedFormat?: Array<{ tournamentId: string; name: string; format: string }>;
  standingsFetchFailures?: Array<{ tournamentId: string; name: string; message: string }>;
  invalidStandingsPayload?: Array<{ tournamentId: string; name: string }>;
  entriesWithoutDecklists?: Array<{ tournamentId: string; player: string }>;
  entriesWithoutPlacing?: Array<{ tournamentId: string; name: string; player: string }>;
  tournamentsBelowMinimum?: Array<{ tournamentId: string; name: string; players?: number | null }>;
  archetypeClassification?: ArchetypeClassificationDiagnostics;
}

/** Options for fetchRecentOnlineTournaments */
export interface FetchTournamentsOptions extends BaseOptions {
  windowEnd?: string | Date;
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
  synonymDb?: import('../../../shared/synonyms').SynonymDatabase | null;
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
  PlayerTournamentEntry
} from '../../../shared/playerTypes';

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
