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
  artNumber,
  isChase,
  mergePulls,
  money,
  oddsLabel,
  priceDate,
  rate,
  returnPercent,
  sealedRows,
  slotRows,
  sortStacks
} from '../../src/pages/packEv/model.ts';
import type { Pull } from '../../shared/packEv/simulate.ts';
import type { PackEvSetPayload, SealedProduct, SlotEv } from '../../shared/packEv/types.ts';

function sealed(over: Partial<SealedProduct> & { id: number }): SealedProduct {
  return { kind: 'box', label: 'Booster Box', packs: 36, price: 100, url: 'https://example.invalid', ...over };
}

const PAYLOAD: Pick<PackEvSetPayload, 'ev' | 'sealed'> = {
  ev: { perPack: 3.25, slots: [] },
  sealed: [
    sealed({ id: 1, label: 'Booster Box', packs: 36, price: 356.09 }),
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

function pull(id: number, value: number, printing: Pull['printing'] = 'holofoil'): Pull {
  return {
    slot: 'Rare slot',
    outcome: 'Illustration Rare',
    card: { id, name: `Card ${id}`, number: `${id}/167`, rarity: 'Illustration Rare', prices: {} },
    printing,
    value,
    notable: value > 1
  };
}

const ENERGY: Pull = {
  slot: 'Energy',
  outcome: 'Basic Energy',
  card: null,
  printing: null,
  value: 0.035,
  notable: false
};

test('identical prints stack across rips; a different printing is its own stack', () => {
  const first = mergePulls([], [pull(1, 50), pull(2, 5), pull(1, 50), ENERGY], 1);
  const stacks = mergePulls(first, [pull(2, 5), pull(2, 0.2, 'reverse'), ENERGY], 2);
  const byKey = Object.fromEntries(stacks.map(entry => [entry.key, [entry.count, entry.first, entry.last]]));
  assert.deepEqual(byKey, {
    '1:holofoil': [2, 1, 1],
    '2:holofoil': [2, 1, 2],
    '2:reverse': [1, 2, 2],
    'flat:Basic Energy': [2, 1, 2]
  });
});

test('stacks sort by value, or by the rip that last touched them', () => {
  const stacks = mergePulls(mergePulls([], [pull(1, 50), pull(3, 5)], 1), [pull(2, 12), pull(3, 5)], 2);
  assert.deepEqual(
    sortStacks(stacks, 'value').map(entry => entry.pull.card?.id),
    [1, 2, 3]
  );
  // Rip 2 touched cards 2 and 3; the bigger stack leads the tie.
  assert.deepEqual(
    sortStacks(stacks, 'newest').map(entry => entry.pull.card?.id),
    [3, 2, 1]
  );
  // A bulk pile reads biggest stack first; value breaks the tie.
  assert.deepEqual(
    sortStacks(stacks, 'count').map(entry => entry.pull.card?.id),
    [3, 1, 2]
  );
});

test('card art is keyed by the number without its set total', () => {
  assert.equal(artNumber('188/167'), '188');
  assert.equal(artNumber('SWSH001'), 'SWSH001');
});

test('special illustration, hyper, and secret rares are chases, as is anything pricey', () => {
  const card = (rarity: string, value: number): Pull => ({
    ...pull(9, value),
    card: { id: 9, name: 'Card 9', number: '9/167', rarity, prices: {} }
  });
  assert.equal(isChase(card('Special Illustration Rare', 20)), true);
  assert.equal(isChase(card('Hyper Rare', 8)), true);
  assert.equal(isChase(card('Secret Rare', 8)), true);
  assert.equal(isChase(card('Illustration Rare', 12)), false);
  assert.equal(isChase(card('Double Rare', 60)), true);
  assert.equal(isChase(ENERGY), false);
});
