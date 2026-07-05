import { generateReportFromDecks } from '../data/reportBuilder.js';
import { loadCardSynonyms } from '../data/cardSynonyms.js';
import { ARCHETYPE_THUMBNAILS, buildArchetypeReports } from './reportGenerator';
import { batchPutJson, getJson } from './storageWriter';
import { runWithConcurrency } from './tournamentFetcher';

const SNAPSHOT_WINDOW_DAYS = 30;
const MIN_USAGE_PERCENT = 0.5;
const SNAPSHOT_ROOT = 'reports/Snapshots';
const DEFAULT_R2_CONCURRENCY = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const TOURNAMENT_KEY_RE = /^(\d{4})-(\d{2})-(\d{2}),/;

export interface RunRotationSnapshotOptions {
  rotationDate: string;
  label?: string;
  windowDays?: number;
  r2Concurrency?: number;
}

export interface RunRotationSnapshotResult {
  success: boolean;
  rotationDate: string;
  snapshotKey: string;
  reason?: string;
  windowStart?: string;
  windowEnd?: string;
  tournaments?: number;
  tournamentKeys?: string[];
  decks?: number;
  archetypes?: number;
}

function parseTournamentDate(key: string): Date | null {
  const m = TOURNAMENT_KEY_RE.exec(key);
  if (!m) {
    return null;
  }
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Read the canonical tournament list from R2 and filter to ones whose dates
 * fall in `[since, windowEnd)`. The list is just keys; per-tournament decks
 * are loaded separately.
 */
async function findInWindowTournaments(env: any, since: Date, windowEnd: Date): Promise<string[]> {
  const list = await getJson<string[]>(env, 'reports/tournaments.json');
  if (!Array.isArray(list)) {
    return [];
  }
  const sinceMs = since.getTime();
  const endMs = windowEnd.getTime();
  return list.filter(key => {
    const date = parseTournamentDate(key);
    if (!date) {
      return false;
    }
    const t = date.getTime();
    return t >= sinceMs && t < endMs;
  });
}

interface StoredDeck {
  archetype?: string;
  cards?: unknown[];
  [key: string]: unknown;
}

/**
 * Fetch decks.json for each in-window tournament in parallel and concatenate.
 * Missing files are tolerated (some old tournaments may not have decks).
 */
async function loadStoredDecks(
  env: any,
  tournamentKeys: string[],
  concurrency: number
): Promise<{ decks: StoredDeck[]; sourcesWithDecks: string[] }> {
  const sourcesWithDecks: string[] = [];
  const perTournament = await runWithConcurrency(tournamentKeys, concurrency, async (key: string) => {
    const decks = await getJson<StoredDeck[]>(env, `reports/${key}/decks.json`);
    if (!Array.isArray(decks) || decks.length === 0) {
      return [] as StoredDeck[];
    }
    sourcesWithDecks.push(key);
    return decks;
  });
  return { decks: perTournament.flat(), sourcesWithDecks };
}

/**
 * Build a frozen pre-rotation snapshot from R2 data alone. No Limitless API
 * traffic — the per-tournament decks.json files already on R2 are everything
 * the report and archetype builders need. Skipped: card-type enrichment (the
 * stored decks were enriched at write time; re-enriching now would overwrite
 * historical regulation marks with current ones), trends, sqlite, player
 * aggregates.
 */
export async function runRotationSnapshot(
  env: any,
  options: RunRotationSnapshotOptions
): Promise<RunRotationSnapshotResult> {
  const { rotationDate } = options;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rotationDate)) {
    throw new Error(`rotationDate must be YYYY-MM-DD, got: ${rotationDate}`);
  }
  const label = options.label || `${rotationDate} rotation`;
  const windowDays = Math.max(1, options.windowDays ?? SNAPSHOT_WINDOW_DAYS);
  const r2Concurrency = Math.max(1, options.r2Concurrency || DEFAULT_R2_CONCURRENCY);

  const rotationDay = new Date(`${rotationDate}T00:00:00Z`);
  // Pre-rotation window: include tournaments held on rotation day (last day
  // of the old format). `windowEnd` is exclusive — point it at the day after.
  const windowEnd = new Date(rotationDay.getTime() + DAY_MS);
  const since = new Date(rotationDay.getTime() - windowDays * DAY_MS);

  const snapshotKey = `Snapshots/${rotationDate}`;
  const reportBaseKey = `${SNAPSHOT_ROOT}/${rotationDate}`;

  console.info(
    `[Snapshot ${rotationDate}] Reading tournaments.json (window ${since.toISOString().slice(0, 10)} → ${windowEnd.toISOString().slice(0, 10)})...`
  );
  const tournamentKeys = await findInWindowTournaments(env, since, windowEnd);
  if (tournamentKeys.length === 0) {
    console.warn(`[Snapshot ${rotationDate}] No in-window tournaments in tournaments.json; skipping write.`);
    return {
      success: false,
      rotationDate,
      snapshotKey,
      reason: 'No persisted tournaments in pre-rotation window',
      windowStart: since.toISOString(),
      windowEnd: windowEnd.toISOString()
    };
  }

  console.info(`[Snapshot ${rotationDate}] Found ${tournamentKeys.length} in-window tournaments; fetching decks...`);
  const { decks, sourcesWithDecks } = await loadStoredDecks(env, tournamentKeys, r2Concurrency);
  if (decks.length === 0) {
    console.warn(`[Snapshot ${rotationDate}] No decks.json data for any in-window tournament; skipping write.`);
    return {
      success: false,
      rotationDate,
      snapshotKey,
      reason: 'No decks.json data for in-window tournaments',
      windowStart: since.toISOString(),
      windowEnd: windowEnd.toISOString(),
      tournaments: tournamentKeys.length,
      tournamentKeys
    };
  }

  console.info(`[Snapshot ${rotationDate}] Loaded ${decks.length} decks from ${sourcesWithDecks.length} tournaments`);

  console.info(`[Snapshot ${rotationDate}] Loading card synonyms...`);
  const synonymDb = await loadCardSynonyms(env);

  const deckTotal = decks.length;
  // Stored decks already carry the same shape that the live pipeline produces
  // (this is literally what gatherDecks wrote to R2 originally). Cast at the
  // boundary to satisfy reportBuilder's narrower DeckEntry/CardEntry types.
  const typedDecks = decks as unknown as Parameters<typeof generateReportFromDecks>[0];
  const masterReport = generateReportFromDecks(typedDecks, deckTotal, synonymDb);
  const { archetypeFiles, archetypeIndex, minDecks, deckMap } = buildArchetypeReports(
    typedDecks,
    MIN_USAGE_PERCENT,
    synonymDb,
    { thumbnailConfig: ARCHETYPE_THUMBNAILS }
  );

  const meta = {
    name: snapshotKey,
    source: 'r2-stored-tournaments',
    rotationDate,
    label,
    generatedAt: new Date().toISOString(),
    windowStart: since.toISOString(),
    windowEnd: windowEnd.toISOString(),
    windowDays,
    deckTotal,
    tournamentCount: sourcesWithDecks.length,
    archetypeMinPercent: MIN_USAGE_PERCENT,
    archetypeMinDecks: minDecks,
    // Carry the source tournament keys so the snapshot is reproducible/auditable.
    tournaments: sourcesWithDecks.map(key => ({ key }))
  };

  const baseWrites = [
    { key: `${reportBaseKey}/master.json`, data: masterReport },
    { key: `${reportBaseKey}/meta.json`, data: meta },
    { key: `${reportBaseKey}/archetypes/index.json`, data: archetypeIndex }
  ];
  // Match the production folder layout written by `.github/scripts/run-online-meta.mjs`:
  // `archetypes/{base}/cards.json` and `archetypes/{base}/decks.json`. The frontend
  // (src/lib/data.ts fetchArchetype/fetchArchetypeDecks) reads from these paths.
  const archetypeWrites: { key: string; data: unknown }[] = [];
  for (const file of archetypeFiles as Array<{ base: string; data: unknown }>) {
    archetypeWrites.push({
      key: `${reportBaseKey}/archetypes/${file.base}/cards.json`,
      data: file.data
    });
    const archetypeDecks = (deckMap as Map<string, unknown[]>).get(file.base);
    if (archetypeDecks && archetypeDecks.length) {
      archetypeWrites.push({
        key: `${reportBaseKey}/archetypes/${file.base}/decks.json`,
        data: archetypeDecks
      });
    }
  }

  await batchPutJson(env, [...baseWrites, ...archetypeWrites], r2Concurrency);

  console.info(
    `[Snapshot ${rotationDate}] Wrote ${archetypeFiles.length} archetypes, ${deckTotal} decks from ${sourcesWithDecks.length} tournaments`
  );

  return {
    success: true,
    rotationDate,
    snapshotKey,
    windowStart: since.toISOString(),
    windowEnd: windowEnd.toISOString(),
    tournaments: sourcesWithDecks.length,
    tournamentKeys: sourcesWithDecks,
    decks: deckTotal,
    archetypes: archetypeFiles.length
  };
}
