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

/** Report item for thumbnail inference (subset of CardItem) */
export interface ReportItem {
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
export interface BaseOptions {
  diagnostics?: DiagnosticsCollector;
  fetchJson?: typeof fetchLimitlessJson;
}

/** Diagnostics collector for tracking issues during processing */
export interface ArchetypeClassificationDiagnostics {
  deckRulesLoaded: number;
  apiName: number;
  deckId: number;
  decklistMatch: number;
  fallback: number;
  unknown: number;
}

export interface DiagnosticsCollector {
  detailsWithoutDecklists?: Array<{ tournamentId: string; name: string }>;
  detailsOffline?: Array<{ tournamentId: string; name: string }>;
  detailsUnsupportedFormat?: Array<{ tournamentId: string; name: string; format: string }>;
  standingsFetchFailures?: Array<{ tournamentId: string; name: string; message: string }>;
  invalidStandingsPayload?: Array<{ tournamentId: string; name: string }>;
  entriesWithoutDecklists?: Array<{ tournamentId: string; player: string }>;
  entriesWithoutPlacing?: Array<{ tournamentId: string; name: string; player: string }>;
  tournamentsBelowMinimum?: Array<{ tournamentId: string; name: string; players: number }>;
  archetypeClassification?: ArchetypeClassificationDiagnostics;
}

/** Options for fetchRecentOnlineTournaments */
export interface FetchTournamentsOptions extends BaseOptions {
  windowEnd?: string | Date;
  pageSize?: number;
  maxPages?: number;
  detailsConcurrency?: number;
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
}

/** Options for runOnlineMetaJob */
export interface OnlineMetaJobOptions extends FetchTournamentsOptions, GatherDecksOptions {
  now?: string | Date;
  since?: string | Date;
  seriesLimit?: number;
  minTrendAppearances?: number;
  r2Concurrency?: number;
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
export interface DailyTimelineEntry {
  date: string;
  decks: number;
  totalDecks: number;
  share: number;
}

/** Tournament with deck count for trend reports */
export interface TournamentWithDeckCount {
  id: string;
  name: string;
  date: string;
  deckTotal: number;
  players?: number;
  format?: string | null;
  platform?: string | null;
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
