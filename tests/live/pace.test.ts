/**
 * Live pacing, against the shape of a real regional: Baltimore posted round two
 * at about 10:00 venue time, finished day one at 19:30, and started day two at
 * 09:00, with top cut after a mid-afternoon wait.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTIVE_WINDOW_MS, IDLE_INTERVAL_MS, nextCheck } from '../../shared/live/pace.ts';

const HOUR = 60 * 60 * 1000;
/** Venue 10:00 on day one, as UTC (Baltimore is UTC-4 in September). */
const ROUND_2 = Date.parse('2026-09-19T14:00:00Z');
const at = (hoursAfterRound2: number) => ROUND_2 + hoursAfterRound2 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

test('while results change, look again at once', () => {
  const pace = { changedAt: iso(at(3)), roundComplete: false, round2At: iso(ROUND_2) };
  assert.equal(nextCheck(pace, at(3) + 5 * 60_000), at(3) + 5 * 60_000);
});

test('once quiet, look every ten minutes', () => {
  const pace = { changedAt: iso(at(3)), roundComplete: false, round2At: iso(ROUND_2) };
  const checked = at(3) + ACTIVE_WINDOW_MS;
  assert.equal(nextCheck(pace, checked), checked + IDLE_INTERVAL_MS);
});

test("a day that ends in the evening sleeps until three hours before the next day's anchor", () => {
  // Day one's last result at 19:30 venue time.
  const pace = { changedAt: iso(at(9.5)), roundComplete: true, round2At: iso(ROUND_2) };
  const wake = at(24 - 3);
  assert.equal(nextCheck(pace, at(9.5) + ACTIVE_WINDOW_MS), wake);
  // After the wake, back to every ten minutes until day two shows itself.
  assert.equal(nextCheck(pace, wake + 60_000), wake + 60_000 + IDLE_INTERVAL_MS);
});

test('the wait for top cut in the afternoon is not mistaken for the night', () => {
  // Day two's last Swiss result at 14:30 venue time: four and a half hours past the anchor's time of day.
  const pace = { changedAt: iso(at(24 + 4.5)), roundComplete: true, round2At: iso(ROUND_2) };
  const checked = at(24 + 4.5) + ACTIVE_WINDOW_MS;
  assert.equal(nextCheck(pace, checked), checked + IDLE_INTERVAL_MS);
});

test('a round still being played is never slept through, whatever the hour', () => {
  const pace = { changedAt: iso(at(12)), roundComplete: false, round2At: iso(ROUND_2) };
  const checked = at(12) + ACTIVE_WINDOW_MS;
  assert.equal(nextCheck(pace, checked), checked + IDLE_INTERVAL_MS);
});

test('without an anchor, the night is polled at the idle interval as before', () => {
  const pace = { changedAt: iso(at(9.5)), roundComplete: true };
  const checked = at(9.5) + ACTIVE_WINDOW_MS;
  assert.equal(nextCheck(pace, checked), checked + IDLE_INTERVAL_MS);
});

test('a finished event is never looked at again', () => {
  assert.equal(nextCheck({ changedAt: iso(at(33)), roundComplete: true, finished: true }, at(34)), null);
});
