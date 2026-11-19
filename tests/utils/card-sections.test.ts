import test from 'node:test';
import assert from 'node:assert/strict';

import { cardSections } from '../../src/pages/archetypePage/cardSections.ts';

test('a report from before deck order groups by its categories, usage order within', () => {
  // Older reports arrive sorted by usage and carry no evolution order.
  const items = [
    { name: 'Dragapult ex', pct: 99, category: 'pokemon' },
    { name: 'Fire Energy', pct: 98, category: 'energy' },
    { name: "Boss's Orders", pct: 97, category: 'trainer/supporter' },
    { name: 'Poké Pad', pct: 96, category: 'trainer' },
    { name: 'Dreepy', pct: 95, category: 'pokemon' },
    { name: 'Unfair Stamp', pct: 86, category: 'trainer/item/acespec' },
    { name: 'Risky Ruins', pct: 79, category: 'trainer/stadium' },
    { name: "Hero's Cape", pct: 8, category: 'trainer/tool/acespec' },
    { name: 'Drakloak', pct: 5, category: 'pokemon' }
  ];
  assert.deepEqual(
    cardSections(items).map(section => [section.title, section.items.map(item => item.name)]),
    [
      ['Pokémon', ['Dragapult ex', 'Dreepy', 'Drakloak']],
      ['Supporters', ["Boss's Orders"]],
      ['Items', ['Poké Pad', 'Unfair Stamp']],
      ['Tools', ["Hero's Cape"]],
      ['Stadiums', ['Risky Ruins']],
      ['Energy', ['Fire Energy']]
    ]
  );
});
