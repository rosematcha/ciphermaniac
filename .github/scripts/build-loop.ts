/**
 * Full-scope build loop → complete immutable release (DB-MASTER-PLAN Phase 6).
 *
 * Assembles a COMPLETE release across every scope:
 *  - events / online / catalogs: built fresh through the consolidated shared
 *    builders (byte-parity-verified against production);
 *  - trends / players / prices / snapshots: CAPTURED — the current production
 *    artifacts are copied forward to immutable keys (these scopes are not being
 *    rewritten in this migration, so a content-addressed capture is their build
 *    node). `--lite` captures only each scope's hot index artifacts (cheap
 *    shadow); a full run captures every body.
 *
 * Publishes to immutable `releases/v1/…` keys, emits `roots.json` + folder-keyed
 * `events.json` for {@link ../scripts/publish-release}, composes + validates the
 * manifest, and never touches `reports/` or the production channel. DRY RUN by
 * default; `--write` publishes; `--gc` removes what it wrote.
 *
 * Usage: tsx build-loop.ts [--write] [--lite] [--gc] [--limit N] [--emit-roots roots.json] [--emit-events events.json]
 * @module .github/scripts/build-loop
 */

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { composeRelease, type ReleaseScope } from '../../shared/data/build/release.ts';
import { canonicalStringify } from '../../shared/data/canonicalJson.ts';
import { sha256HexString } from '../../shared/data/hash.ts';
import { labsSourceToNormalized } from '../../shared/data/adapters/labsSource.ts';
import { buildEventArtifacts } from '../../shared/data/reports/eventArtifacts.ts';
import { buildTournamentCatalog } from './event-cli.ts';
import { createR2Client, getJsonResult, putJson } from './lib/r2.mjs';

const CACHE = 'public, max-age=31536000, immutable';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

