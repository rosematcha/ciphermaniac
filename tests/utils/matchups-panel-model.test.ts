/**
 * MatchupsPanel presentation logic.
 *
 * The matchup math is tested in tests/data/matchups-*.test.ts. This covers the
 * layer above it — wording, ordering, and which cards earn a lens chip — which
 * had no tests at all despite being what a reader actually sees.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatDeltaPp,
  formatShare,
  formatWinRate,
  sortByMode,
  suggestTechCards,
  summarizeKeyMatchups,
  TECH_MAX_PCT,
  TECH_MIN_PCT,
  toneClass
} from '../../src/components/matchupsPanel/model.ts';
import type { CardItem } from '../../src/types/index.ts';

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

test('win rate rounds to a whole percent', () => {
  assert.equal(formatWinRate(52.4), '52%');
  assert.equal(formatWinRate(0), '0%');
  assert.equal(formatWinRate(100), '100%');
});

test('an absent win rate reads as an em dash, not zero', () => {
  assert.equal(formatWinRate(null), '—');
  assert.equal(formatWinRate(Number.NaN), '—');
  assert.equal(formatWinRate(Infinity), '—');
});

test('field share keeps one decimal', () => {
  assert.equal(formatShare(12.74), '12.7%');
  assert.equal(formatShare(0), '0.0%');
});

test('an unknown field share renders nothing rather than a placeholder', () => {
  assert.equal(formatShare(null), '');
  assert.equal(formatShare(Number.NaN), '');
});

test('lens deltas are signed percentage points', () => {
  assert.equal(formatDeltaPp(4.6), '+5pp');
  assert.equal(formatDeltaPp(-4.6), '-5pp');
  assert.equal(formatDeltaPp(0), '0pp', 'zero is unsigned');
  assert.equal(formatDeltaPp(null), '—');
});

// ---------------------------------------------------------------------------
// Tone — the non-colour encoding
// ---------------------------------------------------------------------------

test('tone splits at the exact 50% center', () => {
  assert.equal(toneClass(51), 'mu-pos');
  assert.equal(toneClass(49), 'mu-neg');
  assert.equal(toneClass(50), 'mu-flat');
});

test('a win rate within half a point of even reads neutral', () => {
  assert.equal(toneClass(50.4), 'mu-flat');
  assert.equal(toneClass(49.6), 'mu-flat');
  assert.equal(toneClass(50.6), 'mu-pos');
});

test('no data reads neutral rather than unfavored', () => {
  assert.equal(toneClass(null), 'mu-flat');
  assert.equal(toneClass(Number.NaN), 'mu-flat');
});

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

const rows = [
  { name: 'a', wr: 60, share: 5 },
  { name: 'b', wr: 40, share: 20 },
  { name: 'c', wr: null as number | null, share: 30 },
  { name: 'd', wr: 55, share: 10 }
];
const quality = (r: (typeof rows)[number]) => r.wr;
const prevalence = (r: (typeof rows)[number]) => r.share;

test('win-rate mode orders by quality, descending', () => {
  assert.deepEqual(
    sortByMode(rows, 'winRate', quality, prevalence).map(r => r.name),
    ['a', 'd', 'b', 'c']
  );
});

test('prevalence mode leads with field share', () => {
  assert.deepEqual(
    sortByMode(rows, 'prevalence', quality, prevalence).map(r => r.name),
    ['c', 'b', 'd', 'a']
  );
});

test('a matchup with no data never displaces one with data', () => {
  assert.equal(sortByMode(rows, 'winRate', quality, prevalence).at(-1)?.name, 'c');
});

test('quality breaks ties in prevalence mode', () => {
  const tied = [
    { name: 'lo', wr: 40, share: 10 },
    { name: 'hi', wr: 60, share: 10 }
  ];
  assert.deepEqual(
    sortByMode(tied, 'prevalence', quality, prevalence).map(r => r.name),
    ['hi', 'lo']
  );
});

test('sorting does not mutate the input', () => {
  const input = [...rows];
  sortByMode(input, 'winRate', quality, prevalence);
  assert.deepEqual(
    input.map(r => r.name),
    ['a', 'b', 'c', 'd']
  );
});

// ---------------------------------------------------------------------------
// Key matchup tally
// ---------------------------------------------------------------------------

test('key matchups tally into favored, even, and unfavored', () => {
  const stats = summarizeKeyMatchups([
    { winRate: 60, prevalence: 10 },
    { winRate: 50, prevalence: 20 },
    { winRate: 40, prevalence: 5 }
  ]);
  assert.deepEqual(stats, { favored: 1, even: 1, unfavored: 1, shareSum: 35 });
});

test('the even band is 48 to 52 inclusive, matching the overview', () => {
  const stats = summarizeKeyMatchups([{ winRate: 48 }, { winRate: 52 }, { winRate: 53 }, { winRate: 47 }]);
  assert.equal(stats.even, 2);
  assert.equal(stats.favored, 1);
  assert.equal(stats.unfavored, 1);
});

test('a missing field share contributes nothing to the sum', () => {
  assert.equal(summarizeKeyMatchups([{ winRate: 60 }, { winRate: 60, prevalence: null }]).shareSum, 0);
});

test('no key rows tallies to zero', () => {
  assert.deepEqual(summarizeKeyMatchups([]), { favored: 0, even: 0, unfavored: 0, shareSum: 0 });
});

// ---------------------------------------------------------------------------
// Tech chips
// ---------------------------------------------------------------------------

const items = [
  { name: 'Core Card', set: 'SVI', number: '1', pct: 95 },
  { name: 'Tech A', set: 'SVI', number: '2', pct: 80 },
  { name: 'Tech B', set: 'SVI', number: '3', pct: 45 },
  { name: 'Fringe', set: 'SVI', number: '4', pct: 5 },
  { name: 'No Printing', pct: 50 }
] as CardItem[];

test('only cards inside the tech band earn a chip', () => {
  // Below the band there are too few decks to compare with and without; at or
  // above it the "without" side is a handful of stragglers.
  assert.deepEqual(
    suggestTechCards(items, null).map(t => t.name),
    ['Tech A', 'Tech B']
  );
});

test('the band edges are inclusive below and exclusive above', () => {
  const edges = [
    { name: 'AtMin', set: 'SVI', number: '1', pct: TECH_MIN_PCT },
    { name: 'AtMax', set: 'SVI', number: '2', pct: TECH_MAX_PCT }
  ] as CardItem[];
  assert.deepEqual(
    suggestTechCards(edges, null).map(t => t.name),
    ['AtMin']
  );
});

test('chips are ordered most-played first', () => {
  // Tech A (80%) outranks Tech B (45%), regardless of report order.
  const shuffled = [items[2], items[1]] as typeof items;
  assert.deepEqual(
    suggestTechCards(shuffled, null).map(t => t.name),
    ['Tech A', 'Tech B']
  );
});

test('a card with no printing cannot become a chip', () => {
  assert.equal(
    suggestTechCards(items, null).some(t => t.name === 'No Printing'),
    false
  );
});

test('chips are capped', () => {
  assert.equal(suggestTechCards(items, null, 1).length, 1);
});

test('a chip carries the cardId the lens matches on', () => {
  const [chip] = suggestTechCards(items, null);
  assert.equal(chip.cardId, 'SVI~002');
  assert.equal(chip.label, 'Tech A SVI 2');
});

test('a chip resolves to the cluster canonical, so a rebaked report still matches', () => {
  // Lens decks are canonicalized to the global print; a rebaked report's items
  // carry a rolling one.
  const db = {
    synonyms: { 'Tech A::TWM::130': 'Tech A::PRE::073' },
    canonicals: {}
  };
  const rolling = [{ name: 'Tech A', set: 'TWM', number: '130', pct: 50 }] as CardItem[];
  assert.equal(suggestTechCards(rolling, db)[0].cardId, 'PRE~073');
});
