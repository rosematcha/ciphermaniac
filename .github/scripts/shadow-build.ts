/**
 * Shadow event build + publish.
 *
 * Builds one event's serving artifacts through the shared orchestrator and
 * publishes them to IMMUTABLE `releases/v1/events/{eventId}/{generation}/…`
 * keys, writes a node receipt, and updates the SHADOW channel pointer. It never
 * touches `reports/` (the live serving tree) or `build/v1/channels/production.json`,
 * so it is safe to run against the production bucket alongside the legacy
 * producers — exactly the Phase 3 shadow-release exit criterion.
 *
 * Usage:
 *   tsx shadow-build.ts --input <normalized-or-source.json> [--from labs-source] [--gc]
 *
 * Needs R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME.
 * @module .github/scripts/shadow-build
 */

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { validateNormalizedEvent } from '../../shared/data/contracts.ts';
import { buildEventArtifacts } from '../../shared/data/reports/eventArtifacts.ts';
import { type LabsSourceEvent, labsSourceToNormalized } from '../../shared/data/adapters/labsSource.ts';
import { canonicalStringify } from '../../shared/data/canonicalJson.ts';
import { semanticHash, sha256Hex, sha256HexString } from '../../shared/data/hash.ts';
import { computeNodeKey, type NodeReceipt } from '../../shared/data/build/graph.ts';
import { type CandidateOutput, publishOutputs, writeReceipt } from '../../shared/data/build/receiptStore.ts';
import { createR2Client } from './lib/r2.mjs';
import { createR2ObjectStore } from './lib/build/r2ObjectStore.mjs';

const BUILDER_VERSION = 'event-artifacts-v1';
const hashBody = (body: string): string => `sha256:${sha256HexString(body)}`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function loadEvent(input: string, from: string, synonymDb: unknown): Promise<ReturnType<typeof validateNormalizedEvent>> {
  const raw = JSON.parse(await readFile(input, 'utf8')) as unknown;
  const candidate = from === 'labs-source' ? labsSourceToNormalized(raw as LabsSourceEvent, { synonymDb: synonymDb as never }) : raw;
  return validateNormalizedEvent(candidate);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const input = arg('--input');
  const from = arg('--from') ?? 'normalized';
  const gc = argv.includes('--gc');
  if (!input) throw new Error('Missing --input <event.json>');

  const validated = await loadEvent(input, from, null);
  if (!validated.ok) throw new Error(`Invalid event (${validated.errors.length} errors):\n  ${validated.errors.join('\n  ')}`);
  const event = validated.value;

  const artifacts = buildEventArtifacts(event);
  // Generation is a content hash of the whole artifact set — a byte-stable id.
  const generation = sha256HexString(canonicalStringify([...artifacts.entries()].sort())).slice(0, 12);
  const root = `releases/v1/events/${event.eventId}/${generation}`;

  const candidates: CandidateOutput[] = [...artifacts.entries()].map(([path, body]) => {
    const serialized = JSON.stringify(body);
    return { name: path, key: `${root}/${path}`, body: serialized, sha256: hashBody(serialized) };
  });

  const client = createR2Client({
    accountId: requireEnv('R2_ACCOUNT_ID'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY')
  });
  const bucket = requireEnv('R2_BUCKET_NAME');
  const store = createR2ObjectStore(client, bucket);

  const nodeKey = computeNodeKey(
    { contractVersion: 1, builderVersion: BUILDER_VERSION, config: { eventId: event.eventId }, dependencyHashes: { normalizedEvent: semanticHash(event) } },
    sha256Hex
  );

  console.log(`[shadow] Publishing ${candidates.length} immutable objects to ${root}`);
  const { outputs } = await publishOutputs(store, candidates, hashBody);

  const receipt: NodeReceipt = {
    schemaVersion: 1,
    node: `event:${event.eventId}`,
    nodeKey,
    builder: BUILDER_VERSION,
    inputs: { normalizedEvent: semanticHash(event) },
    outputs,
    completedAt: event.meta.updatedAt || '1970-01-01T00:00:00Z'
  };
  await writeReceipt(store, receipt, `build/v1/nodes/event:${event.eventId}/${nodeKey}.json`);
  console.log(`[shadow] Wrote receipt build/v1/nodes/event:${event.eventId}/${nodeKey}.json`);

  // Shadow channel pointer — NEVER production.json.
  const shadowChannel = {
    channel: 'shadow',
    releaseId: `shadow-${generation}`,
    events: { [event.eventId]: `/${root}` },
    node: receipt.node,
    nodeKey
  };
  await store.put('build/v1/channels/shadow.json', JSON.stringify(shadowChannel));
  console.log('[shadow] Updated build/v1/channels/shadow.json');

  // Read-back verification of every published object.
  let verified = 0;
  for (const candidate of candidates) {
    const body = await store.get(candidate.key);
    if (body === null || hashBody(body) !== candidate.sha256) throw new Error(`verification failed for ${candidate.key}`);
    verified += 1;
  }
  console.log(`[shadow] Verified ${verified}/${candidates.length} objects by hash`);

  if (gc) {
    for (const candidate of candidates) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: candidate.key }));
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `build/v1/nodes/event:${event.eventId}/${nodeKey}.json` }));
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'build/v1/channels/shadow.json' }));
    console.log('[shadow] Garbage-collected shadow objects');
  }
  console.log(`[shadow] Done. eventId=${event.eventId} generation=${generation}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(error => {
    console.error('[shadow]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
