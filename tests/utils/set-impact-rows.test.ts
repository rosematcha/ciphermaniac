/**
 * The Set Impact table's rows: averaging a set's majors, multiplying by its
 * years in Standard, filtering reprints for the new-to-Standard view, and
 * sorting with unknown rotations last.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultDirection,
  formatShare,
  monthYear,
  setImpactRows,
  sortSetImpactRows
} from '../../src/utils/setImpactRows.ts';
import type { SetImpactPayload, SetImpactSet } from '../../shared/setImpactTypes.ts';

function set(over: Partial<SetImpactSet> & Pick<SetImpactSet, 'code'>): SetImpactSet {
  return {
    name: over.code,
    legalFrom: '2024-01-01',
    rotatesOn: '2027-01-01',
    rotationPredicted: true,
    legalYears: 3,
    events: [0, 1],
    series: {
      legal: { linear: [1, 3], weighted: [2, 4] },
      new: { linear: [0.5, 0.5], weighted: [1, 1] }
    },
    cards: [],
    ...over
  };
}

const PAYLOAD: SetImpactPayload = {
  generatedAt: '2026-09-22T00:00:00.000Z',
  rotations: [],
  events: [],
  sets: [
    set({
      code: 'AAA',
      cards: [
        { name: 'Reprint', set: 'AAA', number: '001', isNew: false, linear: 0.9, weighted: 0.2 },
        { name: 'Debut', set: 'AAA', number: '002', isNew: true, linear: 0.3, weighted: 0.6 }
      ]
    }),
    set({ code: 'BBB', legalFrom: '2025-01-01', legalYears: null, rotatesOn: null }),
    set({
      code: 'CCC',
      legalFrom: '2023-01-01',
      legalYears: 1,
      series: { legal: { linear: [9], weighted: [9] }, new: { linear: [9], weighted: [9] } },
      events: [0]
    })
  ]
};

test('a row averages its majors and multiplies by its years', () => {
  const [aaa, bbb] = setImpactRows(PAYLOAD, 'legal', 'linear');
  assert.equal(aaa.perMajor, 2);
  assert.equal(aaa.lifetime, 6);
  assert.equal(aaa.majors, 2);
  assert.equal(bbb.lifetime, null);
  assert.equal(setImpactRows(PAYLOAD, 'new', 'weighted')[0].lifetime, 3);
});

test('cards follow the metric, and new-to-Standard drops reprints', () => {
  const legal = setImpactRows(PAYLOAD, 'legal', 'weighted')[0].cards;
  assert.deepEqual(
    legal.map(card => [card.name, card.share]),
    [
      ['Debut', 0.6],
      ['Reprint', 0.2]
    ]
  );
  assert.deepEqual(
    setImpactRows(PAYLOAD, 'new', 'linear')[0].cards.map(card => card.name),
    ['Debut']
  );
});

test('sorting puts unknown values last in either direction', () => {
  const rows = setImpactRows(PAYLOAD, 'legal', 'linear');
  assert.deepEqual(
    sortSetImpactRows(rows, 'lifetime', 'descending').map(row => row.code),
    ['CCC', 'AAA', 'BBB']
  );
  assert.deepEqual(
    sortSetImpactRows(rows, 'lifetime', 'ascending').map(row => row.code),
    ['AAA', 'CCC', 'BBB']
  );
  assert.deepEqual(
    sortSetImpactRows(rows, 'legalFrom', 'ascending').map(row => row.code),
    ['CCC', 'AAA', 'BBB']
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
