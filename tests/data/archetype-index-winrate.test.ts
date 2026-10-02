import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateEventWinRate, fetchAllArchetypeWinRates } from '../../src/lib/archetypeWinRate';
import { aggregateOnlineWinRate } from '../../shared/data/archetypes/winRate';
import { rowsFromMajorsProfile, rowsFromOnlineMatchups } from '../../src/lib/matchups';
import { ONLINE_META_NAME } from '../../src/lib/constants';
import { dataClient } from '../../src/lib/data/client';
import { fetchArchetypes } from '../../src/lib/data/archetypes';
import type { MatchupPair, MatchupProfile } from '../../src/lib/data/matchups';

const aggregate = { wins: 12, losses: 6, ties: 3, games: 22, winRate: (13 / 22) * 100 };
const entries = Array.from({ length: 39 }, (_, i) => ({ name: `deck_${i}`, label: `Deck ${i}` }));

test('39 online rates use only the already-required index request', async t => {
  const calls: string[] = [];
  const index = entries.map(entry => ({ ...entry, percent: 0.01, winRateAggregate: aggregate }));
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    calls.push(String(url));
    return Response.json(index);
  });
  dataClient.clearCache();
  t.after(() => dataClient.clearCache());
  const list = await fetchArchetypes(ONLINE_META_NAME);
  const rates = await fetchAllArchetypeWinRates(ONLINE_META_NAME, list);
  assert.equal(rates.size, 39);
  for (const entry of list) {
    assert.deepEqual(rates.get(entry.name), aggregate);
    assert.equal(entry.percent, 1);
  }
  assert.equal(calls.length, 1);
  assert.ok(calls[0].endsWith('/archetypes/index.json'));
});

test('legacy and partially populated online indexes never fall back to per-deck downloads', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected request'));
  const legacy = await fetchAllArchetypeWinRates(ONLINE_META_NAME, entries);
  assert.equal(legacy.size, 39);
  assert.deepEqual(legacy.get('deck_0'), aggregateEventWinRate([]));
  const partial = await fetchAllArchetypeWinRates(ONLINE_META_NAME, [
    { ...entries[0], winRateAggregate: aggregate },
    entries[1]
  ]);
  assert.deepEqual(partial.get('deck_0'), aggregate);
  assert.equal(partial.get('deck_1')?.winRate, null);
  assert.equal((await fetchAllArchetypeWinRates('empty-event', [])).size, 0);
  assert.deepEqual(
    (await fetchAllArchetypeWinRates('snapshot:2026-04-01', [{ ...entries[0], winRateAggregate: aggregate }])).get(
      'deck_0'
    ),
    aggregate
  );
});

test('online aggregate matches detail normalization for punctuation, ties and double losses', () => {
  const matchups = {
    mirror: { opponent: 'Farfetch’d / X', wins: 10, losses: 10, ties: 0, total: 20, winRate: 50 },
    field: { opponent: 'Y', wins: 12, losses: 6, ties: 3, total: 22, winRate: 0 }
  };
  const label = "FARFETCH'D_X";
  assert.deepEqual(aggregateOnlineWinRate(matchups, label), aggregate);
  assert.deepEqual(
    aggregateOnlineWinRate(matchups, label),
    aggregateEventWinRate(rowsFromOnlineMatchups(matchups, label))
  );
  assert.deepEqual(aggregateOnlineWinRate({}, label), aggregateEventWinRate([]));
});

function profile(winsA: number): MatchupProfile {
  const pair: MatchupPair = {
    archetypeA: 'Deck 0',
    archetypeB: 'Deck 1',
    matches: 22,
    winsA: winsA + 1.5,
    winsB: 7.5,
    ties: 3,
    doubleLosses: 1,
    weightedWinsA: 100,
    weightedWinsB: 10,
    weightedTies: 3,
    weightedMatches: 111,
    weightedWinRateA: 0,
    weightedWinRateB: 0
  };
  return {
    name: 'all',
    matchesConsidered: 22,
    weightedMatches: 111,
    byArchetypePair: [pair, { ...pair, archetypeB: 'DECK_0' }]
  };
}

for (const quality of [true, false]) {
  test(`majors use one profile request and preserve detail parity (quality=${quality})`, async t => {
    const all = profile(2);
    const preferred = quality ? profile(12) : all;
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
      calls.push(String(url));
      return Response.json({ profiles: { all, ...(quality ? { qualityWeighted: preferred } : {}) } });
    });
    dataClient.clearCache();
    t.after(() => dataClient.clearCache());
    const rates = await fetchAllArchetypeWinRates('majors-test', entries);
    for (const entry of entries) {
      assert.deepEqual(rates.get(entry.name), aggregateEventWinRate(rowsFromMajorsProfile(preferred, entry.label)));
    }
    assert.equal(calls.length, 1);
    assert.ok(calls[0].endsWith('/matchupProfiles.json'));
  });
}

test('scopes without a profile return unavailable rates with no fan-out', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1;
    return new Response(null, { status: 404 });
  });
  dataClient.clearCache();
  t.after(() => dataClient.clearCache());
  const rates = await fetchAllArchetypeWinRates('snapshot:2026-04-01', entries);
  assert.equal(requests, 1);
  assert.equal(rates.size, 39);
  assert.deepEqual(rates.get('deck_0'), aggregateEventWinRate([]));
});
