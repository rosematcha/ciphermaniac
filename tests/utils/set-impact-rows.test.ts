/**
 * The Set Impact table's rows: averaging a set's majors, integrating them
 * over the time they cover, filtering reprints for the new-to-Standard view,
 * and sorting with thin sets and unknown rotations last.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultDirection,
  formatShare,
  MIN_MAJORS,
  monthYear,
  setImpactRows,
  sortSetImpactRows
} from '../../src/utils/setImpactRows.ts';
import type { SetImpactPayload, SetImpactSet } from '../../shared/setImpact/types.ts';

function set(over: Partial<SetImpactSet> & Pick<SetImpactSet, 'code'>): SetImpactSet {
  return {
    name: over.code,
    legalFrom: '2024-01-01',
    rotatesOn: '2027-01-01',
    rotationPredicted: true,
    legalYears: 3,
    events: [0, 1],
    // The first major stands for half a year, the second for a whole one.
    weights: [0.5, 1],
    series: { legal: [1, 3], new: [0.5, 0.5] },
    cards: [],
    ...over
  };
}

const FULL = Array.from({ length: MIN_MAJORS }, (_, i) => i);

const PAYLOAD: SetImpactPayload = {
  generatedAt: '2026-09-22T00:00:00.000Z',
  rotations: [],
  events: [],
  sets: [
    set({
      code: 'AAA',
      cards: [
        { name: 'Reprint', set: 'AAA', number: '001', isNew: false, share: 0.9, majors: 2 },
        // Credited at one of the two majors: half its share reaches the set's figure.
        { name: 'Debut', set: 'AAA', number: '002', isNew: true, share: 0.3, majors: 1 }
      ]
    }),
    set({ code: 'BBB', legalFrom: '2025-01-01', legalYears: null, rotatesOn: null }),
    set({
      code: 'CCC',
      legalFrom: '2023-01-01',
      legalYears: 1,
      events: FULL,
      weights: FULL.map(() => 0.1),
      series: { legal: FULL.map(() => 0.25), new: FULL.map(() => 0.25) }
    })
  ]
};

test('a row averages its majors and integrates them over the time they cover', () => {
  const [aaa, bbb, ccc] = setImpactRows(PAYLOAD, 'legal');
  assert.equal(aaa.perMajor, 2);
  assert.equal(aaa.lifetime, 3.5);
  assert.equal(aaa.majors, 2);
  // No rotation date still gives a lifetime to date, just no coverage.
  assert.equal(bbb.lifetime, 3.5);
  assert.equal(bbb.coverage, null);
  assert.ok(Math.abs(ccc.lifetime - 0.2) < 1e-9);
  assert.equal(setImpactRows(PAYLOAD, 'new')[0].lifetime, 0.75);
});

test('only a set seen at enough majors ranks', () => {
  const [aaa, , ccc] = setImpactRows(PAYLOAD, 'legal');
  assert.equal(aaa.ranked, false);
  assert.equal(ccc.ranked, true);
});

test('cards carry their share and contribution, and new-to-Standard drops reprints', () => {
  const legal = setImpactRows(PAYLOAD, 'legal')[0].cards;
  assert.deepEqual(
    legal.map(card => [card.name, card.share, card.contribution]),
    [
      ['Reprint', 0.9, 0.9],
      ['Debut', 0.3, 0.15]
    ]
  );
  assert.deepEqual(
    setImpactRows(PAYLOAD, 'new')[0].cards.map(card => card.name),
    ['Debut']
  );
});

test('figures sort ranked sets first, then unknown values last in either direction', () => {
  const rows = setImpactRows(PAYLOAD, 'legal');
  // AAA and BBB tie on lifetime; the older set breaks the tie.
  assert.deepEqual(
    sortSetImpactRows(rows, 'lifetime', 'descending').map(row => row.code),
    ['CCC', 'AAA', 'BBB']
  );
  assert.deepEqual(
    sortSetImpactRows(rows, 'lifetime', 'ascending').map(row => row.code),
    ['CCC', 'AAA', 'BBB']
  );
  assert.deepEqual(
    sortSetImpactRows(rows, 'years', 'descending').map(row => row.code),
    ['CCC', 'AAA', 'BBB']
  );
  // Names and dates ignore the floor.
  assert.deepEqual(
    sortSetImpactRows(rows, 'legalFrom', 'ascending').map(row => row.code),
    ['CCC', 'AAA', 'BBB']
  );
  assert.deepEqual(
    sortSetImpactRows(rows, 'name', 'descending').map(row => row.code),
    ['CCC', 'BBB', 'AAA']
  );
});

test('names and dates sort up first, figures down', () => {
  assert.equal(defaultDirection('name'), 'ascending');
  assert.equal(defaultDirection('rotatesOn'), 'ascending');
  assert.equal(defaultDirection('lifetime'), 'descending');
});

test('shares are whole percents and dates read as month and year', () => {
  assert.equal(formatShare(0.854), '85%');
  assert.equal(formatShare(0.004), '<1%');
  assert.equal(formatShare(0), '0%');
  assert.equal(monthYear('2026-04-10'), 'Apr 2026');
  assert.equal(monthYear('2025-01-01'), 'Jan 2025');
});

test('a row carries its series, the span seen, coverage and staples', () => {
  const payload: SetImpactPayload = {
    ...PAYLOAD,
    events: [
      { date: '2024-01-01', name: 'A', players: 100 },
      { date: '2025-07-02', name: 'B', players: 100 }
    ]
  };
  const [aaa, , ccc] = setImpactRows(payload, 'legal');
  assert.deepEqual(aaa.series, [1, 3]);
  assert.equal(aaa.seenFrom, '2024-01-01');
  assert.equal(aaa.seenUntil, '2025-07-02');
  // The majors cover a year and a half of a three-year life.
  assert.equal(aaa.coverage, 0.5);
  assert.ok(Math.abs((ccc.coverage ?? 0) - 0.8) < 1e-9);
  // Reprint is in 90% of decks, a staple; Debut at 30% is not.
  assert.deepEqual(
    aaa.cards.map(card => [card.name, card.staple]),
    [
      ['Reprint', true],
      ['Debut', false]
    ]
  );
  assert.equal(aaa.staples, 0.9);
});
