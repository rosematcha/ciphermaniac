/**
 * tests/data/event-cli.test.ts
 * Event build CLI: validate-then-build, reject malformed records.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PointerConflictError } from '../../shared/data/build/channel.ts';
import { buildFromFile, publishEventArtifacts } from '../../.github/scripts/event-cli.ts';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'data-pipeline');
const labsPath = join(fixturesDir, 'labs-event.json');

test('builds the full artifact set from a valid normalized event file', async () => {
  const artifacts = await buildFromFile({ input: labsPath, outDir: 'unused' });
  assert.ok(artifacts.has('master.json'));
  assert.ok(artifacts.has('archetypes/index.json'));
  assert.ok(artifacts.size >= 15);
});

test('rejects a malformed normalized event with collected errors (never publishes)', async () => {
  const bad = JSON.parse(readFileSync(labsPath, 'utf8')) as { decks: { participantId: string }[] };
  bad.decks[0].participantId = 'labs:0001:999';
  const badPath = join(tmpdir(), `event-cli-bad-${bad.decks.length}.json`);
  writeFileSync(badPath, JSON.stringify(bad));
  await assert.rejects(() => buildFromFile({ input: badPath, outDir: 'unused' }), /Invalid normalized event/);
});

test('builds from a Labs source record (adapter runs before validation)', async () => {
  const src = {
    labsCode: '0099',
    fetchedAt: '2026-07-13T00:00:00.000Z',
    meta: { name: 'Src Event', date: '2026-07-01', players: 2, hasDay2: false },
    standings: [
      { tpId: 1, name: 'A', placement: 1, wins: 1, losses: 0, ties: 0, deckName: 'Gardevoir ex' },
      { tpId: 2, name: 'B', placement: 2, wins: 0, losses: 1, ties: 0, deckName: 'Charizard Pidgeot' }
    ],
    decklists: {
      '1': [{ name: 'Gardevoir ex', set: 'SVI', number: '86', count: 4, category: 'pokemon' }],
      '2': [{ name: 'Charizard ex', set: 'OBF', number: '125', count: 3, category: 'pokemon' }]
    },
    matches: [{ round: 1, phase: 1, table: 1, completed: true, p1Id: 1, p2Id: 2, winner: 1 }]
  };
  const srcPath = join(tmpdir(), 'event-cli-src.json');
  writeFileSync(srcPath, JSON.stringify(src));
  const artifacts = await buildFromFile({ input: srcPath, from: 'labs-source', outDir: 'unused' });
  assert.ok(artifacts.has('master.json'));
  assert.ok(artifacts.has('matches.json'));
});

test('publishes immutable bodies before conditionally registering a pending event', async () => {
  const bodies = new Map<string, string>();
  let pointer: { events?: Record<string, string>; updatedAt?: string } | null = null;
  let etag = '0';
  const store = {
    async get(key: string) {
      return bodies.get(key) ?? null;
    },
    async putIfAbsent(key: string, body: string) {
      if (bodies.has(key)) {
        throw new Error('conflict');
      }
      bodies.set(key, body);
    },
    async read() {
      return pointer ? { value: pointer, etag } : null;
    },
    async createIfAbsent(_key: string, value: typeof pointer) {
      if (pointer) {
        throw new PointerConflictError('pending-events.json');
      }
      pointer = value;
      etag = '1';
    },
    async writeIfMatch(_key: string, value: typeof pointer, expected: string) {
      if (expected !== etag) {
        throw new PointerConflictError('pending-events.json');
      }
      pointer = value;
      etag = String(Number(etag) + 1);
    }
  };
  const artifacts = new Map<string, unknown>([
    ['master.json', { value: 1 }],
    ['decks.json', []]
  ]);
  const folder = '2026-01-01, Event';
  const first = await publishEventArtifacts(store, folder, artifacts, '2026-09-12T00:00:00Z');
  assert.match(first, /^\/releases\/v1\/events\/2026-01-01, Event\/[a-f0-9]{12}$/);
  assert.ok(pointer);
  assert.equal((pointer as { events?: Record<string, string> }).events?.[folder], first);
  assert.ok(bodies.has(`${first.slice(1)}/_complete.json`));
  const { size } = bodies;
  assert.equal(await publishEventArtifacts(store, folder, artifacts), first);
  assert.equal(bodies.size, size);
});
