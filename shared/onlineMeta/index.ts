/**
 * Barrel for the online-meta report modules.
 *
 * The daily pipeline itself runs in GitHub Actions
 * (.github/scripts/run-online-meta.mjs / run-trends.ts) — there is no
 * in-Worker job anymore; a Pages Function can't fit the fetch fan-out within
 * the free plan's subrequest/CPU limits.
 */
export { fetchRecentOnlineTournaments, gatherDecks } from './tournamentFetcher';
export { buildArchetypeReports } from './reportGenerator';
export { buildTrendReport, buildCardTrendReport } from './archetypeBuilder';
