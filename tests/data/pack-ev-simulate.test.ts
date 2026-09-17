/**
 * Pack opening: the sampler has to agree with the averager.
 *
 * If the simulator drifts from the EV table — a mis-stacked cumulative
 * probability, an off-by-one on the pool index — the tool tells two different
 * stories about the same pack. The convergence test is the one that catches
 * that, so it runs enough packs to make the tolerance meaningful.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { computePackEv } from '../../shared/packEv/ev.ts';
import { openPack, possibleHits, type PreparedPack, preparePack } from '../../shared/packEv/simulate.ts';
import type { BulkRates, PackCard, PackSlot } from '../../shared/packEv/types.ts';

/** Deterministic PRNG so a failure is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const BULK: BulkRates = { commonUncommon: 0.035, reverse: 0.05, rare: 0.05, doubleRare: 0.6, hit: 0.05 };

const CARDS: PackCard[] = [
  { id: 1, name: 'Bulk One', number: '001/010', rarity: 'Common', prices: { normal: 0.1, reverse: 0.1 } },
  { id: 2, name: 'Bulk Two', number: '002/010', rarity: 'Common', prices: { normal: 0.1, reverse: 0.1 } },
  { id: 3, name: 'Chase', number: '011/010', rarity: 'Hyper Rare', prices: { holofoil: 100 } },
  { id: 4, name: 'Lesser Chase', number: '012/010', rarity: 'Hyper Rare', prices: { holofoil: 20 } }
];

const SLOTS: PackSlot[] = [
  {
    label: 'Commons',
    count: 3,
    outcomes: [{ label: 'Common', pool: { rarities: ['Common'], printing: 'normal', bulk: 'commonUncommon' } }]
  },
  {
    label: 'Reverse',
    outcomes: [
      { label: 'Hyper Rare', chance: 0.25, pool: { rarities: ['Hyper Rare'], printing: 'holofoil', bulk: 'hit' } },
      { label: 'Reverse holo', pool: { rarities: ['Common'], printing: 'reverse', bulk: 'reverse' } }
    ]
  },
  { label: 'Energy', outcomes: [{ label: 'Basic Energy', flat: 'commonUncommon' }] }
];

const INPUTS = { cards: CARDS, slots: SLOTS, bulk: BULK, threshold: 1 };

/** Total value of `packs` openings. */
function openedValue(pack: PreparedPack, packs: number, rng: () => number): number {
  let total = 0;
  for (let opened = 0; opened < packs; opened += 1) {
    total += openPack(pack, rng).reduce((sum, pull) => sum + pull.value, 0);
  }
  return total;
}

test('an unpriced pull carries its stand-in value and counts as a hit', () => {
  const pack = preparePack({
    ...INPUTS,
    cards: [{ id: 9, name: 'Mew', number: 'R/RGB', rarity: 'Holo Rare', prices: {} }],
    slots: [
      {
        label: 'Rare slot',
        outcomes: [
          {
            label: 'RGB Rare',
            pool: { rarities: ['Holo Rare'], printing: 'holofoil', bulk: 'hit', unpriced: 5000 }
          }
        ]
      }
    ]
  });
  const [pull] = openPack(pack, () => 0);
  assert.equal(pull.value, 5000);
  assert.equal(pull.notable, true);
});

test('a pack holds one card per slot draw, energy included', () => {
  const pulls = openPack(preparePack(INPUTS), mulberry32(7));
  assert.equal(pulls.length, 5);
  assert.deepEqual(
    pulls.map(pull => pull.slot),
    ['Commons', 'Commons', 'Commons', 'Reverse', 'Energy']
  );
  assert.equal(pulls[4].card, null);
  assert.equal(pulls[4].value, 0.035);
});

