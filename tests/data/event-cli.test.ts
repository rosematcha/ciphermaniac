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
