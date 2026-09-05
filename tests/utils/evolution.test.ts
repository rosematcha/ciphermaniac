import test from 'node:test';
import assert from 'node:assert/strict';

import { createEvolutionMapLoader } from '../../src/lib/data/evolution.ts';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

test('evolution loader prefers the slim map and shares one in-flight result', async () => {
  let calls = 0;
  const load = createEvolutionMapLoader(async () => {
    calls += 1;
    return response({ 'MEG::114': 'Charizard' });
  });

  const [first, second] = await Promise.all([load(), load()]);
  assert.equal(calls, 1);
  assert.equal(first.get('MEG::114'), 'Charizard');
  assert.strictEqual(first, second);
});

test('evolution loader derives lowercase parents from the full database when slim data is absent', async () => {
  let calls = 0;
  const load = createEvolutionMapLoader(async (_input, init) => {
    calls += 1;
    assert.deepEqual(init, { mode: 'cors' });
    return calls === 1
      ? response({}, 404)
      : response({
          'MEG::001': { evolutionInfo: 'Evolves from Bulbasaur &amp; Friends' },
          'MEG::002': { evolutionInfo: 'Basic' },
          'MEG::003': {}
        });
  });

  const map = await load();
  assert.equal(map.get('MEG::001'), 'bulbasaur & friends');
  assert.equal(map.has('MEG::002'), false);
  assert.equal(map.has('MEG::003'), false);
});

test('evolution loader retries after a failed request instead of caching an empty result', async () => {
  let calls = 0;
  const load = createEvolutionMapLoader(async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('temporary outage');
    }
    return response({ 'MEG::114': 'Charizard' });
  });

  assert.deepEqual(await load(), new Map());
  assert.equal((await load()).get('MEG::114'), 'Charizard');
  assert.equal(calls, 2);
});
