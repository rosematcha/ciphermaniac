import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReportsPath, onRequestOptions, onRequestPost } from '../../functions/api/archetype/filter-report.ts';
import type { ReleaseManifest } from '../../shared/data/build/release.ts';

test('filter-report resolves deck reads through the embedded event release', () => {
  const release = {
    events: { Event: '/releases/v1/events/Event/aaaaaaaaaaaa' }
  } as unknown as ReleaseManifest;
  const payload = { tournament: 'Event', archetype: 'Deck Name', slice: 'phase2' } as Parameters<
    typeof buildReportsPath
  >[0];
  assert.equal(buildReportsPath(payload, true, release), '/releases/v1/events/Event/aaaaaaaaaaaa/decks.json');
  assert.equal(buildReportsPath({ ...payload, tournament: 'Missing' }, false, release), null);
  const snapshotRelease = {
    roots: { snapshots: '/releases/v1/snapshots/bbbbbbbbbbbb' }
  } as unknown as ReleaseManifest;
  assert.equal(
    buildReportsPath({ ...payload, tournament: 'snapshot:2026-04-10' }, true, snapshotRelease),
    '/releases/v1/snapshots/bbbbbbbbbbbb/2026-04-10/decks.json'
  );
});

test('event slices derive from flags in the canonical deck body', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify([
        {
          id: 'day-one',
          archetype: 'Dragapult',
          madePhase2: false,
          cards: [{ name: 'Dreepy', set: 'TWM', number: '128', count: 4 }]
        },
        {
          id: 'day-two',
          archetype: 'Dragapult',
          madePhase2: true,
          cards: [{ name: 'Dreepy', set: 'TWM', number: '128', count: 4 }]
        }
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;
  try {
    const request = new Request('https://ciphermaniac.com/api/archetype/filter-report', {
      method: 'POST',
      body: JSON.stringify({
        tournament: 'Event',
        archetype: 'Dragapult',
        successFilter: 'all',
        filters: [],
        slice: 'phase2'
      })
    });
    const response = await onRequestPost({ request });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { deckTotal: number }).deckTotal, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test('archetype filter-report returns 400 for an unknown successFilter', async () => {
  // Regression for P-17: a typo'd bracket used to pass through and silently
  // return every deck. It must now 400 before any deck load.
  const request = new Request('https://ciphermaniac.com/api/archetype/filter-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tournament: 'Online - Last 14 Days',
      archetype: 'Dragapult_Dusknoir',
      successFilter: 'winer',
      filters: []
    })
  });

  const response = await onRequestPost({ request });
  assert.strictEqual(response.status, 400);
});

test('archetype filter-report returns 400 for an unknown quantity operator', async () => {
  const request = new Request('https://ciphermaniac.com/api/archetype/filter-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tournament: 'Online - Last 14 Days',
      archetype: 'Dragapult_Dusknoir',
      successFilter: 'all',
      filters: [{ cardId: 'SVI~191', operator: 'exactly', count: 1 }]
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
    {
      id: 'd1',
      archetype: 'Pikachu',
      madePhase2: true,
      cards: [{ name: 'Pikachu', set: 'SVI', number: '7', count: 2 }]
    }
  ];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/decks.json')) {
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
  const fixtureDecks = [
    {
      id: 'd1',
      archetype: 'Pikachu',
      madeTopCut: true,
      cards: [{ name: 'Pikachu', set: 'SVI', number: '7', count: 2 }]
    }
  ];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/decks.json')) {
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

  globalThis.fetch = (async () =>
    new Response(JSON.stringify(fixtureDecks), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as typeof fetch;

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

  globalThis.fetch = (async () =>
    new Response(JSON.stringify(fixtureDecks), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as typeof fetch;

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

test('regular events read the canonical all-decks path', async () => {
  const originalFetch = globalThis.fetch;
  const fixtureDecks = [{ id: 'd1', archetype: 'Pikachu', cards: [] }];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/archetypes/')) {
      return new Response('not valid json', { status: 200 });
    }
    return new Response(JSON.stringify(fixtureDecks), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
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
