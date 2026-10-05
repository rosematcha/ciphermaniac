/**
 * League shards (shared/events/leagues.ts): one entry per league with where
 * its store is and the events pokemon.com lists for it with a sanction ID,
 * built from either listing's records, and published only where they change.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { type Publisher, publishLeagues } from '../../.github/scripts/lib/eventLocator.ts';
import {
  buildLeagueShards,
  LEAGUE_SHARDS,
  leagueShardOf,
  leagueShardPath,
  leaguesIndexPath
} from '../../shared/events/leagues.ts';
import { rawEventWithId, rawListedLocal, rawLocalEvent } from '../__utils__/pokedata.ts';

const NOW = new Date('2026-09-15T12:00:00Z');
const zoneAt = () => 'America/Chicago';

test('a league’s shard is the last two digits of its ID', () => {
  assert.equal(leagueShardOf('6238620'), '20');
  assert.equal(leagueShardOf('7'), '07');
  assert.equal(LEAGUE_SHARDS.length, 100);
});

test('every shard comes back; a league holds its store and its listings with sanction IDs, soonest first', () => {
  const raw = [
    rawEventWithId(3, { league: '6238620', date: '2026-09-27', when: '2026-09-27 11:00:00', time: '11:00:00' }),
    rawEventWithId(2, { league: '6238620', type: 'League Challenge', date: '2026-09-20' }),
    rawEventWithId(4, { league: '6238620', date: '2026-09-01', when: '2026-09-01 11:00:00' }),
    rawEventWithId(5, { league: 'not a league' })
  ];
  const shards = buildLeagueShards(raw, { now: NOW, zoneAt });
  assert.equal(shards.size, 100);
  const entry = shards.get('20')?.leagues['6238620'];
  assert.ok(entry);
  assert.deepEqual([entry.shop, entry.city, entry.timeZone], ['TEST GAMES', 'Austin', 'America/Chicago']);
  assert.deepEqual(
    entry.listings.map(listing => [listing.sanctionId, listing.kind, listing.date]),
    [
      ['26-09-000002', 'challenge', '2026-09-20'],
      ['26-09-000003', 'cup', '2026-09-27']
    ],
    'a past one is not listed'
  );
  assert.deepEqual(Object.keys(shards.get('01')?.leagues ?? {}), [], 'a record naming no league is in no shard');
});

test('a listed local gives its sanction ID from its address; an unnamed one places the store and lists nothing', () => {
  const raw = [
    rawLocalEvent({ league: '6238620', date: '2026-09-17', when: '2026-09-17 00:00:00' }),
    rawListedLocal(19064, { league: '6238620', date: '2026-09-16', when: '2026-09-16 19:30:00' }),
    rawListedLocal(19064, { league: '6238620', date: '2026-09-16', when: '2026-09-16 19:30:00' })
  ];
  const entry = buildLeagueShards(raw, { now: NOW, zoneAt }).get('20')?.leagues['6238620'];
  assert.deepEqual(
    entry?.listings.map(listing => [listing.sanctionId, listing.kind, listing.time]),
    [['26-09-019064', 'local', '19:30']],
    'each sanction ID once'
  );
});

function memoryPublisher() {
  const writes: string[] = [];
  const store = new Map<string, unknown>();
  const publisher: Publisher = {
    read: async <T>(key: string) => (store.get(key) ?? null) as T,
    write: async (key, value) => {
      writes.push(key);
      store.set(key, value);
    },
    remove: async () => undefined
  };
  return { publisher, writes, store };
}

test('league shards are written where they change, then their index', async () => {
  const { publisher, writes } = memoryPublisher();
  const first = buildLeagueShards([rawEventWithId(2, { league: '6238620' })], { now: NOW, zoneAt });
  assert.equal(await publishLeagues('sanctioned', first, publisher, NOW), 1);
  assert.equal(writes.length, 101, 'every shard the first time, and the index');
  assert.equal(writes.at(-1), leaguesIndexPath('sanctioned'));
  writes.length = 0;
  await publishLeagues('sanctioned', first, publisher, NOW);
  assert.deepEqual(writes, [], 'nothing changed, nothing written');
  const second = buildLeagueShards(
    [rawEventWithId(2, { league: '6238620' }), rawEventWithId(3, { league: '1000001' })],
    { now: NOW, zoneAt }
  );
  await publishLeagues('sanctioned', second, publisher, NOW);
  assert.deepEqual(writes, [leagueShardPath('sanctioned', '01'), leaguesIndexPath('sanctioned')]);
});
