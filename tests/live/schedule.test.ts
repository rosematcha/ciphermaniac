/**
 * The live schedule: when an event is polled, when the site advertises it, and
 * when a fresh read of RK9's list is allowed to replace the published schedule.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Rk9EventsParse } from '../../shared/live/rk9Events.ts';
import { buildSchedule, eventsOn, isEventLive, isEventOn, isScheduleStale } from '../../shared/live/schedule.ts';
import type { LiveEvent } from '../../shared/live/types.ts';

const EVENT: LiveEvent = {
  slug: 'test-2027',
  name: 'Test Regional Championships',
  kind: 'regional',
  rk9Id: 'TEST01',
  pod: 2,
  firstDay: '2026-09-19',
  lastDay: '2026-09-20'
};
const HOUR = 3_600_000;
const NOW = new Date('2026-09-19T12:00:00Z');

test('an event is polled from the day before its first day to the day after its last', () => {
  const at = (iso: string) => isEventLive(EVENT, new Date(iso));
  assert.deepEqual(
    ['2026-09-17T23:59:00Z', '2026-09-18T00:00:00Z', '2026-09-21T23:59:00Z', '2026-09-22T00:00:00Z'].map(at),
    [false, true, true, false]
  );
});

test('the site advertises an event on its own days, in any time zone, and not around them', () => {
  const first = Date.parse(`${EVENT.firstDay}T00:00:00Z`);
  const last = Date.parse(`${EVENT.lastDay}T00:00:00Z`);
  // Saturday morning in Auckland is still Friday in UTC; Sunday night in Honolulu is already Monday.
  assert.equal(isEventOn(EVENT, new Date(first - 13 * HOUR)), true);
  assert.equal(isEventOn(EVENT, new Date(last + 35 * HOUR)), true);
  assert.equal(isEventOn(EVENT, new Date(first - 15 * HOUR)), false);
  assert.equal(isEventOn(EVENT, new Date(last + 37 * HOUR)), false);
  assert.deepEqual(eventsOn([EVENT, { ...EVENT, slug: 'later', firstDay: '2026-10-03', lastDay: '2026-10-04' }], NOW), [
    EVENT
  ]);
});

test('overlapping regionals are both on while their local days overlap', () => {
  const brisbane = { ...EVENT, slug: 'brisbane-2027', firstDay: '2026-09-25', lastDay: '2026-09-26' };
  const frankfurt = { ...EVENT, slug: 'frankfurt-2027', firstDay: '2026-09-26', lastDay: '2026-09-27' };
  const schedule = [brisbane, frankfurt];
  assert.deepEqual(eventsOn(schedule, new Date('2026-09-25T12:00:00Z')), schedule);
  assert.deepEqual(eventsOn(schedule, new Date('2026-09-28T00:00:00Z')), [frankfurt]);
});

test('a schedule is rebuilt once it is half a day old, or missing', () => {
  assert.equal(isScheduleStale(null, NOW), true);
  assert.equal(isScheduleStale({ generatedAt: '2026-09-19T01:00:00Z', events: [] }, NOW), false);
  assert.equal(isScheduleStale({ generatedAt: '2026-09-18T23:00:00Z', events: [] }, NOW), true);
});

test('a read replaces the schedule only when it parsed cleanly and found events', () => {
  const clean: Rk9EventsParse = { events: [EVENT], rowsSeen: 4, rowsUnreadable: 0 };
  assert.deepEqual(buildSchedule(clean, NOW), { generatedAt: NOW.toISOString(), events: [EVENT] });
  assert.equal(buildSchedule({ ...clean, rowsUnreadable: 1 }, NOW), null);
  assert.equal(buildSchedule({ events: [], rowsSeen: 4, rowsUnreadable: 0 }, NOW), null);
  assert.equal(buildSchedule({ events: [], rowsSeen: 0, rowsUnreadable: 0 }, NOW), null);
});
