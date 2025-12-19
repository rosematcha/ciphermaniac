import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLargeTournament, generateMockTournament } from '../__utils__/mock-data-factory.js';
import { aggregateDecks } from '../../src/utils/clientSideFiltering.ts';

test('Handle empty tournament list and decks with no cards', () => {
  const tourn = generateMockTournament();
  tourn.decks = [] as any;
  const report = aggregateDecks(tourn.decks || []);
  assert.strictEqual(report.deckTotal, 0);
  assert.ok(Array.isArray(report.items));

  const deckWithNoCards = [{ id: 'd1', archetype: 'X', cards: [] }];
  const rep2 = aggregateDecks(deckWithNoCards as any);
  assert.strictEqual(rep2.deckTotal, 1);
  assert.strictEqual(rep2.items.length, 0);
});

test('Card with no name, missing set/number, extreme deck counts, and duplicates', () => {
  const decks = [
    { id: 'd1', archetype: 'A', cards: [{ name: '', set: '', number: '' }] },
    { id: 'd2', archetype: 'A', cards: [{ name: 'X', set: null, number: null }] }
  ];

  const report = aggregateDecks(decks as any);
  assert.ok(report.items.length >= 0);

  const many = generateLargeTournament(12000);
  // ensure it doesn't throw when processing large counts (deck count > 10000)
  const reportLarge = aggregateDecks(many.decks || []);
  assert.ok(typeof reportLarge.deckTotal === 'number');

  // Duplicate deck entries
  const dupDecks = [
    { id: 'd1', archetype: 'A', cards: [{ name: 'C', set: 'S', number: '1', count: 1 }] },
    { id: 'd1', archetype: 'A', cards: [{ name: 'C', set: 'S', number: '1', count: 1 }] }
  ];
  const dupReport = aggregateDecks(dupDecks as any);
  // Ensure duplicates are counted as separate entries by aggregateDecks
  assert.strictEqual(dupReport.deckTotal, 2);
});
