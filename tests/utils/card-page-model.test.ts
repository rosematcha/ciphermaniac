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

test('a live card keeps the selected tournament', () => {
  assert.equal(effectiveTournament(true, '2026-05-08, Regional X', '2026-01-01'), '2026-05-08, Regional X');
});

test('a snapshot card redirects downstream fetches at the snapshot', () => {
  // Otherwise "Where it's played" would show today's archetypes next to a
  // pre-rotation card.
  assert.equal(effectiveTournament(false, '2026-05-08, Regional X', '2026-01-01'), 'snapshot:2026-01-01');
});

test('no snapshot date falls back to the selected tournament', () => {
  assert.equal(effectiveTournament(false, '2026-05-08, Regional X', null), '2026-05-08, Regional X');
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
  assert.match(event, /Regional Championship Los Angeles/);
  assert.ok(!event.includes('2026-05-08'), 'the raw date prefix should not leak into copy');
});

// ---------------------------------------------------------------------------
// Price joins
// ---------------------------------------------------------------------------

const PRICES = { 'Dragapult ex::PRE::073': { price: 12.5, tcgPlayerId: 'tcg-1' } };

test('a card prices by its own UID', () => {
  assert.deepEqual(resolvePriceEntry(CARD, PRICES, null, null), { price: 12.5, tcgPlayerId: 'tcg-1' });
});

test('a rolling-print card falls back to its global canonical UID', () => {
  // prices.json keys the CURRENT global canonical; the rendered card may not be it.
  assert.deepEqual(resolvePriceEntry(ROLLING_CARD, PRICES, null, 'Dragapult ex::PRE::073'), {
    price: 12.5,
    tcgPlayerId: 'tcg-1'
  });
});

test('a previewed printing prices itself, not the page card', () => {
  const preview = { uid: 'Dragapult ex::TWM::200', set: 'TWM', number: '200', price: 88 };
  assert.deepEqual(resolvePriceEntry(CARD, PRICES, preview, null), { price: 88, tcgPlayerId: undefined });
});

test('a previewed printing with a tracked price keeps its TCGplayer id', () => {
  const preview = { uid: 'Dragapult ex::PRE::073', set: 'PRE', number: '073', price: 99 };
  assert.deepEqual(resolvePriceEntry(CARD, PRICES, preview, null), { price: 12.5, tcgPlayerId: 'tcg-1' });
});

test('a previewed printing with no price anywhere shows nothing', () => {
  const preview = { uid: 'Dragapult ex::ASC::160', set: 'ASC', number: '160', price: null };
  assert.equal(resolvePriceEntry(CARD, PRICES, preview, null), null);
});

test('missing prices or card yield nothing', () => {
  assert.equal(resolvePriceEntry(CARD, null, null, null), null);
  assert.equal(resolvePriceEntry(undefined, PRICES, null, null), null);
});

const HISTORY = { 'Dragapult ex::PRE::073': [{ date: '2026-01-01', price: 10 }] };

test('the sparkline series follows the same fallback chain as the price', () => {
  assert.equal(resolvePriceSeries(CARD, HISTORY, true, null, null).length, 1);
  assert.equal(resolvePriceSeries(ROLLING_CARD, HISTORY, true, null, 'Dragapult ex::PRE::073').length, 1);
});

test('a previewed printing gets only its own history, never the page card s', () => {
  // Showing another print's trend under this print's name would be a lie.
  const preview = { uid: 'Dragapult ex::TWM::200', set: 'TWM', number: '200' };
  assert.deepEqual(resolvePriceSeries(CARD, HISTORY, true, preview, null), []);
});

test('an unready history plots nothing', () => {
  assert.deepEqual(resolvePriceSeries(CARD, HISTORY, false, null, null), []);
  assert.deepEqual(resolvePriceSeries(CARD, null, true, null, null), []);
});

// ---------------------------------------------------------------------------
// Report joins
// ---------------------------------------------------------------------------

test('a card is found in an archetype report by set and number', () => {
  const report = { items: [{ name: 'Other', set: 'SVI', number: '1' }, CARD] } as ArchetypeReport;
  assert.equal(findCardInArchetypeReport(report, CARD)?.name, 'Dragapult ex');
});

test('leading zeros do not prevent a match', () => {
  const report = { items: [{ name: 'Dragapult ex', set: 'pre', number: 73 }] } as unknown as ArchetypeReport;
  assert.ok(findCardInArchetypeReport(report, CARD));
});

test('a report item lacking set and number still matches by name', () => {
  const report = { items: [{ name: 'Dragapult ex' }] } as ArchetypeReport;
  assert.ok(findCardInArchetypeReport(report, CARD));
});

test('a card absent from the report yields null', () => {
  const report = { items: [{ name: 'Other', set: 'SVI', number: '1' }] } as ArchetypeReport;
  assert.equal(findCardInArchetypeReport(report, CARD), null);
  assert.equal(findCardInArchetypeReport({ items: [] } as unknown as ArchetypeReport, CARD), null);
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

test('a usage row for an archetype missing from the index is dropped', () => {
  const payload = {
    usage: { 'Dragapult ex::PRE::073': [{ slug: 'Retired_Deck', found: 5, pct: 5, dist: [] }] }
  } as never;
  assert.deepEqual(buildUsageRowsFromIndex(payload, ARCHETYPES, CARD, DB), []);
});

test('a card with no usage entry yields no rows', () => {
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

test('average copies weights each count by its players', () => {
  const card = {
    dist: [
      { copies: 1, players: 1 },
      { copies: 3, players: 3 }
    ]
  };
  assert.equal(averageCopies(card), (1 * 1 + 3 * 3) / 4);
});

test('a card with no distribution has no average', () => {
  assert.equal(averageCopies({ dist: [] }), null);
  assert.equal(averageCopies({}), null);
});

test('a near-universal card is flagged as uninformative', () => {
  const caveats = conversionCaveats({ pct: 95 }, { day1Count: 500 });
  assert.equal(caveats.length, 1);
  assert.match(caveats[0], /mirrors the field/);
});

test('a tiny sample is flagged', () => {
  const caveats = conversionCaveats({ pct: 20 }, { day1Count: 4 });
  assert.equal(caveats.length, 1);
  assert.match(caveats[0], /too small a sample/);
  assert.match(caveats[0], /4 decks/);
});

test('one deck is singular', () => {
  assert.match(conversionCaveats({ pct: 20 }, { day1Count: 1 })[0], /1 deck /);
});

test('both caveats can apply at once', () => {
  assert.equal(conversionCaveats({ pct: 95 }, { day1Count: 4 }).length, 2);
});

test('a well-sampled niche card gets no caveats', () => {
  assert.deepEqual(conversionCaveats({ pct: 20 }, { day1Count: 500 }), []);
});

test('no conversion row means no caveats', () => {
  assert.deepEqual(conversionCaveats({ pct: 95 }, undefined), []);
});

test('sub-one-percent usage reads as "<1%" rather than rounding to zero', () => {
  assert.equal(formatWholePct(0.4), '<1%');
  assert.equal(formatWholePct(0), '0%');
  assert.equal(formatWholePct(49.6), '50%');
  assert.equal(formatWholePct(100), '100%');
});
