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

import type { UpcomingPayload } from '../../shared/upcomingTypes.js';

export type { UpcomingPayload };

export { fetchEvolutionMap } from './data/evolution';

// Card identity helper, re-exported so pages keep one import site for it.
export { itemUid } from './data/compat';
export { snapshotSourceKey } from './data/paths';
export { fetchRotationIndex, snapshotDateForArchetype, snapshotDateForCard } from './data/snapshots';
export { fetchPlayerDecks, fetchPlayerIndexSlim, fetchPlayerProfile } from './data/players';
export { fetchMajorsTrendReport, fetchOnlineTrendReport } from './data/trends';
export type { TrendTimelinePoint } from './data/trends';
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
export type { Day2CardStat, DeckRecord } from './data/events';
export { findCardBySetNumberCanonical, normalizeCardNumberKey, resolveCanonicalSetNumber } from './data/routes';
// Tournament-key parsing lives in shared: the daily majors-trends pipeline
// classifies and dates events the same way the selector does.
export {
  classifyTournament,
  majorTournaments,
  prettyTournamentName,
  tournamentDate
} from '../../shared/data/tournamentKeys';
export {
  fetchArchetypeMatches,
  fetchArchetypeMatchupsOnline,
  fetchMatchupProfiles,
  fetchPlayerMatches
} from './data/matchups';
export type { MatchupPair, MatchupProfile, OnlineMatchupRecord } from './data/matchups';

// Pricing moved to ./data/prices; re-exported so page imports stay at one site.
export {
  fetchPriceHistoryForSet,
  fetchPriceMovers,
  fetchPrices,
  PRICE_HISTORY_MIN_DAYS,
  priceHistorySpanDays
} from './data/prices';
export type { PriceMoverList, PriceMoverMetric, PriceMoverRow, PricePoint, PricingEntry } from './data/prices';

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
