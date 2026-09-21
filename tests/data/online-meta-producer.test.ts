import test from 'node:test';
import assert from 'node:assert/strict';

import { type OnlineMetaOptions, type OnlineMetaStore, runOnlineMeta } from '../../.github/scripts/lib/onlineMeta';

const BASE = 'reports/Online - Last 14 Days';
const NOW = new Date('2026-08-21T12:00:00Z');
const SYNONYMS = { synonyms: { 'Dragapult ex::TWM::130': 'Dragapult ex::TWM::130' }, canonicals: {} };

/** An in-memory bucket that records what the run did to it, in order. */
function memoryStore(seed: Record<string, unknown> = {}) {
  const objects = new Map<string, unknown>(Object.entries(seed));
  const writes: string[] = [];
  const removed: string[] = [];
  /** Writes and removes interleaved, in the order the run made them. */
  const ops: string[] = [];
  const store: OnlineMetaStore = {
    read: async <T>(key: string) => (objects.get(key) as T | undefined) ?? null,
    async write(key, value) {
      objects.set(key, value);
      writes.push(key);
      ops.push('write');
    },
    list: async prefix => [...objects.keys()].filter(key => key.startsWith(prefix)),
    async remove(keys) {
      for (const key of keys) {
        objects.delete(key);
        removed.push(key);
        ops.push('remove');
      }
      return keys.length;
    }
  };
  const report = () =>
    [...objects.keys()]
      .filter(key => key.startsWith(`${BASE}/`))
      .map(key => key.slice(BASE.length + 1))
      .sort();
  return { store, objects, writes, removed, ops, report };
}

const listed = (placing: number, deck: string, card: string) => ({
  placing,
  name: `Player ${placing}`,
  player: `p${placing}`,
  deck: { id: deck.toLowerCase(), name: deck },
  decklist: { pokemon: [{ name: card, count: 4, set: 'TWM', number: '130' }] }
});

/** One 16-player event: ten Dragapult, six Gardevoir. */
const STANDINGS = Array.from({ length: 16 }, (_, index) =>
  index < 10 ? listed(index + 1, 'Dragapult', 'Dragapult ex') : listed(index + 1, 'Gardevoir', 'Gardevoir ex')
);

interface Limitless {
  tournaments?: unknown[];
  standings?: unknown[];
  failPairings?: boolean;
}

function limitless({ tournaments, standings = STANDINGS, failPairings = false }: Limitless = {}) {
  const events = tournaments ?? [{ id: 't1', name: 'Weekly', date: '2026-08-20T18:00:00.000Z', players: 16 }];
  const fetchJson: OnlineMetaOptions['fetchJson'] = async path => {
    if (path === '/tournaments') {
      return events;
    }
    if (path === '/games/PTCG/decks') {
      return [];
    }
    if (path.endsWith('/details')) {
      return { decklists: true, isOnline: true, format: 'standard', organizer: { name: 'Org', id: 'org-1' } };
    }
    if (path.endsWith('/pairings')) {
      if (failPairings) {
        throw new Error('pairings unavailable');
      }
      return [];
    }
    return standings;
  };
  return fetchJson;
}

function options(store: OnlineMetaStore, overrides: Partial<OnlineMetaOptions> = {}): OnlineMetaOptions {
  return {
    store,
    fetchJson: limitless(),
    limitlessApiKey: 'test-key',
    now: NOW,
    reportsPrefix: 'reports',
    exclusions: {},
    thumbnails: {},
    log: () => undefined,
    warn: () => undefined,
    ...overrides
  };
}

const seeded = (extra: Record<string, unknown> = {}) =>
  memoryStore({ 'assets/card-synonyms.json': SYNONYMS, ...extra });

