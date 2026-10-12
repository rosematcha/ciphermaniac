import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { parseTdf, writeTdf } from '../../shared/tournament/tdf.ts';

// Active lifecycle conformance uses the permitted versioned archive in
// conformance-replay.test.ts. These older synthetic documents remain import
// regressions; they do not define TOM workflow or pairing behavior.
for (const scenario of ['cup-solo', 'challenge', 'earned-mixed', 'earned-challenge']) {
  test(`Legacy synthetic lifecycle documents round-trip: ${scenario}`, () => {
    const directory = new URL(`../fixtures/tdf/harness/${scenario}/`, import.meta.url);
    for (const name of readdirSync(directory)) {
      const bytes = readFileSync(new URL(name, directory));
      assert.deepEqual(Buffer.from(writeTdf(parseTdf(bytes.toString('utf8')))), bytes, name);
    }
  });
}
