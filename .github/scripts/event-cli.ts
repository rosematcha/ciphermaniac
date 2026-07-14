/**
 * Event build CLI.
 *
 * Turns a validated NORMALIZED event record into the full set of serving
 * artifacts (via {@link buildEventArtifacts}) and writes them to a local
 * directory or uploads them to R2 under `reports/{prefix}/`. This is the
 * TypeScript event builder the plan calls for: the Python Labs adapter emits
 * normalized records, and this CLI — the one home for artifact generation —
 * consumes them. Backfill/reprocess scripts call this instead of importing the
 * Python monolith.
 *
 * Usage:
 *   tsx event-cli.ts build --input <normalized.json> --out-dir <dir>
 *   tsx event-cli.ts build --input <normalized.json> --r2-prefix "<date, Name>"
 *
 * R2 mode needs R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY /
 * R2_BUCKET_NAME in the environment.
 * @module .github/scripts/event-cli
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateNormalizedEvent } from '../../shared/data/contracts.ts';
import { buildEventArtifacts } from '../../shared/data/reports/eventArtifacts.ts';
import { type LabsSourceEvent, labsSourceToNormalized } from '../../shared/data/adapters/labsSource.ts';
import { buildArchetypeReports } from '../../shared/data/archetypes/build.ts';
import { buildCardUsageIndex } from '../../shared/data/reports/cardUsage.ts';
import { buildConversionIndex } from '../../shared/data/reports/conversion.ts';
import { type DeckEntry, generateReportFromDecks } from '../../shared/data/reports/cardReport.ts';
import { makeRollingResolver } from '../../shared/data/canonicalPrint.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';
import { createR2Client, getJsonResult, putJson } from './lib/r2.mjs';

const CACHE_CONTROL = 'public, max-age=21600';

interface BuildArgs {
  input: string;
  /** 'normalized' (default) or 'labs-source' (run the adapter first). */
  from?: 'normalized' | 'labs-source';
  outDir?: string;
  r2Prefix?: string;
  synonyms?: string;
  /** Canonicalize card UIDs as of the event's date (rolling canonicals). */
  rolling?: boolean;
  /** Path to an `assets/print-prices/{date}.json` artifact for --rolling. */
  printPrices?: string;
}

function parseArgs(argv: string[]): BuildArgs {
  const args: Partial<BuildArgs> = { from: 'normalized' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--rolling') {
      args.rolling = true;
      continue;
    }
    const value = argv[++i];
    if (flag === '--input') args.input = value;
    else if (flag === '--out-dir') args.outDir = value;
    else if (flag === '--r2-prefix') args.r2Prefix = value;
    else if (flag === '--synonyms') args.synonyms = value;
    else if (flag === '--print-prices') args.printPrices = value;
    else if (flag === '--from') {
      if (value !== 'normalized' && value !== 'labs-source') throw new Error(`--from must be normalized|labs-source, got "${value}"`);
      args.from = value;
    } else throw new Error(`Unknown flag: ${flag}`);
  }
  if (!args.input) throw new Error('Missing --input <event.json>');
  if (!args.outDir && !args.r2Prefix) throw new Error('Provide --out-dir <dir> or --r2-prefix "<date, Name>"');
  return args as BuildArgs;
}

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

/**
 * Validate a normalized event and build its artifacts. Exits non-zero with the
 * collected validation errors when the record is invalid — a malformed record
 * never publishes.
 */
export async function buildFromFile(args: BuildArgs): Promise<Map<string, unknown>> {
  const raw = await loadJson(args.input);
  const synonymDb = args.synonyms ? ((await loadJson(args.synonyms)) as SynonymDatabase) : null;
  // A Labs source record is adapted (all policy applied) before validation.
  const candidate = args.from === 'labs-source' ? labsSourceToNormalized(raw as LabsSourceEvent, { synonymDb }) : raw;
  const result = validateNormalizedEvent(candidate);
  if (!result.ok) {
    throw new Error(`Invalid normalized event (${result.errors.length} errors):\n  ${result.errors.join('\n  ')}`);
  }
  const printPrices = args.printPrices ? ((await loadJson(args.printPrices)) as { prices?: Record<string, number | null> }).prices ?? null : null;
  return buildEventArtifacts(result.value, { synonymDb, rollingCanonicals: args.rolling === true, printPrices });
}

async function writeLocal(artifacts: Map<string, unknown>, outDir: string): Promise<void> {
  for (const [path, body] of artifacts) {
    const full = join(outDir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, JSON.stringify(body));
  }
  console.log(`[event-cli] Wrote ${artifacts.size} artifacts to ${outDir}`);
}

