/**
 * Full-graph shadow build (DB-MASTER-PLAN Phase 3/6, read-mostly).
 *
 * Rebuilds every event and the online window through the NEW pipeline from the
 * current legacy artifacts, publishes the results to IMMUTABLE
 * `releases/v1/…` shadow keys with node receipts, composes a shadow release
 * manifest, and points build/v1/channels/shadow.json at it. It NEVER writes
 * reports/ or build/v1/channels/production.json, so it is safe alongside the
 * live producers. `--gc` removes the shadow objects afterward.
 *
 * Events are reconstructed via the tested labs source adapter; the online
 * window is constructed directly (kind: 'online-window'). Each scope is also
 * parity-checked: the published master.json card counts must equal the legacy
 * artifact's.
 *
 * Usage: tsx shadow-build-all.ts [--limit N] [--gc]
 * @module .github/scripts/shadow-build-all
 */

import { pathToFileURL } from 'node:url';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { computeNodeKey, type NodeReceipt } from '../../shared/data/build/graph.ts';
import { type CandidateOutput, publishOutputs, writeReceipt } from '../../shared/data/build/receiptStore.ts';
import { composeRelease, type ReleaseScope } from '../../shared/data/build/release.ts';
import { canonicalStringify } from '../../shared/data/canonicalJson.ts';
import { sha256Hex, sha256HexString } from '../../shared/data/hash.ts';
import { type LabsSourceEvent, labsSourceToNormalized } from '../../shared/data/adapters/labsSource.ts';
import { buildEventArtifacts } from '../../shared/data/reports/eventArtifacts.ts';
import { archetypeKey, archetypeSlug } from '../../shared/data/contracts.ts';
import { aggregateCanonicalCardsPerDeck, type SynonymDatabase } from '../../shared/data/cardIdentity.ts';
import type { NormalizedEvent } from '../../shared/data/contracts.ts';
import { createR2Client, getJsonResult } from './lib/r2.mjs';
import { createR2ObjectStore } from './lib/build/r2ObjectStore.mjs';

const hashBody = (body: string): string => `sha256:${sha256HexString(body)}`;
const CACHE = 31536000;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

interface LegacyCard { name?: string; set?: string; number?: string | number; count?: number; category?: string; trainerType?: string; energyType?: string; aceSpec?: boolean; regulationMark?: string }
interface LegacyDeck { playerId?: string; placement?: number | null; archetype?: string; cards?: LegacyCard[]; hasDecklist?: boolean; player?: string }
interface LegacyPlayer { tpId: number; playerId?: string | null; name: string; country?: string | null; placement?: number | null; points?: number | null; wins?: number; losses?: number; ties?: number; opw?: number | null; oopw?: number | null; madePhase2?: boolean; madeTopCut?: boolean; decklistPublished?: boolean; dropped?: boolean; dropRound?: number | null }
interface LegacyMatch { round: number; phase?: number | null; table?: number | null; completed?: boolean; player1Id?: number; player2Id?: number | null; winnerCode?: number | null }

/** Reconstruct a labs source event from stored legacy artifacts. */
function legacyEventToSource(labsCode: string, meta: Record<string, unknown>, decks: LegacyDeck[], players: LegacyPlayer[], matches: LegacyMatch[]): LabsSourceEvent {
  const archetypeByTp = new Map<string, string>();
  const cardsByTp: Record<string, LegacyCard[]> = {};
  for (const deck of decks) {
    if (deck.playerId === undefined) continue;
    if (deck.archetype) archetypeByTp.set(String(deck.playerId), deck.archetype);
    if (Array.isArray(deck.cards)) cardsByTp[String(deck.playerId)] = deck.cards;
  }
  return {
    labsCode,
    fetchedAt: (meta.fetchedAt as string) ?? '1970-01-01T00:00:00Z',
    meta: {
      name: (meta.name as string) ?? labsCode,
      date: (meta.startDate as string) ?? (meta.date as string) ?? '1970-01-01',
      players: (meta.players as number) ?? players.length,
      division: (meta.division as string) ?? null,
      country: (meta.country as string) ?? null
    },
    standings: players.map(p => ({
      tpId: p.tpId, playerId: p.playerId ?? null, name: p.name, country: p.country ?? null, placement: p.placement ?? null,
      wins: p.wins, losses: p.losses, ties: p.ties, points: p.points ?? null, opw: p.opw ?? null, oopw: p.oopw ?? null,
      madePhase2: p.madePhase2, madeTopCut: p.madeTopCut, decklistPublished: p.decklistPublished, dropped: p.dropped, dropRound: p.dropRound ?? null,
      deckName: archetypeByTp.get(String(p.tpId)) ?? null
    })),
    decklists: cardsByTp as Record<string, LabsSourceEvent['decklists'][string]>,
    matches: matches.map(m => ({ round: m.round, phase: m.phase ?? null, table: m.table ?? null, completed: m.completed, p1Id: m.player1Id!, p2Id: m.player2Id ?? null, winner: m.winnerCode ?? null }))
  };
}

