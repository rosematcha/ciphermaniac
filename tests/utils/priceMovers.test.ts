import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePriceMovers, historyAnchorMs, PRICE_MOVER_WINDOW_DAYS } from '../../src/lib/priceMovers';

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

test('window constant is seven days', () => {
  assert.equal(PRICE_MOVER_WINDOW_DAYS, 7);
});
