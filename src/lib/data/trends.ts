/**
 * Cron-built trend reports: the daily online timeline per archetype, and the
 * majors movers payload.
 *
 * The online payload's card rows go through read-time canonicalization; the
 * majors payload is already canonicalized at build time and passes through.
 * @module src/lib/data/trends
 */

import { dataClient } from './client';
import { canonicalizeCardTrendEntries } from './compat';
import { getSynonymDatabase } from '../../utils/cardSynonyms';
import type { MajorsTrendsPayload } from '../majorsTrends';

const { fetchJsonOptional } = dataClient;

export interface TrendTimelinePoint {
  /** YYYY-MM-DD */
  date: string;
  /** Decks of this archetype on this day */
  decks: number;
  /** Total decks across all archetypes on this day */
  totalDecks: number;
  /** Share as a percentage 0..100 (= decks / totalDecks * 100) */
  share: number;
}

interface TrendSeries {
  /** Archetype slug, matches archetypes/index.json `name` */
  base: string;
  /** Human-readable name */
  displayName: string;
  totalDecks: number;
  appearances: number;
  avgShare: number;
  maxShare: number;
  peakShare?: number;
  minShare: number;
  /** Daily timeline, ascending date order */
  timeline: TrendTimelinePoint[];
}

interface CardTrendEntry {
  key: string;
  name: string;
  set: string | null;
  number: string | null;
  appearances: number;
  startShare: number;
  endShare: number;
  delta: number;
  currentShare: number;
}

export interface OnlineTrendsPayload {
  trendReport: {
    generatedAt: string;
    windowStart: string;
    windowEnd: string;
    deckTotal: number;
    tournamentCount: number;
    archetypeCount: number;
    series: TrendSeries[];
  };
  cardTrends: {
    generatedAt: string;
    windowStart: string;
    windowEnd: string;
    cardsAnalyzed: number;
    rising: CardTrendEntry[];
    falling: CardTrendEntry[];
  };
}

/**
 * Reads the trends file produced by the online-meta cron.
 * Lives at `reports/Trends - Last 30 Days/trends.json`.
 *
 * Contains 30 daily timeline points per archetype plus pre-computed
 * rising/falling card lists. Returns null if the file isn't there yet.
 */
const TRENDS_FOLDER = 'Trends - Last 30 Days';
export async function fetchOnlineTrendReport(): Promise<OnlineTrendsPayload | null> {
  const [raw, db] = await Promise.all([
    fetchJsonOptional<OnlineTrendsPayload>(`/reports/${encodeURIComponent(TRENDS_FOLDER)}/trends.json`),
    getSynonymDatabase()
  ]);
  if (!raw || !db) {
    return raw;
  }
  return {
    ...raw,
    cardTrends: {
      ...raw.cardTrends,
      rising: canonicalizeCardTrendEntries(raw.cardTrends.rising ?? [], db),
      falling: canonicalizeCardTrendEntries(raw.cardTrends.falling ?? [], db)
    }
  };
}

/**
 * Reads the majors-trends file produced by the pipeline
 * (`.github/scripts/run-majors-trends.ts`), stored at `reports/majors-trends.json`.
 *
 * Carries the precomputed archetype-share timeline + card movers for the last
 * 3 / 5 / 10 major events — the same result the page used to compute in the
 * browser from up to ten full `master.json` files (~5 MB). Set/number in the
 * mover rows are already canonicalized at build time, so no read-time merge is
 * needed here. Returns null (404) until the pipeline has run, so callers fall
 * back to the client-side computation.
 */
export function fetchMajorsTrendReport(): Promise<MajorsTrendsPayload | null> {
  return fetchJsonOptional<MajorsTrendsPayload>('/reports/majors-trends.json');
}
