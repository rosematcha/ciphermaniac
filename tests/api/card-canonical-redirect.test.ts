/**
 * Edge behavior for `/cards/:set/:number` (functions/cards/[set]/[number].ts).
 *
 * The route-graph properties themselves live in
 * tests/data/canonical-card-route.test.ts; this file covers the edge wrapper:
 * that it 301s only when a redirect is warranted, that it never 301s to a URL
 * that would 301 again, and that a broken or absent synonym DB degrades to the
 * SPA shell rather than an error or a loop.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../../functions/cards/[set]/[number].ts';

const SYNONYMS = {
  synonyms: {
    'Dragapult ex::TWM::130': 'Dragapult ex::PRE::073',
    'Dragapult ex::TWM::200': 'Dragapult ex::PRE::073',
    'Dragapult ex::ASC::160': 'Dragapult ex::PRE::073',
    'Nest Ball::SUM::123': 'Nest Ball::SVI::181'
  },
  canonicals: {
    'Dragapult ex': 'Dragapult ex::PRE::073',
    'Nest Ball': 'Nest Ball::SVI::181'
  }
};

const NEXT_BODY = 'spa-shell';

function makeEnv(db: unknown | null) {
  return {
    REPORTS: {
      get: async (key: string) =>
        key === 'assets/card-synonyms.json' && db !== null ? { text: async () => JSON.stringify(db) } : null
    } as unknown as R2Bucket
  };
}

async function request(set: string, number: string, db: unknown | null = SYNONYMS) {
  const res = await onRequest({
    request: new Request(`https://ciphermaniac.com/cards/${set}/${number}`),
    env: makeEnv(db),
    params: { set, number },
    next: async () => new Response(NEXT_BODY, { status: 200 })
  } as never);
  return { status: res.status, location: res.headers.get('Location') ?? '', res };
}

test('a variant printing 301s to its canonical card page', async () => {
  const { status, location } = await request('TWM', '130');
  assert.equal(status, 301);
  assert.equal(location, 'https://ciphermaniac.com/cards/PRE/073');
});

test('the canonical printing is served, not redirected', async () => {
  const { status, res } = await request('PRE', '073');
  assert.equal(status, 200);
  assert.equal(await res.text(), NEXT_BODY);
});

test('a redirect target never redirects again (no 301 loop)', async () => {
  for (const [set, number] of [
    ['TWM', '130'],
    ['TWM', '200'],
    ['ASC', '160'],
    ['SUM', '123']
  ]) {
    const first = await request(set, number);
    assert.equal(first.status, 301, `${set}/${number} should redirect`);
    const target = new URL(first.location).pathname.split('/');
    const second = await request(target[2], target[3]);
    assert.equal(second.status, 200, `${first.location} redirected again`);
  }
});

test('a reciprocal synonym pair serves both URLs rather than looping', async () => {
  const cyclic = {
    synonyms: {
      'Dragapult ex::TWM::130': 'Dragapult ex::PRE::073',
      'Dragapult ex::PRE::073': 'Dragapult ex::TWM::130'
    },
    canonicals: {}
  };
  for (const [set, number] of [
    ['TWM', '130'],
    ['PRE', '073']
  ]) {
    const first = await request(set, number, cyclic);
    if (first.status !== 301) {
      continue;
    }
    const target = new URL(first.location).pathname.split('/');
    const second = await request(target[2], target[3], cyclic);
    assert.equal(second.status, 200, `${set}/${number} 301-loops via ${first.location}`);
  }
});

test('URL casing and zero padding resolve the same as the canonical form', async () => {
  for (const [set, number] of [
    ['twm', '130'],
    ['TWM', '0130'],
    ['TwM', '00130']
  ]) {
    const { status, location } = await request(set, number);
    assert.equal(status, 301);
    assert.equal(location, 'https://ciphermaniac.com/cards/PRE/073');
  }
});

test('an unknown card falls through to the SPA shell', async () => {
  const { status, res } = await request('ZZZ', '999');
  assert.equal(status, 200);
  assert.equal(await res.text(), NEXT_BODY);
});

test('a missing synonym DB falls through instead of failing', async () => {
  const { status } = await request('TWM', '130', null);
  assert.equal(status, 200);
});

test('a malformed synonym DB falls through instead of failing', async () => {
  const { status } = await request('TWM', '130', { synonyms: { garbage: 42 }, canonicals: {} });
  assert.equal(status, 200);
});

test('an empty set or number falls through', async () => {
  assert.equal((await request('', '130')).status, 200);
  assert.equal((await request('TWM', '')).status, 200);
});
