/**
 * Tests for the price-history readiness gate (priceHistorySpanDays in
 * src/lib/data.ts): the calendar span the rolling artifact covers, used to
 * withhold price-trend UIs until PRICE_HISTORY_MIN_DAYS of data has accrued.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { priceHistorySpanDays, type PricePoint } from '../../src/lib/data.ts';

function pts(...dates: string[]): PricePoint[] {
  return dates.map((date, i) => ({ date, price: 1 + i }));
}

test('priceHistorySpanDays spans the global min and max across all cards, ignoring unparseable dates', () => {
  const cases: Array<[string, Record<string, PricePoint[]>, number]> = [
    ['empty history', {}, 0],
    ['single points only', { a: pts('2026-07-01'), b: pts('2026-07-01') }, 0],
    // earliest 2026-06-15, latest 2026-07-10
    ['across cards', { a: pts('2026-07-01', '2026-07-10'), b: pts('2026-06-15', '2026-07-05') }, 25],
    ['unparseable date', { a: [{ date: 'nope', price: 1 }, ...pts('2026-07-01', '2026-07-31')] }, 30]
  ];
  for (const [label, history, expected] of cases) {
    assert.equal(priceHistorySpanDays(history), expected, label);
  }
});
