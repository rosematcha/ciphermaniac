/**
 * Regression tests for the player aggregator + snapshot pipeline fixes:
 *   P-04 — content fingerprint forces rerun even when the tournament key set
 *          is unchanged.
 *   P-05 — a transient/corrupt slice load aborts publication (throws) rather
 *          than publishing aggregates built from the surviving slices.
 *   P-16 — snapshot index build aborts when live master/index is corrupt.
 *   P-29 — pre-rotation window spans exactly `windowDays` dates, excluding the
 *          rotation day.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlayerAggregates } from '../../shared/onlineMeta/playerAggregator.js';
import { rebuildSnapshotIndex } from '../../shared/onlineMeta/snapshotIndexBuilder.js';
import { runRotationSnapshot } from '../../shared/onlineMeta/snapshotGenerator.js';

interface MockOptions {
  /** Keys whose `get` should throw (simulate transport failure). */
  throwOn?: Set<string>;
}

function makeEnv(store: Record<string, string>, options: MockOptions = {}) {
  const throwOn = options.throwOn ?? new Set<string>();
  const bucket = store; // local alias so put/delete don't reassign the param
  return {
    REPORTS: {
      async get(key: string) {
        if (throwOn.has(key)) {
          const err = new Error(`simulated transport failure for ${key}`);
          throw err;
        }
        if (!(key in bucket)) {
          return null;
        }
        const value = bucket[key];
        return { text: async () => value };
      },
      async put(key: string, data: string | ArrayBuffer | ArrayBufferView) {
        bucket[key] = typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString('utf-8');
      },
      async delete(key: string) {
        delete bucket[key];
      }
    }
  };
}

