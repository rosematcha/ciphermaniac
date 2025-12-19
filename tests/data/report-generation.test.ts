import test from 'node:test';
import assert from 'node:assert/strict';

import { deepClone, mockFetch, restoreFetch } from '../__utils__/test-helpers';

import { generateReportFromDecks } from '../../functions/lib/reportBuilder.js';
import { buildArchetypeReports, gatherDecks } from '../../functions/lib/onlineMeta.js';

// Helpers
function makeCard(
  name: string,
  count?: number,
  set?: string,
  number?: string,
  category?: string,
  trainerType?: string,
  energyType?: string,
  aceSpec?: boolean
) {
  const card: any = { name, count: count ?? 1 };
  if (set !== undefined) {
    card.set = set;
  }
  if (number !== undefined) {
    card.number = number;
  }
  if (category !== undefined) {
    card.category = category;
  }
  if (trainerType !== undefined) {
    card.trainerType = trainerType;
  }
  if (energyType !== undefined) {
    card.energyType = energyType;
  }
  if (aceSpec !== undefined) {
    card.aceSpec = aceSpec;
  }
  return card;
}

test('Generate report from valid deck list and calculate distributions', () => {
  const decks = [
    { cards: [makeCard('Pikachu', 2, 'SVI', '1'), makeCard('Professor', 4, undefined, undefined, 'trainer')] },
    {
      cards: [makeCard('Pikachu', 3, 'SVI', '001'), makeCard('Ultra Ball', 2, undefined, undefined, 'trainer', 'item')]
    },
    { cards: [makeCard('Charizard', 1, 'SWSH', '12'), makeCard('Pikachu', 1, 'SVI', '1')] }
  ];

  const report = generateReportFromDecks(decks, decks.length, decks, null);
  assert.strictEqual(report.deckTotal, 3);

  const pik = report.items.find((i: any) => String(i.name).toLowerCase().includes('pikachu'));
  assert.ok(pik, 'Pikachu should be present');
  assert.strictEqual(pik.found, 3);
  assert.strictEqual(Number(pik.pct), 100);

  const { dist } = pik;
  assert.ok(Array.isArray(dist));
  const copyCounts = dist.map((entry: any) => entry.copies);
  assert.ok(copyCounts.includes(1));
  assert.ok(copyCounts.includes(2));
  assert.ok(copyCounts.includes(3));

  const char = report.items.find((i: any) => String(i.name).toLowerCase().includes('charizard'));
  assert.ok(char);
  assert.strictEqual(char.found, 1);
  assert.strictEqual(Number(char.pct), Math.round((1 / 3) * 10000) / 100);
});

test('Handle empty tournament and tournament with no decks', () => {
  const emptyReport = generateReportFromDecks([], 0, [], null);
  assert.strictEqual(emptyReport.deckTotal, 0);
  assert.ok(Array.isArray(emptyReport.items));
  assert.strictEqual(emptyReport.items.length, 0);

  const noDecksReport = generateReportFromDecks(null as any, 0, null as any, null);
  assert.strictEqual(noDecksReport.deckTotal, 0);
  assert.strictEqual(noDecksReport.items.length, 0);
});

test('Handle malformed deck lists and validate deck totals', () => {
  const malformed = [{ cards: null }, {}, { cards: [{ name: 'Bad Card', count: 'not-a-number' } as any] }];

  const report = generateReportFromDecks(malformed as any, malformed.length, malformed as any, null);
  assert.strictEqual(Array.isArray(report.items), true);
  assert.strictEqual(report.items.length, 0);
  assert.strictEqual(report.deckTotal, 3);
});

test('Detect duplicate decks and aggregate across multiple tournaments', () => {
  const deckA = { cards: [makeCard('Zubat', 4, 'SWSH', '010')] };
  const deckB = deepClone(deckA);
  const decks = [deckA, deckB];
  const report = generateReportFromDecks(decks, decks.length, decks, null);
  const zubat = report.items.find((i: any) => String(i.name).toLowerCase().includes('zubat'));
  assert.ok(zubat);
  assert.strictEqual(zubat.found, 2);
  assert.strictEqual(Array.isArray(zubat.dist), true);
  assert.strictEqual(zubat.dist.length, 1);
  assert.strictEqual(zubat.dist[0].copies, 4);
  assert.strictEqual(zubat.dist[0].players, 2);
});

