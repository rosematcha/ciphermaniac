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

import { buildFromFile } from '../../.github/scripts/event-cli.ts';

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
