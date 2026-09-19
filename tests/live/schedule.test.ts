/**
 * The live schedule is hand-listed, so a typo is the likely failure: a
 * malformed Labs code publishes under a key nothing reads, and swapped dates
 * mean the event is never polled.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { eventsOn, isEventLive, isEventOn, LIVE_EVENTS } from '../../shared/live/schedule.ts';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

test('every listed event has a four-digit Labs code, used once', () => {
  const codes = LIVE_EVENTS.map(event => event.labsCode);
  assert.deepEqual(
    codes.filter(code => !/^\d{4}$/.test(code)),
    []
  );
  assert.equal(new Set(codes).size, codes.length);
});

test('every listed event has an RK9 id and is live on each of its days', () => {
  for (const event of LIVE_EVENTS) {
    assert.match(event.rk9Id, /^[A-Za-z0-9-]+$/);
    assert.match(event.firstDay, DAY_RE);
    assert.match(event.lastDay, DAY_RE);
    assert.ok(event.firstDay <= event.lastDay, `${event.labsCode} ends before it starts`);
    assert.equal(isEventLive(event, new Date(`${event.firstDay}T12:00:00Z`)), true);
    assert.equal(isEventLive(event, new Date(`${event.lastDay}T12:00:00Z`)), true);
  }
});

test('the site advertises an event on its own days, in any time zone, and not around them', () => {
  const [event] = LIVE_EVENTS;
  const at = (iso: string) => eventsOn(new Date(iso)).includes(event);
  assert.equal(at(`${event.firstDay}T12:00:00Z`), true);
  // Saturday morning in Auckland is still Friday in UTC; Sunday night in Honolulu is already Monday.
  assert.equal(isEventOn(event, new Date(Date.parse(`${event.firstDay}T00:00:00Z`) - 13 * 3_600_000)), true);
  assert.equal(isEventOn(event, new Date(Date.parse(`${event.lastDay}T00:00:00Z`) + 35 * 3_600_000)), true);
  assert.equal(isEventOn(event, new Date(Date.parse(`${event.firstDay}T00:00:00Z`) - 15 * 3_600_000)), false);
  assert.equal(isEventOn(event, new Date(Date.parse(`${event.lastDay}T00:00:00Z`) + 37 * 3_600_000)), false);
});
