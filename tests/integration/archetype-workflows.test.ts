import test from 'node:test';
import assert from 'node:assert/strict';

import type { Deck } from '../../src/utils/clientSideFiltering.ts';

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

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
  tournament: '',
  archetypeBase: '',
  successFilter: '',
  defaultItems: [],
  defaultDeckTotal: 0,
  filterCache: new Map()
};

let modulesPromise: Promise<{
  buildSkeletonExportEntries: typeof import('../../src/archetype/data/skeleton.ts').buildSkeletonExportEntries;
  loadFilterCombination: typeof import('../../src/archetype/data/report.ts').loadFilterCombination;
  loadSuccessBaseline: typeof import('../../src/archetype/data/report.ts').loadSuccessBaseline;
  buildTcgliveExportString: typeof import('../../src/archetype/export/tcgLive.ts').buildTcgliveExportString;
  getState: typeof import('../../src/archetype/state.ts').getState;
  setState: typeof import('../../src/archetype/state.ts').setState;
  fetchArchetypeDecksLocal: typeof import('../../src/utils/clientSideFiltering.ts').fetchArchetypeDecksLocal;
  filterDecksBySuccess: typeof import('../../src/utils/clientSideFiltering.ts').filterDecksBySuccess;
  generateReportForFilters: typeof import('../../src/utils/clientSideFiltering.ts').generateReportForFilters;
}> | null = null;

function ensureDomMocks(): void {
  globalThis.document = {
    querySelector: () => null,
    getElementById: () => null
  } as Document;
  if (!globalThis.window) {
    globalThis.window = {} as Window & typeof globalThis;
  }
  if (!globalThis.window.location) {
    globalThis.window.location = { hostname: 'localhost' } as Location;
  }
}

async function loadModules() {
  if (!modulesPromise) {
    ensureDomMocks();
    modulesPromise = Promise.all([
      import('../../src/archetype/data/skeleton.ts'),
      import('../../src/archetype/data/report.ts'),
      import('../../src/archetype/export/tcgLive.ts'),
      import('../../src/archetype/state.ts'),
      import('../../src/utils/clientSideFiltering.ts')
    ]).then(([skeleton, report, tcg, state, client]) => ({
      buildSkeletonExportEntries: skeleton.buildSkeletonExportEntries,
      loadFilterCombination: report.loadFilterCombination,
      loadSuccessBaseline: report.loadSuccessBaseline,
      buildTcgliveExportString: tcg.buildTcgliveExportString,
      getState: state.getState,
      setState: state.setState,
      fetchArchetypeDecksLocal: client.fetchArchetypeDecksLocal,
      filterDecksBySuccess: client.filterDecksBySuccess,
      generateReportForFilters: client.generateReportForFilters
    }));
  }
  return modulesPromise;
}

test.before(async () => {
  const { getState } = await loadModules();
  const state = getState();
  originalState.tournament = state.tournament;
  originalState.archetypeBase = state.archetypeBase;
  originalState.successFilter = state.successFilter;
  originalState.defaultItems = state.defaultItems;
  originalState.defaultDeckTotal = state.defaultDeckTotal;
  originalState.filterCache = state.filterCache;
});

test.beforeEach(() => {
  ensureDomMocks();
  globalThis.fetch = async () =>
    ({
      ok: true,
      status: 200,
      json: async () => baseDecks
    }) as Response;
});

test.afterEach(async () => {
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  globalThis.fetch = originalFetch;
  if (modulesPromise) {
    const { setState } = await modulesPromise;
    setState({ ...originalState });
  }
});

test('loadFilterCombination returns filtered report and caches it', async () => {
  const { loadFilterCombination, getState, setState } = await loadModules();
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
  const { loadSuccessBaseline, setState } = await loadModules();
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
  return loadModules().then(({ buildSkeletonExportEntries, buildTcgliveExportString, generateReportForFilters }) => {
    const report = generateReportForFilters(baseDecks, 'Mew', []);
    const entries = buildSkeletonExportEntries(report.items);
    const output = buildTcgliveExportString(entries);

    assert.ok(output.length > 0);
    assert.ok(output.includes('Pikachu'));
  });
});

test('fetchArchetypeDecksLocal falls back when archetype decks are missing', async () => {
  const { fetchArchetypeDecksLocal } = await loadModules();
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
  return loadModules().then(({ filterDecksBySuccess, generateReportForFilters }) => {
    const winners = filterDecksBySuccess(baseDecks, 'winner');
    const report = generateReportForFilters(winners, 'Mew', []);
    assert.equal(report.deckTotal, 1);
  });
});