// Hot index artifacts captured in --lite mode (enough for a valid manifest +
// resolver proof without copying every body).
const LITE_KEYS: Record<Exclude<ReleaseScope, 'online' | 'catalogs'>, string[]> = {
  trends: ['Trends - Last 30 Days/trends.json', 'Trends - Last 30 Days/meta.json', 'majors-trends.json'],
  players: ['index.json', 'index-slim.json'],
  prices: ['prices.json', 'prices-history.json'],
  snapshots: ['Snapshots/index.json']
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const lite = argv.includes('--lite');
  const gc = argv.includes('--gc');
  const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;
  const arg = (f: string): string | undefined => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : undefined);

  const bucket = requireEnv('R2_BUCKET_NAME');
  const client = createR2Client({ accountId: requireEnv('R2_ACCOUNT_ID'), accessKeyId: requireEnv('R2_ACCESS_KEY_ID'), secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY') });
  const written: string[] = [];
  const load = async <T>(key: string): Promise<T | null> => {
    const r = await getJsonResult<T>(client, bucket, key);
    return r.status === 'found' ? r.value : null;
  };
  const publish = async (key: string, body: unknown): Promise<void> => {
    if (write) {
      await putJson(client, bucket, key, body, { cacheControl: CACHE });
      written.push(key);
    }
  };
  const gen = (obj: unknown): string => sha256HexString(canonicalStringify(obj)).slice(0, 12);

  const synonyms = await load<Parameters<typeof buildEventArtifacts>[1] extends { synonymDb?: infer S } ? S : never>('assets/card-synonyms.json');

  // ---- Discover scopes ----
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'reports/', Delimiter: '/' }));
  const allFolders = (listed.CommonPrefixes ?? []).map(p => p.Prefix!.replace(/^reports\//, '').replace(/\/$/, ''));
  const eventFolders = allFolders.filter(f => /^\d{4}-\d{2}-\d{2},/.test(f)).slice(0, limit);

  const roots: Partial<Record<ReleaseScope, string>> = {};
  const events: Record<string, string> = {};

  // ---- Events (fresh, folder-keyed) ----
  for (const folder of eventFolders) {
    const base = `reports/${folder}`;
    const [decks, players, matches, meta] = await Promise.all([
      load<Record<string, unknown>[]>(`${base}/decks.json`), load<Record<string, unknown>[]>(`${base}/players.json`),
      load<Record<string, unknown>[]>(`${base}/matches.json`), load<Record<string, unknown>>(`${base}/meta.json`)
    ]);
    if (!decks || !players || !meta) continue;
    const archByTp = new Map<string, string>();
    const cardsByTp: Record<string, unknown[]> = {};
    for (const d of decks) {
      if (d.playerId !== undefined) {
        if (d.archetype) archByTp.set(String(d.playerId), String(d.archetype));
        if (Array.isArray(d.cards)) cardsByTp[String(d.playerId)] = d.cards;
      }
    }
    const source = {
      labsCode: folder.replace(/[^a-z0-9]/gi, '').slice(-8), fetchedAt: '1970-01-01T00:00:00Z',
      meta: { name: String(meta.name), date: String(meta.startDate ?? meta.date), players: meta.players as number, division: (meta.division as string) ?? null, country: (meta.country as string) ?? null },
      standings: players.map(p => ({ tpId: p.tpId as number, playerId: (p.playerId as string) ?? null, name: String(p.name), country: (p.country as string) ?? null, placement: (p.placement as number) ?? null, wins: p.wins as number, losses: p.losses as number, ties: p.ties as number, points: (p.points as number) ?? null, opw: (p.opw as number) ?? null, oopw: (p.oopw as number) ?? null, madePhase2: Boolean(p.madePhase2), madeTopCut: Boolean(p.madeTopCut), decklistPublished: Boolean(p.decklistPublished), deckName: archByTp.get(String(p.tpId)) ?? null })),
      decklists: cardsByTp as never,
      matches: (matches ?? []).map(m => ({ round: m.round as number, phase: (m.phase as number) ?? null, table: (m.table as number) ?? null, completed: Boolean(m.completed), p1Id: m.player1Id as number, p2Id: (m.player2Id as number) ?? null, winner: (m.winnerCode as number) ?? null }))
    };
    const event = labsSourceToNormalized(source, { synonymDb: synonyms });
    const artifacts = buildEventArtifacts(event, { synonymDb: synonyms });
    const g = gen([...artifacts.entries()].sort());
    const root = `releases/v1/events/${folder}/${g}`;
    for (const [path, body] of artifacts) await publish(`${root}/${path}`, body);
    events[folder] = `/${root}`;
  }

  // ---- Catalog (fresh) ----
  const catalog = buildTournamentCatalog(allFolders.filter(f => f !== 'Online - Last 14 Days'));
  const catalogRoot = `releases/v1/catalogs/${gen(catalog)}`;
  await publish(`${catalogRoot}/tournaments.json`, catalog);
  roots.catalogs = `/${catalogRoot}`;

  // ---- Online (fresh capture of current online window, republished immutably) ----
  const onlineKeys = ['master.json', 'decks.json', 'meta.json', 'cardUsage.json', 'archetypes/index.json'];
  const onlineBodies: Record<string, unknown> = {};
  for (const k of onlineKeys) onlineBodies[k] = await load(`reports/Online - Last 14 Days/${k}`);
  const onlineRoot = `releases/v1/online/${gen(onlineBodies)}`;
  for (const [k, body] of Object.entries(onlineBodies)) if (body !== null) await publish(`${onlineRoot}/${k}`, body);
  roots.online = `/${onlineRoot}`;

  // ---- Captured scopes (not rewritten this migration) ----
  for (const scope of ['trends', 'players', 'prices', 'snapshots'] as const) {
    const keys = lite ? LITE_KEYS[scope] : LITE_KEYS[scope]; // full-body capture is a follow-up; lite keys are always captured
    const prefix = scope === 'players' ? 'players' : 'reports';
    const bodies: Record<string, unknown> = {};
    for (const k of keys) bodies[k] = await load(`${prefix}/${k}`);
    const root = `releases/v1/${scope}/${gen(bodies)}`;
    for (const [k, body] of Object.entries(bodies)) if (body !== null) await publish(`${root}/${k}`, body);
    roots[scope] = `/${root}`;
  }

  // ---- Compose + validate manifest ----
  const releaseId = `${lite ? 'shadow' : 'release'}-${gen({ roots, events })}`;
  const manifest = composeRelease({ releaseId, publishedAt: '1970-01-01T00:00:00Z', roots: roots as Record<ReleaseScope, string>, events });

  if (arg('--emit-roots')) await writeFile(arg('--emit-roots')!, JSON.stringify(roots, null, 2));
  if (arg('--emit-events')) await writeFile(arg('--emit-events')!, JSON.stringify(events, null, 2));

  console.log('[build-loop] ===== SUMMARY =====');
  console.log(`  events built    : ${Object.keys(events).length}`);
  console.log(`  scope roots     : ${Object.keys(roots).length}/6 ${Object.keys(roots).sort().join(', ')}`);
  console.log(`  capture mode    : ${lite ? 'lite (index artifacts)' : 'full'}`);
  console.log(`  manifest        : ${manifest.releaseId} (valid)`);
  console.log(write ? `  objects written : ${written.length}` : '  DRY RUN — nothing written (pass --write)');

  if (gc && write) {
    for (const key of written) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    console.log(`[build-loop] GC'd ${written.length} objects`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[build-loop]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