test('Handle cards appearing in 100% and 0% of decks', () => {
  const decks = [{ cards: [makeCard('Always', 1)] }, { cards: [makeCard('Always', 2)] }];
  const report = generateReportFromDecks(decks, decks.length, decks, null);
  const always = report.items.find((i: any) => String(i.name).toLowerCase().includes('always'));
  assert.ok(always);
  assert.strictEqual(always.pct, 100);

  const never = report.items.find((i: any) => String(i.name).toLowerCase().includes('never'));
  assert.strictEqual(never, undefined);
});

test('gatherDecks derives success tags and handles small tournaments / ties', async () => {
  const tournaments = [
    { id: 't1', name: 'Event 1', date: '2025-12-01T12:00:00Z', players: 16 },
    { id: 't2', name: 'Tiny Event', date: '2025-12-02T12:00:00Z', players: 2 }
  ];

  mockFetch([
    {
      predicate: (input: RequestInfo) => String(input).includes('/tournaments/t1/standings'),
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: [
        { name: 'Alice', placing: 1, decklist: { pokemon: [{ name: 'A', count: 4 }] } },
        { name: 'Bob', placing: 2, decklist: { pokemon: [{ name: 'B', count: 4 }] } },
        { name: 'Carol', placing: 2, decklist: { pokemon: [{ name: 'C', count: 4 }] } },
        { name: 'Dave', placing: 4, decklist: { pokemon: [{ name: 'D', count: 4 }] } }
      ]
    },
    {
      predicate: (input: RequestInfo) => String(input).includes('/tournaments/t2/standings'),
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: [{ name: 'Tiny', placing: 1, decklist: { pokemon: [{ name: 'X', count: 4 }] } }]
    }
  ]);

  const diagnostics: any = {};
  const mockEnv = { LIMITLESS_API_KEY: 'test-key' };
  const decks = await gatherDecks(mockEnv as any, tournaments as any, diagnostics, null, {});

  assert.ok(Array.isArray(diagnostics.tournamentsBelowMinimum));
  const below = diagnostics.tournamentsBelowMinimum.find((entry: any) => entry.tournamentId === 't2');
  assert.ok(below, 'Tiny event should be recorded as below minimum');

  const t1Decks = decks.filter(deck => deck.tournamentId === 't1');
  assert.strictEqual(t1Decks.length, 4);

  const alice = t1Decks.find(deck => deck.player === 'Alice');
  assert.ok(alice);
  assert.ok(Array.isArray(alice.successTags));
  assert.ok(alice.successTags.includes('winner'));

  const bob = t1Decks.find(deck => deck.player === 'Bob');
  assert.ok(bob);
  assert.ok(bob.successTags.includes('top4'));

  restoreFetch();
});

test('buildArchetypeReports groups archetypes and computes thumbnails/index', () => {
  const decks = [
    { archetype: 'Fast Fire', cards: [{ name: 'F', count: 3 }] },
    { archetype: 'fast_fire', cards: [{ name: 'F', count: 3 }] },
    { archetype: 'Control Man', cards: [{ name: 'C', count: 3 }] }
  ];

  const { archetypeFiles, archetypeIndex, minDecks } = buildArchetypeReports(decks as any, 1, null, {
    thumbnailConfig: {}
  });
  assert.ok(Array.isArray(archetypeFiles));
  assert.ok(archetypeFiles.some((file: any) => String(file.base).toLowerCase().includes('fast')));
  assert.ok(Array.isArray(archetypeIndex));
  assert.strictEqual(minDecks >= 1, true);
});

test('cleanup report-generation mocks', () => {
  restoreFetch();
});
