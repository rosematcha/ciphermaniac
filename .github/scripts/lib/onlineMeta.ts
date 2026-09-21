/**
 * Online-meta producer: builds the "Online - Last 14 Days" report set.
 *
 * This is orchestration around the shared builders: tournaments and decks come
 * from the one shared fetcher (shared/onlineMeta/tournamentFetcher, which
 * owns the field-size policy, the event floor, the exclusion config, and the
 * fetch-failure budgets), success tags from the frozen SUCCESS_TAG_POLICY,
 * card reports from shared/data/reports/cardReport, archetype grouping from
 * shared/data/archetypes/build, and the card-usage index from
 * shared/data/reports/cardUsage. Deck ids keep the old producer's 12-char
 * sha1 prefix so published artifacts stay stable.
 *
 * Everything the run touches arrives through `OnlineMetaOptions`: the store it
 * reads and publishes to, the Limitless fetch, and the clock. The entry script
 * (run-online-meta.ts) supplies R2 and the network; tests supply memory.
 */

import type { CardTypesDatabase } from '../../../shared/data/cardTypesDatabase.js';
import { generateArchetypeTrends, MIN_MATCHUP_GAMES } from '../../../shared/data/analysis/archetypeTrends.js';
import { generateReportFromDecks, listedDeckCount } from '../../../shared/data/reports/cardReport.js';
import { type ArchetypeBuildResult, buildArchetypeReports } from '../../../shared/data/archetypes/build.js';
import { onlineArchetypeOptions } from '../../../shared/data/reports/onlineArtifacts.js';
import { buildCardUsageIndex } from '../../../shared/data/reports/cardUsage.js';
import { buildListIndex } from '../../../shared/data/reports/listIndex.js';
import { buildCardSuccessIndex } from '../../../shared/data/reports/cardSuccess.js';
import { requireSynonymDatabase, type SynonymDatabase } from '../../../shared/data/cardIdentity.js';
import type { fetchLimitlessJson } from './onlineFetch';
import {
  compileExclusions,
  DEFAULT_MIN_FIELD_PLAYERS,
  fetchRecentOnlineTournaments,
  gatherDecks,
  utcDayWindow
} from '../../../shared/onlineMeta/index.js';
import type { DiagnosticsCollector, GatheredDeck, OnlineTournamentSummary } from '../../../shared/onlineMeta/types.js';
import { partitionDecks } from './build/deckShards';
import { isOnlineReportRelativeKey } from './build/capturedScope';

const WINDOW_DAYS = 14;
const CACHE_REFRESH_LOOKBACK_DAYS = 30;
export const ONLINE_META_FOLDER = 'Online - Last 14 Days';
export const ONLINE_META_CACHE_CONTROL = 'public, max-age=21600';
const MAX_PAGES = 15;
/**
 * Smallest field whose pairings feed the matchup matrix. Shares tolerate an
 * 8-player event; a win rate built from its three rounds does not.
 */
const MIN_MATCHUP_FIELD_PLAYERS = 16;
const DECK_ID_LENGTH = 12;

/** Where the run reads its inputs and publishes the report. */
export interface OnlineMetaStore {
  /** The value, or null when verifiably absent; a failed read must throw. */
  read<T>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
  list(prefix: string): Promise<string[]>;
  /** Delete exact keys; must throw rather than report a refused key as deleted. */
  remove(keys: string[]): Promise<number>;
}