async function uploadR2(artifacts: Map<string, unknown>, prefix: string): Promise<void> {
  const accountId = requireEnv('R2_ACCOUNT_ID');
  const bucket = requireEnv('R2_BUCKET_NAME');
  const client = createR2Client({
    accountId,
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY')
  });
  const base = `reports/${prefix}`;
  for (const [path, body] of artifacts) {
    await putJson(client, bucket, `${base}/${path}`, body, { cacheControl: CACHE_CONTROL });
  }
  console.log(`[event-cli] Uploaded ${artifacts.size} artifacts to ${bucket}/${base}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

/** A legacy `decks.json` deck row, only the fields reindex/rebake need. */
interface ReindexDeck {
  archetype?: string;
  cards?: { name?: string; set?: string | null; number?: string | number | null; count?: number }[];
  madePhase2?: boolean;
  madeTopCut?: boolean;
  hasDecklist?: boolean;
}

/** The Python-profile archetype build options shared by reindex and rebake. */
const PYTHON_ARCHETYPE_PROFILE = {
  nameCasing: 'preserve',
  minDecksFraction: 0,
  percentMode: 'fraction6',
  sortMode: 'deckCountThenLabel',
  displayNames: 'trimmed',
  emptyBaseFallback: null,
  includeSignatureCards: false
} as const;

/**
 * Rebuild `cardUsage.json` and `conversion.json` from a stored `decks.json`,
 * using the current synonym database. This is the shared-builder replacement
 * for `reprocess-event-indexes.py`'s core (which re-bakes derived indexes when
 * synonyms change) — parity-verified against production. Returns the two bodies;
 * `conversion` is null when the event has no Day 2.
 * @param decks - The stored decks
 * @param synonymDb - Current synonyms (or null)
 * @returns The rebuilt indexes
 */
export function reindexFromDecks(decks: ReindexDeck[], synonymDb: SynonymDatabase | null): { cardUsage: unknown; conversion: unknown } {
  const built = buildArchetypeReports(
    decks.map(deck => ({
      cards: (deck.cards ?? []).map(c => ({ name: c.name, set: c.set ?? undefined, number: c.number ?? undefined, count: c.count })),
      archetype: deck.archetype
    })),
    synonymDb,
    PYTHON_ARCHETYPE_PROFILE
  );
  const cardUsage = buildCardUsageIndex(built.files);
  const conversion = buildConversionIndex(
    decks.map(deck => ({ cards: (deck.cards ?? []).map(c => ({ name: c.name, set: c.set ?? undefined, number: c.number ?? undefined })), madePhase2: deck.madePhase2 })),
    synonymDb
  );
  return { cardUsage, conversion };
}

/**
 * Rebake one stored event's card-facing artifacts with ROLLING canonicals: card
 * UIDs are re-resolved as of the event's date (the oldest print that was
 * standard-legal and reasonably priced THEN), so historical events key and
 * display the period-correct print. Every produced payload carries a
 * `canonicalizedAt` marker so the frontend skips read-time re-canonicalization
 * (which would rewrite the rolling print back to the current global canonical).
 *
 * Produces, relative to the event folder: `master.json`,
 * `archetypes/<base>/cards.json`, `cardUsage.json`, `conversion.json` (only
 * when the event has a Day 2), and — when slice decks exist — the
 * `slices/{phase2,topcut}/` master + archetype cards. Deliberately untouched:
 * `decks.json` (authentic raw printings), `archetypes/index.json` (thumbnails/
 * icons need the richer Python config), `cardIndex.json` (name-keyed),
 * players/matches/meta.
 * @param decks - The stored `decks.json` rows
 * @param synonymDb - The synonym DB (cluster identity + current prints)
 * @param asOfDate - The event's start date (ISO)
 * @param printPrices - Event-date prices from `assets/print-prices/{date}.json`
 * @returns Bodies keyed by path relative to the event folder
 */
export function rebakeFromDecks(
  decks: ReindexDeck[],
  synonymDb: SynonymDatabase,
  asOfDate: string,
  printPrices: Record<string, number | null> | null = null
): Map<string, unknown> {
  const resolveUid = makeRollingResolver(synonymDb, asOfDate, printPrices);
  const out = new Map<string, unknown>();

  const bundle = (subset: ReindexDeck[], prefix: string): void => {
    const deckEntries: DeckEntry[] = subset.map(deck => ({ cards: (deck.cards ?? []) as DeckEntry['cards'] }));
    const deckTotal = subset.filter(deck => deck.hasDecklist !== false).length;
    const master = generateReportFromDecks(deckEntries, deckTotal, synonymDb, { resolveUid });
    master.canonicalizedAt = asOfDate;
    out.set(`${prefix}master.json`, master);

    const built = buildArchetypeReports(
      subset.map(deck => ({
        cards: (deck.cards ?? []).map(c => ({ name: c.name, set: c.set ?? undefined, number: c.number ?? undefined, count: c.count })),
        archetype: deck.archetype
      })),
      synonymDb,
      { ...PYTHON_ARCHETYPE_PROFILE, resolveUid }
    );
    for (const file of built.files) {
      file.data.canonicalizedAt = asOfDate;
      out.set(`${prefix}archetypes/${file.base}/cards.json`, file.data);
    }
    // Slices publish no cardUsage.json in production; only the root does.
    if (prefix === '') {
      out.set(`${prefix}cardUsage.json`, { ...buildCardUsageIndex(built.files), canonicalizedAt: asOfDate });
    }
  };

  bundle(decks, '');
  for (const [name, keep] of [
    ['phase2', (deck: ReindexDeck) => deck.madePhase2 === true],
    ['topcut', (deck: ReindexDeck) => deck.madeTopCut === true]
  ] as const) {
    const sliceDecks = decks.filter(keep);
    if (sliceDecks.length > 0) {
      bundle(sliceDecks, `slices/${name}/`);
    }
  }

  const conversion = buildConversionIndex(
    decks.map(deck => ({ cards: (deck.cards ?? []).map(c => ({ name: c.name, set: c.set ?? undefined, number: c.number ?? undefined })), madePhase2: deck.madePhase2 })),
    synonymDb,
    { resolveUid }
  );
  if (conversion !== null) {
    conversion.canonicalizedAt = asOfDate;
    out.set('conversion.json', conversion);
  }
  return out;
}

const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2}),\s+/;

function extractDatePrefix(name: string): string | null {
  const m = DATE_PREFIX_RE.exec(name.trim());
  if (!m) return null;
  const candidate = m[1];
  const d = new Date(`${candidate}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === candidate ? candidate : null;
}

function stripDatePrefix(name: string): string {
  const text = name.trim();
  const m = DATE_PREFIX_RE.exec(text);
  return m ? text.slice(m[0].length).trim() : text;
}

/**
 * Rebuild the `reports/tournaments.json` catalog from event folder names:
 * dedupe by (date, display name), keeping the dated/lexicographically-smaller
 * entry; drop undated folders (online window, snapshots, trends); sort by date
 * descending then name. Ported from `rebuild_tournaments_json_from_reports`;
 * dated folders derive their date from the name, so no per-folder reads.
 * @param folders - Event folder names (without the `reports/` prefix)
 * @returns The catalog entries in canonical order
 */
export function buildTournamentCatalog(folders: string[]): string[] {
  // Dedupe by (date, lowercased display name).
  const byKey = new Map<string, string>();
  const order: string[] = [];
  for (const name of folders) {
    const dateIso = extractDatePrefix(name) ?? '';
    const key = `${dateIso}::${stripDatePrefix(name).toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, name);
      order.push(key);
    } else {
      const existingDated = extractDatePrefix(existing) !== null;
      const candidateDated = extractDatePrefix(name) !== null;
      const replace = candidateDated !== existingDated ? candidateDated : name < existing;
      if (replace) byKey.set(key, name);
    }
  }
  const deduped = order.map(key => byKey.get(key)!);
  // Keep only dated entries.
  const dated = deduped.filter(name => extractDatePrefix(name) !== null);
  // Sort by date descending, then name (case-insensitive).
  return dated.sort((a, b) => {
    const da = extractDatePrefix(a)!;
    const db = extractDatePrefix(b)!;
    if (da !== db) return da < db ? 1 : -1;
    return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
  });
}

async function runRebuildCatalog(rest: string[]): Promise<void> {
  const arg = (flag: string): string | undefined => {
    const i = rest.indexOf(flag);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const outDir = arg('--out-dir');
  if (!outDir && !rest.includes('--write')) throw new Error('rebuild-catalog needs --out-dir <dir> (dry run) or --write');

  const bucket = requireEnv('R2_BUCKET_NAME');
  const client = createR2Client({
    accountId: requireEnv('R2_ACCOUNT_ID'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY')
  });
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const folders: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'reports/', Delimiter: '/', ContinuationToken: token }));
    for (const p of page.CommonPrefixes ?? []) {
      const folder = (p.Prefix ?? '').replace(/^reports\//, '').replace(/\/$/, '');
      if (folder && folder !== 'Online - Last 14 Days') folders.push(folder);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  const catalog = buildTournamentCatalog(folders);
  if (outDir) await writeLocal(new Map([['tournaments.json', catalog]]), outDir);
  if (rest.includes('--write')) {
    await putJson(client, bucket, 'reports/tournaments.json', catalog, { cacheControl: CACHE_CONTROL });
    console.log(`[event-cli] Rebuilt reports/tournaments.json with ${catalog.length} entries`);
  }
}

interface R2Reader {
  read: <T>(key: string) => Promise<T | null>;
  client: ReturnType<typeof createR2Client>;
  bucket: string;
}

function makeR2Reader(): R2Reader {
  const bucket = requireEnv('R2_BUCKET_NAME');
  const client = createR2Client({
    accountId: requireEnv('R2_ACCOUNT_ID'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY')
  });
  const read = async <T>(key: string): Promise<T | null> => {
    const result = await getJsonResult<T>(client, bucket, key);
    if (result.status === 'found') return result.value;
    if (result.status === 'missing') return null;
    throw new Error(`failed to read ${key}: ${result.status}`);
  };
  return { read, client, bucket };
}

/** The `assets/print-prices/{date}.json` backfill artifact. */
interface PrintPricesArtifact {
  prices?: Record<string, number | null>;
}

/**
 * Load event-date print prices from the TCGCSV backfill artifact. A verified
 * missing artifact degrades to null (the resolver falls back to the synonym
 * DB's current prints); transport failures still throw.
 */
async function loadPrintPrices(r2: R2Reader, asOfDate: string): Promise<Record<string, number | null> | null> {
  const artifact = await r2.read<PrintPricesArtifact>(`assets/print-prices/${asOfDate}.json`);
  if (!artifact?.prices) {
    console.log(`[event-cli] No print-prices artifact for ${asOfDate}; using current prints as the price signal`);
    return null;
  }
  return artifact.prices;
}

/** Derive the event date from a `reports/<date, Name>` prefix or folder name. */
function eventDateFromPrefix(prefix: string): string | null {
  return extractDatePrefix(prefix.replace(/^reports\//, ''));
}

async function runReindex(rest: string[]): Promise<void> {
  const arg = (flag: string): string | undefined => {
    const i = rest.indexOf(flag);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const r2Prefix = arg('--r2-prefix');
  const outDir = arg('--out-dir');
  const synonymsPath = arg('--synonyms');
  const rolling = rest.includes('--rolling');
  const printPricesPath = arg('--print-prices');
  if (!r2Prefix) throw new Error('reindex needs --r2-prefix "reports/<date, Name>"');
  if (!outDir && !rest.includes('--write')) throw new Error('reindex needs --out-dir <dir> (dry run) or --write (upload to R2)');

  const r2 = makeR2Reader();
  const decks = await r2.read<ReindexDeck[]>(`${r2Prefix}/decks.json`);
  if (!decks) throw new Error(`${r2Prefix}/decks.json not found`);
  const synonymDb = synonymsPath ? ((await loadJson(synonymsPath)) as SynonymDatabase) : await r2.read<SynonymDatabase>('assets/card-synonyms.json');

  let bodies: Map<string, unknown>;
  if (rolling) {
    if (!synonymDb) throw new Error('reindex --rolling requires a synonym database');
    const asOfDate = eventDateFromPrefix(r2Prefix);
    if (!asOfDate) throw new Error(`reindex --rolling: cannot derive the event date from "${r2Prefix}"`);
    const printPrices = printPricesPath
      ? ((await loadJson(printPricesPath)) as PrintPricesArtifact).prices ?? null
      : await loadPrintPrices(r2, asOfDate);
    bodies = rebakeFromDecks(decks, synonymDb, asOfDate, printPrices);
  } else {
    const { cardUsage, conversion } = reindexFromDecks(decks, synonymDb);
    bodies = new Map<string, unknown>([['cardUsage.json', cardUsage]]);
    if (conversion !== null) bodies.set('conversion.json', conversion);
  }

  if (outDir) {
    await writeLocal(bodies, outDir);
  }
  if (rest.includes('--write')) {
    for (const [path, body] of bodies) {
      await putJson(r2.client, r2.bucket, `${r2Prefix}/${path}`, body, { cacheControl: CACHE_CONTROL });
    }
    console.log(`[event-cli] ${rolling ? 'Rebaked' : 'Reindexed'} ${bodies.size} artifact(s) for ${r2Prefix}`);
  }
}

/**
 * Rebake every cataloged event with rolling canonicals (the reprocess
 * workflow's engine). Reads `reports/tournaments.json`, and per dated event:
 * loads `decks.json`, the synonym DB, and that date's print-prices artifact,
 * then rebuilds the card-facing artifacts via {@link rebakeFromDecks}.
 * `--dry-run` logs per-event artifact counts and how many cardUsage keys would
 * move, without uploading.
 */
async function runReindexAll(rest: string[]): Promise<void> {
  const arg = (flag: string): string | undefined => {
    const i = rest.indexOf(flag);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const dryRun = rest.includes('--dry-run');
  const only = arg('--only');
  const limitRaw = arg('--limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : Number.POSITIVE_INFINITY;
  if (limitRaw && !Number.isFinite(limit)) throw new Error(`--limit must be a number, got "${limitRaw}"`);

  const r2 = makeR2Reader();
  const catalog = await r2.read<(string | { folder?: string; name?: string; path?: string })[]>('reports/tournaments.json');
  if (!catalog) throw new Error('reports/tournaments.json not found');
  const synonymDb = await r2.read<SynonymDatabase>('assets/card-synonyms.json');
  if (!synonymDb) throw new Error('assets/card-synonyms.json not found');

  const folders = catalog
    .map(entry => (typeof entry === 'string' ? entry : entry.folder || entry.name || entry.path || ''))
    .filter(Boolean)
    .filter(folder => !only || folder === only);

  const pricesByDate = new Map<string, Record<string, number | null> | null>();
  let processed = 0;
  let skipped = 0;
  for (const folder of folders) {
    if (processed >= limit) break;
    const asOfDate = extractDatePrefix(folder);
    if (!asOfDate) {
      console.log(`[event-cli] Skipping undated folder "${folder}"`);
      skipped++;
      continue;
    }
    const prefix = `reports/${folder}`;
    const decks = await r2.read<ReindexDeck[]>(`${prefix}/decks.json`);
    if (!decks || decks.length === 0) {
      console.log(`[event-cli] Skipping ${folder}: no decks.json`);
      skipped++;
      continue;
    }
    if (!pricesByDate.has(asOfDate)) {
      pricesByDate.set(asOfDate, await loadPrintPrices(r2, asOfDate));
    }
    const bodies = rebakeFromDecks(decks, synonymDb, asOfDate, pricesByDate.get(asOfDate) ?? null);

    if (dryRun) {
      const existingUsage = await r2.read<{ usage?: Record<string, unknown> }>(`${prefix}/cardUsage.json`);
      const nextUsage = bodies.get('cardUsage.json') as { usage: Record<string, unknown> };
      const oldKeys = new Set(Object.keys(existingUsage?.usage ?? {}));
      const movedKeys = Object.keys(nextUsage.usage).filter(key => !oldKeys.has(key)).length;
      console.log(
        `[event-cli] DRY RUN ${folder} (${asOfDate}): ${bodies.size} artifact(s), ${movedKeys}/${Object.keys(nextUsage.usage).length} cardUsage keys move`
      );
    } else {
      for (const [path, body] of bodies) {
        await putJson(r2.client, r2.bucket, `${prefix}/${path}`, body, { cacheControl: CACHE_CONTROL });
      }
      console.log(`[event-cli] Rebaked ${folder} (${asOfDate}): ${bodies.size} artifact(s)`);
    }
    processed++;
  }
  console.log(`[event-cli] reindex-all complete: ${processed} event(s) ${dryRun ? 'analyzed' : 'rebaked'}, ${skipped} skipped`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'build') {
    const args = parseArgs(rest);
    const artifacts = await buildFromFile(args);
    if (args.outDir) await writeLocal(artifacts, args.outDir);
    if (args.r2Prefix) await uploadR2(artifacts, args.r2Prefix);
    return;
  }
  if (command === 'reindex') {
    await runReindex(rest);
    return;
  }
  if (command === 'reindex-all') {
    await runReindexAll(rest);
    return;
  }
  if (command === 'rebuild-catalog') {
    await runRebuildCatalog(rest);
    return;
  }
  throw new Error(`Unknown command "${command ?? ''}". Supported: build, reindex, reindex-all, rebuild-catalog`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[event-cli]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
