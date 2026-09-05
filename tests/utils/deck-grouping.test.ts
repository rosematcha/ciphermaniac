import test from 'node:test';
import assert from 'node:assert/strict';

import { groupDeckByCategory } from '../../src/lib/deckGrouping.ts';

function card(category: string, count: number) {
  return { category, count, name: `${category}-${count}` };
}

test('groupDeckByCategory returns the app display order, not input order', () => {
  const groups = groupDeckByCategory([
    card('energy/special', 4),
    card('trainer/item', 2),
    card('pokemon/basic', 3),
    card('other', 1)
  ]);

  assert.deepEqual(
    groups.map(group => [group.label, group.total]),
    [
      ['pokemon', 3],
      ['trainer', 2],
      ['energy', 4],
      ['other', 1]
    ]
  );
});

test('groupDeckByCategory keeps subcategories together and preserves card order', () => {
  const pokemon = [card('pokemon/basic', 2), card('pokemon/stage-2', 1)];
  const groups = groupDeckByCategory([pokemon[1]!, card('trainer/item', 1), pokemon[0]!]);

  assert.deepEqual(groups[0]?.cards, [pokemon[1], pokemon[0]]);
  assert.equal(groups[0]?.total, 3);
});

test('groupDeckByCategory treats missing categories and counts as other and zero', () => {
  const groups = groupDeckByCategory([{ name: 'unknown' }, { category: 'other', count: 2 }]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.label, 'other');
  assert.equal(groups[0]?.total, 2);
});

test('groupDeckByCategory returns no groups for absent or empty decks', () => {
  assert.deepEqual(groupDeckByCategory(undefined), []);
  assert.deepEqual(groupDeckByCategory([]), []);
});
