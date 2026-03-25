import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestOptions, onRequestPost } from '../../functions/api/archetype/filter-report.ts';

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

test('archetype filter-report CORS preflight returns 204 with correct headers', () => {
  const response = onRequestOptions();
  assert.strictEqual(response.status, 204);
  assert.strictEqual(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
});

test('archetype filter-report returns 404 when deck data is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('not found', { status: 404 })) as typeof fetch;

  try {
    const request = new Request('https://ciphermaniac.com/api/archetype/filter-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournament: 'Some Tournament',
        archetype: 'Pikachu',
        successFilter: 'all',
        filters: []
      })
    });

    const response = await onRequestPost({ request });
    assert.strictEqual(response.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('archetype filter-report returns 400 for unparseable JSON body', async () => {
  const request = new Request('https://ciphermaniac.com/api/archetype/filter-report', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'not-valid-json{{{'
  });

  const response = await onRequestPost({ request });
  assert.strictEqual(response.status, 400);
});

test('archetype filter-report handles phase2 slice in URL path', async () => {
  const originalFetch = globalThis.fetch;
  const fixtureDecks = [
    { id: 'd1', archetype: 'Pikachu', cards: [{ name: 'Pikachu', set: 'SVI', number: '7', count: 2 }] }
  ];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/slices/phase2/')) {
      return new Response(JSON.stringify(fixtureDecks), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const request = new Request('https://ciphermaniac.com/api/archetype/filter-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournament: 'Some Tournament',
        archetype: 'Pikachu',
        successFilter: 'all',
        filters: [],
        slice: 'phase2'
      })
    });

    const response = await onRequestPost({ request });
    assert.strictEqual(response.status, 200);
    const payload = (await response.json()) as { deckTotal: number };
    assert.strictEqual(payload.deckTotal, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('archetype filter-report handles topcut slice in URL path', async () => {
  const originalFetch = globalThis.fetch;
  const fixtureDecks = [{ id: 'd1', archetype: 'Pikachu', cards: [] }];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/slices/topcut/')) {
      return new Response(JSON.stringify(fixtureDecks), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const request = new Request('https://ciphermaniac.com/api/archetype/filter-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournament: 'Some Tournament',
        archetype: 'Pikachu',
        successFilter: 'all',
        filters: [],
        slice: 'topcut'
      })
    });

    const response = await onRequestPost({ request });
    assert.strictEqual(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('archetype filter-report skips invalid filter entries in array', async () => {
  const originalFetch = globalThis.fetch;
  const fixtureDecks = [
    { id: 'd1', archetype: 'Test', cards: [{ name: 'Pikachu', set: 'SVI', number: '7', count: 2 }] }
  ];

  globalThis.fetch = (async () => new Response(JSON.stringify(fixtureDecks), { status: 200 })) as typeof fetch;

  try {
    const request = new Request('https://ciphermaniac.com/api/archetype/filter-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournament: 'Some Tournament',
        archetype: 'Test',
        successFilter: 'all',
        filters: [null, 'invalid', { cardId: '' }, { cardId: 'SVI~007', count: 2 }]
      })
    });

    const response = await onRequestPost({ request });
    assert.strictEqual(response.status, 200);
    const payload = (await response.json()) as { deckTotal: number };
    assert.ok(typeof payload.deckTotal === 'number');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('archetype filter-report applies success filter when provided', async () => {
  const originalFetch = globalThis.fetch;
  const fixtureDecks = [
    {
      id: 'd1',
      archetype: 'Pikachu',
      placement: 1,
      tournamentPlayers: 32,
      cards: [{ name: 'Pikachu', set: 'SVI', number: '7', count: 2 }]
    },
    {
      id: 'd2',
      archetype: 'Pikachu',
      placement: 16,
      tournamentPlayers: 32,
      cards: [{ name: 'Pikachu', set: 'SVI', number: '7', count: 2 }]
    }
  ];

  globalThis.fetch = (async () => new Response(JSON.stringify(fixtureDecks), { status: 200 })) as typeof fetch;

  try {
    const request = new Request('https://ciphermaniac.com/api/archetype/filter-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournament: 'Some Tournament',
        archetype: 'Pikachu',
        successFilter: 'winner',
        filters: []
      })
    });

    const response = await onRequestPost({ request });
    assert.strictEqual(response.status, 200);
    const payload = (await response.json()) as { deckTotal: number };
    assert.strictEqual(payload.deckTotal, 1, 'only winner deck should be included');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('archetype filter-report falls back to all-decks path when archetype path returns null', async () => {
  const originalFetch = globalThis.fetch;
  const fixtureDecks = [{ id: 'd1', archetype: 'Pikachu', cards: [] }];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/archetypes/')) {
      return new Response('not valid json', { status: 200 });
    }
    return new Response(JSON.stringify(fixtureDecks), { status: 200 });
  }) as typeof fetch;

  try {
    const request = new Request('https://ciphermaniac.com/api/archetype/filter-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournament: 'Some Tournament',
        archetype: 'Pikachu',
        successFilter: 'all',
        filters: []
      })
    });

    const response = await onRequestPost({ request });
    assert.strictEqual(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
