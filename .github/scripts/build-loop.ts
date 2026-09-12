/**
 * Full-scope build loop → complete immutable release (DB-MASTER-PLAN Phase 6).
 *
 * Assembles a COMPLETE release across every scope:
 *  - events / catalogs: built fresh through the consolidated shared builders;
 *  - online / trends / players / prices / snapshots / assets: captured in full
 *    from the serialized producer tree. A scope is complete or is not published.
 *
 * Publishes to immutable `releases/v1/…` keys, emits `roots.json` + folder-keyed
 * `events.json` for {@link ../scripts/publish-release}, composes + validates the
 * manifest, and never touches `reports/` or the production channel. DRY RUN by
 * default; `--write` publishes. Retention runs through prune-releases.ts.
 *
 * Usage: tsx build-loop.ts [--write] [--limit N] [--allow-shrink] [--emit-roots roots.json] [--emit-events events.json]
 * @module .github/scripts/build-loop
 */

import { requireEnv } from './lib/env.ts';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { CopyObjectCommand, HeadObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { composeRelease, type ReleaseScope } from '../../shared/data/build/release.ts';
import { canonicalStringify } from '../../shared/data/canonicalJson.ts';
import { sha256HexString } from '../../shared/data/hash.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';
import { labsSourceToNormalized } from '../../shared/data/adapters/labsSource.ts';
import { buildEventArtifacts } from '../../shared/data/reports/eventArtifacts.ts';
import { buildTournamentCatalog, listReportFolders } from './event-cli.ts';
import { createR2Client, getJsonResult, putJson, withR2Retry } from './lib/r2.mjs';

const CACHE = 'public, max-age=31536000, immutable';

interface ScopeObject {
  sourceKey: string;
  relativeKey: string;
  etag: string;
  size: number;
}

async function listJsonObjects(options: {
  client: S3Client;
  bucket: string;
  prefix: string;
  relativeTo: string;
  include?: (key: string) => boolean;
}): Promise<ScopeObject[]> {
  const { client, bucket, prefix, relativeTo, include = () => true } = options;
  const objects: ScopeObject[] = [];
  let continuationToken: string | undefined;
  do {
    const token = continuationToken;
    const page = await withR2Retry(() =>
      client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }))
    );
    for (const object of page.Contents ?? []) {
      const key = object.Key;
      if (key?.endsWith('.json') && object.ETag && include(key)) {
        objects.push({
          sourceKey: key,
          relativeKey: key.slice(relativeTo.length),
          etag: object.ETag,
          size: object.Size ?? 0
        });
      }
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects.sort((a, b) => a.relativeKey.localeCompare(b.relativeKey));
}

