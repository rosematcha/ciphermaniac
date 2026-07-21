import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePriceMovers,
  createStandardPrintFilter,
  historyAnchorMs,
  PRICE_MOVER_WINDOW_DAYS
} from '../../src/lib/priceMovers';
import type { SynonymDatabase } from '../../shared/synonyms.js';

const day = (n: number) => `2026-07-${String(n).padStart(2, '0')}`;

test('window is measured from the latest observation, not wall clock', () => {
  const anchor = historyAnchorMs({ a: [{ date: day(1), price: 1 }], b: [{ date: day(9), price: 2 }] });
  assert.equal(anchor, Date.parse(`${day(9)}T12:00:00Z`));
});

test('baseline carries forward the last price at or before the cutoff', () => {
  // Cutoff is day 20 - 7 = day 13; the day-2 observation is the entering price.
  const { rising } = computePriceMovers({
    'Pikachu::SVI::001': [
      { date: day(2), price: 5 },
      { date: day(20), price: 9 }
    ]
  });
  assert.equal(rising.length, 1);
  assert.deepEqual([rising[0].start, rising[0].current, rising[0].delta], [5, 9, 4]);
});

test('movement older than the window is excluded', () => {
  const { rising, falling } = computePriceMovers({
    'Old::SVI::001': [
      { date: day(1), price: 2 },
      { date: day(5), price: 20 },
      { date: day(25), price: 20 }
    ]
  });
  assert.deepEqual([rising.length, falling.length], [0, 0]);
});

test('falling cards sort by steepest drop', () => {
  const { falling } = computePriceMovers({
    'Small::SVI::001': [
      { date: day(20), price: 10 },
      { date: day(25), price: 9 }
    ],
    'Big::SVI::002': [
      { date: day(20), price: 30 },
      { date: day(25), price: 12 }
    ]
  });
  assert.deepEqual(
    falling.map(m => m.name),
    ['Big', 'Small']
  );
});

test('the predicate narrows to the included uids', () => {
  const history = {
    'Card::SVI::001': [
      { date: day(20), price: 4 },
      { date: day(25), price: 9 }
    ],
    'Card::SVI::200': [
      { date: day(20), price: 4 },
      { date: day(25), price: 40 }
    ]
  };
  const { rising } = computePriceMovers(history, uid => uid === 'Card::SVI::001');
  assert.deepEqual(
    rising.map(m => m.number),
    ['001']
  );
});

test('penny cards and sub-threshold swings are dropped', () => {
  const { rising } = computePriceMovers({
    'Penny::SVI::001': [
      { date: day(20), price: 0.1 },
      { date: day(25), price: 0.9 }
    ],
    'Flat::SVI::002': [
      { date: day(20), price: 10 },
      { date: day(25), price: 10.1 }
    ]
  });
  assert.equal(rising.length, 0);
});

/**
 * Mirrors the shipped artifact: the cluster's canonical UID is PRE/161, the
 * $1,500 special illustration rare, while the playable print is the cheap
 * sibling. Filtering on "is its own canonical" would keep exactly the wrong one.
 */
const UMBREON_DB: SynonymDatabase = {
  synonyms: {
    'Umbreon ex::PRE::060': 'Umbreon ex::PRE::161',
    'Umbreon ex::SVP::176': 'Umbreon ex::PRE::161'
  },
  canonicals: { 'Umbreon ex': 'Umbreon ex::PRE::161' },
  prints: { 'Umbreon ex::PRE::060': 7.81, 'Umbreon ex::SVP::176': 12 }
};

test('a collector print is excluded even when it is the cluster canonical', () => {
  const isStandard = createStandardPrintFilter(UMBREON_DB, {
    'Umbreon ex::PRE::161': { price: 1503.91 }
  });
  assert.equal(isStandard('Umbreon ex::PRE::161'), false);
  assert.equal(isStandard('Umbreon ex::PRE::060'), true);
});

test('spot prices win over the scraped fallback', () => {
  // The artifact's stale $7.81 would keep PRE/161 under the cap; the live price
  // for the same sibling puts it far above.
  const isStandard = createStandardPrintFilter(UMBREON_DB, {
    'Umbreon ex::PRE::161': { price: 900 },
    'Umbreon ex::PRE::060': { price: 800 },
    'Umbreon ex::SVP::176': { price: 850 }
  });
  assert.equal(isStandard('Umbreon ex::PRE::161'), true);
});

test('a lone print with no siblings is standard', () => {
  const isStandard = createStandardPrintFilter(UMBREON_DB, { "Hero's Cape::TEF::152": { price: 16.76 } });
  assert.equal(isStandard("Hero's Cape::TEF::152"), true);
});

test('an unpriced print is kept rather than silently dropped', () => {
  const isStandard = createStandardPrintFilter(UMBREON_DB, {});
  assert.equal(isStandard('Unknown Card::XYZ::001'), true);
});

test('the $0.50 slack keeps penny reprints together', () => {
  const db: SynonymDatabase = {
    synonyms: { 'Bulbasaur::MEG::133': 'Bulbasaur::MEG::001' },
    canonicals: {},
    prints: {}
  };
  const isStandard = createStandardPrintFilter(db, {
    'Bulbasaur::MEG::001': { price: 0.22 },
    'Bulbasaur::MEG::133': { price: 0.6 }
  });
  assert.equal(isStandard('Bulbasaur::MEG::133'), true);
});

test('window constant is seven days', () => {
  assert.equal(PRICE_MOVER_WINDOW_DAYS, 7);
});
