/**
 * Input-boundary behavior for POST /api/archetype/filter-report.
 *
 * The happy path and slice routing live in archetype-filter-report.test.ts.
 * This file covers the trust boundary: what the endpoint accepts, what it
 * rejects, how equivalent requests collapse onto one cache key, and whether an
 * upstream outage is distinguishable from a tournament that has no data.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestPost } from '../../functions/api/archetype/filter-report.ts';

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

// ---------------------------------------------------------------------------
// Body size
// ---------------------------------------------------------------------------

test('an oversized body is rejected with 413 before it is parsed', async () => {
  const body = JSON.stringify(base({ tournament: 'x'.repeat(20_000) }));
  const response = await onRequestPost({ request: post(body) });
  assert.equal(response.status, 413);
});

test('a lying Content-Length still cannot smuggle an oversized body through', async () => {
  const body = JSON.stringify(base({ tournament: 'x'.repeat(20_000) }));
  const response = await onRequestPost({ request: post(body, { 'content-length': '10' }) });
  assert.equal(response.status, 413);
});

test('a body at a realistic size is accepted', async () => {
  const filters = Array.from({ length: 50 }, (_, i) => ({
    cardId: `SVI~${String(i).padStart(3, '0')}`,
    operator: '>=',
    count: 1
  }));
  const response = await withFetch(decksResponder(), () => onRequestPost({ request: post(base({ filters })) }));
  assert.equal(response.status, 200);
});

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------

test('an over-long tournament or archetype name is rejected', async () => {
  for (const field of ['tournament', 'archetype']) {
    const response = await onRequestPost({ request: post(base({ [field]: 'a'.repeat(201) })) });
    assert.equal(response.status, 400, `${field} length is unbounded`);
  }
});

test('an unknown slice is rejected rather than silently serving the unsliced report', async () => {
  const response = await onRequestPost({ request: post(base({ slice: 'phase3' })) });
  assert.equal(response.status, 400);
});

test('an absent slice still means "all"', async () => {
  const response = await withFetch(decksResponder(), () => onRequestPost({ request: post(base()) }));
  assert.equal(response.status, 200);
});

test('out-of-range and non-integer copy counts are rejected', async () => {
  // NaN/Infinity are omitted: JSON.stringify writes them as null, which is the
  // legitimate "no threshold" encoding. Their string forms are what a client
  // could actually put on the wire.
  for (const count of [-1, 61, 2.5, 1e9, '2.5', 'NaN', 'Infinity', 'abc', true, []]) {
    const response = await onRequestPost({
      request: post(base({ filters: [{ cardId: 'SVI~191', operator: '>=', count }] }))
    });
    assert.equal(response.status, 400, `count ${count} was accepted`);
  }
});

test('copy counts at the range boundaries are accepted', async () => {
  for (const count of [0, 60]) {
    const response = await withFetch(decksResponder(), () =>
      onRequestPost({ request: post(base({ filters: [{ cardId: 'SVI~191', operator: '>=', count }] })) })
    );
    assert.equal(response.status, 200, `count ${count} was rejected`);
  }
});

test('an over-long cardId is rejected', async () => {
  const response = await onRequestPost({
    request: post(base({ filters: [{ cardId: 'A'.repeat(65), operator: 'any' }] }))
  });
  assert.equal(response.status, 400);
});

test('a non-array filters field is rejected rather than ignored', async () => {
  const response = await onRequestPost({ request: post(base({ filters: { cardId: 'SVI~191' } })) });
  assert.equal(response.status, 400);
});

test('more than 50 filters is rejected', async () => {
  const filters = Array.from({ length: 51 }, (_, i) => ({ cardId: `SVI~${i}`, operator: 'any' }));
  const response = await onRequestPost({ request: post(base({ filters })) });
  assert.equal(response.status, 400);
});

// ---------------------------------------------------------------------------
// Filter canonicalization
// ---------------------------------------------------------------------------

test('filter order does not change the result', async () => {
  const filters = [
    { cardId: 'SVI~191', operator: '>=', count: 1 },
    { cardId: 'TEF~144', operator: '>=', count: 4 }
  ];
  const forward = await withFetch(decksResponder(), () => onRequestPost({ request: post(base({ filters })) }));
  const reverse = await withFetch(decksResponder(), () =>
    onRequestPost({ request: post(base({ filters: [...filters].reverse() })) })
  );
  const shape = async (response: Response) => {
    const { deckTotal, items } = (await response.json()) as { deckTotal: number; items: unknown[] };
    return { deckTotal, items };
  };
  assert.deepEqual(await shape(forward), await shape(reverse));
});

test('an exactly duplicated filter is collapsed, not counted twice', async () => {
  const filter = { cardId: 'SVI~191', operator: '>=', count: 1 };
  const response = await withFetch(decksResponder(), () =>
    onRequestPost({ request: post(base({ filters: [filter, { ...filter }, { ...filter }] })) })
  );
  const payload = (await response.json()) as { raw: { filters: number }; deckTotal: number };
  assert.equal(payload.raw.filters, 1);
  assert.equal(payload.deckTotal, 1);
});

test('contradictory filters on one card are kept and match nothing', async () => {
  const response = await withFetch(decksResponder(), () =>
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
  const payload = (await response.json()) as { raw: { filters: number }; deckTotal: number };
  assert.equal(payload.raw.filters, 2, 'both filters must survive; they are not duplicates');
  assert.equal(payload.deckTotal, 0);
});

// ---------------------------------------------------------------------------
// Upstream failure modes must stay distinguishable
// ---------------------------------------------------------------------------

test('a genuinely absent artifact is 404', async () => {
  const response = await withFetch(
    (async () => new Response('not found', { status: 404 })) as typeof globalThis.fetch,
    () => onRequestPost({ request: post(base()) })
  );
  assert.equal(response.status, 404);
});

test('an upstream 5xx is 502, not 404', async () => {
  const response = await withFetch((async () => new Response('boom', { status: 503 })) as typeof globalThis.fetch, () =>
    onRequestPost({ request: post(base()) })
  );
  assert.equal(response.status, 502, 'a storage outage must not look like an empty tournament');
});

test('a malformed artifact is 502, not 404', async () => {
  const response = await withFetch(
    (async () =>
      new Response('{"not":"an array"}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })) as typeof globalThis.fetch,
    () => onRequestPost({ request: post(base()) })
  );
  assert.equal(response.status, 502);
});

test('unparseable JSON from storage is 502, not 404', async () => {
  const response = await withFetch(
    (async () =>
      new Response('{ truncated', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })) as typeof globalThis.fetch,
    () => onRequestPost({ request: post(base()) })
  );
  assert.equal(response.status, 502);
});

test('a network failure is 502, not an unhandled rejection', async () => {
  const response = await withFetch(
    (async () => {
      throw new TypeError('network error');
    }) as typeof globalThis.fetch,
    () => onRequestPost({ request: post(base()) })
  );
  assert.equal(response.status, 502);
});

test('a missing archetype slice falls back to the full decks file', async () => {
  const response = await withFetch(
    (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/archetypes/')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(JSON.stringify(DECKS), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch,
    () => onRequestPost({ request: post(base()) })
  );
  assert.equal(response.status, 200);
});

test('a broken slice fetch is reported even when the fallback is merely absent', async () => {
  const response = await withFetch(
    (async (input: RequestInfo | URL) =>
      String(input).includes('/archetypes/')
        ? new Response('boom', { status: 500 })
        : new Response('not found', { status: 404 })) as typeof globalThis.fetch,
    () => onRequestPost({ request: post(base()) })
  );
  assert.equal(response.status, 502);
});

// ---------------------------------------------------------------------------
// cardId normalization (found by adversarial review)
//
// Deck counts are keyed uppercase and zero-padded, and matching is an exact Map
// lookup — so an un-normalized cardId matched ZERO decks silently. The cache
// key normalized case while the matcher did not, so the wrong answer was cached
// under the right request's key.
// ---------------------------------------------------------------------------

const PADDED_DECKS = [
  { id: 'd1', archetype: 'Dragapult', cards: [{ name: 'Rare Candy', set: 'SVI', number: '1', count: 2 }] }
];

async function deckTotalFor(cardId: string): Promise<number> {
  const response = await withFetch(decksResponder(PADDED_DECKS), () =>
    onRequestPost({ request: post(base({ filters: [{ cardId, operator: '>=', count: 1 }] })) })
  );
  return ((await response.json()) as { deckTotal: number }).deckTotal;
}

test('a cardId matches regardless of set casing', async () => {
  assert.equal(await deckTotalFor('svi~001'), await deckTotalFor('SVI~001'));
  assert.equal(await deckTotalFor('svi~001'), 1, 'lowercase must not silently match zero decks');
});

test('a cardId matches regardless of zero padding', async () => {
  for (const id of ['SVI~1', 'SVI~01', 'SVI~001']) {
    assert.equal(await deckTotalFor(id), 1, `${id} should reach the padded deck key`);
  }
});

test('a cardId that is not a match id is rejected rather than matching nothing', async () => {
  const response = await onRequestPost({ request: post(base({ filters: [{ cardId: 'no-separator' }] })) });
  assert.equal(response.status, 400);
});

test('a non-string field is rejected rather than coerced to its default', async () => {
  // normalizeString collapses a non-string to '', which is indistinguishable
  // from absent — so `successFilter: true` used to silently mean 'all'.
  for (const body of [
    base({ successFilter: true }),
    base({ slice: 42 }),
    base({ tournament: { a: 1 } }),
    base({ filters: [{ cardId: 'SVI~001', operator: true }] }),
    base({ filters: [{ cardId: ['SVI~001'] }] })
  ]) {
    assert.equal((await onRequestPost({ request: post(body) })).status, 400, JSON.stringify(body));
  }
});

test('the body cap counts UTF-8 bytes, not UTF-16 code units', async () => {
  // A multi-byte body under the cap in string length but over it in bytes must
  // still be rejected: '€' is 1 UTF-16 unit but 3 UTF-8 bytes.
  const multibyte = '€'.repeat(7000);
  assert.ok(multibyte.length < 16 * 1024, 'probe must be under the cap by string length');
  const response = await onRequestPost({ request: post(base({ tournament: multibyte })) });
  assert.equal(response.status, 413);
});

test('count is ignored in the cache key for operators that ignore it', async () => {
  // `any` means "one or more" and the empty operator means "none"; both ignore
  // the count, so varying it must not split one logical request across entries.
  const a = await withFetch(decksResponder(PADDED_DECKS), () =>
    onRequestPost({ request: post(base({ filters: [{ cardId: 'SVI~001', operator: 'any', count: 1 }] })) })
  );
  const b = await withFetch(decksResponder(PADDED_DECKS), () =>
    onRequestPost({ request: post(base({ filters: [{ cardId: 'SVI~001', operator: 'any', count: 60 }] })) })
  );
  const shape = async (r: Response) => {
    const { deckTotal, items } = (await r.json()) as { deckTotal: number; items: unknown[] };
    return { deckTotal, items };
  };
  assert.deepEqual(await shape(a), await shape(b));
});
