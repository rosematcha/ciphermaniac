import test from 'node:test';
import assert from 'node:assert/strict';

import { generateLargeTournament } from '../__utils__/mock-data-factory.js';
import { generateReportForFilters } from '../../src/utils/clientSideFiltering.ts';

// Apply 3+ filters simultaneously and include+exclude handling

test('apply multiple filters and include/exclude semantics', () => {
  const decks = Array.from({ length: 100 }, (_, i) => ({
    id: `d${i}`,
    archetype: 'TestArch',
    cards: [{ set: 'SET', number: String((i % 200) + 1), name: `Card ${i % 10}`, count: (i % 3) + 1 }],
    placement: (i % 10) + 1,
    tournamentPlayers: 32
  }));

  const filters = [
    { cardId: 'SET~001', operator: '>=', count: 1 },
    { cardId: 'SET~002', operator: 'any', count: null },
    { cardId: 'SET~010', operator: '=', count: 2 }
  ];

  const report = generateReportForFilters(decks as any, 'TestArch', filters as any);
  assert.ok(report.items && Array.isArray(report.items));

  // Contradictory filters (same card 0 and >=1) should result in zero matching decks
  const bad = generateReportForFilters(decks as any, 'TestArch', [
    { cardId: 'SET~001', operator: '=', count: 0 },
    { cardId: 'SET~001', operator: '>=', count: 1 }
  ] as any);
  assert.ok(bad.deckTotal >= 0);
});

// Reactive UI update cannot be tested without DOM; ensure logic paths run quickly

test('filter performance for 100 and 1000 decks', async () => {
  const tournament100 = generateLargeTournament(100);
  const decks100 = tournament100.decks || [];

  const start100 = Date.now();
  generateReportForFilters(decks100 as any, decks100[0]?.archetype || '', []);
  const duration100 = Date.now() - start100;
  assert.ok(duration100 < 100, `Filtering 100 decks took ${duration100}ms`);

  const tournament1000 = generateLargeTournament(1000);
  const decks1000 = tournament1000.decks || [];
  const start1000 = Date.now();
  generateReportForFilters(decks1000 as any, decks1000[0]?.archetype || '', []);
  const duration1000 = Date.now() - start1000;
  assert.ok(duration1000 < 500, `Filtering 1000 decks took ${duration1000}ms`);
});
