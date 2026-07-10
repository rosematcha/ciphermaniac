import test from 'node:test';
import assert from 'node:assert/strict';

import { DAY_MS, parseReportDate, windowCutoff } from '../../src/lib/trendWindow.ts';

test('parseReportDate handles a full ISO windowEnd without corrupting it', () => {
  // Regression for P-11: the producer emits `toISOString()`, so windowEnd can be
  // a full timestamp. The old `${value}T12:00:00Z` concatenation made this NaN,
  // which fell back to Date.now(). It must parse to a finite ms value.
  const iso = '2026-07-09T01:00:00.000Z';
  const ms = parseReportDate(iso);
  assert.ok(Number.isFinite(ms), 'full ISO windowEnd must parse');
  assert.equal(ms, Date.parse(iso));
});

test('parseReportDate anchors a bare YYYY-MM-DD to noon UTC', () => {
  assert.equal(parseReportDate('2026-07-09'), Date.parse('2026-07-09T12:00:00Z'));
});

test('parseReportDate returns NaN for junk instead of a silent fallback', () => {
  assert.ok(Number.isNaN(parseReportDate('not-a-date')));
  assert.ok(Number.isNaN(parseReportDate(undefined)));
});

test('windowCutoff is inclusive of the anchor day (no N+1 drift)', () => {
  const anchor = Date.parse('2026-07-09T12:00:00Z');
  // A 7-day window ending on the 9th includes the 3rd..9th — cutoff is anchor
  // minus 6 days, not 7.
  assert.equal(windowCutoff(anchor, 7), anchor - 6 * DAY_MS);
  // The oldest included day (the 3rd at noon) is >= cutoff; the day before (the
  // 2nd) is not.
  assert.ok(Date.parse('2026-07-03T12:00:00Z') >= windowCutoff(anchor, 7));
  assert.ok(Date.parse('2026-07-02T12:00:00Z') < windowCutoff(anchor, 7));
});
