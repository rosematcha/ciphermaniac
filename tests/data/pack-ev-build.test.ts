/**
 * Building the pack-EV artifact out of a TCGCSV group.
 *
 * The risky part isn't the arithmetic, it's the mapping: TCGplayer renames
 * products, splits foil patterns into their own listings, and occasionally
 * delists a sealed product outright. Each of those shows up here as a
 * different assertion, and the two failure cases must abort the run rather
 * than publish a set with a missing rarity.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSetPayload,
  cardDisplayName,
  PACK_EV_INDEX_KEY,
  PACK_EV_PREFIX,
  patternOf,
  runPackEv,
  type TcgcsvPrice,
  type TcgcsvProduct
} from '../../.github/scripts/lib/packEv.ts';
import type { PackEvConfig, PackEvSetConfig } from '../../shared/packEv/types.ts';

function product(id: number, name: string, fields: Record<string, string> = {}): TcgcsvProduct {
  return {
    productId: id,
    name,
    url: `https://www.tcgplayer.com/product/${id}`,
    extendedData: Object.entries(fields).map(([key, value]) => ({ name: key, value }))
  };
}

const PRODUCTS: TcgcsvProduct[] = [
  product(1, 'Twilight Masquerade Booster Box'),
  product(2, 'Twilight Masquerade Booster Pack'),
  product(3, 'Code Card - Twilight Masquerade Booster Pack', { Rarity: 'Code Card' }),
  product(10, 'Tangela', { Number: '001/167', Rarity: 'Common' }),
  product(11, 'Pinsir - 003/167', { Number: '003/167', Rarity: 'Common' }),
  product(12, 'Exeggcute (Poke Ball Pattern)', { Number: '001/131', Rarity: 'Common' }),
  product(13, 'Greninja ex - 214/167', { Number: '214/167', Rarity: 'Special Illustration Rare' })
];

const PRICES: TcgcsvPrice[] = [
  { productId: 1, subTypeName: 'Normal', marketPrice: 356.09 },
  { productId: 2, subTypeName: 'Normal', marketPrice: 9.09 },
  { productId: 10, subTypeName: 'Normal', marketPrice: 0.15 },
  { productId: 10, subTypeName: 'Reverse Holofoil', marketPrice: 0.19 },
  { productId: 11, subTypeName: 'Normal', marketPrice: 0.13 },
  { productId: 12, subTypeName: 'Holofoil', marketPrice: 0.32 },
  { productId: 13, subTypeName: 'Holofoil', marketPrice: 352.38 },
  // Printings TCGplayer prices at null are absent, not zero.
  { productId: 13, subTypeName: 'Normal', marketPrice: null }
];

const SET: PackEvSetConfig = {
  code: 'TWM',
  name: 'Twilight Masquerade',
  groupId: 23473,
  source: { url: 'https://example.invalid/rates', label: 'Pull rates', sampleSize: 8000 },
  sealed: [
    { kind: 'box', label: 'Booster Box', id: 1, packs: 36 },
    { kind: 'pack', label: 'Single Pack', id: 2, packs: 1 }
  ],
  slots: [
    {
      label: 'Rare slot',
      outcomes: [
        {
          label: 'Special Illustration Rare',
          chance: 0.0117,
          pool: { rarities: ['Special Illustration Rare'], printing: 'holofoil', bulk: 'hit' }
        },
        { label: 'Common', pool: { rarities: ['Common'], printing: 'normal', pattern: 'base', bulk: 'commonUncommon' } }
      ]
    }
  ]
};

const CONFIG: PackEvConfig = {
  threshold: 1,
  bulk: { commonUncommon: 0.035, reverse: 0.05, rare: 0.05, doubleRare: 0.6, hit: 0.05 },
  bulkSource: { url: 'https://example.invalid/bulk', label: 'Bulk buyer' },
  sets: [SET]
};

const SOURCES = { products: PRODUCTS, prices: PRICES, releasedOn: '2024-05-24' };

test('the collector number and the foil-pattern suffix leave the display name', () => {
  assert.equal(cardDisplayName('Pinsir - 003/167', '003/167'), 'Pinsir');
  assert.equal(cardDisplayName('Exeggcute (Poke Ball Pattern)', '001/131'), 'Exeggcute');
  assert.equal(cardDisplayName('Tangela', '001/167'), 'Tangela');
  assert.equal(cardDisplayName('Psyduck (Dusk Ball)', '051/217'), 'Psyduck');
});

test('any parenthetical is a variant, so no variant joins a base pool', () => {
  assert.equal(patternOf('Exeggcute (Poke Ball Pattern)'), 'poke-ball-pattern');
  assert.equal(patternOf('Psyduck (Energy Symbol Pattern)'), 'energy-symbol-pattern');
  assert.equal(patternOf('Mew ex (151 Metal Card)'), '151-metal-card');
  assert.equal(patternOf('Tangela'), undefined);
});

test('a special pack that names a card the set lacks fails the run', () => {
  const godPack = {
    label: 'God pack',
    odds: 2000,
    keepSlots: ['Rare slot'],
    draws: [{ kind: 'cards' as const, cards: [{ name: 'Greninja ex', rarity: 'Special Illustration Rare' }] }]
  };
  // Resolves: Greninja ex is in the group, under its display name.
  const payload = buildSetPayload(CONFIG, { ...SET, specialPacks: [godPack] }, SOURCES, 'now');
  assert.equal(payload.specialPacks?.length, 1);
  assert.throws(
    () =>
      buildSetPayload(
        CONFIG,
        {
          ...SET,
          specialPacks: [{ ...godPack, draws: [{ kind: 'cards', cards: [{ name: 'Umbreon ex', rarity: 'SIR' }] }] }]
        },
        SOURCES,
        'now'
      ),
    /Umbreon ex/
  );
  assert.throws(
    () => buildSetPayload(CONFIG, { ...SET, specialPacks: [{ ...godPack, keepSlots: ['Energy'] }] }, SOURCES, 'now'),
    /Energy/
  );
  assert.throws(
    () =>
      buildSetPayload(
        CONFIG,
        {
          ...SET,
          specialPacks: [
            {
              ...godPack,
              draws: [
                {
                  kind: 'random',
                  count: 3,
                  pool: { rarities: ['Mega Attack Rare'], printing: 'holofoil', bulk: 'hit' }
                }
              ]
            }
          ]
        },
        SOURCES,
        'now'
      ),
    /Mega Attack Rare/
  );
});

test('cards are the products with a number and a rarity, priced per printing', () => {
  const payload = buildSetPayload(CONFIG, SET, SOURCES, '2026-09-16T00:00:00.000Z');
  assert.deepEqual(
    payload.cards.map(card => card.id),
    [10, 11, 12, 13]
  );
  const tangela = payload.cards[0];
  assert.deepEqual(tangela.prices, { normal: 0.15, reverse: 0.19 });
  assert.equal(payload.cards[2].pattern, 'poke-ball-pattern');
  assert.equal(payload.cards[0].pattern, undefined);
  // A null market price is not a printing.
  assert.deepEqual(payload.cards[3].prices, { holofoil: 352.38 });
});

/** A Classic Collection-style subset: its own group, numbered for the set it was first printed in. */
const REPRINTS = {
  products: [
    product(50, 'Charizard', { Number: '4/102', Rarity: 'Classic Collection' }),
    product(51, 'Gengar (Prime)', { Number: '94/102', Rarity: 'Classic Collection' })
  ],
  prices: [
    { productId: 50, subTypeName: 'Holofoil', marketPrice: 192.5 },
    { productId: 51, subTypeName: 'Holofoil', marketPrice: 97.5 }
  ]
};

