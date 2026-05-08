import type { CardTrendDataset, TrendDataset } from '../utils/trendAggregator.js';
import type { Deck } from '../types/index.js';

export type TrendSeries = TrendDataset['series'][number];
export type TrendTimelineEntry = TrendSeries['timeline'][number];
export type TrendsMode = 'meta' | 'archetypes';

export interface TrendSharePoint {
  date: string;
  share: number;
  decks?: number;
  totalDecks?: number;
}

export interface TrendTimelinePoint {
  date?: string | null;
  share?: number;
  totalDecks?: number;
  total?: number;
}

export interface MetaLine {
  name: string;
  color: string;
  points: number[];
  latestPointShare: number;
  windowShare: number;
  delta: number;
}

export interface MetaChart {
  dates: string[];
  lines: MetaLine[];
}

export interface TrendTournament {
  id: string;
  name: string;
  date: string;
  players: number | string | null;
  format: string | null;
  platform: string | null;
  organizer: string | null;
}

export interface CardTrendMover {
  name: string;
  set?: string | null;
  number?: string | null;
  archetype?: string | null;
  recentAvg?: number;
  latest?: number;
  currentShare?: number;
  endShare?: number;
  startShare?: number;
  startAvg?: number;
  avgShare?: number;
  absDrop?: number;
  deltaAbs?: number;
  delta?: number;
}

export interface CardMoversPayload {
  rising?: CardTrendMover[];
  falling?: CardTrendMover[];
}

export interface NormalizedCardMover {
  name: string;
  set: string | null;
  number: string | null;
  latest: number;
  start: number;
  delta: number;
}

export interface DisplayCardMover extends NormalizedCardMover {
  variantCount: number;
}

export type CardTrendsState = CardTrendDataset | CardMoversPayload | null;

export interface TrendsState {
  trendData: TrendDataset | null;
  cardTrends: CardTrendsState;
  rawDecks: Deck[] | null;
  rawTournaments: TrendTournament[] | null;
  isLoading: boolean;
  isHydrating: boolean;
  minAppearances: number;
  mode: TrendsMode;
  performanceFilter: string;
  chartDensity: number;
  timeRangeDays: number;
  resizeTimer: number | null;
  archetypeThumbnails: Map<string, string[]>;
  thumbIndexLoading: boolean;
}
