/**
 * Tests for the price-history readiness gate (priceHistorySpanDays in
 * src/lib/data.ts): the calendar span the rolling artifact covers, used to
 * withhold price-trend UIs until PRICE_HISTORY_MIN_DAYS of data has accrued.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRICE_HISTORY_MIN_DAYS,
  priceHistorySpanDays,
  type PricePoint
} from '../../src/lib/data.ts';

function pts(...dates: string[]): PricePoint[] {
  return dates.map((date, i) => ({ date, price: 1 + i }));
}

test('priceHistorySpanDays returns 0 for empty history', () => {
  assert.equal(priceHistorySpanDays({}), 0);
});

test('priceHistorySpanDays returns 0 when every card has a single point', () => {
  assert.equal(priceHistorySpanDays({ a: pts('2026-07-01'), b: pts('2026-07-01') }), 0);
});

test('priceHistorySpanDays spans the global min and max across all cards', () => {
  const history = {
    a: pts('2026-07-01', '2026-07-10'),
    b: pts('2026-06-15', '2026-07-05')
  };
  // earliest 2026-06-15, latest 2026-07-10 → 25 days
  assert.equal(priceHistorySpanDays(history), 25);
});

test('priceHistorySpanDays ignores unparseable dates', () => {
  const history = { a: [{ date: 'nope', price: 1 }, ...pts('2026-07-01', '2026-07-31')] };
  assert.equal(priceHistorySpanDays(history), 30);
});

test('the 30-day gate is only met once the span reaches PRICE_HISTORY_MIN_DAYS', () => {
  const almost = { a: pts('2026-07-01', '2026-07-29') }; // 28 days
  const ready = { a: pts('2026-07-01', '2026-07-31') }; // 30 days
  assert.ok(priceHistorySpanDays(almost) < PRICE_HISTORY_MIN_DAYS);
  assert.ok(priceHistorySpanDays(ready) >= PRICE_HISTORY_MIN_DAYS);
});