const WITH_REPRINTS: PackEvSetConfig = {
  ...SET,
  reprintGroupIds: [24837],
  slots: [
    {
      label: 'Third common',
      outcomes: [
        {
          label: 'Classic Collection',
          odds: 10,
          pool: { rarities: ['Classic Collection'], printing: 'holofoil', bulk: 'hit' }
        },
        { label: 'Common', pool: { rarities: ['Common'], printing: 'normal', bulk: 'commonUncommon' } }
      ]
    }
  ]
};

test('reprint groups join the card list flagged, so their art is never keyed off this set', () => {
  const payload = buildSetPayload(CONFIG, WITH_REPRINTS, { ...SOURCES, reprints: REPRINTS }, 'now');
  const charizard = payload.cards.find(card => card.id === 50);
  assert.deepEqual(charizard, {
    id: 50,
    name: 'Charizard',
    number: '4/102',
    rarity: 'Classic Collection',
    prices: { holofoil: 192.5 },
    reprint: true
  });
  assert.deepEqual(
    payload.cards.filter(card => card.reprint).map(card => card.id),
    [50, 51],
    "the set's own cards are not reprints"
  );
  // A reprint's parenthetical is its original name, not a foil pattern that would drop it from the pool.
  const gengar = payload.cards.find(card => card.id === 51);
  assert.equal(gengar?.name, 'Gengar (Prime)');
  assert.equal(gengar?.pattern, undefined);
  assert.equal(payload.ev.perPack.toFixed(3), (0.1 * 145 + 0.9 * 0.035).toFixed(3));
});

