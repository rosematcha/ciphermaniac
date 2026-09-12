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
  chartFromDaily,
  chartFromWeekly,
  eventMarkers,
  railRows,
  rankedArchetypes,
  signedDecimal,
  signedPercent,
  smoothSeries,
  wholePercent
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

test('the chart slices the last N days and keeps the rank order', () => {
  const chart = chartFromWeekly(weekly(), 'share', 7, false);
  assert.equal(chart.days.length, 7);
  assert.equal(chart.days[0].key, '2026-09-08');
  assert.deepEqual(
    chart.series.map(s => s.name),
    ['alpha', 'gamma', 'beta']
  );
  assert.deepEqual(chart.series[2].points, [15, 16, 17, 18, 19, 20, 21]);
});

test('the chart can plot top-10% share instead', () => {
  const chart = chartFromWeekly(weekly(), 'top10', 3, false);
  assert.deepEqual(chart.series[0].points, [17, 17, 17]);
});

test('smoothing is applied before the window is cut, so the first visible day is already averaged', () => {
  const chart = chartFromWeekly(weekly(), 'share', 3, true);
  // beta runs 8..21; the last three smoothed points are means of the 7 days ending there.
  assert.deepEqual(chart.series[2].points, [16, 17, 18]);
});

test('the rail average follows the visible window', () => {
  const chart = chartFromWeekly(weekly(), 'share', 2, false);
  assert.equal(chart.series[2].avg, 20.5);
});

test('the daily fallback builds the same shape from the older report', () => {
  const chart = chartFromDaily(
    {
      series: [
        {
          base: 'a',
          displayName: 'A',
          avgShare: 5,
          timeline: [
            { date: '2026-09-01', share: 4 },
            { date: '2026-09-03', share: 6 }
          ]
        },
        { base: 'b', displayName: 'B', avgShare: 9, timeline: [{ date: '2026-09-02', share: 9 }] }
      ]
    },
    30,
    false
  );
  assert.deepEqual(
    chart.days.map(d => d.key),
    ['2026-09-01', '2026-09-02', '2026-09-03']
  );
  assert.deepEqual(
    chart.series.map(s => s.name),
    ['b', 'a']
  );
  assert.deepEqual(chart.series[1].points, [4, null, 6]);
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

test('event markers land on charted days only, one per day, biggest event first', () => {
  const days = ['2026-08-28', '2026-08-29'].map(key => ({ key, date: new Date(`${key}T12:00:00Z`), count: 1 }));
  const markers = eventMarkers(
    [
      '2026-08-28, World Championship San Francisco',
      '2026-08-28, Special Event Lima',
      '2026-08-29, Regional Championship Nowhere',
      '2026-08-01, Regional Championship Elsewhere',
      '2026-08-29, League Cup Toronto'
    ],
    days
  );
  assert.deepEqual(markers, [
    { date: '2026-08-28', label: 'Worlds' },
    { date: '2026-08-29', label: 'Regional' }
  ]);
});

test('figures format the way the tiles and rail print them', () => {
  assert.equal(signedPercent(9.4), '+9%');
  assert.equal(signedPercent(-5.6), '−6%');
  assert.equal(signedDecimal(2.31), '+2.3%');
  assert.equal(signedDecimal(-0.05), '−0.1%');
  assert.equal(wholePercent(0.4), '<1%');
  assert.equal(wholePercent(57.5), '58%');
  assert.equal(wholePercent(0), '0%');
});
