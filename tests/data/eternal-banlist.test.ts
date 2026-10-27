import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchEternalBanlist, parseBanlist } from '../../.github/scripts/lib/eternalBanlist';
import cube from '../fixtures/eternal/banlist-2026-09-19.json' with { type: 'json' };

/** A card as Cube Koga's API sends it. */
function cubeCard(id: string, name: string, set: string): Record<string, string> {
  // Cube Koga's field names, which are not camel case.
  return Object.fromEntries([
    ['card_ID', id],
    ['card_Name', name],
    ['set', set]
  ]);
}

test('every card on the September 2026 ban list maps to one of our prints', () => {
  const { prints, unmapped } = parseBanlist(cube);
  assert.deepEqual(unmapped, []);
  assert.equal(prints.length, cube.length);
});

test('prints keep the card name and drop promo prefixes and padding', () => {
  const { prints } = parseBanlist([
    cubeCard('dp6-28', 'Forretress', 'Legends Awakened'),
    cubeCard('swshp-SWSH050', 'Rayquaza V', 'SWSH Black Star Promos'),
    cubeCard('base1-6', 'Gyarados', 'Base'),
    cubeCard('hgss3-001', 'Bellossom', 'HS—Undaunted')
  ]);
  assert.deepEqual(prints, [
    { name: 'Forretress', set: 'LA', number: '28' },
    { name: 'Rayquaza V', set: 'SP', number: '50' },
    { name: 'Gyarados', set: 'BS', number: '6' },
    { name: 'Bellossom', set: 'UD', number: '1' }
  ]);
});

test('an unknown set is reported rather than guessed, and a non-list is an error', () => {
  const { prints, unmapped } = parseBanlist([cubeCard('x1-1', 'Mew', 'Mystery Set')]);
  assert.deepEqual(prints, []);
  assert.deepEqual(unmapped, ['Mew (Mystery Set)']);
  assert.throws(() => parseBanlist({ error: 'down' }), /expected an array/);
});

test('a ban list with an unmappable card is refused whole', async () => {
  const fetchJson = async () => [
    cubeCard('dp6-28', 'Forretress', 'Legends Awakened'),
    cubeCard('x1-1', 'Mew', 'Mystery Set')
  ];
  await assert.rejects(fetchEternalBanlist(fetchJson, new Date('2026-10-27T12:00:00Z')), /unknown sets: Mew/);
});
