import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSearchIndex, createSearchLoader, type SearchSources, searchTiered } from '../../src/lib/globalSearch';
import type { PlayerIndexSlimEntry } from '../../shared/playerTypes';
import type { ArchetypeIndexEntry, CardItem } from '../../src/types';

function card(name: string, set: string, number: string, pct: number): CardItem {
  return { name, set, number, pct, found: 0, total: 0 };
}

function archetype(name: string, label: string, percent: number): ArchetypeIndexEntry {
  return { name, label, percent, deckCount: 1, thumbnails: [], icons: ['dragapult'] };
}

function player(playerId: string, name: string, eventCount: number): PlayerIndexSlimEntry {
  return { playerId, name, eventCount, wins: 0, losses: 0, day2s: 0, topCuts: 0, tournamentWins: 0 };
}

const sources: SearchSources = {
  archetypes: [
    archetype('Dragapult_Dusknoir', 'Dragapult Dusknoir', 8),
    archetype('Dragapult', 'Dragapult', 12),
    archetype('Gardevoir', 'Gardevoir', 5)
  ],
  cards: [
    card('Dragapult ex', 'TWM', '130', 20),
    card('Pokégear 3.0', 'SVI', '186', 40),
    card('Iono', 'PAL', '185', 90),
    card('Arven', 'SVI', '181', 80),
    card('Nest Ball', 'SVI', '255', 70)
  ],
  players: [player('1', 'Drago Sanchez', 3), player('2', 'Ada Dragon', 9)],
  tournaments: ['2026-06-12, International Championship New Orleans', '2026-05-30, Regional Championship Milwaukee']
};

const index = buildSearchIndex(sources);

function labels(query: string): string[] {
  return searchTiered(index, query).hits.map(h => h.entry.label);
}

test('buildSearchIndex flattens every source with routes and sublabels', () => {
  assert.equal(index.length, 12);
  const pult = index.find(e => e.kind === 'archetype' && e.label === 'Dragapult Dusknoir');
  assert.equal(pult?.href, '/archetypes/Dragapult_Dusknoir');
  assert.equal(pult?.sublabel, '8.0%');
  const arven = index.find(e => e.label === 'Arven');
  assert.equal(arven?.href, '/cards/SVI/181');
  assert.equal(arven?.sublabel, 'SVI 181');
  assert.equal(index.find(e => e.kind === 'player' && e.label === 'Ada Dragon')?.sublabel, '9 events');
  const event = index.find(e => e.kind === 'tournament');
  assert.equal(event?.label, 'New Orleans Internationals');
  assert.ok(event?.kind === 'tournament' && event.tournament.startsWith('2026-06-12'));
  assert.match(event?.href ?? '', /^\/\?scope=/);
  assert.match(event?.sublabel ?? '', /2026/);
});

test('buildSearchIndex skips cards without a set or number and tolerates missing sources', () => {
  const partial = buildSearchIndex({ cards: [{ name: 'Nameless', found: 0, total: 0, pct: 0 }], players: null });
  assert.deepEqual(partial, []);
});

test('empty and whitespace queries return nothing', () => {
  assert.deepEqual(searchTiered(index, ''), { groups: [], hits: [] });
  assert.deepEqual(searchTiered(index, '   '), { groups: [], hits: [] });
});

test('tiers order exact, then prefix, then word-start, then substring', () => {
  const hits = searchTiered(index, 'dragapult').hits.map(h => [h.entry.label, h.tier]);
  assert.deepEqual(hits, [
    ['Dragapult', 1],
    ['Dragapult Dusknoir', 2],
    ['Dragapult ex', 2]
  ]);
  const drag = searchTiered(index, 'drag').hits.map(h => [h.entry.kind, h.entry.label, h.tier]);
  assert.deepEqual(drag, [
    ['archetype', 'Dragapult', 2],
    ['archetype', 'Dragapult Dusknoir', 2],
    ['card', 'Dragapult ex', 2],
    ['player', 'Drago Sanchez', 2],
    ['player', 'Ada Dragon', 3]
  ]);
  assert.deepEqual(
    searchTiered(index, 'ardev').hits.map(h => h.tier),
    [4]
  );
});

