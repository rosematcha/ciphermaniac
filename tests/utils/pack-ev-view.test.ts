/**
 * How /tools/pack-ev words its numbers.
 *
 * The page is nothing but figures, so the formatting rules are load-bearing:
 * a bulk rate rounded to the cent misstates its own source by 14%, and odds
 * have to read the way the pull-rate articles write them.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  money,
  oddsLabel,
  priceDate,
  primaryProduct,
  rate,
  returnPercent,
  sealedRows,
  shareLabel,
  slotRows
} from '../../src/pages/packEv/model.ts';
import type { PackEvSetPayload, SealedProduct, SlotEv } from '../../shared/packEv/types.ts';

function sealed(over: Partial<SealedProduct> & { id: number }): SealedProduct {
  return { kind: 'box', label: 'Booster Box', packs: 36, price: 100, url: 'https://example.invalid', ...over };
}

const PAYLOAD: Pick<PackEvSetPayload, 'ev' | 'sealed'> = {
  ev: { perPack: 3.25, slots: [] },
  sealed: [
    sealed({ id: 1, label: 'Booster Box', packs: 36, price: 356.09, primary: true }),
    sealed({ id: 2, kind: 'pack', label: 'Single Pack', packs: 1, price: 9.09 }),
    sealed({ id: 3, kind: 'bundle', label: 'Booster Bundle', packs: 6, price: null })
  ]
};

test('money is always to the cent; buylist rates keep their tenth', () => {
  assert.equal(money(3.2), '$3.20');
  assert.equal(money(356.094), '$356.09');
  assert.equal(rate(0.035), '$0.035');
  assert.equal(rate(0.05), '$0.05');
  assert.equal(rate(0.6), '$0.60');
});

test('odds read as the pull-rate articles write them', () => {
  assert.equal(oddsLabel(1), 'Every pack');
  assert.equal(oddsLabel(0.0068), '1 in 147');
  assert.equal(oddsLabel(0.0773), '1 in 13');
  // Past a fifth of packs, "1 in 3" is a clumsier way to say a third.
  assert.equal(oddsLabel(0.331), '33% of packs');
  assert.equal(oddsLabel(0), '—');
});

test('a share of runs keeps a decimal while it is small', () => {
  assert.equal(shareLabel(0.042), '4.2%');
  assert.equal(shareLabel(0.5), '50%');
});

test('return is what the contents give back per dollar, or nothing to compare', () => {
  assert.equal(returnPercent(3.25, 9.89), 33);
  assert.equal(returnPercent(3.25, null), null);
  assert.equal(returnPercent(3.25, 0), null);
});

test('sealed rows rank by cost per pack, with unpriced products last', () => {
  const rows = sealedRows(PAYLOAD);
  assert.deepEqual(
    rows.map(row => row.product.label),
    ['Single Pack', 'Booster Box', 'Booster Bundle']
  );
  assert.equal(rows[1].costPerPack?.toFixed(2), '9.89');
  assert.equal(rows[1].contentsValue.toFixed(2), '117.00');
  assert.equal(rows[1].returnPercent, 33);
  // No market price means no comparison, not a zero.
  assert.equal(rows[2].costPerPack, null);
  assert.equal(rows[2].returnPercent, null);
});

test('the primary product is the one the set is bought by', () => {
  assert.equal(primaryProduct(PAYLOAD)?.label, 'Booster Box');
  assert.equal(primaryProduct({ sealed: [sealed({ id: 9, label: 'Only Product' })] })?.label, 'Only Product');
  assert.equal(primaryProduct({ sealed: [] }), null);
});

test('slot rows lead with the money and name the slot once', () => {
  const slots: SlotEv[] = [
    {
      label: 'Second reverse holo',
      count: 1,
      contribution: 2.21,
      outcomes: [
        { label: 'Reverse holo', chance: 0.9, poolSize: 147, averageValue: 0.06, contribution: 0.06 },
        { label: 'Illustration Rare', chance: 0.0773, poolSize: 21, averageValue: 16.49, contribution: 1.27 }
      ]
    },
    {
      label: 'Commons',
      count: 4,
      contribution: 0.14,
      outcomes: [{ label: 'Common', chance: 1, poolSize: 76, averageValue: 0.035, contribution: 0.14 }]
    }
  ];
  const rows = slotRows(slots);
  assert.deepEqual(
    rows.map(row => [row.slot, row.outcome, row.count]),
    [
      ['Second reverse holo', 'Illustration Rare', 1],
      [null, 'Reverse holo', null],
      ['Commons', 'Common', 4]
    ]
  );
  assert.equal(rows[0].key, 'Second reverse holo:Illustration Rare');
});

test('the price date is the day the job ran, and a bad stamp prints nothing', () => {
  assert.match(priceDate('2026-09-16T15:42:43.969Z'), /16 Sep(t)? 2026/);
  assert.equal(priceDate('not a date'), '');
});
