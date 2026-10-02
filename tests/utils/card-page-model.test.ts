/**
 * Card page joins.
 *
 * Most of these lookups are cluster-aware for one reason: a rebaked historical
 * event keys its rows by that event's ROLLING canonical print (D17), which is a
 * different UID from today's global canonical for the same card. A direct match
 * finds nothing on exactly the events that have been reprocessed — and finds
 * nothing SILENTLY, rendering an empty section rather than an error. These
 * tests pin the fallback chain that prevents that.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  averageCopies,
  buildUsageRowsFromIndex,
  conversionCaveats,
  effectiveTournament,
  emptyDescription,
  findCardInArchetypeReport,
  findConversionStat,
  formatWholePct,
  resolvePriceEntry,
  resolvePriceSeries,
  snapshotDateLabel,
  supportsConversion
} from '../../src/pages/cardPage/model.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';
import type { ArchetypeIndexEntry, ArchetypeReport, CardItem } from '../../src/types/index.ts';

const DB: SynonymDatabase = {
  synonyms: { 'Dragapult ex::TWM::130': 'Dragapult ex::PRE::073' },
  canonicals: { 'Dragapult ex': 'Dragapult ex::PRE::073' }
};

const CARD = { name: 'Dragapult ex', set: 'PRE', number: '073', pct: 40 } as CardItem;
/** The same card as a rebaked event would report it: the rolling print. */
const ROLLING_CARD = { name: 'Dragapult ex', set: 'TWM', number: '130', pct: 40 } as CardItem;

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

test('a snapshot card redirects downstream fetches at the snapshot; anything else keeps the selection', () => {
  const selected = '2026-05-08, Regional X';
  const cases = [
    ['a live card keeps the selected tournament', true, '2026-01-01', selected],
    // Otherwise "Where it's played" would show today's archetypes next to a
    // pre-rotation card.
    ['a snapshot card reads the snapshot', false, '2026-01-01', 'snapshot:2026-01-01'],
    ['no snapshot date falls back to the selection', false, null, selected]
  ] as const;
  for (const [name, live, snapshot, expected] of cases) {
    assert.equal(effectiveTournament(live, selected, snapshot), expected, name);
  }
});

test('conversion is computed only where a day-2 cut exists', () => {
  assert.equal(supportsConversion('2026-05-08, Regional X'), true);
  assert.equal(supportsConversion('Online - Last 14 Days'), false, 'rolling window has no single cut');
  assert.equal(supportsConversion('snapshot:2026-01-01'), false, 'frozen reports carry no madePhase2 flag');
  assert.equal(supportsConversion(''), false);
});

test('snapshot dates render long-form, and survive being unparseable', () => {
  assert.match(snapshotDateLabel('2026-01-15'), /2026/);
  assert.match(snapshotDateLabel('2026-01-15'), /January|Jan/);
  assert.equal(snapshotDateLabel(null), '');
  assert.equal(snapshotDateLabel('not-a-date'), 'not-a-date');
});

test('the empty state names the scope that was searched', () => {
  assert.match(emptyDescription('Online - Last 14 Days'), /rolling 14-day window/);
  const event = emptyDescription('2026-05-08, Regional Championship Los Angeles');
  assert.match(event, /Los Angeles Regionals/);
  assert.ok(!event.includes('2026-05-08'), 'the raw date prefix should not leak into copy');
});

// ---------------------------------------------------------------------------
// Price joins
// ---------------------------------------------------------------------------

const PRICES = { 'Dragapult ex::PRE::073': { price: 12.5, tcgPlayerId: 'tcg-1' } };

const SELECTED = { uid: 'Dragapult ex::TWM::200', set: 'TWM', number: '200', price: 24.75 };
const GLOBAL = 'Dragapult ex::PRE::073';

test('a price resolves by UID, then the global canonical, then a selected printing', () => {
  const withVariant = { ...PRICES, 'Dragapult ex::TWM::200': { price: 24.75, tcgPlayerId: 'tcg-variant' } };
  const cases = [
    ['a card prices by its own UID', CARD, PRICES, null, null, { price: 12.5, tcgPlayerId: 'tcg-1' }],
    // prices.json keys the CURRENT global canonical; the rendered card may not be it.
    [
      'a rolling print falls back to its global canonical',
      ROLLING_CARD,
      PRICES,
      null,
      GLOBAL,
      { price: 12.5, tcgPlayerId: 'tcg-1' }
    ],
    [
      'a selected printing uses its scraped price when prices.json has no entry',
      CARD,
      PRICES,
      SELECTED,
      GLOBAL,
      { price: 24.75, tcgPlayerId: undefined }
    ],
    [
      'a selected printing keeps its own TCGplayer product link',
      CARD,
      withVariant,
      { ...SELECTED, price: 20 },
      GLOBAL,
      { price: 24.75, tcgPlayerId: 'tcg-variant' }
    ],
    ['missing prices yield nothing', CARD, null, null, null, null],
    ['a missing card yields nothing', undefined, PRICES, null, null, null]
  ] as const;
  for (const [name, card, prices, selected, globalUid, expected] of cases) {
    assert.deepEqual(resolvePriceEntry(card, prices, { selected, globalUid }), expected, name);
  }
});

const HISTORY = { 'Dragapult ex::PRE::073': [{ date: '2026-01-01', price: 10 }] };

test('the sparkline series follows the price fallback chain, but never borrows across printings', () => {
  const cases = [
    ['own UID', CARD, HISTORY, true, null, null, 1],
    ['global canonical', ROLLING_CARD, HISTORY, true, null, GLOBAL, 1],
    ["a selected printing never borrows another printing's sparkline", CARD, HISTORY, true, SELECTED, GLOBAL, 0],
    ['an unready history plots nothing', CARD, HISTORY, false, null, null, 0],
    ['no history plots nothing', CARD, null, true, null, null, 0]
  ] as const;
  for (const [name, card, history, ready, selected, globalUid, points] of cases) {
    assert.equal(resolvePriceSeries(card, history, ready, { selected, globalUid }).length, points, name);
  }
});

