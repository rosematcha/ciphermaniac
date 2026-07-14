/**
 * Thin compatibility shim. The trends + matchup aggregation authority now lives
 * in `shared/data/analysis/archetypeTrends.ts` (DB-MASTER-PLAN Phase 2 slice 6),
 * where the input contracts (Deck, PairingData, Tournament, TrendOptions,
 * TrendReport, ...) are defined explicitly. Function/script callers keep
 * importing the aggregation entry points from this path unchanged.
 */
export { buildMatchupMatrix, generateArchetypeTrends } from '../../../shared/data/analysis/archetypeTrends';