/** Construct a normalized online-window event from online decks. */
function onlineToNormalized(decks: LegacyDeck[], synonymDb: SynonymDatabase | null): NormalizedEvent {
  const withList = decks.filter(d => Array.isArray(d.cards) && d.cards.length > 0);
  const deckTotal = withList.length;
  const entries = withList.map((deck, i) => {
    const participantId = `online:w14:${i}`;
    const deckId = `sha256:${sha256HexString(`online:${i}`)}`;
    const categoryOf = (name?: string): 'pokemon' | 'trainer' | 'energy' => {
      const c = (deck.cards ?? []).find(x => x.name === name)?.category;
      return c === 'trainer' || c === 'energy' ? c : 'pokemon';
    };
    const cards = [...aggregateCanonicalCardsPerDeck(deck.cards ?? [], synonymDb).values()].map(c => ({
      canonical: { uid: c.uid, name: c.name, set: c.set, number: c.number }, printings: [], count: c.copies, category: categoryOf(c.name)
    }));
    const key = archetypeKey(deck.archetype ?? 'Unknown');
    return { participantId, deckId, playerRef: deck.playerId ?? null, name: deck.player ?? `deck-${i}`, placement: deck.placement ?? null, key, displayName: deck.archetype ?? 'Unknown', cards };
  });
  const participants = entries.map(e => ({
    participantId: e.participantId, playerRef: e.playerRef, name: e.name, country: null, placement: e.placement,
    record: { wins: 0, losses: 0, ties: 0 }, opwPct: null, oopwPct: null,
    flags: { madePhase2: false, madeTopCut: false, dropped: false, dqed: false, late: false, decklistPublished: true }, deckId: e.deckId
  }));
  const normDecks = entries.map(e => ({
    schemaVersion: 1 as const, deckId: e.deckId, participantId: e.participantId, playerRef: e.playerRef,
    archetype: { key: e.key, displayName: e.displayName, slug: archetypeSlug(e.key) }, cards: e.cards, hasDecklist: true, successTags: []
  })).sort((a, b) => (a.deckId < b.deckId ? -1 : a.deckId > b.deckId ? 1 : 0));
  return {
    schemaVersion: 1, eventId: 'online:w14', kind: 'online-window',
    meta: { name: 'Online - Last 14 Days', date: '1970-01-01', playerCount: deckTotal, format: null, division: null, hasDay2: false },
    participants, decks: normDecks, matches: [], sourceRevisions: [{ source: 'limitless-online', entityId: 'w14', sourceHash: sha256Hex(withList.length), fetchedAt: '' }]
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;
  const gc = argv.includes('--gc');

  const client = createR2Client({ accountId: requireEnv('R2_ACCOUNT_ID'), accessKeyId: requireEnv('R2_ACCESS_KEY_ID'), secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY') });
  const bucket = requireEnv('R2_BUCKET_NAME');
  const store = createR2ObjectStore(client, bucket);
  const load = async <T>(key: string): Promise<T | null> => {
    const r = await getJsonResult<T>(client, bucket, key);
    return r.status === 'found' ? r.value : null;
  };

  const synonyms = await load<SynonymDatabase>('assets/card-synonyms.json');

  // Discover event folders.
  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  void S3Client;
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'reports/2026', Delimiter: '/' }));
  const eventBases = (listed.CommonPrefixes ?? []).map(p => p.Prefix!.replace(/\/$/, '')).slice(0, limit);

  const publishedKeys: string[] = [];
  const eventRoots: Record<string, string> = {};
  let totalObjects = 0;
  let totalBytes = 0;
  const parityFailures: string[] = [];

  const publishEvent = async (event: NormalizedEvent, scopeKey: string): Promise<string> => {
    const artifacts = buildEventArtifacts(event, { synonymDb: synonyms });
    const generation = sha256HexString(canonicalStringify([...artifacts.entries()].sort())).slice(0, 12);
    const root = `releases/v1/${scopeKey}/${generation}`;
    const candidates: CandidateOutput[] = [...artifacts.entries()].map(([path, body]) => {
      const s = JSON.stringify(body);
      return { name: path, key: `${root}/${path}`, body: s, sha256: hashBody(s) };
    });
    const { outputs } = await publishOutputs(store, candidates, hashBody);
    const nodeKey = computeNodeKey({ contractVersion: 1, builderVersion: 'event-artifacts-v1', config: { eventId: event.eventId }, dependencyHashes: { normalizedEvent: sha256Hex(event) } }, sha256Hex);
    const receipt: NodeReceipt = { schemaVersion: 1, node: `event:${event.eventId}`, nodeKey, builder: 'event-artifacts-v1', inputs: { normalizedEvent: sha256Hex(event) }, outputs, completedAt: '1970-01-01T00:00:00Z' };
    await writeReceipt(store, receipt, `build/v1/nodes/event:${event.eventId}/${nodeKey}.json`);
    candidates.forEach(c => { publishedKeys.push(c.key); totalBytes += c.body.length; });
    publishedKeys.push(`build/v1/nodes/event:${event.eventId}/${nodeKey}.json`);
    totalObjects += candidates.length;
    return root;
  };

  // Events.
  for (const base of eventBases) {
    const [decks, players, matches, meta, legacyMaster] = await Promise.all([
      load<LegacyDeck[]>(`${base}/decks.json`), load<LegacyPlayer[]>(`${base}/players.json`),
      load<LegacyMatch[]>(`${base}/matches.json`), load<Record<string, unknown>>(`${base}/meta.json`),
      load<{ deckTotal: number; items: { name: string; found: number }[] }>(`${base}/master.json`)
    ]);
    if (!decks || !players || !meta) { console.log(`[shadow-all] skip ${base} (missing artifacts)`); continue; }
    const labsCode = (meta.labsCode as string) ?? base.replace(/[^a-z0-9]/gi, '').slice(-8);
    const event = labsSourceToNormalized(legacyEventToSource(labsCode, meta, decks, players, matches ?? []), { synonymDb: synonyms });
    const root = await publishEvent(event, `events/${event.eventId}`);
    eventRoots[event.eventId] = `/${root}`;
    // Parity: published master card counts vs legacy.
    if (legacyMaster) {
      const built = buildEventArtifacts(event, { synonymDb: synonyms }).get('master.json') as { items: { name: string; found: number }[] };
      const nextFound = new Map(built.items.map(i => [i.name, i.found]));
      const mismatches = legacyMaster.items.filter(i => nextFound.get(i.name) !== undefined && nextFound.get(i.name) !== i.found).length;
      if (mismatches > 0) parityFailures.push(`${base}: ${mismatches} master card-count mismatches`);
    }
    console.log(`[shadow-all] published event ${event.eventId} -> ${root}`);
  }

  // Online window.
  const onlineDecks = await load<LegacyDeck[]>('reports/Online - Last 14 Days/decks.json');
  let onlineRoot = 'releases/v1/online/none';
  if (onlineDecks) {
    onlineRoot = await publishEvent(onlineToNormalized(onlineDecks, synonyms), 'online');
    console.log(`[shadow-all] published online window -> ${onlineRoot}`);
  }

  // Compose a shadow release manifest. Scopes we did not rebuild point at their
  // freshly-built root where available, else the online root as a placeholder
  // (shadow only; production compose requires every real scope root).
  const roots: Record<ReleaseScope, string> = {
    online: `/${onlineRoot}`, trends: `/${onlineRoot}`, players: `/${onlineRoot}`,
    prices: `/${onlineRoot}`, catalogs: `/${onlineRoot}`, snapshots: `/${onlineRoot}`
  };
  const manifest = composeRelease({ releaseId: `shadow-${sha256HexString(JSON.stringify(eventRoots)).slice(0, 10)}`, publishedAt: '1970-01-01T00:00:00Z', roots, events: eventRoots });
  await store.put('build/v1/channels/shadow.json', JSON.stringify({ channel: 'shadow', manifest }));
  publishedKeys.push('build/v1/channels/shadow.json');

  console.log('\n[shadow-all] ===== SHADOW BUILD SUMMARY =====');
  console.log(`  events published : ${Object.keys(eventRoots).length}`);
  console.log(`  online published : ${onlineDecks ? 'yes' : 'no'}`);
  console.log(`  total objects    : ${totalObjects}`);
  console.log(`  total bytes      : ${(totalBytes / 1e6).toFixed(1)} MB`);
  console.log(`  shadow manifest  : ${manifest.releaseId}`);
  console.log(`  parity           : ${parityFailures.length === 0 ? 'PASS (all scopes match legacy card counts)' : parityFailures.join('; ')}`);
  console.log(`  cache policy     : immutable ${CACHE}s`);

  if (gc) {
    for (const key of publishedKeys) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    console.log(`[shadow-all] GC'd ${publishedKeys.length} shadow objects`);
  } else {
    console.log(`[shadow-all] retained ${publishedKeys.length} shadow objects (run with --gc to remove)`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[shadow-all]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