test('a run fetches every reprint group a set names', async () => {
  const fetched: string[] = [];
  const index = await runPackEv({
    config: { ...CONFIG, sets: [WITH_REPRINTS] },
    fetchJson: async url => {
      fetched.push(url);
      if (url.endsWith('/groups')) {
        return { success: true, results: [] };
      }
      const listing = url.includes('/24837/') ? REPRINTS : { products: PRODUCTS, prices: PRICES };
      return { success: true, results: url.endsWith('/products') ? listing.products : listing.prices };
    },
    publisher: { write: async () => {} }
  });
  assert.ok(fetched.includes('https://tcgcsv.com/tcgplayer/3/24837/products'));
  assert.ok(fetched.includes('https://tcgcsv.com/tcgplayer/3/24837/prices'));
  assert.equal(index.sets[0].evPerPack.toFixed(3), (0.1 * 145 + 0.9 * 0.035).toFixed(3));
});

test('sealed products carry their market price and their TCGplayer URL', () => {
  const payload = buildSetPayload(CONFIG, SET, SOURCES, '2026-09-16T00:00:00.000Z');
  assert.deepEqual(payload.sealed[0], {
    kind: 'box',
    label: 'Booster Box',
    id: 1,
    packs: 36,
    price: 356.09,
    url: 'https://www.tcgplayer.com/product/1'
  });
});

test('a delisted sealed product fails the run instead of publishing a null price', () => {
  const missing = { ...SET, sealed: [{ kind: 'etb' as const, label: 'Elite Trainer Box', id: 999, packs: 9 }] };
  assert.throws(() => buildSetPayload(CONFIG, missing, SOURCES, 'now'), /999/);
});

test('a renamed rarity fails the run rather than dropping a whole slot outcome', () => {
  const renamed = {
    ...SET,
    slots: [
      {
        label: 'Rare slot',
        outcomes: [
          {
            label: 'Mega Hyper Rare',
            pool: { rarities: ['Mega Hyper Rare'], printing: 'holofoil' as const, bulk: 'hit' as const }
          }
        ]
      }
    ]
  };
  assert.throws(() => buildSetPayload(CONFIG, renamed, SOURCES, 'now'), /Mega Hyper Rare/);
});

test('a run publishes one payload per set plus the index', async () => {
  const written = new Map<string, unknown>();
  const index = await runPackEv({
    config: CONFIG,
    fetchJson: async url => {
      if (url.endsWith('/groups')) {
        return { success: true, results: [{ groupId: 23473, name: 'SV06', publishedOn: '2024-05-24T00:00:00' }] };
      }
      if (url.endsWith('/products')) {
        return { success: true, results: PRODUCTS };
      }
      return { success: true, results: PRICES };
    },
    publisher: { write: async (key, value) => void written.set(key, value) },
    now: () => new Date('2026-09-16T12:00:00.000Z')
  });

  assert.deepEqual([...written.keys()], [`${PACK_EV_PREFIX}TWM.json`, PACK_EV_INDEX_KEY]);
  assert.equal(index.sets.length, 1);
  assert.equal(index.sets[0].releasedOn, '2024-05-24');
  // A $9.09 single undercuts the box's $356.09 across 36 packs, so the single sets the cost.
  assert.equal(index.sets[0].cheapestLabel, 'Single Pack');
  assert.equal(index.sets[0].costPerPack, 9.09);
  // 1.17% of a $352 card, plus the remainder of the slot in bulk commons.
  assert.equal(index.sets[0].evPerPack.toFixed(3), (0.0117 * 352.38 + 0.9883 * 0.035).toFixed(3));
});

test('a set that fails to build publishes nothing, not the sets before it', async () => {
  const written: string[] = [];
  const broken = { ...SET, code: 'BRK', sealed: [{ kind: 'box' as const, label: 'Booster Box', id: 999, packs: 36 }] };
  await assert.rejects(
    runPackEv({
      config: { ...CONFIG, sets: [SET, broken] },
      fetchJson: async url => ({ success: true, results: url.endsWith('/prices') ? PRICES : PRODUCTS }),
      publisher: { write: async key => void written.push(key) }
    }),
    /999/
  );
  assert.deepEqual(written, []);
});

test('a TCGCSV error response stops the run', async () => {
  await assert.rejects(
    runPackEv({
      config: CONFIG,
      fetchJson: async () => ({ success: false, errors: ['nope'] }),
      publisher: { write: async () => {} }
    }),
    /no usable results/
  );
});
