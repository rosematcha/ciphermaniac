/**
 * POST /api/archetype/filter-report: the happy path, slice routing, and the
 * trust boundary (what the endpoint accepts, what it rejects, how equivalent
 * requests collapse onto one cache key, and whether an upstream outage is
 * distinguishable from a tournament that has no data).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReportsPath, onRequestOptions, onRequestPost } from '../../functions/api/archetype/filter-report.ts';
import type { ReleaseManifest } from '../../shared/data/build/release.ts';

const DECKS = [
  {
    id: 'deck-1',
    archetype: 'Dragapult',
    cards: [
      { name: 'Rare Candy', set: 'SVI', number: '191', count: 2 },
      { name: 'Buddy-Buddy Poffin', set: 'TEF', number: '144', count: 4 }
    ]
  },
  {
    id: 'deck-2',
    archetype: 'Dragapult',
    cards: [{ name: 'Buddy-Buddy Poffin', set: 'TEF', number: '144', count: 4 }]
  }
];

/** Install a fetch stub for the duration of `run`, always restoring the original. */
async function withFetch<T>(stub: typeof globalThis.fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function decksResponder(decks: unknown = DECKS): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) => {
    if (String(input).includes('/archetypes/Dragapult/decks.json')) {
      return new Response(JSON.stringify(decks), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
}

function anyPathResponder(decks: unknown): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify(decks), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as typeof globalThis.fetch;
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://ciphermaniac.com/api/archetype/filter-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

function base(overrides: Record<string, unknown> = {}) {
  return {
    tournament: 'Online - Last 14 Days',
    archetype: 'Dragapult',
    successFilter: 'all',
    filters: [],
    ...overrides
  };
}

async function deckTotal(response: Response): Promise<number> {
  return ((await response.json()) as { deckTotal: number }).deckTotal;
}

// ---------------------------------------------------------------------------
// Reports and paths
// ---------------------------------------------------------------------------

test('filter-report returns the aggregate for decks matching the filters', async () => {
  const response = await withFetch(decksResponder(), () =>
    onRequestPost({ request: post(base({ filters: [{ cardId: 'SVI~191', operator: '>=', count: 1 }] })) })
  );
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { deckTotal: number; items: Array<{ name: string }> };
  assert.equal(payload.deckTotal, 1, 'only one deck should satisfy Rare Candy >= 1');
  assert.ok(payload.items.some(item => item.name === 'Rare Candy'));
});

test('deck reads resolve through the release, or the legacy reports tree without one', () => {
  const release = {
    events: { Event: '/releases/v1/events/Event/aaaaaaaaaaaa' },
    roots: { online: '/releases/v1/online/cccccccccccc', snapshots: '/releases/v1/snapshots/bbbbbbbbbbbb' }
  } as unknown as ReleaseManifest;
  const cases: Array<[ReleaseManifest | null, string, boolean, string | null]> = [
    [release, 'Event', true, '/releases/v1/events/Event/aaaaaaaaaaaa/decks.json'],
    [release, 'Missing', false, null],
    [release, 'snapshot:2026-04-10', true, '/releases/v1/snapshots/bbbbbbbbbbbb/2026-04-10/decks.json'],
    [release, 'Online - Last 14 Days', true, '/releases/v1/online/cccccccccccc/archetypes/Deck%20Name/decks.json'],
    [null, 'Online - Last 14 Days', true, '/reports/Online%20-%20Last%2014%20Days/archetypes/Deck%20Name/decks.json'],
    // Only the online report is sharded by archetype; a regular event reads its one decks file.
    [null, 'Some Tournament', true, '/reports/Some%20Tournament/decks.json'],
    [null, 'snapshot:2026-04-10', false, '/reports/Snapshots/2026-04-10/decks.json']
  ];
  for (const [manifest, tournament, archetypeDecks, expected] of cases) {
    const payload = {
      tournament,
      archetype: 'Deck Name',
      successFilter: 'all',
      filters: [],
      slice: 'all'
    } as Parameters<typeof buildReportsPath>[0];
    assert.equal(
      buildReportsPath(payload, archetypeDecks, manifest),
      expected,
      `${tournament} (release: ${Boolean(manifest)})`
    );
  }
});

test('slices keep only the decks flagged for them', async () => {
  const card = { name: 'Dreepy', set: 'TWM', number: '128', count: 4 };
  const decks = [
    { id: 'day-one', archetype: 'Dragapult', cards: [card] },
    { id: 'day-two', archetype: 'Dragapult', madePhase2: true, cards: [card] },
    { id: 'top-cut', archetype: 'Dragapult', madePhase2: true, madeTopCut: true, cards: [card] }
  ];
  for (const [slice, expected] of [
    ['all', 3],
    ['phase2', 2],
    ['topcut', 1]
  ] as const) {
    const response = await withFetch(anyPathResponder(decks), () =>
      onRequestPost({ request: post(base({ tournament: 'Event', slice })) })
    );
    assert.equal(response.status, 200, slice);
    assert.equal(await deckTotal(response), expected, slice);
  }
});

test('the success filter narrows to its bracket', async () => {
  const card = { name: 'Pikachu', set: 'SVI', number: '7', count: 2 };
  const decks = [
    { id: 'd1', archetype: 'Dragapult', placement: 1, tournamentPlayers: 32, cards: [card] },
    { id: 'd2', archetype: 'Dragapult', placement: 16, tournamentPlayers: 32, cards: [card] }
  ];
  const response = await withFetch(anyPathResponder(decks), () =>
    onRequestPost({ request: post(base({ tournament: 'Event', successFilter: 'winner' })) })
  );
  assert.equal(await deckTotal(response), 1, 'only the winner deck should be included');
});

test('CORS preflight allows POST from any origin', () => {
  const response = onRequestOptions();
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

test('an oversized body is rejected with 413 before it is parsed', async () => {
  const body = JSON.stringify(base({ tournament: 'x'.repeat(20_000) }));
  const response = await onRequestPost({ request: post(body) });
  assert.equal(response.status, 413);
});

test('an invalid payload is rejected with 400', async () => {
  const filter = (overrides: Record<string, unknown>) => base({ filters: [{ cardId: 'SVI~191', ...overrides }] });
  const cases: Array<[string, unknown]> = [
    ['unparseable JSON', 'not-valid-json{{{'],
    ['empty names', { tournament: '', archetype: '', filters: [] }],
    // Regression for P-17: a typo'd bracket used to pass through and silently
    // return every deck.
    ['unknown successFilter', base({ successFilter: 'winer' })],
    ['unknown operator', filter({ operator: 'exactly', count: 1 })],
    ['over-long tournament', base({ tournament: 'a'.repeat(201) })],
    ['over-long archetype', base({ archetype: 'a'.repeat(201) })],
    // An unknown slice used to silently serve the unsliced report.
    ['unknown slice', base({ slice: 'phase3' })],
    ['over-long cardId', base({ filters: [{ cardId: 'A'.repeat(65), operator: 'any' }] })],
    ['non-array filters', base({ filters: { cardId: 'SVI~191' } })],
    ['51 filters', base({ filters: Array.from({ length: 51 }, (_, i) => ({ cardId: `SVI~${i}`, operator: 'any' })) })],
    ['a cardId that is not a match id', base({ filters: [{ cardId: 'no-separator' }] })],
    // `SVI~` is a key no deck card can produce, so the count is always 0, and
    // with the default (exclude) operator "count must be 0" then matches EVERY
    // deck, returning an unfiltered report that looks filtered.
    ['a cardId with no number', base({ filters: [{ cardId: 'SVI~' }] })],
    // normalizeString collapses a non-string to '', which is indistinguishable
    // from absent, so `successFilter: true` used to silently mean 'all'.
    ['non-string successFilter', base({ successFilter: true })],
    ['non-string slice', base({ slice: 42 })],
    ['non-string tournament', base({ tournament: { a: 1 } })],
    ['non-string operator', filter({ operator: true })],
    ['non-string cardId', base({ filters: [{ cardId: ['SVI~001'] }] })]
  ];
  // NaN/Infinity are omitted as numbers: JSON.stringify writes them as null,
  // which is the legitimate "no threshold" encoding. Their string forms are what
  // a client could actually put on the wire.
  for (const count of [-1, 61, 2.5, 1e9, '2.5', 'NaN', 'Infinity', 'abc', true, []]) {
    cases.push([`count ${JSON.stringify(count)}`, filter({ operator: '>=', count })]);
  }
  for (const [label, body] of cases) {
    assert.equal((await onRequestPost({ request: post(body) })).status, 400, label);
  }
});

test('payloads at the limits are accepted', async () => {
  const cases: Array<[string, unknown]> = [
    ['an absent slice, meaning "all"', base()],
    [
      '50 filters, a realistic body size',
      base({
        filters: Array.from({ length: 50 }, (_, i) => ({
          cardId: `SVI~${String(i).padStart(3, '0')}`,
          operator: '>=',
          count: 1
        }))
      })
    ],
    ['count 0', base({ filters: [{ cardId: 'SVI~191', operator: '>=', count: 0 }] })],
    ['count 60', base({ filters: [{ cardId: 'SVI~191', operator: '>=', count: 60 }] })],
    // Non-objects and blank ids are skipped rather than rejected.
    ['skippable filter entries', base({ filters: [null, 'invalid', { cardId: '' }] })]
  ];
  for (const [label, body] of cases) {
    const response = await withFetch(decksResponder(), () => onRequestPost({ request: post(body) }));
    assert.equal(response.status, 200, label);
  }
});

// ---------------------------------------------------------------------------
// Filter canonicalization
// ---------------------------------------------------------------------------

test('an exactly duplicated filter is collapsed, while contradictory ones are kept', async () => {
  const filter = { cardId: 'SVI~191', operator: '>=', count: 1 };
  const duplicated = await withFetch(decksResponder(), () =>
    onRequestPost({ request: post(base({ filters: [filter, { ...filter }, { ...filter }] })) })
  );
  const dup = (await duplicated.json()) as { raw: { filters: number }; deckTotal: number };
  assert.deepEqual([dup.raw.filters, dup.deckTotal], [1, 1]);

  const contradictory = await withFetch(decksResponder(), () =>
    onRequestPost({
      request: post(
        base({
          filters: [
            { cardId: 'SVI~191', operator: '=', count: 2 },
            { cardId: 'SVI~191', operator: '=', count: 3 }
          ]
        })
      )
    })
  );
  const both = (await contradictory.json()) as { raw: { filters: number }; deckTotal: number };
  assert.equal(both.raw.filters, 2, 'both filters must survive; they are not duplicates');
  assert.equal(both.deckTotal, 0);
});

test('equivalent spellings of one request share a cache entry', async () => {
  const keys: string[] = [];
  const store = new Map<string, Response>();
  const scope = globalThis as { caches?: unknown };
  const original = scope.caches;
  scope.caches = {
    default: {
      match: async (request: Request) => {
        keys.push(request.url);
        return store.get(request.url)?.clone();
      },
      put: async (request: Request, response: Response) => {
        store.set(request.url, response.clone());
      }
    }
  };
  const a = { cardId: 'SVI~191', operator: '>=', count: 1 };
  const b = { cardId: 'TEF~144', operator: '>=', count: 4 };
  const groups = [
    [
      [a, b],
      [b, a],
      [a, a, b]
    ],
    // The cache key once normalized case while the matcher did not, caching a
    // wrong answer under the right request's key.
    [[a], [{ ...a, cardId: 'svi~0191' }]],
    // `any` and the exclude operator ignore the count, so it must not split the key.
    [[{ cardId: 'SVI~191', operator: 'any', count: 1 }], [{ cardId: 'SVI~191', operator: 'any', count: 60 }]]
  ];
  try {
    const seen: string[] = [];
    for (const spellings of groups) {
      keys.length = 0;
      for (const filters of spellings) {
        await withFetch(decksResponder(), () => onRequestPost({ request: post(base({ filters })) }));
      }
      assert.equal(new Set(keys).size, 1, `spellings split the cache: ${JSON.stringify(spellings)}`);
      seen.push(keys[0] ?? '');
    }
    assert.equal(new Set(seen).size, groups.length, 'different requests must not share a key');
  } finally {
    scope.caches = original;
  }
});

// Deck counts are keyed uppercase and zero-padded, and matching is an exact Map
// lookup, so an un-normalized cardId matched ZERO decks silently (found by
// adversarial review). buildCardId pads short numbers but never truncates, so an
// over-padded id needs stripping first.
test('a cardId reaches the padded deck key regardless of casing and padding', async () => {
  const padded = [
    { id: 'd1', archetype: 'Dragapult', cards: [{ name: 'Rare Candy', set: 'SVI', number: '1', count: 2 }] }
  ];
  for (const cardId of ['SVI~001', 'svi~001', 'SVI~1', 'SVI~01', 'SVI~0001', 'SVI~00001', 'svi~0001']) {
    const response = await withFetch(decksResponder(padded), () =>
      onRequestPost({ request: post(base({ filters: [{ cardId, operator: '>=', count: 1 }] })) })
    );
    assert.equal(await deckTotal(response), 1, `${cardId} should reach SVI~001`);
  }
  // `any` means "plays the card at all": its count is ignored, not a minimum.
  const any = await withFetch(decksResponder(padded), () =>
    onRequestPost({ request: post(base({ filters: [{ cardId: 'SVI~001', operator: 'any', count: 60 }] })) })
  );
  assert.equal(await deckTotal(any), 1, 'any ignores its count');
});

// ---------------------------------------------------------------------------
// Upstream failure modes must stay distinguishable
// ---------------------------------------------------------------------------

test('a storage outage is 502, not a 404 that looks like an empty tournament', async () => {
  const json = { 'content-type': 'application/json' };
  const cases: Array<[string, () => Response, number]> = [
    ['a genuinely absent artifact', () => new Response('not found', { status: 404 }), 404],
    [
      'an HTML SPA fallback',
      () =>
        new Response('<!doctype html><title>Ciphermaniac</title>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=UTF-8' }
        }),
      404
    ],
    ['an upstream 5xx', () => new Response('boom', { status: 503 }), 502],
    ['a malformed artifact', () => new Response('{"not":"an array"}', { status: 200, headers: json }), 502],
    ['unparseable JSON', () => new Response('{ truncated', { status: 200, headers: json }), 502],
    [
      'a network failure',
      () => {
        throw new TypeError('network error');
      },
      502
    ]
  ];
  for (const [label, respond, expected] of cases) {
    let requests = 0;
    const response = await withFetch(
      (async () => {
        requests++;
        return respond();
      }) as typeof globalThis.fetch,
      () => onRequestPost({ request: post(base()) })
    );
    assert.equal(response.status, expected, label);
    // A missing online shard must not fall back to downloading the full corpus.
    assert.equal(requests, 1, `${label}: fetched more than once`);
  }
});