test('publishes the whole report, with meta.json written last', async () => {
  const bucket = seeded();
  const meta = await runOnlineMeta(options(bucket.store));

  assert.equal(bucket.writes.at(-1), `${BASE}/meta.json`);
  assert.equal(meta.deckTotal, 16);
  assert.equal(meta.tournamentCount, 1);
  const report = bucket.report();
  for (const key of [
    'master.json',
    'meta.json',
    'cardUsage.json',
    'lists.json',
    'archetypes/index.json',
    'decks/index.json'
  ]) {
    assert.ok(report.includes(key), `missing ${key}`);
  }
  assert.ok(report.includes('archetypes/Dragapult/cards.json'));
  assert.ok(report.includes('archetypes/Dragapult/trends.json'));
  // Every shard the deck index names was published.
  const shards = bucket.objects.get(`${BASE}/decks/index.json`) as string[];
  assert.ok(shards.length > 0);
  for (const shard of shards) {
    assert.ok(bucket.objects.has(`${BASE}/${shard}`), `missing shard ${shard}`);
  }
});

test('sweeps an archetype that left the meta and keys outside the report shape, and nothing else', async () => {
  const bucket = seeded({
    [`${BASE}/archetypes/Retired_Deck/cards.json`]: {},
    [`${BASE}/archetypes/Retired_Deck/trends.json`]: {},
    [`${BASE}/decks/retired.json`]: [],
    [`${BASE}/legacy.sqlite`]: 'x',
    // Inside the report's shape and not this run's to rewrite: kept.
    [`${BASE}/archetypes/Dragapult/decks.json`]: [],
    'reports/Trends - Last 30 Days/trends.json': {},
    'assets/data/card-types.json': { 'TWM::130': { cardType: 'pokemon' } }
  });
  await runOnlineMeta(options(bucket.store));

  assert.deepEqual(bucket.removed.sort(), [
    `${BASE}/archetypes/Retired_Deck/cards.json`,
    `${BASE}/archetypes/Retired_Deck/trends.json`,
    `${BASE}/decks/retired.json`,
    `${BASE}/legacy.sqlite`
  ]);
  assert.ok(bucket.objects.has('reports/Trends - Last 30 Days/trends.json'));
  assert.ok(bucket.objects.has('assets/card-synonyms.json'));
});

test('a master-only run leaves the published archetypes alone', async () => {
  const kept = `${BASE}/archetypes/Retired_Deck/cards.json`;
  const bucket = seeded({ [kept]: {} });
  await runOnlineMeta(options(bucket.store, { generateArchetypes: false }));

  assert.deepEqual(bucket.removed, []);
  assert.ok(bucket.objects.has(kept));
  assert.deepEqual(bucket.writes, [`${BASE}/master.json`, `${BASE}/cardSuccess.json`, `${BASE}/meta.json`]);
});

test('a failed gather leaves the previous report untouched, even in a clean refresh', async () => {
  const previous = { [`${BASE}/master.json`]: { old: true }, [`${BASE}/meta.json`]: { old: true } };
  const bucket = seeded(previous);
  await assert.rejects(
    runOnlineMeta(options(bucket.store, { cleanRefresh: true, fetchJson: limitless({ tournaments: [] }) })),
    /No decklists gathered/
  );
  assert.deepEqual(bucket.writes, []);
  assert.deepEqual(bucket.removed, []);
});

test('refuses to publish a window with no event in the last 14 days', async () => {
  const stale = [{ id: 't0', name: 'Old Weekly', date: '2026-07-28T18:00:00.000Z', players: 16 }];
  const bucket = seeded();
  await assert.rejects(
    runOnlineMeta(options(bucket.store, { cleanRefresh: true, fetchJson: limitless({ tournaments: stale }) })),
    /refusing to publish a mislabelled report/
  );
  assert.deepEqual(bucket.writes, []);
});