test('within a tier, kinds order archetype, card, player, tournament, then prominence', () => {
  const { hits } = searchTiered(index, 'a');
  const tier2 = hits.filter(h => h.tier === 2).map(h => h.entry.label);
  assert.deepEqual(tier2, ['Arven', 'Ada Dragon']);
  const cards = searchTiered(index, 'svi').hits.map(h => h.entry.label);
  assert.deepEqual(cards, ['Arven', 'Nest Ball', 'Pokégear 3.0']);
});

test('results are grouped by kind in best-hit order', () => {
  const { groups, hits } = searchTiered(index, 'drag');
  assert.deepEqual(
    groups.map(g => [g.kind, g.hits.length]),
    [
      ['archetype', 2],
      ['card', 1],
      ['player', 2]
    ]
  );
  assert.deepEqual(
    hits,
    groups.flatMap(g => g.hits)
  );
});

test('caps apply per kind and in total', () => {
  const many = buildSearchIndex({
    cards: Array.from({ length: 9 }, (_, i) => card(`Ball ${i}`, 'SVI', String(i), i)),
    players: Array.from({ length: 9 }, (_, i) => player(String(i), `Ball Player ${i}`, i))
  });
  const def = searchTiered(many, 'ball');
  assert.equal(def.groups[0].hits.length, 5);
  assert.equal(def.hits.length, 10);
  assert.equal(def.hits[0].entry.label, 'Ball 8');
  assert.equal(searchTiered(many, 'ball', { perKind: 5, total: 7 }).hits.length, 7);
});

test('diacritics fold on both sides', () => {
  assert.deepEqual(labels('pokegear'), ['Pokégear 3.0']);
  assert.deepEqual(labels('POKÉGEAR'), ['Pokégear 3.0']);
});

test('multi-word queries need every word to match and take the weakest tier', () => {
  const { hits } = searchTiered(index, 'drag dusk');
  assert.deepEqual(
    hits.map(h => [h.entry.label, h.tier]),
    [['Dragapult Dusknoir', 3]]
  );
  assert.deepEqual(labels('dragapult nope'), []);
});

test('set and number find a card exactly', () => {
  const svi = searchTiered(index, 'SVI 181').hits;
  assert.equal(svi[0].entry.label, 'Arven');
  assert.equal(svi[0].tier, 1);
  assert.equal(searchTiered(index, 'svi/181').hits[0].entry.label, 'Arven');
});

test('tournaments match on their name', () => {
  const { hits } = searchTiered(index, 'milwaukee');
  assert.equal(hits[0].entry.kind, 'tournament');
  assert.equal(hits[0].tier, 2);
});

test('the online meta opens the unscoped home page', () => {
  const [online] = buildSearchIndex({ tournaments: ['Online - Last 14 Days'] });
  assert.equal(online.href, '/');
  assert.equal(online.sublabel, '');
});

test('the loader requests nothing until asked, and the players index only once', async () => {
  const calls: string[] = [];
  const loader = createSearchLoader({
    cards: async scope => {
      calls.push(`cards:${scope}`);
      return [];
    },
    archetypes: async scope => {
      calls.push(`archetypes:${scope}`);
      return [];
    },
    players: async () => {
      calls.push('players');
      return [];
    },
    tournaments: async () => {
      calls.push('tournaments');
      return [];
    }
  });
  assert.deepEqual(calls, []);
  await Promise.all([loader.players(), loader.players(), loader.cards('A'), loader.cards('A'), loader.cards('B')]);
  await loader.tournaments();
  await loader.archetypes('A');
  assert.deepEqual(calls, ['players', 'cards:A', 'cards:B', 'tournaments', 'archetypes:A']);
});

test('a failed load is retried on the next call', async () => {
  let calls = 0;
  const loader = createSearchLoader({
    cards: async () => [],
    archetypes: async () => [],
    tournaments: async () => [],
    players: async () => {
      calls++;
      if (calls === 1) {
        throw new Error('offline');
      }
      return [];
    }
  });
  await assert.rejects(loader.players());
  await Promise.resolve();
  assert.deepEqual(await loader.players(), []);
  assert.equal(calls, 2);
});
