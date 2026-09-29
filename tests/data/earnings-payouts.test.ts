/**
 * Restating finishes at today's prize money.
 *
 * The payout tables are inclusive upper bands, which is exactly the shape that
 * goes wrong quietly: an off-by-one puts 2nd place in the 3rd-4th band and
 * nothing ever throws. These pin every boundary, plus the tier mapping that
 * decides whether an event restates at all.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { payoutFor, seasonLabel, seasonList, TIER_OF_TYPE, totalsFor } from '../../shared/earningsPayouts.ts';
import type { CrawledResult } from '../../shared/earningsTypes.ts';

function result(over: Partial<CrawledResult> = {}): CrawledResult {
  return { tournamentId: '1', name: 'Event', season: '2526', place: 1, cash: 0, division: 'masters', ...over };
}

test('each payout band covers through its upper bound and no further', () => {
  const cases: Array<[Parameters<typeof payoutFor>[0], number | null, number]> = [
    ['regional', 1, 10_000],
    ['regional', 2, 7_000],
    ['regional', 3, 5_000],
    ['regional', 4, 5_000],
    ['regional', 5, 3_000],
    ['regional', 16, 2_000],
    ['regional', 17, 1_000],
    // The Regional table stops at 32; 33rd is out of the money.
    ['regional', 32, 1_000],
    ['regional', 33, 0],
    // Internationals pay two bands deeper than Regionals...
    ['international', 33, 2_000],
    ['international', 64, 2_000],
    ['international', 65, 0],
    // ...and Worlds pays more per band.
    ['worlds', 1, 50_000],
    ['worlds', 32, 5_000],
    ['worlds', 33, 0],
    // A missing placement pays nothing rather than counting as first.
    ['worlds', null, 0]
  ];
  for (const [tier, place, expected] of cases) {
    assert.equal(payoutFor(tier, place, 'masters'), expected, `${tier} ${String(place)}`);
  }
});

test('Juniors and Seniors restate from their own, much lower column', () => {
  // A Senior Regional win is $2,500 where a Masters win is $10,000; paying
  // every finish at Masters rates would inflate whole junior careers.
  assert.equal(payoutFor('regional', 1, 'junior-senior'), 2_500);
  assert.equal(payoutFor('regional', 8, 'junior-senior'), 750);
  // Their table stops at 8th where the Masters one runs to 32nd.
  assert.equal(payoutFor('regional', 9, 'junior-senior'), 0);
  assert.equal(payoutFor('international', 32, 'junior-senior'), 750);
  // Worlds publishes one prize column for every division.
  assert.equal(payoutFor('worlds', 1, 'junior-senior'), 50_000);
});

test('Nationals restate at International rates and Specials at Regional', () => {
  assert.equal(TIER_OF_TYPE.national, 'international');
  assert.equal(TIER_OF_TYPE.special, 'regional');
  // Types with no modern equivalent are absent, so they restate to nothing.
  assert.equal(TIER_OF_TYPE.cl, undefined);
  assert.equal(TIER_OF_TYPE.online, undefined);
});

test('totals split actual cash from restated money, per season', () => {
  const typeOf = (id: string) => ({ '10': 'regional', '20': 'worlds', '30': 'online' })[id];
  const { actual, adjusted } = totalsFor(
    [
      result({ tournamentId: '10', season: '1516', place: 1, cash: 2_000 }),
      result({ tournamentId: '20', season: '1516', place: 8, cash: 5_000 }),
      // An online event pays real money but has no table to restate from.
      result({ tournamentId: '30', season: '2526', place: 1, cash: 1_000 })
    ],
    typeOf
  );
  assert.deepEqual(actual.seasons, { 1516: 7_000, 2526: 1_000 });
  assert.equal(actual.total, 8_000);
  assert.deepEqual(adjusted.seasons, { 1516: 25_000 });
  assert.equal(adjusted.total, 25_000);
});

test('a finish that paid nothing at the time still restates', () => {
  const { actual, adjusted } = totalsFor(
    [result({ tournamentId: '1', season: '1415', place: 20, cash: 0 })],
    () => 'regional'
  );
  assert.deepEqual(actual.seasons, {});
  assert.equal(actual.total, 0);
  assert.deepEqual(adjusted.seasons, { 1415: 1_000 });
});

test('an unknown tournament id contributes cash but no restated money', () => {
  const { actual, adjusted } = totalsFor([result({ place: 1, cash: 500 })], () => undefined);
  assert.equal(actual.total, 500);
  assert.equal(adjusted.total, 0);
});

test('season keys render as full spans, newest first', () => {
  assert.equal(seasonLabel('2526'), '2025–2026');
  assert.equal(seasonLabel('1011'), '2010–2011');
  // Limitless data reaches back before 2000; 90+ is a 19xx year.
  assert.equal(seasonLabel('9900'), '1999–2000');
  assert.deepEqual(
    seasonList(['1516', '2526', '1516']).map(s => s.key),
    ['2526', '1516']
  );
});
