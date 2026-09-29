/**
 * Live pacing, against the shape of a real regional: Baltimore posted round two
 * at about 10:00 venue time, finished day one at 19:30, and started day two at
 * 09:00, with top cut after a mid-afternoon wait.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVE_INTERVAL_MS,
  ACTIVE_WINDOW_MS,
  awaitsNextRound,
  CLOSING_INTERVAL_MS,
  IDLE_INTERVAL_MS,
  nextCheck,
  PROBE_WINDOW_MS
} from '../../shared/live/pace.ts';

const HOUR = 60 * 60 * 1000;
/** Venue 10:00 on day one, as UTC (Baltimore is UTC-4 in September). */
const ROUND_2 = Date.parse('2026-09-19T14:00:00Z');
const at = (hoursAfterRound2: number) => ROUND_2 + hoursAfterRound2 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

test('while results change, read every minute, and every thirty seconds with five tables or fewer left', () => {
  const pace = { changedAt: iso(at(3)), roundComplete: false, round2At: iso(ROUND_2), playing: 5 };
  assert.equal(nextCheck(pace, at(3) + 60_000), at(3) + 60_000 + CLOSING_INTERVAL_MS);
  assert.equal(nextCheck({ ...pace, playing: 6 }, at(3) + 60_000), at(3) + 60_000 + ACTIVE_INTERVAL_MS);
});

test("a day that ends in the evening sleeps until three hours before the next day's anchor", () => {
  // Day one's last result at 19:30 venue time.
  const pace = { changedAt: iso(at(9.5)), roundComplete: true, round2At: iso(ROUND_2) };
  const wake = at(24 - 3);
  assert.equal(nextCheck(pace, at(9.5) + ACTIVE_WINDOW_MS), wake);
  // After the wake, back to every ten minutes until day two shows itself.
  assert.equal(nextCheck(pace, wake + 60_000), wake + 60_000 + IDLE_INTERVAL_MS);
});

test('a quiet spell that is not the night is looked at every ten minutes', () => {
  const cases: Array<[string, Parameters<typeof nextCheck>[0]]> = [
    ['mid-round quiet', { changedAt: iso(at(3)), roundComplete: false, round2At: iso(ROUND_2) }],
    // Day two's last Swiss result at 14:30 venue time: four and a half hours past the anchor's time of day.
    ['the wait for top cut', { changedAt: iso(at(24 + 4.5)), roundComplete: true, round2At: iso(ROUND_2), round: 14 }],
    // A round still being played is never slept through, whatever the hour, outside day one's closing rounds.
    ['a late round in play', { changedAt: iso(at(12)), roundComplete: false, round2At: iso(ROUND_2), round: 13 }],
    ['no anchor', { changedAt: iso(at(9.5)), roundComplete: true }],
    // Brisbane 2027 played round nine the morning after day one; a wait after it must not sleep through top cut.
    ['round nine on day two', { changedAt: iso(at(24 + 1)), roundComplete: false, round2At: iso(ROUND_2), round: 9 }],
    [
      'round nine finished on day two',
      { changedAt: iso(at(24 + 1)), roundComplete: true, round2At: iso(ROUND_2), round: 9 }
    ],
    [
      'a closing round in the top cut',
      { changedAt: iso(at(9)), roundComplete: false, round2At: iso(ROUND_2), round: 9, topCut: true }
    ]
  ];
  for (const [label, pace] of cases) {
    const checked = Date.parse(pace.changedAt) + ACTIVE_WINDOW_MS;
    assert.equal(nextCheck(pace, checked), checked + IDLE_INTERVAL_MS, label);
  }
});

test("day one's closing rounds end the day once quiet, even with results RK9 never filled in", () => {
  // Brisbane 2027 left round eight part-filled at 18:18 venue time, and posted round nine the next morning.
  for (const round of [8, 9]) {
    const pace = { changedAt: iso(at(8.3)), roundComplete: false, round2At: iso(ROUND_2), round };
    assert.equal(nextCheck(pace, at(8.3) + ACTIVE_WINDOW_MS), at(24 - 3));
  }
});

test('the next round is awaited for ten minutes after a round finishes', () => {
  const pace = { changedAt: iso(at(3)), roundComplete: true, round2At: iso(ROUND_2), round: 4 };
  assert.equal(awaitsNextRound(pace, at(3) + PROBE_WINDOW_MS - 1), true);
  assert.equal(awaitsNextRound(pace, at(3) + PROBE_WINDOW_MS), false);
  assert.equal(awaitsNextRound({ ...pace, roundComplete: false }, at(3) + 60_000), false);
});

test("after a day ends, the next day's first round is awaited from the wake for four hours", () => {
  const pace = { changedAt: iso(at(10.5)), roundComplete: true, round2At: iso(ROUND_2), round: 9 };
  const wake = at(24 - 3);
  assert.equal(awaitsNextRound(pace, wake - 60_000), false);
  assert.equal(awaitsNextRound(pace, wake), true);
  assert.equal(awaitsNextRound(pace, wake + 4 * HOUR - 1), true);
  assert.equal(awaitsNextRound(pace, wake + 4 * HOUR), false);
});

test('a finished event awaits nothing and is never looked at again', () => {
  const pace = { changedAt: iso(at(33)), roundComplete: true, finished: true };
  assert.equal(awaitsNextRound(pace, at(33) + 60_000), false);
  assert.equal(nextCheck(pace, at(34)), null);
});