test('a clean refresh empties the folder only after the report is built, then rewrites it', async () => {
  const bucket = seeded({ [`${BASE}/master.json`]: { old: true }, [`${BASE}/archetypes/Retired_Deck/cards.json`]: {} });
  const meta = await runOnlineMeta(options(bucket.store, { cleanRefresh: true }));

  assert.equal(meta.refreshMode, true);
  assert.equal(meta.refreshLookbackDays, 30);
  assert.ok(bucket.removed.includes(`${BASE}/master.json`));
  // The old folder goes in one sweep before the first write; the only removes after it are the run's own.
  assert.deepEqual(bucket.ops.slice(0, 3), ['remove', 'remove', 'write']);
  assert.ok(!bucket.report().some(key => key.includes('Retired_Deck')));
  assert.notDeepEqual(bucket.objects.get(`${BASE}/master.json`), { old: true });
});

test('stops before publishing when the synonym database is missing', async () => {
  const bucket = memoryStore();
  await assert.rejects(runOnlineMeta(options(bucket.store)), /synonyms/i);
  assert.deepEqual(bucket.writes, []);
});

test('a pairings outage is recorded on meta rather than failing the run', async () => {
  const bucket = seeded();
  const meta = await runOnlineMeta(options(bucket.store, { fetchJson: limitless({ failPairings: true }) }));
  const skipped = meta.skipped as { pairingsFailures: Array<{ tournamentId: string }> };
  assert.deepEqual(
    skipped.pairingsFailures.map(failure => failure.tournamentId),
    ['t1']
  );
});

test('an explicitly undefined option takes its default', async () => {
  const bucket = seeded();
  await runOnlineMeta(options(bucket.store, { generateMaster: undefined, cleanRefresh: undefined }));
  assert.ok(bucket.objects.has(`${BASE}/master.json`));
});

test('a stale cardSuccess.json is swept when no deck meets the floor, and kept when master is off', async () => {
  // Eight players: enough for a report, below the success tag's field floor.
  const small = limitless({ standings: STANDINGS.slice(0, 8) });
  const stale = { [`${BASE}/cardSuccess.json`]: { old: true } };

  const swept = seeded(stale);
  await runOnlineMeta(options(swept.store, { fetchJson: small }));
  assert.deepEqual(swept.removed, [`${BASE}/cardSuccess.json`]);

  const kept = seeded(stale);
  await runOnlineMeta(options(kept.store, { fetchJson: small, generateMaster: false }));
  assert.deepEqual(kept.removed, []);
  assert.ok(!kept.writes.includes(`${BASE}/master.json`));
  assert.ok(kept.writes.includes(`${BASE}/archetypes/index.json`));
});

test('lists.json indexes every listed deck, and a master-only run leaves it alone', async () => {
  const bucket = seeded();
  await runOnlineMeta(options(bucket.store));
  const lists = bucket.objects.get(`${BASE}/lists.json`) as { decks: unknown[]; events: unknown[][] };
  assert.equal(lists.decks.length, 16);
  assert.deepEqual(lists.events, [['t1', 'Weekly', '2026-08-20', 16]]);

  const kept = seeded({ [`${BASE}/lists.json`]: { old: true } });
  await runOnlineMeta(options(kept.store, { generateArchetypes: false }));
  assert.deepEqual(kept.removed, []);
  assert.ok(!kept.writes.includes(`${BASE}/lists.json`));
});

test('a store failure mid-publish never reaches meta.json', async () => {
  for (const failing of ['write', 'remove'] as const) {
    const bucket = seeded({ [`${BASE}/legacy.sqlite`]: 'x' });
    const store: OnlineMetaStore = {
      ...bucket.store,
      write: (key, value) =>
        failing === 'write' && key.endsWith('/decks/index.json')
          ? Promise.reject(new Error('store down'))
          : bucket.store.write(key, value),
      remove: keys => (failing === 'remove' ? Promise.reject(new Error('store down')) : bucket.store.remove(keys))
    };
    await assert.rejects(runOnlineMeta(options(store)), /store down/, failing);
    assert.ok(!bucket.writes.includes(`${BASE}/meta.json`), failing);
  }
});
