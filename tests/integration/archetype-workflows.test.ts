import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSkeletonExportEntries } from '../../src/archetype/data/skeleton.ts';
import { loadFilterCombination, loadSuccessBaseline } from '../../src/archetype/data/report.ts';
import { buildTcgliveExportString } from '../../src/archetype/export/tcgLive.ts';
import { getState, setState } from '../../src/archetype/state.ts';
import {
  type Deck,
  fetchArchetypeDecksLocal,
  filterDecksBySuccess,
  generateReportForFilters
} from '../../src/utils/clientSideFiltering.ts';

const originalFetch = globalThis.fetch;

const baseDecks: Deck[] = [
  {
    id: 'd1',
    archetype: 'Mew',
    tournamentId: 'T1',
    tournamentPlayers: 32,
    placement: 1,
    cards: [{ name: 'Pikachu', set: 'SVI', number: '7', count: 2 }]
  },
  {
    id: 'd2',
    archetype: 'Mew',
    tournamentId: 'T1',
    tournamentPlayers: 32,
    placement: 12,
    cards: [{ name: 'Pikachu', set: 'SVI', number: '7', count: 1 }]
  },
  {
    id: 'd3',
    archetype: 'Gardevoir',
    tournamentId: 'T1',
    tournamentPlayers: 32,
    placement: 4,
    cards: [{ name: 'Pikachu', set: 'SVI', number: '7', count: 4 }]
  }
];

const originalState = {
  tournament: getState().tournament,
  archetypeBase: getState().archetypeBase,
  successFilter: getState().successFilter,
  defaultItems: getState().defaultItems,
  defaultDeckTotal: getState().defaultDeckTotal,
  filterCache: getState().filterCache
};

test.beforeEach(() => {
  globalThis.fetch = async () =>
    ({
      ok: true,
      status: 200,
      json: async () => baseDecks
    }) as Response;
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  setState({ ...originalState });
});

test('loadFilterCombination returns filtered report and caches it', async () => {
  setState({
    tournament: 'Test Tournament',
    archetypeBase: 'Mew',
    successFilter: 'all',
    filterCache: new Map()
  });

  const filters = [{ cardId: 'SVI~007', operator: '>=', count: 2 }];
  const result = await loadFilterCombination(filters);

  assert.equal(result.deckTotal, 1);
  assert.ok(result.items.length > 0);
  assert.equal(getState().filterCache.size, 1);

  const repeat = await loadFilterCombination(filters);
  assert.equal(repeat.deckTotal, 1);
});

test('loadSuccessBaseline respects success filter', async () => {
  setState({
    tournament: 'Test Tournament',
    archetypeBase: 'Mew',
    successFilter: 'winner'
  });

  const baseline = await loadSuccessBaseline();
  assert.equal(baseline.deckTotal, 1);
  assert.ok(baseline.items.length > 0);
});

test('filter report can be exported to TCG Live format', () => {
  const report = generateReportForFilters(baseDecks, 'Mew', []);
  const entries = buildSkeletonExportEntries(report.items);
  const output = buildTcgliveExportString(entries);

  assert.ok(output.includes('Pokemon:'));
  assert.ok(output.includes('Pikachu'));
});

test('fetchArchetypeDecksLocal falls back when archetype decks are missing', async () => {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = input.toString();
    if (url.includes('/archetypes/')) {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => []
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => baseDecks
    } as Response;
  };

  const result = await fetchArchetypeDecksLocal('Test Tournament', 'Mew');
  assert.equal(result.isFiltered, true);
  assert.equal(result.decks.length, baseDecks.length);
});

test('success filter + report pipeline returns expected deck count', () => {
  const winners = filterDecksBySuccess(baseDecks, 'winner');
  const report = generateReportForFilters(winners, 'Mew', []);
  assert.equal(report.deckTotal, 1);
});