async function describeObject(
  client: S3Client,
  bucket: string,
  sourceKey: string,
  relativeKey: string
): Promise<ScopeObject | null> {
  try {
    const object = await withR2Retry(() => client.send(new HeadObjectCommand({ Bucket: bucket, Key: sourceKey })));
    return object.ETag ? { sourceKey, relativeKey, etag: object.ETag, size: object.ContentLength ?? 0 } : null;
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

async function runConcurrent<T>(items: readonly T[], worker: (item: T) => Promise<void>, limit = 24): Promise<void> {
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
}

function encodedCopySource(bucket: string, key: string): string {
  return `${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function captureScope(options: {
  client: S3Client;
  bucket: string;
  scope: ReleaseScope;
  objects: ScopeObject[];
  write: boolean;
  written: string[];
  gen: (value: unknown) => string;
}): Promise<string> {
  const { client, bucket, scope, objects, write, written, gen } = options;
  const generation = gen(objects.map(({ relativeKey, etag, size }) => ({ relativeKey, etag, size })));
  const root = `releases/v1/${scope}/${generation}`;
  const markerKey = `${root}/_complete.json`;
  if (!write) {
    return `/${root}`;
  }
  const marker = await getJsonResult(client, bucket, markerKey);
  if (marker.status === 'found') {
    return `/${root}`;
  }
  if (marker.status !== 'missing') {
    throw new Error(`Cannot verify ${markerKey}: ${marker.status}`);
  }
  await runConcurrent(objects, async object => {
    const target = `${root}/${object.relativeKey}`;
    await withR2Retry(() =>
      client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: target,
          CopySource: encodedCopySource(bucket, object.sourceKey),
          MetadataDirective: 'REPLACE',
          ContentType: 'application/json',
          CacheControl: CACHE
        })
      )
    );
    written.push(target);
  });
  await putJson(client, bucket, markerKey, { generation, objectCount: objects.length }, { cacheControl: CACHE });
  written.push(markerKey);
  return `/${root}`;
}

/**
 * Fail the build when a release would publish FEWER events than the one
 * currently served. A truncated `reports/` listing (the un-paginated
 * ListObjectsV2 bug) dropped six months of events while every run still
 * reported success, so a shrinking event set is treated as a build error
 * rather than a silent regression. Legitimate removals pass `--allow-shrink`.
 * @param folders - Event folders this build is about to publish
 * @param load - JSON reader for the bucket
 * @throws When events present in the served release are absent from this build
 */
export async function assertNoEventRegression(
  folders: string[],
  load: <T>(key: string) => Promise<T | null>
): Promise<void> {
  const pointer: { releaseId?: string; manifest?: string } | null =
    (await load<{ releaseId?: string; manifest?: string }>('current.json')) ??
    (await load<{ releaseId?: string; manifest?: string }>('build/v1/channels/production.json'));
  if (!pointer?.releaseId) {
    console.log('[build-loop] no production release to compare against — skipping regression guard');
    return;
  }
  const manifestKey = pointer.manifest?.replace(/^\/+/, '') ?? `build/v1/releases/${pointer.releaseId}.json`;
  const served = await load<{ events?: Record<string, string> }>(manifestKey);
  const previous = Object.keys(served?.events ?? {});
  const current = new Set(folders);
  const missing = previous.filter(folder => !current.has(folder));
  if (missing.length > 0) {
    throw new Error(
      `event regression: ${missing.length} event(s) in release ${pointer.releaseId} are missing from this build ` +
        `(${missing.slice(0, 5).join('; ')}${missing.length > 5 ? '; …' : ''}). ` +
        'Pass --allow-shrink if the removal is intentional.'
    );
  }
  console.log(`[build-loop] regression guard: ${previous.length} served event(s) all present`);
}

type EventBody = Record<string, unknown>;

/** The decision to capture an event folder, carrying the narrowed bodies. */
export type EventCapturePlan =
  { capture: true; decks: EventBody[]; players: EventBody[]; meta: EventBody } | { capture: false; reason: string };

/**
 * Decide whether an event folder may be captured into an immutable release.
 *
 * Beyond the obvious missing-file case, an event with ZERO decks is a
 * not-yet-published event rather than a real one: Labs posts standings as soon
 * as an event starts and the decklists hours or days later. Capturing that
 * window freezes `{"deckTotal":0}` into an immutable release body. Skipping it
 * keeps the incomplete event out of both the release catalog and event map.
 * @param bodies - The folder's loaded decks/players/meta bodies (null when absent)
 * @returns The capture decision, with a human-readable reason when declining
 */
export function planEventCapture(bodies: {
  decks: EventBody[] | null;
  players: EventBody[] | null;
  meta: EventBody | null;
}): EventCapturePlan {
  const { decks, players, meta } = bodies;
  if (!decks || !players || !meta) {
    const absent = [!decks && 'decks.json', !players && 'players.json', !meta && 'meta.json'].filter(Boolean);
    return { capture: false, reason: `missing ${absent.join(', ')}` };
  }
  if (decks.length === 0) {
    return { capture: false, reason: '0 decks (decklists not published yet)' };
  }
  return { capture: true, decks, players, meta };
}

interface BuildContext {
  load: <T>(key: string) => Promise<T | null>;
  publish: (key: string, body: unknown) => Promise<void>;
  gen: (value: unknown) => string;
  synonyms: SynonymDatabase | null;
}

export async function buildEvent(folder: string, context: BuildContext): Promise<string | null> {
  const base = `reports/${folder}`;
  const [decks, players, matches, meta] = await Promise.all([
    context.load<Record<string, unknown>[]>(`${base}/decks.json`),
    context.load<Record<string, unknown>[]>(`${base}/players.json`),
    context.load<Record<string, unknown>[]>(`${base}/matches.json`),
    context.load<Record<string, unknown>>(`${base}/meta.json`)
  ]);
  const plan = planEventCapture({ decks, players, meta });
  if (!plan.capture) {
    console.log(`[build-loop] skipping ${folder}: ${plan.reason}`);
    return null;
  }
  const archByTp = new Map<string, string>();
  const cardsByTp: Record<string, unknown[]> = {};
  for (const deck of plan.decks) {
    if (deck.playerId === undefined) {
      continue;
    }
    if (deck.archetype) {
      archByTp.set(String(deck.playerId), String(deck.archetype));
    }
    if (Array.isArray(deck.cards)) {
      cardsByTp[String(deck.playerId)] = deck.cards;
    }
  }
  const source = {
    labsCode: folder.replace(/[^a-z0-9]/gi, '').slice(-8),
    fetchedAt: '1970-01-01T00:00:00Z',
    meta: {
      name: String(plan.meta.name),
      date: String(plan.meta.startDate ?? plan.meta.date),
      players: plan.meta.players as number,
      division: (plan.meta.division as string) ?? null,
      country: (plan.meta.country as string) ?? null
    },
    standings: plan.players.map(player => ({
      tpId: player.tpId as number,
      playerId: (player.playerId as string) ?? null,
      name: String(player.name),
      country: (player.country as string) ?? null,
      placement: (player.placement as number) ?? null,
      wins: player.wins as number,
      losses: player.losses as number,
      ties: player.ties as number,
      points: (player.points as number) ?? null,
      opw: (player.opw as number) ?? null,
      oopw: (player.oopw as number) ?? null,
      madePhase2: Boolean(player.madePhase2),
      madeTopCut: Boolean(player.madeTopCut),
      decklistPublished: Boolean(player.decklistPublished),
      deckName: archByTp.get(String(player.tpId)) ?? null
    })),
    decklists: cardsByTp as never,
    matches: (matches ?? []).map(match => ({
      round: match.round as number,
      phase: (match.phase as number) ?? null,
      table: (match.table as number) ?? null,
      completed: Boolean(match.completed),
      p1Id: match.player1Id as number,
      p2Id: (match.player2Id as number) ?? null,
      winner: (match.winnerCode as number) ?? null
    }))
  };
  const artifacts = buildEventArtifacts(labsSourceToNormalized(source, { synonymDb: context.synonyms }), {
    synonymDb: context.synonyms
  });
  const generation = context.gen([...artifacts.entries()].sort());
  const root = `releases/v1/events/${folder}/${generation}`;
  const complete = await context.load<{ generation?: string; objectCount?: number }>(`${root}/_complete.json`);
  if (!eventNeedsPublication(complete, generation, artifacts.size)) {
    return `/${root}`;
  }
  await Promise.all([...artifacts].map(([path, body]) => context.publish(`${root}/${path}`, body)));
  await context.publish(`${root}/_complete.json`, { generation, objectCount: artifacts.size });
  return `/${root}`;
}

export function eventNeedsPublication(
  marker: { generation?: string; objectCount?: number } | null,
  generation: string,
  objectCount: number
): boolean {
  if (!marker) {
    return true;
  }
  if (marker.generation !== generation || marker.objectCount !== objectCount) {
    throw new Error(`Invalid completion marker for event generation ${generation}`);
  }
  return false;
}

async function buildEvents(folders: string[], context: BuildContext): Promise<Record<string, string>> {
  const events: Record<string, string> = {};
  for (const folder of folders) {
    const root = await buildEvent(folder, context);
    if (root) {
      events[folder] = root;
    }
  }
  return events;
}

async function discoverCapturedScopes(
  client: S3Client,
  bucket: string
): Promise<
  Array<{
    scope: ReleaseScope;
    objects: ScopeObject[];
  }>
> {
  const list = (prefix: string, relativeTo: string, include?: (key: string) => boolean) =>
    listJsonObjects({ client, bucket, prefix, relativeTo, include });
  const [online, trends, players, snapshots, assets, priceShards, priceGlobals, majors] = await Promise.all([
    list('reports/Online - Last 14 Days/', 'reports/Online - Last 14 Days/'),
    list('reports/Trends - Last 30 Days/', 'reports/Trends - Last 30 Days/'),
    list('players/', 'players/', key => key !== 'players/_manifest.json'),
    list('reports/Snapshots/', 'reports/Snapshots/'),
    list('assets/', 'assets/', key => !key.startsWith('assets/print-prices/')),
    list('reports/price-history/', 'reports/'),
    Promise.all(
      ['prices.json', 'prices-history.json', 'price-movers.json'].map(relativeKey =>
        describeObject(client, bucket, `reports/${relativeKey}`, relativeKey)
      )
    ),
    describeObject(client, bucket, 'reports/majors-trends.json', 'majors-trends.json')
  ]);
  if (majors) {
    trends.push(majors);
  }
  return [
    { scope: 'online', objects: online },
    { scope: 'trends', objects: trends },
    { scope: 'players', objects: players },
    {
      scope: 'prices',
      objects: [...priceGlobals.filter((item): item is ScopeObject => item !== null), ...priceShards]
    },
    { scope: 'snapshots', objects: snapshots },
    { scope: 'assets', objects: assets }
  ];
}

function assertRequiredArtifacts(captures: Array<{ scope: ReleaseScope; objects: ScopeObject[] }>): void {
  const required: Partial<Record<ReleaseScope, string[]>> = {
    online: ['master.json', 'meta.json', 'decks.json', 'cardUsage.json', 'archetypes/index.json'],
    trends: ['trends.json', 'meta.json', 'majors-trends.json'],
    players: ['index.json', 'index-slim.json'],
    prices: ['prices.json'],
    assets: ['card-synonyms.json', 'data/card-types.json']
  };
  for (const { scope, objects } of captures) {
    const present = new Set(objects.map(object => object.relativeKey));
    const missing = (required[scope] ?? []).filter(path => !present.has(path));
    if (missing.length) {
      throw new Error(`${scope} scope is incomplete: missing ${missing.join(', ')}`);
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  if (argv.includes('--gc')) {
    throw new Error('--gc is unsafe for shared release roots; use prune-releases.ts');
  }
  const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;
  const arg = (f: string): string | undefined => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : undefined);

  const bucket = requireEnv('R2_BUCKET_NAME');
  const client = createR2Client({
    accountId: requireEnv('R2_ACCOUNT_ID'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY')
  });
  const written: string[] = [];
  const load = async <T>(key: string): Promise<T | null> => {
    const r = await getJsonResult<T>(client, bucket, key);
    if (r.status !== 'found' && r.status !== 'missing') {
      throw new Error(`Cannot read release input ${key}: ${r.status}`);
    }
    return r.status === 'found' ? r.value : null;
  };
  const publish = async (key: string, body: unknown): Promise<void> => {
    if (write) {
      await putJson(client, bucket, key, body, { cacheControl: CACHE });
      written.push(key);
    }
  };
  const gen = (obj: unknown): string => sha256HexString(canonicalStringify(obj)).slice(0, 12);

  const synonyms = await load<SynonymDatabase>('assets/card-synonyms.json');
  // ---- Discover scopes ----
  const allFolders = await listReportFolders(client, bucket);
  const eventFolders = allFolders.filter(f => /^\d{4}-\d{2}-\d{2},/.test(f)).slice(0, limit);
  if (!argv.includes('--allow-shrink') && limit === Infinity) {
    await assertNoEventRegression(eventFolders, load);
  }

  const roots: Partial<Record<ReleaseScope, string>> = {};
  const events = await buildEvents(eventFolders, { load, publish, gen, synonyms });
  if (!argv.includes('--allow-shrink') && limit === Infinity) {
    await assertNoEventRegression(Object.keys(events), load);
  }

  // ---- Catalog (fresh) ----
  const catalog = buildTournamentCatalog(Object.keys(events));
  const catalogRoot = `releases/v1/catalogs/${gen(catalog)}`;
  await publish(`${catalogRoot}/tournaments.json`, catalog);
  await publish(`${catalogRoot}/_complete.json`, { objectCount: 1 });
  roots.catalogs = `/${catalogRoot}`;

  // ---- Complete captured scopes ----
  const captures = await discoverCapturedScopes(client, bucket);
  assertRequiredArtifacts(captures);
  for (const capture of captures) {
    roots[capture.scope] = await captureScope({ client, bucket, ...capture, write, written, gen });
  }

  // ---- Compose + validate manifest ----
  const releaseId = `release-${gen({ roots, events })}`;
  const manifest = composeRelease({
    releaseId,
    publishedAt: '1970-01-01T00:00:00Z',
    roots: roots as Record<ReleaseScope, string>,
    events
  });

  if (arg('--emit-roots')) {
    await writeFile(arg('--emit-roots')!, JSON.stringify(roots, null, 2));
  }
  if (arg('--emit-events')) {
    await writeFile(arg('--emit-events')!, JSON.stringify(events, null, 2));
  }

  console.log('[build-loop] ===== SUMMARY =====');
  console.log(`  events built    : ${Object.keys(events).length}`);
  console.log(`  scope roots     : ${Object.keys(roots).length}/7 ${Object.keys(roots).sort().join(', ')}`);
  console.log('  capture mode    : complete');
  console.log(`  manifest        : ${manifest.releaseId} (valid)`);
  console.log(write ? `  objects written : ${written.length}` : '  DRY RUN — nothing written (pass --write)');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[build-loop]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
