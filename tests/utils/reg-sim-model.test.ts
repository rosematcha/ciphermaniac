/**
 * The fake registration's clock and price rules (/tools/registration).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DRAW_TTL_MS,
  eventSaturday,
  liveDraw,
  localPrice,
  newDraw,
  nextOpening,
  zonedInstant
} from '../../src/pages/regSim/model.ts';

test('registration opens at the next top of the hour, skipping one less than a minute away', () => {
  const at = (h: number, m: number, s = 0) => new Date(2026, 10, 12, h, m, s);
  assert.equal(nextOpening(at(19, 47)), at(20, 0).getTime());
  assert.equal(nextOpening(at(19, 58, 59)), at(20, 0).getTime());
  assert.equal(nextOpening(at(19, 59)), at(21, 0).getTime());
  assert.equal(nextOpening(at(20, 0)), at(21, 0).getTime());
});

test('the event is the weekend eight weeks out', () => {
  // Thursday 12 November 2026 -> Thursday 7 January 2027 -> 9-10 January.
  assert.deepEqual(eventSaturday(new Date(2026, 10, 12, 19, 47)), { year: 2027, month: 1, day: 9 });
  // A Saturday target is its own weekend; a Sunday target ends the weekend before it.
  assert.deepEqual(eventSaturday(new Date(2026, 10, 14)), { year: 2027, month: 1, day: 9 });
  assert.deepEqual(eventSaturday(new Date(2026, 10, 15)), { year: 2027, month: 1, day: 9 });
  assert.deepEqual(eventSaturday(new Date(2026, 10, 16)), { year: 2027, month: 1, day: 16 });
});

test('wall-clock times resolve to instants in the event zone', () => {
  const saturday = { year: 2027, month: 1, day: 9 };
  assert.equal(zonedInstant(saturday, 8, 30, 'America/Recife'), Date.UTC(2027, 0, 9, 11, 30));
  assert.equal(zonedInstant(saturday, 8, 30, 'Asia/Kolkata'), Date.UTC(2027, 0, 9, 3, 0));
  // Berlin in summer time is two hours ahead of UTC.
  assert.equal(zonedInstant({ year: 2027, month: 7, day: 3 }, 9, 0, 'Europe/Berlin'), Date.UTC(2027, 6, 3, 7, 0));
});

test('local prices keep two significant figures', () => {
  assert.equal(localPrice(40, 1), 40);
  assert.equal(localPrice(80, 1), 80);
  assert.equal(localPrice(40, 0.862), 34);
  assert.equal(localPrice(40, 84.1), 3400);
  assert.equal(localPrice(40, 0.307), 12);
});

test('a draw lasts two hours and survives a reload', () => {
  const cities = [{ id: 'Q1', city: 'Recife' }];
  const now = new Date(2026, 10, 12, 19, 47);
  const draw = newDraw(now, cities, () => 0);
  assert.match(draw.code, /^RE001-a{14}$/);
  const raw = JSON.stringify(draw);
  const known = (id: string) => id === 'Q1';
  assert.deepEqual(liveDraw(raw, now.getTime() + DRAW_TTL_MS - 1, known), draw);
  assert.equal(liveDraw(raw, now.getTime() + DRAW_TTL_MS, known), null);
  assert.equal(
    liveDraw(raw, now.getTime(), () => false),
    null
  );
  assert.equal(liveDraw('{"version":1}', now.getTime(), known), null);
  assert.equal(liveDraw('not json', now.getTime(), known), null);
});
