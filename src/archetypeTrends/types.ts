export interface TrendsMeta {
  generatedAt: string;
  tournamentCount: number;
  cardCount: number;
  weekCount: number;
  dayCount: number;
  windowStart: string;
  windowEnd: string;
}

export interface WeekEntry {
  weekStart: string;
  weekEnd: string;
  tournamentIds: string[];
  totals: {
    all: number;
    winner?: number;
    top8?: number;
    [key: string]: number | undefined;
  };
}

export interface DayEntry {
  date: string;
  tournamentIds: string[];
  totals: {
    all: number;
    winner?: number;
    top8?: number;
    [key: string]: number | undefined;
  };
}

export interface CardTimelineWeek {
  count: number;
  avg: number;
  mode: number;
  dist: number[];
}

export interface CopyTrendWeek {
  avg: number;
  mode: number;
  dist: number[];
}

export interface EnhancedCardEntry {
  name: string;
  set: string | null;
  number: string | null;
  category: 'core' | 'staple' | 'flex' | 'tech' | 'emerging' | 'fading';
  currentPlayrate: number;
  currentAvgCopies: number;
  currentModeCopies: number;
  playrateChange: number;
  copiesChange: number;
  volatility: number;
  timeline: {
    [weekIndex: string]: {
      [tier: string]: CardTimelineWeek;
    };
  };
  timelineDays?: {
    [dayIndex: string]: {
      [tier: string]: CardTimelineWeek;
    };
  };
  copyTrend: CopyTrendWeek[];
}

export interface Insights {
  coreCards: string[];
  flexSlots: Array<{ uid: string; variance: number; copyRange: [number, number] }>;
  risers: Array<{ uid: string; delta: number; from: number; to: number }>;
  fallers: Array<{ uid: string; delta: number; from: number; to: number }>;
  substitutions: Array<{ cardA: string; cardB: string; correlation: number }>;
}

export interface MatchupStats {
  opponent: string;
  wins: number;
  losses: number;
  ties: number;
  total: number;
  winRate: number;
}

export interface TrendsData {
  meta: TrendsMeta;
  weeks: WeekEntry[];
  days: DayEntry[];
  cards: Record<string, EnhancedCardEntry>;
  insights: Insights;
  matchups: Record<string, MatchupStats>;
}

export interface ChartLine {
  card: EnhancedCardEntry;
  color: string;
  points: {
    index: number;
    date: string;
    share: number;
    count: number;
    total: number;
  }[];
}

export interface AppState {
  archetypeName: string;
  archetypeSlug: string;
  trendsData: TrendsData | null;
  selectedTier: string;
  selectedCards: Set<string>;
  categoryFilter: 'all' | 'core' | 'staple' | 'flex' | 'tech' | 'emerging' | 'fading';
  sortBy: 'playrate' | 'trending' | 'name' | 'copies' | 'volatility';
  timeScale: 'daily' | 'weekly';
  resizeTimer: number | null;
  activeCopyCard: string | null;
  chartLines: ChartLine[];
  showAllMatchups: boolean;
}

export type MatchupSortMode = 'games' | 'winrate' | 'name';
