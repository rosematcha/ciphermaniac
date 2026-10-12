/**
 * The Rising graphic's baseline: which recent events it pools, and how a card
 * that only became legal partway through that window is weighed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { baselineRate, baselineTournaments } from '../../src/pages/socialGraphics/baseline.ts';
import type { EventField } from '../../src/pages/socialGraphics/eventField.ts';

const LIST = [
  'Online - Last 14 Days',
  '2026-10-10, Regional Louisville, KY',
  '2026-10-03, Regional Recife',
  '2026-09-26, Regional Brisbane',
  '2026-09-26, Regional Frankfurt',
  '2026-09-18, Regional Baltimore, MD',
  '2026-09-12, Regional Milwaukee, WI'
];

test('the baseline pools every event of the last three weekends before the selected one', () => {
  assert.deepEqual(baselineTournaments(LIST, '2026-10-10, Regional Louisville, KY'), [
    '2026-10-03, Regional Recife',
    '2026-09-26, Regional Brisbane',
    '2026-09-26, Regional Frankfurt',
    '2026-09-18, Regional Baltimore, MD'
  ]);
});

test('a Friday start shares its weekend with that Sunday', () => {
  const list = ['2026-09-20, Cup Sunday', '2026-09-18, Regional Friday', '2026-09-12, Old'];
  assert.deepEqual(baselineTournaments(list, '2026-10-10, Selected'), list);
});

test('nothing older than two months counts, even short of three weekends', () => {
  const list = ['2026-10-03, Recent', '2026-08-01, Stale'];
  assert.deepEqual(baselineTournaments(list, '2026-10-10, Selected'), ['2026-10-03, Recent']);
});

test('an undated selection anchors on now', () => {
  const now = Date.UTC(2026, 9, 12);
  assert.deepEqual(baselineTournaments(LIST, 'Online - Last 14 Days', now).slice(0, 1), [
    '2026-10-10, Regional Louisville, KY'
  ]);
});

function field(deckTotal: number, found: number, sets: string[]): EventField {
  return {
    deckTotal,
    cards: new Map([['Mew::NEW::030', { found, day1: 0, day2: 0 }]]),
    sets: new Set(sets),
    fieldConversion: null
  };
}

test('events before a card was legal are left out, not counted as zeros', () => {
  const fields = [field(100, 50, ['NEW', 'OLD']), field(300, 0, ['OLD'])];
  assert.deepEqual(baselineRate(fields, 'Mew::NEW::030', 'NEW'), { found: 50, total: 100 });
  assert.deepEqual(baselineRate(fields, 'Other::OLD::001', 'OLD'), { found: 0, total: 400 });
  assert.equal(baselineRate([field(300, 0, ['OLD'])], 'Mew::NEW::030', 'NEW'), null);
});
