/**
 * AdvancedPanel calculations.
 *
 * These were reactive memos tangled inside a 994-line component, so the only
 * way to exercise them was to drive a browser. As pure functions they can state
 * their contracts directly — which matters most for the ones with a non-obvious
 * reason to exist: canonicalizing the deck side so rules match at all, and
 * reusing item objects so filtering does not remount every card image.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyFilters,
  buildBaselinePct,
  canonicalizeDecks,
  inclusionPct,
  indexItemsByCardId,
  reconcileDisplayedItems,
  rulesFromPersisted,
  rulesToFilters,
  sameRenderedContent,
  searchCandidates
} from '../../src/components/advancedPanel/model.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';
import type { CardItem, Deck } from '../../src/types/index.ts';
import type { PersistedRule, Rule } from '../../src/utils/buildState.ts';

const DB: SynonymDatabase = {
  synonyms: { 'Dragapult ex::TWM::130': 'Dragapult ex::PRE::073' },
  canonicals: { 'Dragapult ex': 'Dragapult ex::PRE::073' }
};

function deck(id: string, cards: Array<[string, string, string | number, number]>, extra: Partial<Deck> = {}): Deck {
  return {
    id,
    deckId: id,
    archetype: 'Dragapult',
    cards: cards.map(([name, set, number, count]) => ({ name, set, number, count })),
    ...extra
  } as Deck;
}

// ---------------------------------------------------------------------------
// canonicalizeDecks
// ---------------------------------------------------------------------------

test('deck cards with a synonym are rewritten to their canonical printing, on a copy', () => {
  const input = [
    deck('d1', [
      ['Dragapult ex', 'TWM', '130', 2],
      ['Nest Ball', 'SVI', '181', 4]
    ])
  ];
  const [out] = canonicalizeDecks(input, DB);
  assert.deepEqual(
    out.cards?.map(c => `${c.set}/${c.number}`),
    ['PRE/073', 'SVI/181'],
    'a card with no synonym mapping is left alone'
  );
  assert.equal(input[0].cards?.[0].set, 'TWM', 'the original decks must survive for other consumers');
});

test('a deck with no cards survives canonicalization', () => {
  const out = canonicalizeDecks([{ id: 'd1', archetype: 'A' } as Deck], DB);
  assert.deepEqual(out[0].cards, []);
});

// ---------------------------------------------------------------------------
// indexItemsByCardId
// ---------------------------------------------------------------------------

test('report items index by their cluster-canonical cardId', () => {
  // A rebaked event reports the rolling print (TWM/130); rules key by the
  // global canonical (PRE/073). Without resolving, a persisted rule never
  // rehydrates.
  const items = [{ name: 'Dragapult ex', set: 'TWM', number: '130' }] as CardItem[];
  const index = indexItemsByCardId(items, DB);
  assert.deepEqual([...index.keys()], ['PRE~073']);
});

test('items without a set or number are skipped', () => {
  const items = [{ name: 'Basic Fire Energy' }, { name: 'X', set: 'ABC' }] as CardItem[];
  assert.equal(indexItemsByCardId(items, DB).size, 0);
});

test('indexing works with no synonym database', () => {
  const items = [{ name: 'Nest Ball', set: 'SVI', number: '181' }] as CardItem[];
  assert.deepEqual([...indexItemsByCardId(items, null).keys()], ['SVI~181']);
});

// ---------------------------------------------------------------------------
// buildBaselinePct
// ---------------------------------------------------------------------------

test('the baseline is each card s inclusion fraction across all decks', () => {
  const decks = [
    deck('d1', [['Nest Ball', 'SVI', '181', 4]]),
    deck('d2', [['Nest Ball', 'SVI', '181', 2]]),
    deck('d3', [['Ultra Ball', 'SVI', '196', 4]])
  ];
  const items = [
    { name: 'Nest Ball', set: 'SVI', number: '181' },
    { name: 'Ultra Ball', set: 'SVI', number: '196' }
  ] as CardItem[];
  const baseline = buildBaselinePct(decks, items);
  assert.equal(baseline.get('SVI~181'), 2 / 3);
  assert.equal(baseline.get('SVI~196'), 1 / 3);
});

test('an empty deck collection yields an empty baseline', () => {
  assert.equal(buildBaselinePct([], []).size, 0);
});

// ---------------------------------------------------------------------------
// rulesToFilters
// ---------------------------------------------------------------------------

test('rules become filters, dropping an include whose count is mid-edit', () => {
  const rule = (mode: string, count: number) => ({ id: 1, cardId: 'SVI~181', mode, countOp: '>=', count }) as Rule;
  const cases = [
    [
      'include rules carry their operator and count',
      rule('include', 2),
      [{ cardId: 'SVI~181', operator: '>=', count: 2 }]
    ],
    [
      'exclude rules become the empty operator with a null count',
      rule('exclude', 0),
      [{ cardId: 'SVI~181', operator: '', count: null }]
    ],
    // Comparing against NaN matches zero decks, so the list would blank out
    // while the user is still typing a number.
    ['an include with a mid-edit count is dropped', rule('include', Number.NaN), []],
    [
      'an exclude survives a non-finite count',
      rule('exclude', Number.NaN),
      [{ cardId: 'SVI~181', operator: '', count: null }]
    ]
  ] as const;
  for (const [name, input, expected] of cases) {
    assert.deepEqual(rulesToFilters([input]), expected, name);
  }
});

// ---------------------------------------------------------------------------
// applyFilters
// ---------------------------------------------------------------------------

const CORPUS = [
  deck('d1', [['Nest Ball', 'SVI', '181', 4]]),
  deck('d2', [['Nest Ball', 'SVI', '181', 1]]),
  deck('d3', [['Ultra Ball', 'SVI', '196', 4]])
];

test('filters narrow the corpus by copy count or by absence', () => {
  const cases = [
    ['a copy-count filter', [{ cardId: 'SVI~181', operator: '>=', count: 2 }], ['d1']],
    ['an exclude filter keeps only decks without the card', [{ cardId: 'SVI~181', operator: '', count: null }], ['d3']],
    ['no filters keeps the whole archetype', [], ['d1', 'd2', 'd3']]
  ] as const;
  for (const [name, filters, expected] of cases) {
    assert.deepEqual(
      applyFilters(CORPUS, 'Dragapult', 'all', [...filters]).map(d => d.id),
      expected,
      name
    );
  }
});

test('filter order does not change the result', () => {
  const a = { cardId: 'SVI~181', operator: '>=' as const, count: 1 };
  const b = { cardId: 'SVI~196', operator: '' as const, count: null };
  assert.deepEqual(
    applyFilters(CORPUS, 'Dragapult', 'all', [a, b]).map(d => d.id),
    applyFilters(CORPUS, 'Dragapult', 'all', [b, a]).map(d => d.id)
  );
});

// ---------------------------------------------------------------------------
// rulesFromPersisted
// ---------------------------------------------------------------------------

test('persisted rules rehydrate their display fields from the report', () => {
  const index = indexItemsByCardId([{ name: 'Nest Ball', set: 'SVI', number: '181' }] as CardItem[], null);
  const persisted = [{ cardId: 'SVI~181', mode: 'include', countOp: '>=', count: 2 }] as PersistedRule[];
  let id = 0;
  const [rule] = rulesFromPersisted(persisted, index, () => ++id);
  assert.equal(rule.name, 'Nest Ball');
  assert.equal(rule.set, 'SVI');
  assert.equal(rule.count, 2);
  assert.equal(rule.id, 1);
});

test('a persisted rule for a card outside this archetype is dropped', () => {
  const index = indexItemsByCardId([{ name: 'Nest Ball', set: 'SVI', number: '181' }] as CardItem[], null);
  const persisted = [{ cardId: 'ZZZ~999', mode: 'include', countOp: '>=', count: 1 }] as PersistedRule[];
  assert.deepEqual(
    rulesFromPersisted(persisted, index, () => 1),
    []
  );
});

// ---------------------------------------------------------------------------
// searchCandidates
// ---------------------------------------------------------------------------

const ITEMS = [
  { name: 'Nest Ball', set: 'SVI', number: '181' },
  { name: 'Ultra Ball', set: 'SVI', number: '196' },
  { name: 'Buddy-Buddy Poffin', set: 'TEF', number: '144' }
] as CardItem[];

test('search matches folded names, skips cards already in a rule, and caps its results', () => {
  const cases = [
    ['an empty query matches nothing', '   ', [], undefined, []],
    ['search matches on folded name', 'ball', [], undefined, ['Nest Ball', 'Ultra Ball']],
    ['cards already used by a rule are excluded', 'ball', ['SVI~181'], undefined, ['Ultra Ball']],
    ['results are capped', 'ball', [], 1, ['Nest Ball']]
  ] as const;
  for (const [name, query, used, limit, expected] of cases) {
    assert.deepEqual(
      searchCandidates(ITEMS, query, new Set(used), null, limit).map(i => i.name),
      expected,
      name
    );
  }
});

// ---------------------------------------------------------------------------
// reconcileDisplayedItems — the reason card images stay mounted
// ---------------------------------------------------------------------------

const shown = (pct: number, rank = 1) => ({ set: 'SVI', number: '181', pct, rank, found: 10, total: 20 });

test('an item whose rendered content is unchanged keeps its object identity', () => {
  const first = reconcileDisplayedItems([shown(50)], 0, new Map());
  const second = reconcileDisplayedItems([shown(50)], 0, first.byCardId);
  assert.equal(second.items[0], first.items[0], 'a fresh but identical item must reuse the previous object');
});

test('an item whose numbers moved is replaced', () => {
  const first = reconcileDisplayedItems([shown(50)], 0, new Map());
  const second = reconcileDisplayedItems([shown(60)], 0, first.byCardId);
  assert.notEqual(second.items[0], first.items[0]);
  assert.equal(second.items[0].pct, 60);
});

test('items below the threshold are dropped', () => {
  const items = [shown(50), { ...shown(5), number: '196' }];
  const out = reconcileDisplayedItems(items, 10, new Map());
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].pct, 50);
});

test('an item without a set or number still renders, just unreconciled', () => {
  const out = reconcileDisplayedItems([{ pct: 50 }], 0, new Map());
  assert.equal(out.items.length, 1);
  assert.equal(out.byCardId.size, 0);
});

test('sameRenderedContent compares the distribution, not just the headline', () => {
  const base = { pct: 50, dist: [{ copies: 2, players: 10, percent: 50 }] };
  assert.ok(sameRenderedContent(base, { pct: 50, dist: [{ copies: 2, players: 10, percent: 50 }] }));
  assert.ok(!sameRenderedContent(base, { pct: 50, dist: [{ copies: 2, players: 11, percent: 55 }] }));
  assert.ok(!sameRenderedContent(base, { pct: 50, dist: [] }));
});

// ---------------------------------------------------------------------------
// inclusionPct
// ---------------------------------------------------------------------------

test('inclusion percent is rounded to a whole number, and reads zero when unknown', () => {
  const ctx = { totalDecks: 3, presence: new Map([['SVI~181', { count: 2 }]]) } as never;
  assert.equal(inclusionPct(ctx, 'SVI~181'), '67');
  assert.equal(inclusionPct(ctx, 'SVI~196'), '0', 'a missing card');
  assert.equal(inclusionPct(null, 'SVI~181'), '0', 'no context');
});
