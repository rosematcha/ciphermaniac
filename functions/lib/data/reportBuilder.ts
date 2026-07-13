/**
 * Compatibility shim — the canonical card-report builder now lives in
 * `shared/data/reports/cardReport.ts` (DB-MASTER-PLAN Phase 2, slice 3). This
 * module re-exports it, plus the path/filename/archetype-name sanitizers from
 * their consolidated home, so existing Functions callers and tests keep working
 * unchanged.
 */

export { generateReportFromDecks } from '../../../shared/data/reports/cardReport';
export { sanitizeForFilename, sanitizeForPath, normalizeArchetypeName } from '../../../shared/cardUtils';
