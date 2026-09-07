import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getArchetypeIconMap, loadArchetypeIconMap, resolveArchetypeIcons } from '../../src/lib/data/archetypes';

test('published archetype metadata replaces the icon map after loading', async () => {
  await loadArchetypeIconMap(async () => ({ 'Dragapult Dusknoir': ['dragapult', 'dusknoir'] }));
  assert.deepEqual(resolveArchetypeIcons({ name: 'Dragapult Dusknoir' }, getArchetypeIconMap()), [
    'dragapult',
    'dusknoir'
  ]);
  await loadArchetypeIconMap(async () => ({ Charizard: ['charizard'] }));
  assert.equal(getArchetypeIconMap().has('dragapult_dusknoir'), false);
});

test('failed or malformed metadata preserves the last usable map', async () => {
  await loadArchetypeIconMap(async () => ({ Charizard: ['charizard'] }));
  const previous = getArchetypeIconMap();
  await assert.rejects(
    loadArchetypeIconMap(async () => {
      throw new Error('offline');
    }),
    /offline/
  );
  await assert.rejects(
    loadArchetypeIconMap(async () => null),
    /Invalid/
  );
  await assert.rejects(
    loadArchetypeIconMap(async () => ({ Charizard: ['../bad'] })),
    /Invalid/
  );
  assert.equal(getArchetypeIconMap(), previous);
});
