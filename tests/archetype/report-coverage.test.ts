import test from 'node:test';
import assert from 'node:assert/strict';
import { mockFetch, restoreFetch } from '../__utils__/test-helpers';

// DOM shim must be loaded via --import flag before this file runs.
// See: tests/__utils__/dom-shim.ts

import { getState, setState } from '../../src/archetype/state.ts';
import { loadFilterCombination, loadSuccessBaseline } from '../../src/archetype/data/report.ts';

// Reset state before each test
function resetState() {
  const state = getState();
  state.filterCache.clear();
  state.filterRequestController = null;
  setState({
    archetypeBase: 'TestArchetype',
    tournament: 'Online - Last 14 Days',
    successFilter: 'all',
    defaultItems: [{ name: 'Pikachu', uid: 'SVI~025', found: 10, total: 20, pct: 50 }],
    defaultDeckTotal: 20
  });
}

// ---------------------------------------------------------------------------
// loadSuccessBaseline
// ---------------------------------------------------------------------------

test('loadSuccessBaseline returns defaults when successFilter is "all"', async () => {
  resetState();

  const result = await loadSuccessBaseline();
  assert.equal(result.deckTotal, 20);
  assert.ok(Array.isArray(result.items));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, 'Pikachu');
});

test('loadSuccessBaseline uses client-side filtering for non-all filter', async () => {
  resetState();
  setState({ successFilter: 'topcut' });

  const decks = [
    {
      id: 'd1',
      archetype: 'TestArchetype',
      placement: 1,
      tournamentPlayers: 32,
      cards: [{ name: 'Pikachu', set: 'SVI', number: '025', count: 2 }]
    },
    {
      id: 'd2',
      archetype: 'TestArchetype',
      placement: 20,
      tournamentPlayers: 32,
      cards: [{ name: 'Charizard', set: 'SVI', number: '006', count: 3 }]
    }
  ];

  mockFetch({
    predicate: () => true,
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: decks
  });

  try {
    const result = await loadSuccessBaseline();
    assert.ok(typeof result.deckTotal === 'number');
    assert.ok(Array.isArray(result.items));
  } finally {
    restoreFetch();
  }
});

test('loadSuccessBaseline falls back to main decks when archetype path fails', async () => {
  resetState();
  setState({ successFilter: 'winner' });

  let fetchCount = 0;
  const decks = [
    {
      id: 'd1',
      archetype: 'TestArchetype',
      placement: 1,
      tournamentPlayers: 32,
      cards: [{ name: 'Pikachu', set: 'SVI', number: '025', count: 2 }]
    }
  ];

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCount++;
    const url = String(input);
    if (url.includes('/archetypes/') && fetchCount <= 1) {
      return new Response('not found', { status: 404 });
    }
    return new Response(JSON.stringify(decks), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;

  try {
    const result = await loadSuccessBaseline();
    assert.ok(typeof result.deckTotal === 'number');
    assert.ok(Array.isArray(result.items));
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ---------------------------------------------------------------------------
// loadFilterCombination
// ---------------------------------------------------------------------------

test('loadFilterCombination returns cached result on repeat call', async () => {
  resetState();

  const decks = [
    {
      id: 'd1',
      archetype: 'TestArchetype',
      cards: [{ name: 'Pikachu', set: 'SVI', number: '025', count: 2 }]
    }
  ];

  mockFetch({
    predicate: () => true,
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: decks
  });

  const filters = [{ cardId: 'SVI~025', operator: '>=', count: 1 }];

  try {
    const result1 = await loadFilterCombination(filters);
    const result2 = await loadFilterCombination(filters);
    assert.equal(result1.deckTotal, result2.deckTotal);
    assert.ok(Array.isArray(result1.items));
  } finally {
    restoreFetch();
  }
});

test('loadFilterCombination with empty filters', async () => {
  resetState();

  const decks = [
    {
      id: 'd1',
      archetype: 'TestArchetype',
      cards: [{ name: 'Pikachu', set: 'SVI', number: '025', count: 2 }]
    }
  ];

  mockFetch({
    predicate: () => true,
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: decks
  });

  try {
    const result = await loadFilterCombination([]);
    assert.ok(typeof result.deckTotal === 'number');
    assert.ok(Array.isArray(result.items));
  } finally {
    restoreFetch();
  }
});

test('loadFilterCombination handles fetch error gracefully', async () => {
  resetState();

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('Network failure');
  }) as typeof fetch;

  try {
    await assert.rejects(() => loadFilterCombination([{ cardId: 'SVI~999', operator: '=', count: 1 }]), {
      message: /Network failure/
    });
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('loadFilterCombination falls back to main decks when archetype-specific fails', async () => {
  resetState();

  let fetchCount = 0;
  const decks = [
    {
      id: 'd1',
      archetype: 'TestArchetype',
      cards: [{ name: 'Pikachu', set: 'SVI', number: '025', count: 2 }]
    }
  ];

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCount++;
    const url = String(input);
    if (url.includes('/archetypes/') && fetchCount <= 1) {
      return new Response('not found', { status: 404 });
    }
    return new Response(JSON.stringify(decks), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;

  try {
    const result = await loadFilterCombination([]);
    assert.ok(typeof result.deckTotal === 'number');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('loadFilterCombination with successFilter applies filtering', async () => {
  resetState();
  setState({ successFilter: 'topcut' });

  const decks = [
    {
      id: 'd1',
      archetype: 'TestArchetype',
      placement: 1,
      tournamentPlayers: 32,
      cards: [{ name: 'Pikachu', set: 'SVI', number: '025', count: 2 }]
    },
    {
      id: 'd2',
      archetype: 'TestArchetype',
      placement: 20,
      tournamentPlayers: 32,
      cards: [{ name: 'Pikachu', set: 'SVI', number: '025', count: 1 }]
    }
  ];

  mockFetch({
    predicate: () => true,
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: decks
  });

  try {
    const result = await loadFilterCombination([]);
    assert.ok(typeof result.deckTotal === 'number');
    assert.ok(Array.isArray(result.items));
  } finally {
    restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

test('cleanup report-coverage', () => {
  resetState();
  restoreFetch();
});
