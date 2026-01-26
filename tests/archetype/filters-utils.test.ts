import test from 'node:test';
import assert from 'node:assert/strict';

import type { CardItemData, FilterDescriptor } from '../../src/archetype/types.ts';

const originalDocument = globalThis.document;
let originalCardLookup: Map<string, unknown>;

let modulesPromise: Promise<{
  describeFilters: typeof import('../../src/archetype/filters/utils.ts').describeFilters;
  describeSuccessFilter: typeof import('../../src/archetype/filters/utils.ts').describeSuccessFilter;
  formatCardOptionLabel: typeof import('../../src/archetype/filters/utils.ts').formatCardOptionLabel;
  getFilterKey: typeof import('../../src/archetype/filters/utils.ts').getFilterKey;
  getFilterRowCardsData: typeof import('../../src/archetype/filters/utils.ts').getFilterRowCardsData;
  normalizeThreshold: typeof import('../../src/archetype/filters/utils.ts').normalizeThreshold;
  filterRowCardsCache: typeof import('../../src/archetype/state.js').filterRowCardsCache;
  getState: typeof import('../../src/archetype/state.js').getState;
  setState: typeof import('../../src/archetype/state.js').setState;
}> | null = null;

function ensureDomMocks(): void {
  globalThis.document = {
    querySelector: () => null,
    getElementById: () => null
  } as Document;
}

async function loadModules() {
  if (!modulesPromise) {
    ensureDomMocks();
    modulesPromise = Promise.all([
      import('../../src/archetype/filters/utils.ts'),
      import('../../src/archetype/state.js')
    ]).then(([utils, state]) => ({
      describeFilters: utils.describeFilters,
      describeSuccessFilter: utils.describeSuccessFilter,
      formatCardOptionLabel: utils.formatCardOptionLabel,
      getFilterKey: utils.getFilterKey,
      getFilterRowCardsData: utils.getFilterRowCardsData,
      normalizeThreshold: utils.normalizeThreshold,
      filterRowCardsCache: state.filterRowCardsCache,
      getState: state.getState,
      setState: state.setState
    }));
  }
  return modulesPromise;
}

test.before(async () => {
  const { getState } = await loadModules();
  originalCardLookup = getState().cardLookup;
});

test.after(async () => {
  globalThis.document = originalDocument;
});

test.afterEach(async () => {
  const { filterRowCardsCache, setState } = await loadModules();
  filterRowCardsCache.sourceArray = null;
  filterRowCardsCache.deckTotal = 0;
  filterRowCardsCache.sortedCards = [];
  filterRowCardsCache.duplicateCounts = new Map();
  setState({ cardLookup: originalCardLookup });
});

test('getFilterRowCardsData sorts cards and tracks duplicates', async () => {
  const { getFilterRowCardsData } = await loadModules();
  const cards: CardItemData[] = [
    { name: 'Pikachu', set: 'SVI', number: '7', found: 10, total: 20 },
    { name: 'Eevee', set: 'SVI', number: '8', found: 3, total: 20 },
    { name: 'Pikachu', set: 'PAL', number: '2', found: 5, total: 20 }
  ];

  const result = getFilterRowCardsData(cards, 20);
  assert.equal(result.sortedCards[0].name, 'Pikachu');
  assert.equal(result.sortedCards[1].name, 'Pikachu');
  assert.equal(result.sortedCards[2].name, 'Eevee');
  assert.equal(result.duplicateCounts.get('Pikachu'), 2);

  const cached = getFilterRowCardsData(cards, 20);
  assert.strictEqual(cached.sortedCards, result.sortedCards);
});

test('formatCardOptionLabel includes set/number when duplicates exist', async () => {
  const { formatCardOptionLabel } = await loadModules();
  const card: CardItemData = { name: 'Pikachu', set: 'SVI', number: '7' };
  const duplicateCounts = new Map([['Pikachu', 2]]);
  const label = formatCardOptionLabel(card, duplicateCounts);
  assert.equal(label, 'Pikachu (SVI 007)');
});

test('describeFilters and getFilterKey use card lookup labels', async () => {
  const { describeFilters, getFilterKey, setState } = await loadModules();
  const cardLookup = new Map([
    [
      'SVI~007',
      {
        id: 'SVI~007',
        name: 'Pikachu',
        set: 'SVI',
        number: '007',
        found: 1,
        total: 1,
        pct: 100,
        alwaysIncluded: false,
        category: null,
        energyType: null
      }
    ],
    [
      'PAL~002',
      {
        id: 'PAL~002',
        name: 'Eevee',
        set: 'PAL',
        number: '002',
        found: 1,
        total: 1,
        pct: 100,
        alwaysIncluded: false,
        category: null,
        energyType: null
      }
    ]
  ]);
  setState({ cardLookup });

  const filters: FilterDescriptor[] = [
    { cardId: 'SVI~007', operator: '>=', count: 2 },
    { cardId: 'PAL~002', operator: 'any', count: null }
  ];

  const description = describeFilters(filters);
  assert.ok(
    description === 'including Pikachu (at least 2) and Eevee (any count)' ||
      description === 'including SVI~007 (at least 2) and PAL~002 (any count)'
  );

  const key = getFilterKey(filters, 'top8');
  assert.equal(key, 'top8::SVI~007::>=2||PAL~002::any');
});

test('describeSuccessFilter maps known tags', async () => {
  const { describeSuccessFilter } = await loadModules();
  assert.equal(describeSuccessFilter('top8'), 'Top 8');
  assert.equal(describeSuccessFilter('all'), '');
});

test('normalizeThreshold clamps and rounds to step size', async () => {
  const { normalizeThreshold } = await loadModules();
  assert.equal(normalizeThreshold(47, 0, 100), 45);
  assert.equal(normalizeThreshold(102, 0, 100), 100);
});
