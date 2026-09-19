/**
 * Live polling step, driven with a fake clock, an in-memory publisher and canned
 * RK9 bodies. What matters: one fragment per step, writes only on change, a
 * finished round hands over to the next, and markup breakage never overwrites
 * the last good round.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ACTIVE_WINDOW_MS,
  IDLE_INTERVAL_MS,
  initialState,
  liveKeys,
  resumeState,
  tickEvent,
  type TickOutcome
} from '../../shared/live/tick.ts';
import type { LiveEvent, LiveIndex, LiveRound, LiveState } from '../../shared/live/types.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/live');
const OPEN_ROUND = readFileSync(join(FIXTURES, 'round.html'), 'utf8');
/** The same round once staff have confirmed every table. */
const DONE_ROUND = OPEN_ROUND.replaceAll('match no-gutter "', 'match no-gutter complete"');
const BROKEN_ROUND = readFileSync(join(FIXTURES, 'round-renamed.html'), 'utf8');

const EVENT: LiveEvent = {
  slug: 'test-2027',
  name: 'Test Regional',
  kind: 'regional',
  rk9Id: 'TEST01',
  pod: 2,
  firstDay: '2026-09-19',
  lastDay: '2026-09-20'
};
const START = Date.parse('2026-09-19T13:00:00Z');

interface Harness {
  files: Map<string, unknown>;
  puts: string[];
  fetched: number[];
  rounds: Record<number, string>;
  state: LiveState;
  tick: (offsetMs: number) => Promise<TickOutcome>;
}

function harness(rounds: Record<number, string>): Harness {
  const self: Harness = {
    files: new Map(),
    puts: [],
    fetched: [],
    rounds,
    state: initialState(),
    tick: async offsetMs => {
      const result = await tickEvent(EVENT, self.state, {
        now: new Date(START + offsetMs),
        hash: text => Promise.resolve(`${text.length}:${text}`),
        publish: (key, value) => {
          self.puts.push(key);
          self.files.set(key, structuredClone(value));
          return Promise.resolve();
        },
        fetchRound: (_event, round) => {
          self.fetched.push(round);
          return Promise.resolve(self.rounds[round] ?? '');
        }
      });
      self.state = result.state;
      return result.outcome;
    }
  };
  return self;
}

const MINUTE = 60_000;

test('the first poll publishes the round, then its index', async () => {
  const h = harness({ 1: OPEN_ROUND });
  assert.equal(await h.tick(0), 'written');
  assert.deepEqual(h.puts, [liveKeys.round(EVENT, 1), liveKeys.index(EVENT)]);
  const index = h.files.get(liveKeys.index(EVENT)) as LiveIndex;
  // Two tables in the fixture have a submitted result, so only one is still playing.
  assert.deepEqual([index.round, index.playing], [1, 1]);
  assert.equal((h.files.get(liveKeys.round(EVENT, 1)) as LiveRound).matches.length, 8);
});

test('an unchanged round inside the active window writes nothing', async () => {
  const h = harness({ 1: OPEN_ROUND });
  await h.tick(0);
  h.puts.length = 0;
  assert.equal(await h.tick(MINUTE), 'unchanged');
  assert.deepEqual(h.puts, []);
});

test('a finished round hands over to the next once RK9 posts it', async () => {
  const h = harness({ 1: DONE_ROUND });
  await h.tick(0);
  assert.equal(h.state.roundComplete, true);

  assert.equal(await h.tick(MINUTE), 'unchanged');
  h.rounds[2] = OPEN_ROUND;
  assert.equal(await h.tick(2 * MINUTE), 'written');
  assert.deepEqual(h.fetched, [1, 2, 1, 2]);
  assert.equal((h.files.get(liveKeys.index(EVENT)) as LiveIndex).round, 2);
  assert.equal(h.state.roundComplete, false);
});

test('a result corrected after the round finished is republished', async () => {
  const h = harness({ 1: DONE_ROUND });
  await h.tick(0);
  h.rounds[1] = DONE_ROUND.replace('player1  loser   ', 'player1 winner    ').replace(
    'player2 winner    ',
    'player2  loser   '
  );
  assert.equal(await h.tick(MINUTE), 'written');
  const [first] = (h.files.get(liveKeys.round(EVENT, 1)) as LiveRound).matches;
  assert.deepEqual(
    first.seats.map(seat => seat.result),
    ['win', 'loss']
  );
});

test('a body cut short cannot finish a round or replace the published one', async () => {
  const h = harness({ 1: OPEN_ROUND });
  await h.tick(0);
  const published = structuredClone(h.files.get(liveKeys.round(EVENT, 1)));
  // Keeps only the confirmed rows, so every surviving match is complete.
  h.rounds[1] = OPEN_ROUND.slice(0, OPEN_ROUND.indexOf('<div class="row row-cols-3 match no-gutter "'));
  assert.equal(await h.tick(MINUTE), 'broken');
  assert.deepEqual(h.files.get(liveKeys.round(EVENT, 1)), published);
  assert.equal(h.state.roundComplete, false);
});

test('an event with nothing posted is polled at the idle interval from the start', async () => {
  const h = harness({});
  assert.equal(await h.tick(0), 'not-posted');
  assert.equal(await h.tick(MINUTE), 'skipped');
  assert.equal(await h.tick(IDLE_INTERVAL_MS), 'not-posted');
});

test('once nothing has changed for the active window, polls are spaced out', async () => {
  const h = harness({ 1: OPEN_ROUND });
  await h.tick(0);
  assert.equal(await h.tick(ACTIVE_WINDOW_MS), 'unchanged');
  assert.equal(await h.tick(ACTIVE_WINDOW_MS + MINUTE), 'skipped');
  assert.equal(await h.tick(ACTIVE_WINDOW_MS + IDLE_INTERVAL_MS), 'unchanged');
  assert.deepEqual(h.fetched, [1, 1, 1]);
});

test('a change while idle brings back per-minute polling', async () => {
  const h = harness({ 1: OPEN_ROUND });
  await h.tick(0);
  await h.tick(ACTIVE_WINDOW_MS);
  h.rounds[1] = DONE_ROUND;
  assert.equal(await h.tick(ACTIVE_WINDOW_MS + IDLE_INTERVAL_MS), 'written');
  assert.equal(await h.tick(ACTIVE_WINDOW_MS + IDLE_INTERVAL_MS + MINUTE), 'unchanged');
  assert.deepEqual(h.fetched.slice(-2), [2, 1]);
});

test('broken markup is reported and leaves the last good round in place', async () => {
  const h = harness({ 1: OPEN_ROUND });
  await h.tick(0);
  const published = structuredClone(h.files.get(liveKeys.round(EVENT, 1)));
  h.rounds[1] = BROKEN_ROUND;
  assert.equal(await h.tick(MINUTE), 'broken');
  assert.deepEqual(h.files.get(liveKeys.round(EVENT, 1)), published);
});