// ---------------------------------------------------------------------------
// Report joins
// ---------------------------------------------------------------------------

test('a card is found in an archetype report by set and number, or by name when those are missing', () => {
  const cases = [
    ['set and number', [{ name: 'Other', set: 'SVI', number: '1' }, CARD], 'Dragapult ex'],
    ['leading zeros do not prevent a match', [{ name: 'Dragapult ex', set: 'pre', number: 73 }], 'Dragapult ex'],
    ['an item lacking set and number matches by name', [{ name: 'Dragapult ex' }], 'Dragapult ex'],
    ['an absent card', [{ name: 'Other', set: 'SVI', number: '1' }], null],
    ['an empty report', [], null]
  ] as const;
  for (const [name, items, found] of cases) {
    const report = { items } as unknown as ArchetypeReport;
    assert.equal(findCardInArchetypeReport(report, CARD)?.name ?? null, found, name);
  }
});

test('an exact set/number match wins over an earlier name fallback; otherwise the first name wins', () => {
  const first = { ...CARD, set: 'OTHER', number: '1' };
  const second = { ...CARD, set: 'OTHER', number: '2' };
  const report = { items: [first, second, CARD] } as ArchetypeReport;
  assert.equal(findCardInArchetypeReport(report, CARD), CARD);
  report.items.pop();
  assert.equal(findCardInArchetypeReport(report, CARD), first);
});

// ---------------------------------------------------------------------------
// Usage rows
// ---------------------------------------------------------------------------

const ARCHETYPES = [
  { name: 'Dragapult', label: 'Dragapult', deckCount: 100 },
  { name: 'Slowking', label: 'Slowking', deckCount: 50 }
] as ArchetypeIndexEntry[];

test('usage rows join the index for deck totals', () => {
  const payload = {
    usage: {
      'Dragapult ex::PRE::073': [
        { slug: 'Dragapult', found: 90, pct: 90, dist: [{ copies: 2, players: 90, percent: 100 }] }
      ]
    }
  } as never;
  const rows = buildUsageRowsFromIndex(payload, ARCHETYPES, CARD, DB);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entry.name, 'Dragapult');
  assert.equal(rows[0].report.deckTotal, 100);
  assert.equal(rows[0].item.found, 90);
});

test('a card with no usage entry, or only for archetypes missing from the index, yields no rows', () => {
  const retired = {
    usage: { 'Dragapult ex::PRE::073': [{ slug: 'Retired_Deck', found: 5, pct: 5, dist: [] }] }
  } as never;
  assert.deepEqual(buildUsageRowsFromIndex(retired, ARCHETYPES, CARD, DB), []);
  assert.deepEqual(buildUsageRowsFromIndex({ usage: {} } as never, ARCHETYPES, CARD, DB), []);
});

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

test('conversion matches through the cluster, not just the exact UID', () => {
  const stats = [{ uid: 'Dragapult ex::PRE::073', day1Count: 100, day2Count: 40 }] as never;
  assert.ok(findConversionStat(stats, ROLLING_CARD, DB), 'a rolling card must match a global-keyed row');
});

test('conversion falls back to set and number when the UID does not resolve', () => {
  const stats = [{ uid: 'x', set: 'PRE', number: '73', day1Count: 100, day2Count: 40 }] as never;
  assert.ok(findConversionStat(stats, CARD, null));
});

test('no stats or no card yields nothing', () => {
  assert.equal(findConversionStat(null, CARD, DB), undefined);
  assert.equal(findConversionStat([], undefined, DB), undefined);
});

// ---------------------------------------------------------------------------
// Presentation math
// ---------------------------------------------------------------------------

test('average copies weights each count by its players, and is null without a distribution', () => {
  const card = {
    dist: [
      { copies: 1, players: 1 },
      { copies: 3, players: 3 }
    ]
  };
  assert.equal(averageCopies(card), (1 * 1 + 3 * 3) / 4);
  assert.equal(averageCopies({ dist: [] }), null);
  assert.equal(averageCopies({}), null);
  assert.equal(averageCopies({ dist: [{ copies: 3 }, { players: 2 }, { copies: 2, players: 2 }] }), 1);
  assert.equal(averageCopies({ dist: [{ copies: 4, players: 0 }] }), null);
});

test('conversion caveats flag a near-universal card and a tiny sample', () => {
  const cases = [
    ['a near-universal card mirrors the field', 95, 500, [/mirrors the field/]],
    ['a tiny sample is flagged', 20, 4, [/4 decks.*too small a sample/]],
    ['one deck is singular', 20, 1, [/1 deck /]],
    ['both caveats can apply at once', 95, 4, [/mirrors the field/, /too small a sample/]],
    ['a well-sampled niche card gets no caveats', 20, 500, []],
    ['no conversion row means no caveats', 95, undefined, []]
  ] as const;
  for (const [name, pct, day1Count, patterns] of cases) {
    const caveats = conversionCaveats({ pct }, day1Count === undefined ? undefined : { day1Count });
    assert.equal(caveats.length, patterns.length, name);
    patterns.forEach((pattern, i) => assert.match(caveats[i]!, pattern, name));
  }
});

test('sub-one-percent usage reads as "<1%" rather than rounding to zero', () => {
  assert.equal(formatWholePct(0.4), '<1%');
  assert.equal(formatWholePct(0), '0%');
  assert.equal(formatWholePct(49.6), '50%');
  assert.equal(formatWholePct(100), '100%');
});
