/**
 * The browser data layer's public surface.
 *
 * Every reader lives in a focused module under ./data — transport, path
 * construction, compatibility, and one module per domain. This file is the
 * barrel that keeps page imports at a single site, plus the handful of pure
 * tournament-key helpers (naming, dating, classification) that belong to no
 * particular reader.
 *
 * Add new readers to the domain module, not here.
 * @module src/lib/data
 */

import { ONLINE_META_LABEL } from './constants';
import { ONLINE } from './data/paths';
import type { UpcomingPayload } from '../../shared/upcomingTypes.js';

export type { UpcomingPayload };

export { fetchEvolutionMap } from './data/evolution';

// Card identity helper, re-exported so pages keep one import site for it.
export { itemUid } from './data/compat';
export { isSnapshotSource, snapshotSourceKey } from './data/paths';
export { fetchRotationIndex, snapshotDateForArchetype, snapshotDateForCard } from './data/snapshots';
export type { SnapshotIndex } from './data/snapshots';
export { fetchPlayerDecks, fetchPlayerIndexSlim, fetchPlayerProfile } from './data/players';
export { fetchMajorsTrendReport, fetchOnlineTrendReport } from './data/trends';
export type { OnlineTrendsPayload, TrendTimelinePoint } from './data/trends';
export { fetchMaster, fetchMeta, fetchTournamentsList } from './data/reports';
export type { MasterPayload } from './data/reports';
export {
  fetchArchetype,
  fetchArchetypes,
  fetchOnlineArchetypes,
  getArchetypeIconMap,
  normalizeArchetypeKey,
  resolveArchetypeIcons
} from './data/archetypes';
export { cardUsageForCard, fetchCardUsage, findByClusterUid } from './data/cards';
export type { CardUsageEntry, CardUsagePayload } from './data/cards';
export { fetchArchetypeDecks, fetchConversionIndex, fetchDay2CardStats, fetchParticipants } from './data/events';
export type { ConversionPayload, Day2CardStat, DeckRecord } from './data/events';
export { findCardBySetNumberCanonical, normalizeCardNumberKey, resolveCanonicalSetNumber } from './data/routes';
export {
  fetchArchetypeMatches,
  fetchArchetypeMatchupsOnline,
  fetchMatchupProfiles,
  fetchPlayerMatches
} from './data/matchups';
export type { MatchupPair, MatchupProfile, MatchupProfilesPayload, OnlineMatchupRecord } from './data/matchups';

// Pricing moved to ./data/prices; re-exported so page imports stay at one site.
export {
  fetchPriceHistoryForSet,
  fetchPriceMovers,
  fetchPrices,
  PRICE_HISTORY_MIN_DAYS,
  priceHistorySpanDays
} from './data/prices';
export type {
  PriceMoverList,
  PriceMoverMetric,
  PriceMoverRow,
  PriceMoversPayload,
  PriceMoverScope,
  PricePoint,
  PricingEntry
} from './data/prices';

// --- Upcoming tournaments (Limitless scraper Function) ---
// Types live in shared/upcomingTypes.ts so the producing Pages Function
// (functions/api/limitless/upcoming.ts — owned separately) can share them.
// FOLLOW-UP: point that Function's inline types at shared/upcomingTypes.ts too.

/**
 * Hits the /api/limitless/upcoming Pages Function, which scrapes Limitless's
 * upcoming-tournaments page and caches at the edge for 6 hours.
 */
export async function fetchUpcomingTournaments(): Promise<UpcomingPayload | null> {
  try {
    const response = await fetch('/api/limitless/upcoming', { mode: 'cors' });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as UpcomingPayload;
  } catch {
    return null;
  }
}

// --- Tournament name helpers ---

/**
 * Tournament keys look like "2026-05-08, Regional Championship Los Angeles".
 * Pretty form for display: "Regional Championship Los Angeles · May 8, 2026"
 * Returns the input unchanged if the format doesn't match.
 */
export function prettyTournamentName(key: string): string {
  if (key === ONLINE) {
    return ONLINE_META_LABEL;
  }
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2}),\s*(.+)$/);
  if (!m) {
    return key;
  }
  const [, y, mo, d, rest] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) {
    return key;
  }
  const dateLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${rest} · ${dateLabel}`;
}

/**
 * Tournament type classification (regional / international / online / special).
 * Used to group + filter in the selector.
 */
export function classifyTournament(key: string): 'online' | 'regional' | 'international' | 'special' | 'other' {
  if (key === ONLINE) {
    return 'online';
  }
  const lower = key.toLowerCase();
  if (lower.includes('international championship')) {
    return 'international';
  }
  if (lower.includes('regional championship')) {
    return 'regional';
  }
  if (lower.includes('special event')) {
    return 'special';
  }
  return 'other';
}

// --- Tournament-classification helpers ---

/**
 * Parse the date portion of a tournament key like "2026-05-08, Regional Championship Los Angeles".
 */
export function tournamentDate(key: string): Date | null {
  if (key === ONLINE) {
    return null;
  }
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    return null;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Filter a tournament list to "majors" (regional / international / special).
 */
export function majorTournaments(list: string[]): string[] {
  return list.filter(t => {
    const c = classifyTournament(t);
    return c === 'regional' || c === 'international' || c === 'special';
  });
}
