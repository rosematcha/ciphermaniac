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

export { snapshotSourceKey } from './data/paths';
export { fetchRotationIndex, snapshotDateForArchetype, snapshotDateForCard } from './data/snapshots';
export { fetchPlayerDecks, fetchPlayerIndexSlim, fetchPlayerProfile } from './data/players';
export { fetchEarnings, fetchEarningsEvents } from './data/earnings';
export { fetchMajorsTrendReport, fetchOnlineTrendReport } from './data/trends';
export type { TrendTimelinePoint } from './data/trends';
export { fetchCardSuccessIndex, fetchMaster, fetchMeta, fetchTournamentsList } from './data/reports';
export type { MasterPayload } from './data/reports';
export {
  fetchArchetype,
  fetchArchetypes,
  fetchOnlineArchetypes,
  getArchetypeIconMap,
  normalizeArchetypeKey,
  resolveArchetypeIcons
} from './data/archetypes';
export { fetchFormatArchetypes, FORMAT_SPRITE_SLUGS, TIER_FORMATS, tierFormat } from './data/formats';
export type { TierFormat } from './data/formats';
export { cardUsageForCard, fetchCardUsage, findByClusterUid } from './data/cards';
export type { CardUsageEntry, CardUsagePayload } from './data/cards';
export { fetchArchetypeDecks, fetchConversionIndex, fetchDay2CardStats, fetchParticipants } from './data/events';
export type { Day2CardStat, DeckRecord } from './data/events';
export { findCardBySetNumberCanonical, resolveCanonicalSetNumber } from './data/routes';
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

export {
  fetchPriceHistoryForSet,
  fetchPriceMovers,
  fetchPrices,
  PRICE_HISTORY_MIN_DAYS,
  priceHistorySpanDays
} from './data/prices';
export type { PriceMoverList, PriceMoverMetric, PriceMoverRow, PricePoint, PricingEntry } from './data/prices';

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
