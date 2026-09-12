/**
 * Event build CLI.
 *
 * Turns a validated NORMALIZED event record into the full set of serving
 * artifacts (via {@link buildEventArtifacts}) and writes them to a local
 * directory, or publishes a Labs source directly to an immutable event root. This is the
 * TypeScript event builder the plan calls for: the Python Labs adapter emits
 * normalized records, and this CLI — the one home for artifact generation —
 * consumes them.
 *
 * Usage:
 *   tsx event-cli.ts build --input <normalized.json> --out-dir <dir>
 *   tsx event-cli.ts publish-source --input <labs-source.json>
 *
 * R2 mode needs R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY /
 * R2_BUCKET_NAME in the environment.
 * @module .github/scripts/event-cli
 */

import { requireEnv } from './lib/env.ts';
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
import { createR2Client, getJsonResult } from './lib/r2.mjs';
import { canonicalStringify } from '../../shared/data/canonicalJson.ts';
import { sha256HexString } from '../../shared/data/hash.ts';
import { type ConditionalPointerStore, updatePointer } from '../../shared/data/build/channel.ts';
import { createR2ObjectStore } from './lib/build/r2ObjectStore.mjs';

interface BuildArgs {
  input: string;
  /** 'normalized' (default) or 'labs-source' (run the adapter first). */
  from?: 'normalized' | 'labs-source';
  outDir?: string;
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
    if (flag === '--input') {
      args.input = value;
    } else if (flag === '--out-dir') {
      args.outDir = value;
    } else if (flag === '--synonyms') {
      args.synonyms = value;
    } else if (flag === '--print-prices') {
      args.printPrices = value;
    } else if (flag === '--from') {
      if (value !== 'normalized' && value !== 'labs-source') {
        throw new Error(`--from must be normalized|labs-source, got "${value}"`);
      }
      args.from = value;
    } else {
      throw new Error(`Unknown flag: ${flag}`);
    }
  }
  if (!args.input) {
    throw new Error('Missing --input <event.json>');
  }
  if (!args.outDir) {
    throw new Error('Provide --out-dir <dir>');
  }
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
  const printPrices = args.printPrices
    ? (((await loadJson(args.printPrices)) as { prices?: Record<string, number | null> }).prices ?? null)
    : null;
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

interface ImmutableEventStore extends ConditionalPointerStore<{ events?: Record<string, string>; updatedAt?: string }> {
  get(key: string): Promise<string | null>;
  putIfAbsent(key: string, body: string): Promise<void>;
}

function eventFolder(source: LabsSourceEvent): string {
  const date = String(source.meta?.date ?? '').trim();
  const name = String(source.meta?.name ?? '')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) {
    throw new Error('Labs source needs a valid event date and name');
  }
  return `${date}, ${name}`;
}

async function putImmutable(store: ImmutableEventStore, key: string, body: string): Promise<void> {
  const existing = await store.get(key);
  if (existing !== null) {
    try {
      if (canonicalStringify(JSON.parse(existing) as unknown) === body) {
        return;
      }
    } catch {
      // A corrupt body at an immutable key is a conflict, never an overwrite.
    }
    throw new Error(`Immutable event object has conflicting content: ${key}`);
  }
  await store.putIfAbsent(key, body);
}

export async function publishEventArtifacts(
  store: ImmutableEventStore,
  folder: string,
  artifacts: Map<string, unknown>,
  now = new Date().toISOString()
): Promise<string> {
  const entries = [...artifacts.entries()].sort(([a], [b]) => a.localeCompare(b));
  const generation = sha256HexString(canonicalStringify(entries)).slice(0, 12);
  const root = `releases/v1/events/${folder}/${generation}`;
  await Promise.all(entries.map(([path, body]) => putImmutable(store, `${root}/${path}`, canonicalStringify(body))));
  await putImmutable(store, `${root}/_complete.json`, canonicalStringify({ generation, objectCount: artifacts.size }));
  await updatePointer(store, 'pending-events.json', current => ({
    events: { ...(current?.events ?? {}), [folder]: `/${root}` },
    updatedAt: now
  }));
  return `/${root}`;
}

