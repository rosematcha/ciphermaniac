import assert from 'node:assert/strict';
import test from 'node:test';
import { inventoryPrefix, summarizeInventory } from '../../.github/scripts/lib/build/bucketInventory';

test('names the tree an object belongs to', () => {
  assert.equal(inventoryPrefix('current.json'), '(root)');
  assert.equal(inventoryPrefix('card-images/TWM/TWM_130_R_EN_XS.webp'), 'card-images/');
  assert.equal(inventoryPrefix('players/ab/cd/profile.json'), 'players/');
  assert.equal(
    inventoryPrefix('reports/Online - Last 14 Days/archetypes/index.json'),
    'reports/Online - Last 14 Days/'
  );
  assert.equal(inventoryPrefix('reports/prices.json'), 'reports/');
  assert.equal(inventoryPrefix('releases/v1/players/abcdef123456/index.json'), 'releases/v1/players/');
});

test('totals each tree and lists the largest first', () => {
  const trees = summarizeInventory([
    { key: 'players/a/profile.json', size: 10 },
    { key: 'releases/v1/events/Event/aaaaaaaaaaaa/decks.json', size: 500 },
    { key: 'players/b/profile.json', size: 15 },
    { key: 'releases/v1/events/Other/bbbbbbbbbbbb/decks.json', size: 100 }
  ]);
  assert.deepEqual(trees, [
    { prefix: 'releases/v1/events/', objects: 2, bytes: 600 },
    { prefix: 'players/', objects: 2, bytes: 25 }
  ]);
});