test('the roll picks the outcome, and the second roll picks the card', () => {
  const pack = preparePack(INPUTS);
  // Rolls are consumed outcome-then-card per draw; 0 takes the first of each.
  const scripted = (rolls: number[]) => {
    let index = 0;
    return openPack(pack, () => rolls[index++]);
  };
  const first = scripted([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(first[3].outcome, 'Hyper Rare');
  assert.equal(first[3].card?.name, 'Chase');
  assert.equal(first[3].value, 100);
  assert.equal(first[3].notable, true);
  // A bulk-floored common is not a hit, however the pack rendered it.
  assert.equal(first[0].notable, false);
  // Same outcome, later card roll: the other half of the pool.
  const second = scripted([0, 0, 0, 0, 0, 0, 0, 0.99, 0]);
  assert.equal(second[3].card?.name, 'Lesser Chase');
});

test('a roll past the last named chance falls through to the remainder outcome', () => {
  const pulls = openPack(preparePack(INPUTS), () => 0.999);
  assert.equal(pulls[3].outcome, 'Reverse holo');
  assert.equal(pulls[3].printing, 'reverse');
});

test('sampled value converges on the EV table', () => {
  const expected = computePackEv(INPUTS).perPack;
  const packs = 20_000;
  const sampled = openedValue(preparePack(INPUTS), packs, mulberry32(99)) / packs;
  assert.ok(Math.abs(sampled - expected) < 0.5, `sampled ${sampled} vs expected ${expected}`);
});

const WITH_GOD_PACK = {
  ...INPUTS,
  specialPacks: [
    {
      label: 'God pack',
      odds: 2,
      keepSlots: ['Energy'],
      draws: [
        { kind: 'cards' as const, cards: [{ name: 'Chase', rarity: 'Hyper Rare' }] },
        {
          kind: 'random' as const,
          count: 2,
          pool: { rarities: ['Hyper Rare'], printing: 'holofoil' as const, bulk: 'hit' as const }
        }
      ]
    }
  ]
};

test('a god pack roll replaces every slot it does not keep', () => {
  const pack = preparePack(WITH_GOD_PACK);
  // First roll picks the special pack; the kept energy slot takes one roll,
  // then each random draw takes one.
  const rolls = [0, 0, 0, 0.99];
  let index = 0;
  const pulls = openPack(pack, () => rolls[index++]);
  assert.deepEqual(
    pulls.map(pull => [pull.slot, pull.card?.name ?? pull.outcome]),
    [
      ['Energy', 'Basic Energy'],
      ['God pack', 'Chase'],
      ['God pack', 'Chase'],
      ['God pack', 'Lesser Chase']
    ]
  );
  assert.equal(pulls[1].notable, true);
});

test('an ordinary roll in a set with god packs opens an ordinary pack', () => {
  const ordinary = openPack(preparePack(WITH_GOD_PACK), () => 0.99);
  assert.equal(ordinary.length, 5);
});

test('sampled value converges on the EV table with god packs in the mix', () => {
  const expected = computePackEv(WITH_GOD_PACK).perPack;
  const packs = 20_000;
  const sampled = openedValue(preparePack(WITH_GOD_PACK), packs, mulberry32(21)) / packs;
  assert.ok(Math.abs(sampled - expected) < 1.5, `sampled ${sampled} vs expected ${expected}`);
});

test('the possible hits are every card any pack can clear bulk with, once each at its best printing', () => {
  const pack = preparePack({
    ...INPUTS,
    cards: [
      CARDS[0],
      { id: 3, name: 'Chase', number: '011/010', rarity: 'Hyper Rare', prices: { holofoil: 100, reverse: 150 } },
      { id: 4, name: 'Lesser Chase', number: '012/010', rarity: 'Hyper Rare', prices: { holofoil: 20 } },
      { id: 5, name: 'Promo', number: '013/010', rarity: 'Special Illustration Rare', prices: { holofoil: 40 } }
    ],
    slots: [
      ...SLOTS,
      {
        label: 'Reverse chase',
        outcomes: [{ label: 'Hyper Rare', pool: { rarities: ['Hyper Rare'], printing: 'reverse', bulk: 'reverse' } }]
      }
    ],
    // The promo is only reachable through the god pack.
    specialPacks: [
      {
        label: 'God pack',
        odds: 2,
        keepSlots: ['Energy'],
        draws: [{ kind: 'cards', cards: [{ name: 'Promo', rarity: 'Special Illustration Rare' }] }]
      }
    ]
  });
  // Bulk never appears, and Lesser Chase's unpriced reverse doesn't undercut its holo.
  assert.deepEqual(
    possibleHits(pack)
      .map(hit => [hit.card.name, hit.value])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
    [
      ['Chase', 150],
      ['Lesser Chase', 20],
      ['Promo', 40]
    ]
  );
});