async function publishSource(input: string): Promise<void> {
  const source = (await loadJson(input)) as LabsSourceEvent;
  const accountId = requireEnv('R2_ACCOUNT_ID');
  const bucket = requireEnv('R2_BUCKET_NAME');
  const client = createR2Client({
    accountId,
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY')
  });
  const read = async <T>(key: string): Promise<T | null> => {
    const result = await getJsonResult<T>(client, bucket, key);
    if (result.status === 'found') {
      return result.value;
    }
    if (result.status === 'missing') {
      return null;
    }
    throw new Error(`Cannot read event dependency ${key}: ${result.status}`, { cause: result.error });
  };
  const synonymDb = await read<SynonymDatabase>('assets/card-synonyms.json');
  const candidate = labsSourceToNormalized(source, { synonymDb });
  const validated = validateNormalizedEvent(candidate);
  if (!validated.ok) {
    throw new Error(
      `Invalid normalized event (${validated.errors.length} errors):\n  ${validated.errors.join('\n  ')}`
    );
  }
  const { date } = source.meta;
  const printPrices = await read<{ prices?: Record<string, number | null> }>(`assets/print-prices/${date}.json`);
  const artifacts = buildEventArtifacts(validated.value, {
    synonymDb,
    rollingCanonicals: true,
    printPrices: printPrices?.prices ?? null
  });
  const root = await publishEventArtifacts(
    createR2ObjectStore<{ events?: Record<string, string>; updatedAt?: string }>(client, bucket),
    eventFolder(source),
    artifacts
  );
  console.log(`[event-cli] Published immutable event ${root}`);
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
export function reindexFromDecks(
  decks: ReindexDeck[],
  synonymDb: SynonymDatabase | null
): { cardUsage: unknown; conversion: unknown } {
  const built = buildArchetypeReports(
    decks.map(deck => ({
      cards: (deck.cards ?? []).map(c => ({
        name: c.name,
        set: c.set ?? undefined,
        number: c.number ?? undefined,
        count: c.count
      })),
      archetype: deck.archetype
    })),
    synonymDb,
    PYTHON_ARCHETYPE_PROFILE
  );
  const cardUsage = buildCardUsageIndex(built.files);
  const conversion = buildConversionIndex(
    decks.map(deck => ({
      cards: (deck.cards ?? []).map(c => ({ name: c.name, set: c.set ?? undefined, number: c.number ?? undefined })),
      madePhase2: deck.madePhase2
    })),
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
        cards: (deck.cards ?? []).map(c => ({
          name: c.name,
          set: c.set ?? undefined,
          number: c.number ?? undefined,
          count: c.count
        })),
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
    decks.map(deck => ({
      cards: (deck.cards ?? []).map(c => ({ name: c.name, set: c.set ?? undefined, number: c.number ?? undefined })),
      madePhase2: deck.madePhase2
    })),
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
  if (!m) {
    return null;
  }
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
      if (replace) {
        byKey.set(key, name);
      }
    }
  }
  const deduped = order.map(key => byKey.get(key)!);
  // Keep only dated entries.
  const dated = deduped.filter(name => extractDatePrefix(name) !== null);
  // Sort by date descending, then name (case-insensitive).
  return dated.sort((a, b) => {
    const da = extractDatePrefix(a)!;
    const db = extractDatePrefix(b)!;
    if (da !== db) {
      return da < db ? 1 : -1;
    }
    return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
  });
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'build') {
    const args = parseArgs(rest);
    const artifacts = await buildFromFile(args);
    if (args.outDir) {
      await writeLocal(artifacts, args.outDir);
    }
    return;
  }
  if (command === 'publish-source') {
    if (rest.length !== 2 || rest[0] !== '--input' || !rest[1]) {
      throw new Error('Usage: publish-source --input <labs-source.json>');
    }
    await publishSource(rest[1]);
    return;
  }
  throw new Error(`Unknown command "${command ?? ''}". Supported: build, publish-source`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[event-cli]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
