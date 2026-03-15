import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../../functions/api/archetype/filter-report.ts';

test('archetype filter-report endpoint returns filtered aggregate response', async () => {
  const originalFetch = globalThis.fetch;

  const fixtureDecks = [
    {
      id: 'deck-1',
      archetype: 'Dragapult_Dusknoir',
      cards: [
        { name: 'Rare Candy', set: 'SVI', number: '191', count: 2 },
        { name: 'Buddy-Buddy Poffin', set: 'TEF', number: '144', count: 4 }
      ]
    },
    {
      id: 'deck-2',
      archetype: 'Dragapult_Dusknoir',
      cards: [{ name: 'Buddy-Buddy Poffin', set: 'TEF', number: '144', count: 4 }]
    }
  ];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/archetypes/Dragapult_Dusknoir/decks.json')) {
      return new Response(JSON.stringify(fixtureDecks), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const request = new Request('https://ciphermaniac.com/api/archetype/filter-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournament: 'Online - Last 14 Days',
        archetype: 'Dragapult_Dusknoir',
        successFilter: 'all',
        filters: [{ cardId: 'SVI~191', operator: '>=', count: 1 }]
      })
    });

    const response = await onRequestPost({ request });
    assert.strictEqual(response.status, 200);

    const payload = (await response.json()) as { deckTotal: number; items: Array<{ name: string }> };
    assert.strictEqual(payload.deckTotal, 1, 'only one deck should satisfy Rare Candy >= 1');
    assert.ok(Array.isArray(payload.items));
    assert.ok(payload.items.some(item => item.name === 'Rare Candy'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('archetype filter-report endpoint validates payload', async () => {
  const request = new Request('https://ciphermaniac.com/api/archetype/filter-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tournament: '',
      archetype: '',
      filters: []
    })
  });

  const response = await onRequestPost({ request });
  assert.strictEqual(response.status, 400);
});