function playerRow(overrides: Record<string, unknown> = {}) {
  return {
    tpId: 1,
    playerId: 1,
    name: 'Ash Ketchum',
    country: 'US',
    placement: 1,
    wins: 5,
    losses: 1,
    ties: 0,
    madePhase2: true,
    madeTopCut: true,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// P-04 — content fingerprint
// ---------------------------------------------------------------------------

test('P-04: rerun rewrites profiles when tournament content changes under the same key', async () => {
  const KEY = '2026-01-15, Regional Foo';
  const store: Record<string, string> = {
    'reports/tournaments.json': JSON.stringify([KEY]),
    [`reports/${KEY}/players.json`]: JSON.stringify([playerRow()]),
    [`reports/${KEY}/decks.json`]: JSON.stringify([]),
    [`reports/${KEY}/meta.json`]: JSON.stringify({ fetchedAt: '2026-01-16T00:00:00.000Z' })
  };
  const env = makeEnv(store);

  const first = await buildPlayerAggregates(env);
  assert.equal(first.skippedNoChanges, false);
  assert.equal(first.profilesWritten, 1);

  // Second run, nothing changed → fast path skip.
  const second = await buildPlayerAggregates(env);
  assert.equal(second.skippedNoChanges, true);
  assert.equal(second.profilesWritten, 0);

  // Correct the placement AND bump the fingerprint (as a re-download would).
  store[`reports/${KEY}/players.json`] = JSON.stringify([playerRow({ placement: 4 })]);
  store[`reports/${KEY}/meta.json`] = JSON.stringify({ fetchedAt: '2026-01-17T00:00:00.000Z' });

  const third = await buildPlayerAggregates(env);
  assert.equal(third.skippedNoChanges, false, 'fingerprint change must defeat the fast path');
  assert.equal(third.profilesWritten, 1, 'the affected player profile must be rewritten');

  const profile = JSON.parse(store['players/1/profile.json']);
  assert.equal(profile.summary.bestPlacement, 4, 'corrected placement must be persisted');
});

test('P-04: legacy manifest without fingerprints forces a rebuild', async () => {
  const KEY = '2026-02-01, Regional Bar';
  const store: Record<string, string> = {
    'reports/tournaments.json': JSON.stringify([KEY]),
    [`reports/${KEY}/players.json`]: JSON.stringify([playerRow()]),
    [`reports/${KEY}/decks.json`]: JSON.stringify([]),
    [`reports/${KEY}/meta.json`]: JSON.stringify({ fetchedAt: '2026-02-02T00:00:00.000Z' }),
    // Manifest shaped like the pre-fix version: keys match, but no fingerprints.
    'players/_manifest.json': JSON.stringify({
      generatedAt: '2026-01-01T00:00:00.000Z',
      tournamentKeys: [KEY],
      players: { '1': [KEY] }
    })
  };
  const env = makeEnv(store);

  const result = await buildPlayerAggregates(env);
  assert.equal(result.skippedNoChanges, false, 'missing fingerprints must not short-circuit');
});

// ---------------------------------------------------------------------------
// P-05 — abort on slice load failure
// ---------------------------------------------------------------------------

test('P-05: a transient slice failure aborts publication instead of publishing partial data', async () => {
  const GOOD = '2026-03-01, Good Event';
  const BAD = '2026-03-08, Broken Event';
  const store: Record<string, string> = {
    'reports/tournaments.json': JSON.stringify([GOOD, BAD]),
    [`reports/${GOOD}/players.json`]: JSON.stringify([playerRow()]),
    [`reports/${GOOD}/decks.json`]: JSON.stringify([]),
    [`reports/${GOOD}/meta.json`]: JSON.stringify({ fetchedAt: '2026-03-02T00:00:00.000Z' })
  };
  // players.json for BAD throws on read (transport failure, not a 404).
  const env = makeEnv(store, { throwOn: new Set([`reports/${BAD}/players.json`]) });

  await assert.rejects(() => buildPlayerAggregates(env), /players\.json/);
  // Publication must not have happened.
  assert.equal(store['players/index.json'], undefined);
  assert.equal(store['players/_manifest.json'], undefined);
});

test('P-05: a genuinely missing slice is skipped, not fatal', async () => {
  const GOOD = '2026-03-01, Good Event';
  const MISSING = '2026-03-08, Absent Event';
  const store: Record<string, string> = {
    'reports/tournaments.json': JSON.stringify([GOOD, MISSING]),
    [`reports/${GOOD}/players.json`]: JSON.stringify([playerRow()]),
    [`reports/${GOOD}/decks.json`]: JSON.stringify([]),
    [`reports/${GOOD}/meta.json`]: JSON.stringify({ fetchedAt: '2026-03-02T00:00:00.000Z' })
    // MISSING/* intentionally absent → getJson returns missing.
  };
  const env = makeEnv(store);

  const result = await buildPlayerAggregates(env);
  assert.equal(result.tournamentsSkipped, 1);
  assert.equal(result.tournamentsScanned, 1);
  assert.ok(store['players/_manifest.json'], 'a partial-but-valid run still publishes');
});

// ---------------------------------------------------------------------------
// P-16 — snapshot index aborts on corrupt live input
// ---------------------------------------------------------------------------

test('P-16: corrupt live master.json aborts the snapshot index rebuild', async () => {
  const store: Record<string, string> = {
    'reports/Online - Last 14 Days/master.json': '{ this is not valid json',
    'reports/Online - Last 14 Days/archetypes/index.json': JSON.stringify([])
  };
  const env = makeEnv(store);

  await assert.rejects(() => rebuildSnapshotIndex(env, []), /unreadable\/corrupt/);
  // The destructive index must not have been written.
  assert.equal(store['reports/Snapshots/index.json'], undefined);
});

test('P-16: genuinely missing live data is tolerated (empty active sets)', async () => {
  // No live master/index at all → treated as "no live data yet", not an error.
  const store: Record<string, string> = {};
  const env = makeEnv(store);

  const index = await rebuildSnapshotIndex(env, []);
  assert.ok(index.generatedAt);
  assert.ok(store['reports/Snapshots/index.json'], 'index publishes for the empty bootstrap state');
});

// ---------------------------------------------------------------------------
// P-29 — window math
// ---------------------------------------------------------------------------

test('P-29: pre-rotation window spans exactly windowDays dates and excludes the rotation day', async () => {
  const ROTATION = '2026-04-10';
  const deck = JSON.stringify([
    { archetype: 'Gardevoir', cards: [{ name: 'Gardevoir ex', set: 'SVI', number: '86', count: 3 }] }
  ]);
  const ON_ROTATION = '2026-04-10, Rotation Day Event'; // new format → excluded
  const IN_WINDOW = '2026-04-09, Day Before'; // included
  const EARLIEST = '2026-03-11, Window Start'; // rotation - 30 days → included (inclusive start)
  const TOO_OLD = '2026-03-10, Too Old'; // < since → excluded

  const keys = [ON_ROTATION, IN_WINDOW, EARLIEST, TOO_OLD];
  const store: Record<string, string> = {
    'reports/tournaments.json': JSON.stringify(keys)
  };
  for (const k of keys) {
    store[`reports/${k}/decks.json`] = deck;
  }
  const env = makeEnv(store);

  const result = await runRotationSnapshot(env, { rotationDate: ROTATION, windowDays: 30 });
  assert.equal(result.success, true);
  const included = result.tournamentKeys ?? [];
  assert.ok(!included.includes(ON_ROTATION), 'rotation-day events (new format) are excluded');
  assert.ok(included.includes(IN_WINDOW), 'the day before rotation is included');
  assert.ok(included.includes(EARLIEST), 'the inclusive window start is included');
  assert.ok(!included.includes(TOO_OLD), 'events before the window start are excluded');

  // windowEnd is exclusive at the rotation day itself.
  assert.equal(result.windowEnd, '2026-04-10T00:00:00.000Z');
  assert.equal(result.windowStart, '2026-03-11T00:00:00.000Z');
});
