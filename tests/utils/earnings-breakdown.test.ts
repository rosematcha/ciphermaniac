/**
 * What an expanded earnings row breaks down into.
 *
 * The panel has to answer the same question the row does — career money, or
 * one season's — under whichever pay scale the table is showing, so the same
 * events produce different lines depending on the basis.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { eventAmount, eventsInSeason, ordinalPlace, summarizeSeasons } from '../../src/utils/earningsBreakdown.ts';
import type { EarningsEvent } from '../../shared/earningsTypes.ts';

function event(over: Partial<EarningsEvent> = {}): EarningsEvent {
  return { name: 'Regional', season: '2526', place: 1, cash: 0, adjusted: 0, ...over };
}

const EVENTS: EarningsEvent[] = [
  event({ name: 'Regional Peoria', season: '2425', place: 5, cash: 3000, adjusted: 3000 }),
  event({ name: 'Regional Knoxville', season: '2425', place: 40, cash: 0, adjusted: 0 }),
  event({ name: 'NAIC', season: '2526', place: 2, cash: 15000, adjusted: 15000 }),
  event({ name: 'Regional Orlando', season: '2526', place: 1, cash: 5000, adjusted: 10000 })
];

test('a season line counts every event but only banks the paying ones', () => {
  const rows = summarizeSeasons(EVENTS, 'actual');
  assert.deepEqual(
    rows.map(r => [r.season, r.eventCount, r.bestPlace, r.amount]),
    [
      ['2526', 2, 1, 20000],
      // Both 2024-25 events count, including the 40th that paid nothing.
      ['2425', 2, 5, 3000]
    ]
  );
});

test('seasons come back newest first', () => {
  const rows = summarizeSeasons(EVENTS, 'actual');
  assert.deepEqual(
    rows.map(r => r.season),
    ['2526', '2425']
  );
});

test('the basis changes the season totals, not the event counts', () => {
  const [current] = summarizeSeasons(EVENTS, 'adjusted');
  // Orlando restates from $5,000 to $10,000, so the season goes $20k -> $25k.
  assert.equal(current.amount, 25000);
  assert.equal(current.eventCount, 2);
});

test('a season that earned nothing under this basis is dropped', () => {
  const unpaid = [event({ season: '1415', place: 20, cash: 0, adjusted: 0 })];
  assert.deepEqual(summarizeSeasons(unpaid, 'actual'), []);
  // But it appears once today's payouts give it money.
  const restated = [event({ season: '1415', place: 20, cash: 0, adjusted: 1000 })];
  assert.deepEqual(
    summarizeSeasons(restated, 'adjusted').map(r => r.season),
    ['1415']
  );
});

test('a season expansion keeps non-paying events, in source order', () => {
  const rows = eventsInSeason(EVENTS, '2425');
  assert.deepEqual(
    rows.map(r => r.name),
    ['Regional Peoria', 'Regional Knoxville']
  );
});

test('an unknown season expands to nothing', () => {
  assert.deepEqual(eventsInSeason(EVENTS, '1011'), []);
});

test('event amounts follow the active basis', () => {
  const orlando = EVENTS[3];
  assert.equal(eventAmount(orlando, 'actual'), 5000);
  assert.equal(eventAmount(orlando, 'adjusted'), 10000);
});

test('placements read as ordinals, with the teens all th', () => {
  assert.equal(ordinalPlace(1), '1st');
  assert.equal(ordinalPlace(2), '2nd');
  assert.equal(ordinalPlace(3), '3rd');
  assert.equal(ordinalPlace(4), '4th');
  assert.equal(ordinalPlace(11), '11th');
  assert.equal(ordinalPlace(12), '12th');
  assert.equal(ordinalPlace(13), '13th');
  assert.equal(ordinalPlace(21), '21st');
  assert.equal(ordinalPlace(112), '112th');
  assert.equal(ordinalPlace(null), '—');
});