export interface OnlineMetaOptions {
  store: OnlineMetaStore;
  fetchJson: typeof fetchLimitlessJson;
  limitlessApiKey: string;
  now: Date;
  /** Key prefix the report folder sits under, e.g. `reports`. */
  reportsPrefix: string;
  exclusions: Parameters<typeof compileExclusions>[0];
  thumbnails: Record<string, string[]>;
  generateMaster?: boolean;
  generateArchetypes?: boolean;
  /**
   * Refetch a wider window and delete the published folder before rewriting
   * it. The delete happens only once a complete report is in hand (P-03).
   */
  cleanRefresh?: boolean;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

/** The options with defaults applied, plus what this run has published so far. */
interface Run extends Required<OnlineMetaOptions> {
  limitlessEnv: { LIMITLESS_API_KEY: string };
  basePath: string;
  published: Set<string>;
}

function startRun(options: OnlineMetaOptions): Run {
  return {
    ...options,
    generateMaster: options.generateMaster ?? true,
    generateArchetypes: options.generateArchetypes ?? true,
    cleanRefresh: options.cleanRefresh ?? false,
    log: options.log ?? (message => console.log(message)),
    warn: options.warn ?? (message => console.warn(message)),
    limitlessEnv: { LIMITLESS_API_KEY: options.limitlessApiKey },
    basePath: `${options.reportsPrefix}/${ONLINE_META_FOLDER}`,
    published: new Set()
  };
}

type PairingData = import('../../../shared/data/analysis/archetypeTrends.js').PairingData;
type PairingsFailure = { tournamentId: string; name: string; message: string };

/**
 * Fetches pairings and standings for the tournaments whose fields are large
 * enough for a matchup record to mean anything.
 */
async function gatherPairingsData(
  run: Run,
  tournaments: OnlineTournamentSummary[]
): Promise<{ pairingsData: PairingData[]; failures: PairingsFailure[] }> {
  const pairingsData: PairingData[] = [];
  const failures: PairingsFailure[] = [];

  run.log(`[online-meta] Fetching pairings data for ${tournaments.length} tournaments...`);

  for (const tournament of tournaments) {
    try {
      const [pairings, standings] = await Promise.all([
        run.fetchJson(`/tournaments/${tournament.id}/pairings`, { env: run.limitlessEnv }),
        run.fetchJson(`/tournaments/${tournament.id}/standings`, { env: run.limitlessEnv })
      ]);

      if (Array.isArray(pairings) && Array.isArray(standings)) {
        pairingsData.push({
          tournamentId: tournament.id,
          pairings: pairings as PairingData['pairings'],
          standings: standings as PairingData['standings']
        });
      }
    } catch (error) {
      run.warn(`[online-meta] Failed to fetch pairings for ${tournament.name}: ${(error as Error).message}`);
      failures.push({ tournamentId: tournament.id, name: tournament.name, message: (error as Error).message });
    }
  }

  run.log(`[online-meta] Gathered pairings data for ${pairingsData.length} tournaments`);
  return { pairingsData, failures };
}

/** Publish one object of the report, remembering it so the sweep below spares it. */
async function publish(run: Run, relativeKey: string, data: unknown): Promise<void> {
  const key = `${run.basePath}/${relativeKey}`;
  await run.store.write(key, data);
  run.published.add(key);
}

/**
 * Delete what this run superseded: anything in the folder that is no longer
 * part of the report's shape, and any archetype, deck shard, list index or
 * cardSuccess object the run was responsible for rewriting but did not write.
 */
async function removeSupersededOnlineObjects(run: Run): Promise<number> {
  const { basePath, published } = run;
  const existing = await run.store.list(`${basePath}/`);
  const archetypePrefix = `${basePath}/archetypes/`;
  const listIndexPrefix = `${basePath}/decks/`;
  const stale = existing.filter(key => {
    const relative = key.slice(`${basePath}/`.length);
    if (!isOnlineReportRelativeKey(relative)) {
      return true;
    }
    if (key.startsWith(listIndexPrefix) || key.startsWith(archetypePrefix)) {
      return !published.has(key);
    }
    if (run.generateArchetypes && key === `${basePath}/lists.json`) {
      return !published.has(key);
    }
    return run.generateMaster && key === `${basePath}/cardSuccess.json` && !published.has(key);
  });
  return run.store.remove(stale);
}

async function loadCardTypesDatabase(run: Run): Promise<CardTypesDatabase | null> {
  const key = 'assets/data/card-types.json';
  const data = await run.store.read<CardTypesDatabase>(key);
  if (data) {
    run.log(`[online-meta] Loaded card types database (${Object.keys(data).length} entries) from ${key}`);
    return data;
  }
  run.warn('[online-meta] Card types database not found; continuing without enrichment');
  return null;
}

async function loadCardSynonyms(run: Run): Promise<SynonymDatabase> {
  const key = 'assets/card-synonyms.json';
  const data = requireSynonymDatabase(await run.store.read<SynonymDatabase>(key), key);
  run.log(`[online-meta] Loaded card synonyms (${Object.keys(data.synonyms).length} entries) from ${key}`);
  return data;
}

interface GatheredWindow {
  tournaments: OnlineTournamentSummary[];
  decks: GatheredDeck[];
  diagnostics: DiagnosticsCollector;
}

/**
 * Fetch and gather the report window. In clean-refresh mode a wider window is
 * fetched so the Limitless cache is repopulated, but the published report is
 * always the WINDOW_DAYS window — never silently widened while labelled
 * "Last 14 Days" (P-30). Tournaments that contributed no decks (below the
 * field floor, failed standings) are dropped so the report's tournament list
 * is exactly its deck population.
 */
async function gatherWindow(
  run: Run,
  cardTypesDb: CardTypesDatabase | null
): Promise<GatheredWindow & { fetchWindowDays: number }> {
  const { now, fetchJson, limitlessEnv } = run;
  const reportWindow = utcDayWindow(now, WINDOW_DAYS);
  const fetchWindowDays = run.cleanRefresh ? Math.max(WINDOW_DAYS, CACHE_REFRESH_LOOKBACK_DAYS) : WINDOW_DAYS;
  const fetchWindow = utcDayWindow(now, fetchWindowDays);
  const diagnostics: DiagnosticsCollector = {};

  run.log(`[online-meta] Gathering tournaments ${fetchWindow.start.toISOString()} .. ${fetchWindow.end.toISOString()}`);
  const fetched = await fetchRecentOnlineTournaments(limitlessEnv, fetchWindow.start, {
    windowEnd: fetchWindow.lastInstant,
    maxPages: MAX_PAGES,
    diagnostics,
    exclusions: compileExclusions(run.exclusions),
    fetchJson
  });
  run.log(
    `[online-meta] Found ${fetched.length} eligible tournaments (${diagnostics.excludedTournaments?.length || 0} excluded by config)`
  );

  const gathered = await gatherDecks(limitlessEnv, fetched, diagnostics, cardTypesDb, { fetchJson });
  if (!gathered.length) {
    throw new Error('No decklists gathered from online tournaments');
  }

  const reportStartMs = reportWindow.start.getTime();
  const inWindow = fetched.filter(tournament => {
    const dateMs = Date.parse(tournament.date);
    return Number.isFinite(dateMs) && dateMs >= reportStartMs;
  });
  if (!inWindow.length) {
    throw new Error(
      `No tournaments fall within the ${WINDOW_DAYS}-day report window ` +
        `(fetched ${fetched.length} over ${fetchWindowDays} days); ` +
        'refusing to publish a mislabelled report'
    );
  }

  const deckCounts = new Map<string, number>();
  for (const deck of gathered) {
    deckCounts.set(deck.tournamentId, (deckCounts.get(deck.tournamentId) || 0) + 1);
  }
  const tournaments = inWindow.filter(tournament => (deckCounts.get(tournament.id) || 0) > 0);
  const tournamentIds = new Set(tournaments.map(tournament => tournament.id));
  const decks = gathered
    .filter(deck => tournamentIds.has(deck.tournamentId))
    .map(deck => ({ ...deck, id: deck.id.slice(0, DECK_ID_LENGTH) }));
  if (!decks.length) {
    throw new Error('No decklists remained after report-window filtering');
  }

  return { tournaments, decks, diagnostics, fetchWindowDays };
}

function buildMeta(
  run: Run,
  window: GatheredWindow & { fetchWindowDays: number },
  archetypes: { minDecks: number; pairingsFailures: PairingsFailure[] }
): Record<string, unknown> {
  const { now } = run;
  const reportWindow = utcDayWindow(now, WINDOW_DAYS);
  const { diagnostics } = window;
  const fields = diagnostics.tournamentFields || {};
  return {
    name: ONLINE_META_FOLDER,
    source: 'limitless-online',
    generatedAt: now.toISOString(),
    windowStart: reportWindow.start.toISOString(),
    windowEnd: reportWindow.end.toISOString(),
    deckTotal: window.decks.length,
    tournamentCount: window.tournaments.length,
    archetypeMinPercent: 0.5,
    archetypeMinDecks: archetypes.minDecks,
    refreshMode: run.cleanRefresh,
    refreshLookbackDays: window.fetchWindowDays,
    // What the numbers were computed against, so a reader never has to guess.
    fieldPolicy: {
      population: 'players with a placing',
      minFieldPlayers: DEFAULT_MIN_FIELD_PLAYERS,
      minMatchupFieldPlayers: MIN_MATCHUP_FIELD_PLAYERS,
      minMatchupGames: MIN_MATCHUP_GAMES
    },
    unplacedEntries: diagnostics.entriesWithoutPlacing?.length || 0,
    excluded: diagnostics.excludedTournaments || [],
    skipped: {
      belowMinimum: diagnostics.tournamentsBelowMinimum || [],
      standingsFailures: diagnostics.standingsFetchFailures || [],
      detailsFailures: diagnostics.detailsFetchFailures || [],
      pairingsFailures: archetypes.pairingsFailures
    },
    tournaments: window.tournaments.map(t => ({
      id: t.id,
      name: t.name,
      date: t.date,
      // `players` is the field the report was computed against; `registered`
      // is what Limitless lists, late registrations and no-shows included.
      players: fields[t.id]?.fieldSize ?? t.players,
      registered: fields[t.id]?.registered ?? t.players,
      format: t.format,
      platform: t.platform,
      organizer: t.organizer
    }))
  };
}

interface TrendBuildInput {
  archetypes: ArchetypeBuildResult;
  tournaments: OnlineTournamentSummary[];
  synonymDb: SynonymDatabase;
  pairingsData: PairingData[];
}

function buildArchetypeTrends(run: Run, input: TrendBuildInput): Map<string, unknown> {
  const trendsByBase = new Map<string, unknown>();
  if (!run.generateArchetypes) {
    return trendsByBase;
  }
  const failures: string[] = [];
  for (const file of input.archetypes.files) {
    const decks = input.archetypes.decksByBase.get(file.base);
    if (!decks) {
      continue;
    }
    try {
      const archetypeName = file.displayName || file.base.replace(/_/g, ' ');
      trendsByBase.set(
        file.base,
        generateArchetypeTrends(
          decks as unknown as Parameters<typeof generateArchetypeTrends>[0],
          input.tournaments,
          input.synonymDb,
          { pairingsData: input.pairingsData, archetypeName }
        )
      );
    } catch (error) {
      failures.push(`${file.base}: ${(error as Error)?.message || error}`);
    }
  }
  if (failures.length) {
    throw new Error(`Trend generation failed for ${failures.length} archetype(s): ${failures.join('; ')}`);
  }
  return trendsByBase;
}

interface PublishInput {
  reportDecks: GatheredDeck[];
  masterReport: unknown;
  cardSuccess: ReturnType<typeof buildCardSuccessIndex>;
  archetypes: ArchetypeBuildResult;
  trendsByBase: Map<string, unknown>;
  meta: unknown;
}

async function publishMaster(run: Run, input: PublishInput): Promise<void> {
  if (!run.generateMaster) {
    run.log('[online-meta] Skipping master.json (GENERATE_MASTER=false)');
    return;
  }
  run.log('[online-meta] Uploading master.json...');
  await publish(run, 'master.json', input.masterReport);
  if (!input.cardSuccess) {
    run.log('[online-meta] Skipping cardSuccess.json (no deck met the field-size floor)');
    return;
  }
  run.log(
    `[online-meta] Uploading cardSuccess.json (${input.cardSuccess.successTotal}/${input.cardSuccess.deckTotal} decks ${input.cardSuccess.tag})...`
  );
  await publish(run, 'cardSuccess.json', input.cardSuccess);
}

async function publishArchetypes(run: Run, input: PublishInput): Promise<void> {
  if (!run.generateArchetypes) {
    run.log('[online-meta] Skipping archetype reports (GENERATE_ARCHETYPES=false)');
    return;
  }
  const { files, index, decksByBase } = input.archetypes;
  run.log('[online-meta] Uploading archetype reports...');
  await publish(run, 'archetypes/index.json', index);
  await publish(run, 'cardUsage.json', buildCardUsageIndex(files));
  const listIndex = buildListIndex(input.reportDecks);
  if (listIndex) {
    await publish(run, 'lists.json', listIndex);
  }
  for (const file of files) {
    await publish(run, `archetypes/${file.base}/cards.json`, file.data);
    const trends = input.trendsByBase.get(file.base);
    if (trends) {
      await publish(run, `archetypes/${file.base}/trends.json`, trends);
    }
  }
  const deckShards = partitionDecks(
    input.reportDecks,
    files.map(file => ({ base: file.base, decks: (decksByBase.get(file.base) ?? []) as GatheredDeck[] }))
  );
  for (const shard of deckShards) {
    await publish(run, shard.path, shard.decks);
  }
  await publish(run, 'decks/index.json', deckShards.map(shard => shard.path).sort());
  const removed = await removeSupersededOnlineObjects(run);
  run.log(`[online-meta] Removed ${removed} superseded or duplicate object(s)`);
}

async function publishReport(run: Run, input: PublishInput): Promise<void> {
  if (run.cleanRefresh) {
    run.log(`[online-meta] Clean refresh: deleting existing ${run.basePath} artifacts before rebuild...`);
    const keys = await run.store.list(`${run.basePath}/`);
    const deleted = await run.store.remove(keys);
    run.log(`[online-meta] Deleted ${deleted}/${keys.length} objects from ${run.basePath}/`);
  }
  await publishMaster(run, input);
  await publishArchetypes(run, input);
  run.log('[online-meta] Uploading meta.json (pointer, written last)...');
  await publish(run, 'meta.json', input.meta);
  const components = [
    run.generateMaster ? 'master' : null,
    run.generateArchetypes ? `${input.archetypes.files.length} archetypes` : null
  ];
  run.log(`[online-meta] Uploaded ${components.filter(Boolean).join(' + ')} to ${run.basePath}`);
}

/** Build the report and publish it; resolves with the meta pointer it wrote. */
export async function runOnlineMeta(options: OnlineMetaOptions): Promise<Record<string, unknown>> {
  const run = startRun(options);

  // NOTE: In clean-refresh mode the existing artifacts are deleted only
  // AFTER a complete, validated report is in hand (see below), so a fetch outage
  // or an empty report window can no longer wipe production (P-03).

  const cardTypesDb = await loadCardTypesDatabase(run);
  const synonymDb = await loadCardSynonyms(run);
  const window = await gatherWindow(run, cardTypesDb);
  const { tournaments: reportTournaments, decks: reportDecks, diagnostics } = window;
  run.log(`[online-meta] Archetype classification summary: ${JSON.stringify(diagnostics.archetypeClassification)}`);

  // Gather pairings data for matchup analysis, from fields large enough to
  // carry a matchup record.
  const fields = diagnostics.tournamentFields || {};
  const matchupTournaments = reportTournaments.filter(
    tournament => (fields[tournament.id]?.fieldSize || 0) >= MIN_MATCHUP_FIELD_PLAYERS
  );
  const { pairingsData, failures: pairingsFailures } = await gatherPairingsData(run, matchupTournaments);

  run.log(`[online-meta] Aggregating ${reportDecks.length} decks`);
  // Decklist-less standings entries stay in the deck list — they're real decks
  // in the meta and carry an archetype — but they can't contribute a card, so
  // card inclusion divides by the listed decks only (D13).
  const masterReport = generateReportFromDecks(
    reportDecks as unknown as Parameters<typeof generateReportFromDecks>[0],
    listedDeckCount(reportDecks as unknown as Parameters<typeof listedDeckCount>[0]),
    synonymDb
  );
  // The frozen 'preserve' online profile: case-preserving group keys (D3
  // quirk), 0.5% deck floor, fraction percent, deckCount-desc ordering,
  // thumbnails + signature cards on index entries. The "Other" bucket stays in
  // the denominator but gets no page.
  const archetypes = buildArchetypeReports(
    reportDecks as unknown as Parameters<typeof buildArchetypeReports>[0],
    synonymDb,
    onlineArchetypeOptions(run.thumbnails, cardTypesDb, masterReport)
  );

  const meta = buildMeta(run, window, { minDecks: archetypes.minDecks, pairingsFailures });

  // Pre-generate every archetype's trends BEFORE any destructive step. Trend
  // generation is pure/in-memory, so a failure here signals a real bug — surface
  // it now, while the previous report is still intact, rather than publishing
  // new decks alongside stale (or missing) trends (P-31).
  const trendsByBase = buildArchetypeTrends(run, {
    archetypes,
    tournaments: reportTournaments,
    synonymDb,
    pairingsData
  });

  // Per-card finish rates, computed with the trends above and for the same
  // reason (P-31): it is pure, in-memory work, so a bug here must surface while
  // the previous report is still whole rather than between two uploads.
  const cardSuccess = buildCardSuccessIndex(
    reportDecks as unknown as Parameters<typeof buildCardSuccessIndex>[0],
    synonymDb
  );

  await publishReport(run, { reportDecks, masterReport, cardSuccess, archetypes, trendsByBase, meta });
  return meta;
}
