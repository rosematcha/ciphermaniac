/**
 * The Trends page's projections of the weekly report.
 *
 * The chart, the rail, and the deck blocks all read the same ranked list, so
 * these pin the ranking and the smoothing the three share, plus the fallback
 * for a trends file that predates the weekly block.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  changeArrow,
  chartFromDaily,
  chartFromWeekly,
  railRows,
  rankedArchetypes,
  signedDecimal,
  signedPercent,
  smoothSeries,
  wholePercent,
  yAxisDomain
} from '../../src/pages/trendsPage/weekly.ts';
import type { WeeklyReport } from '../../src/lib/data/trends.ts';

const DATES = Array.from({ length: 14 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);

function archetype(base: string, share: number, lists: number, shares: number[]) {
  return {
    base,
    displayName: base.toUpperCase(),
    lists,
    priorLists: lists,
    share,
    priorShare: share - 1,
    delta: 1,
    top10Share: share + 5,
    priorTop10Share: share,
    daily: DATES.map((date, i) => ({
      date,
      lists: 10,
      top10: 1,
      share: shares[i] ?? null,
      top10Share: (shares[i] ?? 0) + 5
    }))
  };
}

function weekly(): WeeklyReport {
  return {
    generatedAt: '2026-09-15T00:00:00Z',
    days: 7,
    recent: { start: '2026-09-08', end: '2026-09-15', lists: 100, top10: 10 },
    prior: { start: '2026-09-01', end: '2026-09-08', lists: 90, top10: 9 },
    dates: DATES,
    dailyTotals: DATES.map(date => ({ date, lists: 10, top10: 1 })),
    archetypes: [
      archetype(
        'beta',
        8,
        80,
        DATES.map((_, i) => 8 + i)
      ),
      archetype(
        'alpha',
        12,
        120,
        DATES.map(() => 12)
      ),
      archetype(
        'gamma',
        8,
        90,
        DATES.map(() => 8)
      )
    ],
    decks: [],
    movers: { rising: [], falling: [] }
  };
}

test('smoothing takes the trailing mean and leaves the first days blank', () => {
  const smoothed = smoothSeries([10, 20, 30, 40, 50, null, 70, 80], 3);
  // A window with a missing day has only two present days in it, so it stays blank.
  assert.deepEqual(smoothed, [null, null, 20, 30, 40, null, null, null]);
});

test("archetypes rank by this week's share, then by lists", () => {
  assert.deepEqual(
    rankedArchetypes(weekly()).map(a => a.base),
    ['alpha', 'gamma', 'beta']
  );
});

test('the chart slices the last N days, keeps the rank order, and plots the 7-day mean', () => {
  const chart = chartFromWeekly(weekly(), 'share', 7);
  assert.equal(chart.days.length, 7);
  assert.equal(chart.days[0].key, '2026-09-08');
  assert.deepEqual(
    chart.series.map(s => s.name),
    ['alpha', 'gamma', 'beta']
  );
  // beta runs 8..21, so each visible point is the mean of the 7 days ending there.
  assert.deepEqual(chart.series[2].points, [12, 13, 14, 15, 16, 17, 18]);
});

test('the chart can plot top-10% share instead', () => {
  const chart = chartFromWeekly(weekly(), 'top10', 3);
  assert.deepEqual(chart.series[0].points, [17, 17, 17]);
});

test('the rail average follows the visible window', () => {
  const chart = chartFromWeekly(weekly(), 'share', 2);
  assert.equal(chart.series[2].avg, 17.5);
});

test('the daily fallback builds the same shape from the older report, smoothed the same way', () => {
  const chart = chartFromDaily(
    {
      series: [
        {
          base: 'a',
          displayName: 'A',
          avgShare: 5,
          timeline: [
            { date: '2026-09-01', share: 4 },
            { date: '2026-09-02', share: 5 },
            { date: '2026-09-03', share: 6 }
          ]
        },
        { base: 'b', displayName: 'B', avgShare: 9, timeline: [{ date: '2026-09-02', share: 9 }] }
      ]
    },
    30
  );
  assert.deepEqual(
    chart.days.map(d => d.key),
    ['2026-09-01', '2026-09-02', '2026-09-03']
  );
  assert.deepEqual(
    chart.series.map(s => s.name),
    ['b', 'a']
  );
  assert.deepEqual(chart.series[1].points, [null, null, 5]);
});

test('rail rows are the default lines plus what the user added, with deltas when known', () => {
  const series = Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, label: `S${i}`, avg: 9 - i, points: [] }));
  const rows = railRows(
    series,
    ['s8', 'missing'],
    new Map([
      ['s0', 2.3],
      ['s8', -0.4]
    ])
  );
  assert.deepEqual(
    rows.map(r => r.name),
    ['s0', 's1', 's2', 's3', 's4', 's5', 's8']
  );
  assert.equal(rows[0].delta, 2.3);
  assert.equal(rows[1].delta, null);
  assert.equal(rows[6].delta, -0.4);
  assert.equal(railRows(series, [], null)[0].delta, null);
});

test('the Y axis runs one whole percent past the data at each end', () => {
  const axis = yAxisDomain([3.8, 7.2, 12]);
  assert.equal(axis.min, 3);
  assert.equal(axis.max, 13);
  assert.deepEqual(axis.ticks, [3, 6, 8, 10, 13]);
});

test('a whole-number extreme still gets its percent of headroom', () => {
  const axis = yAxisDomain([4, 12]);
  assert.equal(axis.min, 3);
  assert.equal(axis.max, 13);
});

test('the Y axis never runs below zero', () => {
  assert.equal(yAxisDomain([0.4, 5]).min, 0);
  assert.equal(yAxisDomain([0, 5]).min, 0);
});

test('a wide range steps in fives or tens and keeps the bounds', () => {
  assert.deepEqual(yAxisDomain([2, 21.5]).ticks, [1, 5, 10, 15, 22]);
  // 40 sits half a step under the 45 bound, close enough to crowd its label.
  assert.deepEqual(yAxisDomain([1, 44]).ticks, [0, 10, 20, 30, 45]);
});

test('an empty chart falls back to zero to ten', () => {
  assert.deepEqual(yAxisDomain([]), { min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10] });
});

test('figures format the way the tiles and rail print them', () => {
  assert.equal(signedPercent(9.4), '+9%');
  assert.equal(signedPercent(-5.6), '−6%');
  assert.equal(signedDecimal(2.31), '+2.3%');
  assert.equal(signedDecimal(-0.06), '−0.1%');
  assert.equal(signedDecimal(0.04), '0.0%');
  assert.equal(signedDecimal(-0.02), '0.0%');
  assert.equal(changeArrow(2.3), '↑');
  assert.equal(changeArrow(-0.4), '↓');
  assert.equal(changeArrow(0.01), '');
  assert.equal(wholePercent(0.4), '<1%');
  assert.equal(wholePercent(57.5), '58%');
  assert.equal(wholePercent(0), '0%');
});
