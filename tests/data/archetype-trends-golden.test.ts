/**
 * tests/data/archetype-trends-golden.test.ts
 * Characterization test for generateArchetypeTrends.
 *
 * The per-test assertions elsewhere check named invariants; this one pins the
 * WHOLE output for a deliberately awkward input — several tournaments on the
 * same day, a week boundary crossed mid-window, cards that appear and vanish
 * across the window, and every success tier populated. It exists so that
 * restructuring the aggregator cannot quietly change a number that no named
 * test happens to look at. (Synonym collapsing has its own coverage in
 * card-trends-canonicalization.test.ts.)
 *
 * `meta.generatedAt` is a wall-clock stamp, so it is dropped before hashing;
 * everything else is hashed through the pipeline's own canonical JSON, which
 * sorts keys and so is stable across object-construction order. If a change to
 * the aggregator is deliberate, re-run and paste the new digest — but read the
 * diff first, because this hash moving means published trend numbers moved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { generateArchetypeTrends } from '../../shared/data/analysis/archetypeTrends.ts';
import { canonicalStringify } from '../../shared/data/canonicalJson.ts';
import { sha256Hex } from '../../shared/data/hash.ts';

function makeTournament(id: string, date: string, players = 32) {
  return { id, name: `Tournament ${id}`, date, players };
}

function makeDeck(
  tournamentId: string,
  tournamentDate: string,
  successTags: string[],
  cards: Array<{ name: string; count: number; set?: string; number?: string }>
) {
  return {
    tournamentId,
    tournamentDate,
    tournamentName: `Tournament ${tournamentId}`,
    archetype: 'Dragapult ex',
    successTags,
    cards
  };
}

/**
 * Two events on 2025-12-01, one on 2025-12-04, one on 2025-12-08 — so the
 * window spans a week boundary and one day carries more than one event.
 */
const TOURNAMENTS = [
  makeTournament('t1', '2025-12-01T10:00:00Z'),
  makeTournament('t2', '2025-12-01T18:00:00Z'),
  makeTournament('t3', '2025-12-04T10:00:00Z'),
  makeTournament('t4', '2025-12-08T10:00:00Z')
];

const DRAGAPULT = { name: 'Dragapult ex', set: 'TWM', number: '130' };
const RESCUE = { name: 'Rescue Board', set: 'TEF', number: '159' };
const NEST = { name: 'Nest Ball', set: 'SVI', number: '181' };
const IONO = { name: 'Iono', set: 'PAL', number: '185' };

const DECKS = [
  // 2025-12-01, event t1 — a winner, a top4, and two also-rans.
  makeDeck(
    't1',
    '2025-12-01T10:00:00Z',
    ['winner', 'top2', 'top4', 'top8', 'top16', 'top10', 'top25', 'top50'],
    [
      { ...DRAGAPULT, count: 4 },
      { ...RESCUE, count: 2 },
      { ...NEST, count: 4 }
    ]
  ),
  makeDeck(
    't1',
    '2025-12-01T10:00:00Z',
    ['top4', 'top8', 'top16', 'top10', 'top25', 'top50'],
    [
      { ...DRAGAPULT, count: 3 },
      { ...RESCUE, count: 1 },
      { ...NEST, count: 4 }
    ]
  ),
  makeDeck(
    't1',
    '2025-12-01T10:00:00Z',
    ['top50'],
    [
      { ...DRAGAPULT, count: 4 },
      { ...NEST, count: 3 },
      { ...IONO, count: 3 }
    ]
  ),
  makeDeck(
    't1',
    '2025-12-01T10:00:00Z',
    [],
    [
      { ...DRAGAPULT, count: 2 },
      { ...NEST, count: 4 }
    ]
  ),
  // 2025-12-01, event t2 — same day, separate event.
  makeDeck(
    't2',
    '2025-12-01T18:00:00Z',
    ['winner', 'top2', 'top4', 'top8', 'top16', 'top10', 'top25', 'top50'],
    [
      { ...DRAGAPULT, count: 4 },
      { ...RESCUE, count: 3 },
      { ...IONO, count: 4 }
    ]
  ),
  makeDeck(
    't2',
    '2025-12-01T18:00:00Z',
    ['top25', 'top50'],
    [
      { ...DRAGAPULT, count: 4 },
      { ...NEST, count: 2 }
    ]
  ),
  // 2025-12-04 — Rescue Board climbing, Nest Ball fading.
  makeDeck(
    't3',
    '2025-12-04T10:00:00Z',
    ['winner', 'top2', 'top4', 'top8', 'top16', 'top10', 'top25', 'top50'],
    [
      { ...DRAGAPULT, count: 4 },
      { ...RESCUE, count: 4 },
      { ...IONO, count: 4 }
    ]
  ),
  makeDeck(
    't3',
    '2025-12-04T10:00:00Z',
    ['top8', 'top16', 'top25', 'top50'],
    [
      { ...DRAGAPULT, count: 4 },
      { ...RESCUE, count: 3 },
      { ...IONO, count: 3 }
    ]
  ),
  makeDeck(
    't3',
    '2025-12-04T10:00:00Z',
    [],
    [
      { ...DRAGAPULT, count: 3 },
      { ...RESCUE, count: 2 }
    ]
  ),
  // 2025-12-08 — next week; Nest Ball gone entirely.
  makeDeck(
    't4',
    '2025-12-08T10:00:00Z',
    ['winner', 'top2', 'top4', 'top8', 'top16', 'top10', 'top25', 'top50'],
    [
      { ...DRAGAPULT, count: 4 },
      { ...RESCUE, count: 4 },
      { ...IONO, count: 4 }
    ]
  ),
  makeDeck(
    't4',
    '2025-12-08T10:00:00Z',
    ['top16', 'top25', 'top50'],
    [
      { ...DRAGAPULT, count: 4 },
      { ...RESCUE, count: 4 },
      { ...IONO, count: 3 }
    ]
  )
];

/** Strip the wall-clock stamp so the rest can be compared exactly. */
function stable(report: ReturnType<typeof generateArchetypeTrends>): string {
  const { meta, ...rest } = report;
  const { generatedAt: _generatedAt, ...metaRest } = meta;
  return canonicalStringify({ meta: metaRest, ...rest });
}

const GOLDEN_DIGEST = '344f2429a217da03db04cf18954f46a5b54ab1a767c7f86e20eaec02d079019a';

test('the full trend report for a mixed multi-event window is unchanged', () => {
  const report = generateArchetypeTrends(DECKS, TOURNAMENTS, null, { archetypeName: 'Dragapult ex' });

  // Guard the guard: an empty report would make the digest vacuously stable.
  assert.ok(report.days.length > 0, 'expected day buckets');
  assert.ok(report.weeks.length > 1, 'expected the window to span more than one week');
  assert.ok(Object.keys(report.cards).length > 0, 'expected card trends');

  assert.strictEqual(sha256Hex(stable(report)), GOLDEN_DIGEST);
});

test('an empty deck list and a deck list with no usable dates agree on the empty report', () => {
  const fromNoDecks = generateArchetypeTrends([], TOURNAMENTS, null);
  // Decks whose tournamentId matches nothing produce no active days, which is
  // the aggregator's other route to an empty report. The two must not drift.
  const orphaned = [makeDeck('missing', '2025-12-01T10:00:00Z', [], [{ ...DRAGAPULT, count: 4 }])];
  const fromNoActiveDays = generateArchetypeTrends(orphaned, [], null);

  assert.equal(stable(fromNoDecks), stable(fromNoActiveDays));
});
