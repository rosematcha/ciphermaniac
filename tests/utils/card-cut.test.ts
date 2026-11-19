import test from 'node:test';
import assert from 'node:assert/strict';

import { cutCards } from '../../src/components/cardCut.ts';

test('opening the cards under 10% shows the section in its own order', () => {
  const section = [
    { name: "Erika's Oddish", pct: 5 },
    { name: "Erika's Gloom", pct: 20 },
    { name: "Erika's Vileplume ex", pct: 90 }
  ];
  const names = (open: boolean) => cutCards(section, 10, open).shown.map(c => c.name);
  assert.deepEqual(names(false), ["Erika's Gloom", "Erika's Vileplume ex"]);
  assert.deepEqual(names(true), ["Erika's Oddish", "Erika's Gloom", "Erika's Vileplume ex"]);
  assert.equal(cutCards(section, 10, true).under, 1);
});
