/**
 * Trends page chart windowing.
 *
 * The property worth guarding: the window anchors to the PAYLOAD's end date,
 * never to wall-clock now. If the daily cron lags, "now" drifts past the newest
 * data and a 7-day window slides clean off the end of the file — an empty chart
 * drawn over perfectly good data, on a page that gives no hint anything is
 * wrong. These tests run against fixed dates well in the past, so they fail if
 * anyone reintroduces a `Date.now()` into the anchoring.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOnlineChart,
  defaultOnlineWindow,
  formatDateWindow,
  type OnlineTrendReportLike,
  relativeTimeFrom,
  sliceCardMovers
} from '../../src/pages/trendsPage/model.ts';

/** A report whose dates are years in the past — wall-clock anchoring cannot reach them. */
function report(overrides: Partial<OnlineTrendReportLike> = {}): OnlineTrendReportLike {
  return {
    windowEnd: '2020-01-10',
    series: [
      {
        base: 'alpha',
        displayName: 'Alpha',
        avgShare: 30,
        timeline: [
          { date: '2020-01-05', share: 20 },
          { date: '2020-01-08', share: 30 },
          { date: '2020-01-10', share: 40 }
        ]
      },
      {
        base: 'beta',
        displayName: 'Beta',
        avgShare: 50,
        timeline: [
          { date: '2020-01-05', share: 50 },
          { date: '2020-01-10', share: 60 }
        ]
      }
    ],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Anchoring — the reason this module exists
// ---------------------------------------------------------------------------

test('the window anchors to the payload, not the clock', () => {
  // Every date here is years old. Anchored to `now`, the cutoff would exclude
  // all of it and the chart would be empty.
  const chart = buildOnlineChart(report(), 7);
  assert.ok(chart.days.length > 0, 'stale data must still chart');
  assert.equal(chart.series.length, 2);
});

test('a missing windowEnd falls back to the latest timeline point, still not the clock', () => {
  const chart = buildOnlineChart(report({ windowEnd: undefined }), 7);
  assert.ok(chart.days.length > 0);
  assert.equal(chart.days[chart.days.length - 1].key, '2020-01-10');
});

test('an unparseable windowEnd falls back the same way', () => {
  const chart = buildOnlineChart(report({ windowEnd: 'not-a-date' }), 7);
  assert.ok(chart.days.length > 0);
});

test('the window is inclusive of the anchor day', () => {
  // A 3-day window anchored at Jan 10 admits Jan 8, 9, 10 — not Jan 7.
  const chart = buildOnlineChart(report(), 3);
  assert.deepEqual(
    chart.days.map(d => d.key),
    ['2020-01-08', '2020-01-10']
  );
});

test('a wider window admits the earlier dates', () => {
  const chart = buildOnlineChart(report(), 30);
  assert.deepEqual(
    chart.days.map(d => d.key),
    ['2020-01-05', '2020-01-08', '2020-01-10']
  );
});

// ---------------------------------------------------------------------------
// Series projection
// ---------------------------------------------------------------------------

test('series rank by the file s own average, so colours stay stable', () => {
  // Beta has the higher avgShare even though Alpha appears first in the file.
  const chart = buildOnlineChart(report(), 30);
  assert.deepEqual(
    chart.series.map(s => s.name),
    ['beta', 'alpha']
  );
});

test('a day an archetype skipped becomes a null point, not a gap in the array', () => {
  const chart = buildOnlineChart(report(), 30);
  const beta = chart.series.find(s => s.name === 'beta');
  assert.ok(beta);
  assert.equal(beta.points.length, chart.days.length);
  assert.deepEqual(beta.points, [50, null, 60], 'beta has no Jan 8 point');
});

test('the legend average is recomputed for the visible window', () => {
  // Alpha's file-wide avgShare is 30; inside a 3-day window it only has Jan 8
  // (30) and Jan 10 (40), so the legend should read 35.
  const chart = buildOnlineChart(report(), 3);
  const alpha = chart.series.find(s => s.name === 'alpha');
  assert.equal(alpha?.avg, 35);
});

test('an archetype with no points in the window keeps its file-wide average', () => {
  const only = report({
    series: [{ base: 'gamma', displayName: 'Gamma', avgShare: 12, timeline: [{ date: '2019-01-01', share: 5 }] }],
    windowEnd: '2020-01-10'
  });
  const chart = buildOnlineChart(only, 7);
  // No dates survive the cutoff, so there is nothing to chart at all.
  assert.deepEqual(chart, { series: [], days: [] });
});

test('day bins are sorted ascending', () => {
  const shuffled = report({
    series: [
      {
        base: 'a',
        displayName: 'A',
        avgShare: 1,
        timeline: [
          { date: '2020-01-10', share: 1 },
          { date: '2020-01-05', share: 2 },
          { date: '2020-01-08', share: 3 }
        ]
      }
    ]
  });
  assert.deepEqual(
    buildOnlineChart(shuffled, 30).days.map(d => d.key),
    ['2020-01-05', '2020-01-08', '2020-01-10']
  );
});

// ---------------------------------------------------------------------------
// Degenerate input
// ---------------------------------------------------------------------------

test('an absent or empty report charts nothing', () => {
  assert.deepEqual(buildOnlineChart(null, 7), { series: [], days: [] });
  assert.deepEqual(buildOnlineChart(undefined, 7), { series: [], days: [] });
  assert.deepEqual(buildOnlineChart({ series: [] }, 7), { series: [], days: [] });
});

test('a report whose dates are all unparseable charts nothing', () => {
  const broken = report({
    windowEnd: undefined,
    series: [{ base: 'a', displayName: 'A', avgShare: 1, timeline: [{ date: 'garbage', share: 1 }] }]
  });
  assert.deepEqual(buildOnlineChart(broken, 7), { series: [], days: [] });
});

test('a series with no timeline is tolerated', () => {
  const chart = buildOnlineChart(report({ series: [{ base: 'a', displayName: 'A', avgShare: 1 }] }), 7);
  assert.deepEqual(chart, { series: [], days: [] });
});

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

const NOW = Date.parse('2026-06-01T12:00:00Z');

test('relative time reads in the largest sensible unit', () => {
  assert.equal(relativeTimeFrom('2026-06-01T11:59:40Z', NOW), 'just now');
  assert.equal(relativeTimeFrom('2026-06-01T11:59:00Z', NOW), '1 minute ago');
  assert.equal(relativeTimeFrom('2026-06-01T11:30:00Z', NOW), '30 minutes ago');
  assert.equal(relativeTimeFrom('2026-06-01T09:00:00Z', NOW), '3 hours ago');
  assert.equal(relativeTimeFrom('2026-05-30T12:00:00Z', NOW), '2 days ago');
});

test('relative time handles the singular hour and day', () => {
  assert.equal(relativeTimeFrom('2026-06-01T11:00:00Z', NOW), '1 hour ago');
  assert.equal(relativeTimeFrom('2026-05-31T12:00:00Z', NOW), '1 day ago');
});

test('an absent or unparseable timestamp has no relative phrase', () => {
  assert.equal(relativeTimeFrom(undefined, NOW), null);
  assert.equal(relativeTimeFrom('not-a-date', NOW), null);
});

test('a date window reads as a span', () => {
  assert.equal(formatDateWindow('2026-06-06', '2026-07-06'), 'Jun 6 to Jul 6');
});

test('a window with an unparseable end has no phrase', () => {
  assert.equal(formatDateWindow('2026-06-06', 'nope'), null);
  assert.equal(formatDateWindow(undefined, '2026-07-06'), null);
});

// ---------------------------------------------------------------------------
// Movers
// ---------------------------------------------------------------------------

test('movers are capped per direction', () => {
  const many = Array.from({ length: 30 }, (_, i) => i);
  const out = sliceCardMovers({ rising: many, falling: many }, 12);
  assert.equal(out.rising.length, 12);
  assert.equal(out.falling.length, 12);
  assert.equal(out.rising[0], 0, 'the top movers, not a random slice');
});

test('absent mover lists become empty ones', () => {
  assert.deepEqual(sliceCardMovers(null), { rising: [], falling: [] });
  assert.deepEqual(sliceCardMovers({}), { rising: [], falling: [] });
});

// ---------------------------------------------------------------------------
// Opening window
// ---------------------------------------------------------------------------

/** Stand in for the browser's matchMedia with a fixed answer. */
function withViewport<T>(narrow: boolean, run: () => T): T {
  const g = globalThis as { window?: unknown };
  const prev = g.window;
  g.window = { matchMedia: () => ({ matches: narrow }) };
  try {
    return run();
  } finally {
    g.window = prev;
  }
}

test('the online view opens on two weeks, or one on a phone', () => {
  assert.equal(withViewport(false, defaultOnlineWindow), '14d');
  assert.equal(withViewport(true, defaultOnlineWindow), '7d');
});
