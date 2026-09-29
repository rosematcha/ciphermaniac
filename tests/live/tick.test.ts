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

import { ACTIVE_WINDOW_MS, IDLE_INTERVAL_MS, PROBE_INTERVAL_MS, PROBE_WINDOW_MS } from '../../shared/live/pace.ts';
import {
  FIRST_ROUND_PROBE_MS,
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
/** Top eight: four finished matches with no points printed. */
const TOP_EIGHT = readFileSync(join(FIXTURES, 'round-top-cut.html'), 'utf8');
/** The final: the top eight's first match alone. */
const FINAL = TOP_EIGHT.slice(0, TOP_EIGHT.indexOf('<div class="row', 1));

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

function harness(rounds: Record<number, string>, event: LiveEvent = EVENT): Harness {
  const self: Harness = {
    files: new Map(),
    puts: [],
    fetched: [],
    rounds,
    state: initialState(),
    tick: async offsetMs => {
      const result = await tickEvent(event, self.state, {
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

test("on the first day's mornings, round one is probed every half minute and read every ten", async () => {
  const h = harness({});
  assert.equal(await h.tick(0), 'not-posted');
  assert.equal(await h.tick(FIRST_ROUND_PROBE_MS - 1), 'skipped');
  assert.equal(await h.tick(FIRST_ROUND_PROBE_MS), 'probed');
  assert.equal(await h.tick(IDLE_INTERVAL_MS), 'not-posted');
  h.rounds[1] = OPEN_ROUND;
  assert.equal(await h.tick(IDLE_INTERVAL_MS + FIRST_ROUND_PROBE_MS), 'written');
  assert.deepEqual(h.fetched, [1, 1, 1, 1]);
});

test('before the first morning, an event with nothing posted is only read at the idle interval', async () => {
  const h = harness({}, { ...EVENT, firstDay: '2026-09-21' });
  assert.equal(await h.tick(0), 'not-posted');
  assert.equal(await h.tick(MINUTE), 'skipped');
  assert.equal(await h.tick(IDLE_INTERVAL_MS), 'not-posted');
});

test('for ten minutes after a round finishes, only the next round is probed, every ten seconds', async () => {
  const h = harness({ 1: DONE_ROUND });
  await h.tick(0);
  h.fetched.length = 0;
  assert.equal(await h.tick(PROBE_INTERVAL_MS), 'probed');
  assert.equal(await h.tick(PROBE_INTERVAL_MS + 1000), 'skipped');
  assert.equal(await h.tick(2 * PROBE_INTERVAL_MS), 'probed');
  assert.deepEqual(h.fetched, [2, 2]);
  h.rounds[2] = OPEN_ROUND;
  assert.equal(await h.tick(3 * PROBE_INTERVAL_MS), 'written');
  assert.equal((h.files.get(liveKeys.index(EVENT)) as LiveIndex).round, 2);
});

test('once the probe window lapses, the next round waits for the minute read', async () => {
  const h = harness({ 1: DONE_ROUND });
  await h.tick(0);
  await h.tick(PROBE_WINDOW_MS - 30_000);
  h.fetched.length = 0;
  assert.equal(await h.tick(PROBE_WINDOW_MS + PROBE_INTERVAL_MS), 'skipped');
  assert.equal(await h.tick(PROBE_WINDOW_MS + 30_000), 'unchanged');
  assert.deepEqual(h.fetched, [2, 1]);
});

test("a day one close RK9 never finished sleeps overnight, then the morning's round is probed for", async () => {
  // Round eight left part-filled in the evening; round nine posted the next morning without it.
  const h = harness({ 8: OPEN_ROUND });
  const round2At = new Date(START - 8 * 60 * MINUTE).toISOString();
  h.state = { ...h.state, round: 7, roundComplete: true, round2At, changedAt: new Date(START).toISOString() };
  assert.equal(await h.tick(0), 'written');
  assert.equal(await h.tick(ACTIVE_WINDOW_MS), 'unchanged');
  const wake = START - 8 * 60 * MINUTE + 21 * 60 * MINUTE;
  h.fetched.length = 0;
  assert.equal(await h.tick(wake - START - MINUTE), 'skipped');
  assert.deepEqual(h.fetched, []);
  // The wake's read looks for round nine first, then rereads round eight.
  assert.equal(await h.tick(wake - START), 'unchanged');
  assert.deepEqual(h.fetched, [9, 8]);
  assert.equal(await h.tick(wake - START + PROBE_INTERVAL_MS), 'probed');
  h.rounds[9] = OPEN_ROUND;
  assert.equal(await h.tick(wake - START + 2 * PROBE_INTERVAL_MS), 'written');
  assert.equal((h.files.get(liveKeys.index(EVENT)) as LiveIndex).round, 9);
});

test('once nothing has changed for the active window, polls are spaced out', async () => {
  const h = harness({ 1: OPEN_ROUND });
  await h.tick(0);
  assert.equal(await h.tick(ACTIVE_WINDOW_MS), 'unchanged');
  assert.equal(await h.tick(ACTIVE_WINDOW_MS + MINUTE), 'skipped');
  assert.equal(await h.tick(ACTIVE_WINDOW_MS + IDLE_INTERVAL_MS), 'unchanged');
  // A round quiet this long may never be finished on RK9, so each read looks for the next round first.
  assert.deepEqual(h.fetched, [1, 2, 1, 2, 1]);
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

test('broken or cut-short markup is reported and leaves the last good round in place', async () => {
  const cases: Array<[string, string]> = [
    ['renamed markup', BROKEN_ROUND],
    // Keeps only the confirmed rows, so every surviving match is complete: a cut
    // body must not finish the round either.
    ['cut short', OPEN_ROUND.slice(0, OPEN_ROUND.indexOf('<div class="row row-cols-3 match no-gutter "'))]
  ];
  for (const [label, body] of cases) {
    const h = harness({ 1: OPEN_ROUND });
    await h.tick(0);
    const published = structuredClone(h.files.get(liveKeys.round(EVENT, 1)));
    h.rounds[1] = body;
    assert.equal(await h.tick(MINUTE), 'broken', label);
    assert.deepEqual(h.files.get(liveKeys.round(EVENT, 1)), published, label);
    assert.equal(h.state.roundComplete, false, label);
  }
});

test("round two's first publish is kept as the day's anchor, and never moves", async () => {
  const h = harness({ 1: DONE_ROUND, 2: OPEN_ROUND });
  await h.tick(0);
  await h.tick(MINUTE);
  const anchor = new Date(START + MINUTE).toISOString();
  assert.equal((h.files.get(liveKeys.index(EVENT)) as LiveIndex).round2At, anchor);
  h.rounds[2] = DONE_ROUND;
  await h.tick(2 * MINUTE);
  assert.equal((h.files.get(liveKeys.index(EVENT)) as LiveIndex).round2At, anchor);
});

test('a top cut round is marked, and the cut is sized from its first round', async () => {
  const h = harness({ 14: DONE_ROUND, 15: TOP_EIGHT });
  h.state = { ...h.state, round: 14, roundComplete: true, changedAt: new Date(START).toISOString() };
  assert.equal(await h.tick(0), 'written');
  assert.equal((h.files.get(liveKeys.round(EVENT, 15)) as LiveRound).topCut, true);
  const index = h.files.get(liveKeys.index(EVENT)) as LiveIndex;
  assert.deepEqual(index.cut, { from: 15, size: 8 });
  assert.equal(index.finished, undefined);

  h.rounds[16] = FINAL;
  await h.tick(MINUTE);
  assert.deepEqual((h.files.get(liveKeys.index(EVENT)) as LiveIndex).cut, { from: 15, size: 8 });
});

test('a decided final ends the event: published as finished, never polled again', async () => {
  const h = harness({ 17: FINAL });
  h.state = { ...h.state, round: 16, roundComplete: true, cut: { from: 15, size: 8 } };
  assert.equal(await h.tick(0), 'written');
  assert.equal((h.files.get(liveKeys.index(EVENT)) as LiveIndex).finished, true);
  const fetched = h.fetched.length;
  assert.equal(await h.tick(MINUTE), 'skipped');
  assert.equal(await h.tick(3 * 24 * 60 * MINUTE), 'skipped');
  assert.equal(h.fetched.length, fetched);
});

test('a runner taking over carries the cut, the anchor and the finish', () => {
  const state = resumeState({
    slug: EVENT.slug,
    rk9Id: EVENT.rk9Id,
    name: EVENT.name,
    round: 17,
    matches: 1,
    hash: 'h',
    playing: 0,
    updatedAt: new Date(START).toISOString(),
    cut: { from: 15, size: 8 },
    round2At: new Date(START).toISOString(),
    finished: true
  });
  assert.deepEqual(
    [state.cut, state.round2At, state.finished],
    [{ from: 15, size: 8 }, new Date(START).toISOString(), true]
  );
});
