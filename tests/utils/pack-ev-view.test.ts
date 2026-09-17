/**
 * How /tools/pack-ev words its numbers.
 *
 * The page is nothing but figures, so the formatting rules are load-bearing:
 * a bulk rate rounded to the cent misstates its own source by 14%, and a loss
 * has to be the same whole-number figure the return is, from the other side.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  artNumber,
  isChase,
  lossPercent,
  mergePulls,
  money,
  priceDate,
  productImage,
  rate,
  returnPercent,
  sortStacks
} from '../../src/pages/packEv/model.ts';
import type { Pull } from '../../shared/packEv/simulate.ts';
test('money is always to the cent; buylist rates keep their tenth', () => {
  assert.equal(money(3.2), '$3.20');
  assert.equal(money(356.094), '$356.09');
  assert.equal(rate(0.035), '$0.035');
  assert.equal(rate(0.05), '$0.05');
  assert.equal(rate(0.6), '$0.60');
});

test('return is what the contents give back per dollar, or nothing to compare', () => {
  assert.equal(returnPercent(3.25, 9.89), 33);
  assert.equal(returnPercent(3.25, null), null);
  assert.equal(returnPercent(3.25, 0), null);
});

test('loss is the rest of the price, negative when a pack is worth more than it costs', () => {
  assert.equal(lossPercent(3.25, 9.89), 67);
  assert.equal(lossPercent(12, 10), -20);
  assert.equal(lossPercent(3.25, null), null);
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

test('a reprint shows its TCGplayer product photo, keyed by product id', () => {
  assert.equal(productImage(714372), 'https://tcgplayer-cdn.tcgplayer.com/product/714372_200w.jpg');
});

test('special illustration, hyper, secret, and futuristic rares are chases, as is anything pricey', () => {
  const card = (rarity: string, value: number): Pull => ({
    ...pull(9, value),
    card: { id: 9, name: 'Card 9', number: '9/167', rarity, prices: {} }
  });
  assert.equal(isChase(card('Special Illustration Rare', 20)), true);
  assert.equal(isChase(card('Hyper Rare', 8)), true);
  assert.equal(isChase(card('Secret Rare', 8)), true);
  assert.equal(isChase(card('Futuristic Rare', 30)), true);
  assert.equal(isChase(card('Illustration Rare', 12)), false);
  assert.equal(isChase(card('Double Rare', 60)), true);
  assert.equal(isChase(ENERGY), false);
});
