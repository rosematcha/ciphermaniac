import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFormatArchetypes, loadTierFormats, tierFormat, tierFormats } from '../../src/lib/data/formats';
import snapshot from '../fixtures/e2e/assets/format-archetypes.json';

test('published formats populate the catalog and preserve the report interface', async () => {
  await loadTierFormats(async () => snapshot);
  assert.deepEqual(
    tierFormats().map(format => format.id),
    ['standard', 'expanded', 'ex', '2016']
  );
  assert.equal(tierFormat('unknown').id, 'standard');
  assert.equal(tierFormat(undefined).id, 'standard');
  assert.equal(tierFormat('expanded').previews, true);
  // A past format carries previews when its scrape covered the whole table...
  assert.equal(tierFormat('ex').previews, true);
  // ...and not when it did not.
  assert.equal(tierFormat('2016').previews, false);
  assert.deepEqual(await fetchFormatArchetypes('ex'), [
    {
      name: 'Synthetic Vintage Deck',
      label: 'Synthetic Vintage Deck',
      deckCount: null,
      percent: 25,
      thumbnails: ['RG/009'],
      icons: ['pikachu']
    }
  ]);
  assert.deepEqual(await fetchFormatArchetypes('2016'), [
    {
      name: 'Synthetic Deck',
      label: 'Synthetic Deck',
      deckCount: null,
      percent: 25,
      thumbnails: [],
      icons: ['pikachu']
    }
  ]);
});

test('malformed or failed refreshes preserve the last usable snapshot', async () => {
  await loadTierFormats(async () => snapshot);
  const invalid = [
    null,
    {},
    { formats: [null] },
    { formats: [{ ...snapshot.formats[0], id: 'standard' }] },
    { formats: [{ ...snapshot.formats[0], group: 'invalid' }] },
    { formats: [snapshot.formats[0], snapshot.formats[0]] }
  ];
  for (const value of invalid) {
    await assert.rejects(loadTierFormats(async () => value));
  }
  for (const change of [
    { name: '' },
    { name: 'Other' },
    { share: 101 },
    { share: 0 },
    { icons: ['../bad'] },
    { icons: [] },
    { cards: ['invalid'] }
  ]) {
    const value = structuredClone(snapshot);
    Object.assign(value.formats[0]!.archetypes[0]!, change);
    await assert.rejects(loadTierFormats(async () => value));
  }
  await assert.rejects(
    loadTierFormats(async () => {
      throw new Error('offline');
    })
  );
  assert.equal(tierFormats().length, snapshot.formats.length + 1);
});

test('formats and archetype names must be unique', async () => {
  const value = structuredClone(snapshot);
  value.formats[0]!.archetypes = [
    ...value.formats[0]!.archetypes,
    { name: 'Synthetic Expanded Deck', share: 50, icons: ['pikachu'], cards: ['SVI/001'] }
  ];
  await assert.rejects(loadTierFormats(async () => value));
});
