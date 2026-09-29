import test from 'node:test';
import assert from 'node:assert/strict';

// @ts-expect-error — JS Pages Function with JSDoc types, no .d.ts
import { onRequest } from '../../functions/archetype/[[path]].js';

async function redirectLocation(url: string): Promise<{ status: number; location: string }> {
  const res = (await onRequest({ request: new Request(url) })) as unknown as Response;
  return { status: res.status, location: res.headers.get('Location') || '' };
}

// P-22: the legacy /archetype/* redirect must preserve the query (and origin).
test('legacy /archetype paths 301 to their current path, query intact', async () => {
  const cases: Array<[string, string]> = [
    ['/archetype/Dragapult', '/Dragapult'],
    ['/archetype/Dragapult?tour=X&tab=analysis', '/Dragapult?tour=X&tab=analysis'],
    ['/archetype/Dragapult/trends?range=30', '/Dragapult/trends?range=30'],
    ['/archetype', '/archetypes'],
    ['/archetype/', '/archetypes']
  ];
  for (const [from, to] of cases) {
    assert.deepEqual(
      await redirectLocation(`https://ciphermaniac.com${from}`),
      { status: 301, location: `https://ciphermaniac.com${to}` },
      from
    );
  }
});
