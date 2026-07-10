import test from 'node:test';
import assert from 'node:assert/strict';

// @ts-expect-error — JS Pages Function with JSDoc types, no .d.ts
import { onRequest } from '../../functions/archetype/[[path]].js';

async function redirectLocation(url: string): Promise<{ status: number; location: string }> {
  const res = (await onRequest({ request: new Request(url) })) as unknown as Response;
  return { status: res.status, location: res.headers.get('Location') || '' };
}

// --- P-22: legacy /archetype/* redirect must preserve query (and origin) ---

test('archetype redirect strips /archetype prefix', async () => {
  const { status, location } = await redirectLocation('https://ciphermaniac.com/archetype/Dragapult');
  assert.strictEqual(status, 301);
  assert.strictEqual(location, 'https://ciphermaniac.com/Dragapult');
});

test('archetype redirect preserves query string', async () => {
  const { location } = await redirectLocation('https://ciphermaniac.com/archetype/Dragapult?tour=X&tab=analysis');
  assert.strictEqual(location, 'https://ciphermaniac.com/Dragapult?tour=X&tab=analysis');
});

test('archetype redirect preserves query on sub-paths', async () => {
  const { location } = await redirectLocation('https://ciphermaniac.com/archetype/Dragapult/trends?range=30');
  assert.strictEqual(location, 'https://ciphermaniac.com/Dragapult/trends?range=30');
});

test('bare /archetype redirects to /archetypes listing', async () => {
  assert.strictEqual(
    (await redirectLocation('https://ciphermaniac.com/archetype')).location,
    'https://ciphermaniac.com/archetypes'
  );
  assert.strictEqual(
    (await redirectLocation('https://ciphermaniac.com/archetype/')).location,
    'https://ciphermaniac.com/archetypes'
  );
});
