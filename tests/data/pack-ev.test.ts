/**
 * Pack EV: the slot model, the bulk floor, and the per-card contributions.
 *
 * The arithmetic here is the whole tool — a wrong bulk floor or a mis-resolved
 * remainder moves the headline number without anything failing — so these pin
 * a hand-computable fixture rather than a snapshot.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { cardValue, computePackEv, resolveChances, selectPool, topCardContributions } from '../../shared/packEv/ev.ts';
import type { BulkRates, PackCard, PackSlot } from '../../shared/packEv/types.ts';

const BULK: BulkRates = { commonUncommon: 0.035, reverse: 0.05, rare: 0.05, doubleRare: 0.6, hit: 0.05 };

function card(over: Partial<PackCard> & { id: number }): PackCard {
  return { name: `Card ${over.id}`, number: `00${over.id}/010`, rarity: 'Common', prices: {}, ...over };
}

const CARDS: PackCard[] = [
  card({ id: 1, rarity: 'Common', prices: { normal: 0.1, reverse: 0.2 } }),
  card({ id: 2, rarity: 'Common', prices: { normal: 4, reverse: 0.2 } }),
  card({ id: 3, rarity: 'Rare', prices: { holofoil: 0.3, reverse: 0.4 } }),
  card({ id: 4, rarity: 'Hyper Rare', prices: { holofoil: 30 } }),
  card({ id: 5, rarity: 'Hyper Rare', prices: { holofoil: 10 } }),
  card({ id: 6, rarity: 'Common', pattern: 'pokeball', prices: { holofoil: 2 } })
];

const SLOTS: PackSlot[] = [
  {
    label: 'Commons',
    count: 2,
    outcomes: [{ label: 'Common', pool: { rarities: ['Common'], printing: 'normal', bulk: 'commonUncommon' } }]
  },
  {
    label: 'Reverse',
    outcomes: [
      { label: 'Hyper Rare', chance: 0.01, pool: { rarities: ['Hyper Rare'], printing: 'holofoil', bulk: 'hit' } },
      { label: 'Reverse holo', pool: { rarities: ['Common', 'Rare'], printing: 'reverse', bulk: 'reverse' } }
    ]
  },
  { label: 'Energy', outcomes: [{ label: 'Basic Energy', flat: 'commonUncommon' }] }
];

const INPUTS = { cards: CARDS, slots: SLOTS, bulk: BULK, threshold: 1 };

test('a card counts at market only once it clears the threshold', () => {
  assert.equal(cardValue(CARDS[0], 'normal', BULK.commonUncommon, 1), 0.035);
  assert.equal(cardValue(CARDS[1], 'normal', BULK.commonUncommon, 1), 4);
  // Exactly at the threshold is still bulk: a $1 card is not worth selling.
  assert.equal(cardValue(card({ id: 9, prices: { normal: 1 } }), 'normal', BULK.commonUncommon, 1), 0.035);
  // A printing TCGplayer has no market price for falls back to bulk, not zero.
  assert.equal(cardValue(CARDS[2], 'normal', BULK.rare, 1), 0.05);
});

test('pools match on rarity and keep the special foil patterns apart', () => {
  assert.deepEqual(
    selectPool(CARDS, { rarities: ['Common'], printing: 'normal', bulk: 'commonUncommon' }).map(entry => entry.id),
    [1, 2]
  );
  assert.deepEqual(
    selectPool(CARDS, { rarities: ['Common'], printing: 'holofoil', pattern: 'pokeball', bulk: 'reverse' }).map(
      entry => entry.id
    ),
    [6]
  );
});

test('the outcome without a chance takes the remainder, and over-claiming throws', () => {
  assert.deepEqual(resolveChances(SLOTS[1].outcomes), [0.01, 0.99]);
  assert.throws(
    () => resolveChances([{ label: 'a', chance: 0.7 }, { label: 'b', chance: 0.4 }, { label: 'c' }]),
    /over 1/
  );
});

test('pack EV is the sum of every slot, counted once per card the slot holds', () => {
  const ev = computePackEv(INPUTS);
  // Commons: one bulk card at 0.035, one $4 card, averaged, twice over.
  assert.equal(ev.slots[0].contribution.toFixed(4), (((0.035 + 4) / 2) * 2).toFixed(4));
  // Reverse: 1% of the $20 hyper-rare average, plus 99% of a bulk reverse.
  const reverse = ev.slots[1];
  assert.equal(reverse.outcomes[0].averageValue, 20);
  assert.equal(reverse.outcomes[0].contribution.toFixed(4), (0.01 * 20).toFixed(4));
  assert.equal(reverse.outcomes[1].averageValue.toFixed(4), '0.0500');
  assert.equal(ev.perPack.toFixed(4), (4.035 + 0.2 + 0.0495 + 0.035).toFixed(4));
});

test('an empty pool contributes nothing rather than dividing by zero', () => {
  const ev = computePackEv({
    ...INPUTS,
    slots: [
      {
        label: 'Rare slot',
        outcomes: [{ label: 'Ultra Rare', pool: { rarities: ['Ultra Rare'], printing: 'holofoil', bulk: 'hit' } }]
      }
    ]
  });
  assert.equal(ev.perPack, 0);
  assert.equal(ev.slots[0].outcomes[0].poolSize, 0);
});

test('card contributions rank by dollars per pack and drop everything bulk', () => {
  const rows = topCardContributions(INPUTS, 10);
  assert.deepEqual(
    rows.map(row => row.card.id),
    [2, 4, 5]
  );
  // The $4 common rides a 2-card slot drawn twice: 2 × (1/2) chance.
  assert.equal(rows[0].chance, 1);
  assert.equal(rows[0].contribution, 4);
  // Each hyper rare is half of the 1% outcome.
  assert.equal(rows[1].chance.toFixed(4), '0.0050');
  assert.equal(rows[1].value, 30);
});

test('a print both reverse slots can draw is one row, carrying both slots', () => {
  const reverse = { rarities: ['Common'], printing: 'reverse' as const, bulk: 'reverse' as const };
  const rows = topCardContributions(
    {
      ...INPUTS,
      cards: [card({ id: 7, prices: { reverse: 12 } }), card({ id: 8, prices: { reverse: 0.1 } })],
      slots: [
        { label: 'First reverse holo', outcomes: [{ label: 'Reverse holo', pool: reverse }] },
        { label: 'Second reverse holo', outcomes: [{ label: 'Reverse holo', pool: reverse }] }
      ]
    },
    10
  );
  assert.equal(rows.length, 1);
  // Half of each slot's draws, twice over.
  assert.equal(rows[0].chance, 1);
  assert.equal(rows[0].contribution, 12);
});
