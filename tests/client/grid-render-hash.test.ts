import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCardRenderHash } from '../../src/render/cards/gridCards.ts';

const baseCard = {
  name: 'Rare Candy',
  uid: 'Rare Candy::SVI::191',
  set: 'SVI',
  number: '191',
  found: 42,
  total: 100,
  pct: 42,
  dist: [
    { copies: 1, players: 10, percent: 23.81 },
    { copies: 2, players: 22, percent: 52.38 }
  ]
};

test('buildCardRenderHash remains stable for unchanged card render state', () => {
  const hashA = buildCardRenderHash(baseCard);
  const hashB = buildCardRenderHash({ ...baseCard });
  assert.strictEqual(hashA, hashB);
});

test('buildCardRenderHash changes when card render-driving data changes', () => {
  const before = buildCardRenderHash(baseCard, { showPrice: true });
  const after = buildCardRenderHash(
    {
      ...baseCard,
      found: 50,
      pct: 50,
      price: 3.5
    },
    { showPrice: true }
  );
  assert.notStrictEqual(before, after);
});
