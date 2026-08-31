/**
 * Social-graphics render model.
 *
 * What goes in the graphic, in what order — separated from the canvas so it can
 * be tested without one. Two behaviors are worth pinning: the evolution
 * collapse (which spends one slot on a pre-evo/evo pair instead of two), and
 * returning an EMPTY list rather than a partial one while a mode's secondary
 * data is still loading, since the export gate reads that emptiness.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRenderModel,
  classify,
  collapseEvolutions,
  conversionZScore,
  FRAUD_MAX_Z,
  isBasicEnergy,
  type RenderItem,
  shortTournament,
  statsAreClose,
  thumbUrl
} from '../../src/pages/socialGraphics/model.ts';
import type { CardItem } from '../../src/types/index.ts';

function item(name: string, pct: number, extra: Partial<CardItem> = {}): CardItem {
  return {
    name,
    set: 'SVI',
    number: '1',
    uid: `${name}::SVI::001`,
    found: 10,
    total: 20,
    pct,
    ...extra
  } as CardItem;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

test('cards classify into the graphic s visual categories', () => {
  assert.equal(classify({ supertype: 'Pokémon' } as CardItem), 'pokemon');
  assert.equal(classify({ supertype: 'Trainer' } as CardItem), 'trainer');
  assert.equal(classify({ supertype: 'Energy', category: 'Basic Energy' } as CardItem), 'energy-basic');
  assert.equal(classify({ supertype: 'Energy', category: 'Special Energy' } as CardItem), 'energy-special');
});

test('basic energy is excluded by its set code', () => {
  assert.equal(isBasicEnergy({ set: 'SVE' }), true);
  assert.equal(isBasicEnergy({ set: 'SVI' }), false);
});

test('thumbnails load same-origin, which is what keeps the export canvas untainted', () => {
  assert.equal(thumbUrl('svi', 181), '/thumbnails/lg/SVI/181');
});

test('a tournament label drops its date prefix', () => {
  assert.equal(shortTournament('2026-05-08, Regional Championship LA'), 'Regional Championship LA');
  assert.equal(shortTournament('Online - Last 14 Days'), 'Online ladder · last 14 days');
  assert.equal(shortTournament('Something Else'), 'Something Else');
});

// ---------------------------------------------------------------------------
// Evolution collapsing
// ---------------------------------------------------------------------------

const row = (name: string, pct: number, extra: Partial<RenderItem> = {}): RenderItem => ({
  rank: 0,
  name,
  set: 'SVI',
  number: name === 'Rellor' ? '1' : '2',
  found: 10,
  total: 20,
  pct,
  cat: 'pokemon',
  ...extra
});

const EVO_MAP = new Map([['SVI::2', 'rellor']]);

test('a pre-evolution collapses into its evolution when their stats are close', () => {
  // Rellor 37% / Rabsca 35%: the only reason to play Rellor is to reach Rabsca.
  const out = collapseEvolutions([row('Rellor', 37), row('Rabsca', 35)], EVO_MAP, 'standard');
  assert.deepEqual(
    out.map(r => r.name),
    ['Rabsca']
  );
});

test('a pre-evolution played far more than its evolution is kept', () => {
  // A 30-point gap means the pre-evo is doing something on its own.
  const out = collapseEvolutions([row('Rellor', 60), row('Rabsca', 20)], EVO_MAP, 'standard');
  assert.deepEqual(
    out.map(r => r.name),
    ['Rellor', 'Rabsca']
  );
});

test('rising mode compares deltas rather than usage', () => {
  const close = collapseEvolutions(
    [row('Rellor', 5, { delta: 3 }), row('Rabsca', 40, { delta: 4 })],
    EVO_MAP,
    'rising'
  );
  assert.deepEqual(
    close.map(r => r.name),
    ['Rabsca']
  );
  const apart = collapseEvolutions(
    [row('Rellor', 5, { delta: 1 }), row('Rabsca', 40, { delta: 20 })],
    EVO_MAP,
    'rising'
  );
  assert.equal(apart.length, 2);
});

test('the close-stats bands are 5 points on usage and 2 on deltas', () => {
  assert.equal(statsAreClose(row('a', 30), row('b', 35), 'standard'), true);
  assert.equal(statsAreClose(row('a', 30), row('b', 36), 'standard'), false);
  assert.equal(statsAreClose(row('a', 0, { delta: 3 }), row('b', 0, { delta: 5 }), 'rising'), true);
  assert.equal(statsAreClose(row('a', 0, { delta: 3 }), row('b', 0, { delta: 6 }), 'rising'), false);
});

test('a card with no evolution in the list is untouched', () => {
  const out = collapseEvolutions([row('Rabsca', 35)], EVO_MAP, 'standard');
  assert.equal(out.length, 1);
});

test('an absent or empty evolution map collapses nothing', () => {
  const rows = [row('Rellor', 37), row('Rabsca', 35)];
  assert.equal(collapseEvolutions(rows, undefined, 'standard').length, 2);
  assert.equal(collapseEvolutions(rows, new Map(), 'standard').length, 2);
});

// ---------------------------------------------------------------------------
// Mode selection
// ---------------------------------------------------------------------------

const MASTER = [item('Alpha', 90), item('Beta', 80, { uid: 'Beta::SVI::002' }), item('Energy', 70, { set: 'SVE' })];

test('standard mode ranks the master report, minus basic energy', () => {
  const out = buildRenderModel({ mode: 'standard', size: 10, minDecks: 5, items: MASTER });
  assert.deepEqual(
    out.map(r => r.name),
    ['Alpha', 'Beta']
  );
});

test('rows are ranked from one', () => {
  const out = buildRenderModel({ mode: 'standard', size: 10, minDecks: 5, items: MASTER });
  assert.deepEqual(
    out.map(r => r.rank),
    [1, 2]
  );
});

test('the list is capped at the requested size', () => {
  assert.equal(buildRenderModel({ mode: 'standard', size: 1, minDecks: 5, items: MASTER }).length, 1);
});

test('rising mode lists only cards that gained, biggest gain first', () => {
  const comparison = [item('Alpha', 95), item('Beta', 40, { uid: 'Beta::SVI::002' })];
  const out = buildRenderModel({
    mode: 'rising',
    size: 10,
    minDecks: 5,
    items: MASTER,
    comparisonItems: comparison
  });
  assert.deepEqual(
    out.map(r => r.name),
    ['Beta'],
    'Alpha fell, so it is not rising'
  );
  assert.equal(out[0].delta, 40);
});

test('rising mode ignores cards absent from the comparison', () => {
  const out = buildRenderModel({
    mode: 'rising',
    size: 10,
    minDecks: 5,
    items: MASTER,
    comparisonItems: [item('Alpha', 10)]
  });
  assert.deepEqual(
    out.map(r => r.name),
    ['Alpha']
  );
});

test('converting mode ranks by conversion, breaking ties on sample size', () => {
  const stats = [
    { uid: 'a', name: 'Low', set: 'SVI', number: '1', conversion: 40, day1Count: 100, day2Count: 40 },
    { uid: 'b', name: 'High', set: 'SVI', number: '2', conversion: 60, day1Count: 20, day2Count: 12 },
    { uid: 'c', name: 'TieBigger', set: 'SVI', number: '3', conversion: 60, day1Count: 80, day2Count: 48 }
  ] as never;
  const out = buildRenderModel({ mode: 'converting', size: 10, minDecks: 5, items: MASTER, day2Stats: stats });
  assert.deepEqual(
    out.map(r => r.name),
    ['TieBigger', 'High', 'Low']
  );
});

test('converting mode drops rows below the sample floor', () => {
  const stats = [
    { uid: 'a', name: 'Thin', set: 'SVI', number: '1', conversion: 99, day1Count: 3, day2Count: 3 },
    { uid: 'b', name: 'Solid', set: 'SVI', number: '2', conversion: 50, day1Count: 50, day2Count: 25 }
  ] as never;
  const out = buildRenderModel({ mode: 'converting', size: 10, minDecks: 10, items: MASTER, day2Stats: stats });
  assert.deepEqual(
    out.map(r => r.name),
    ['Solid'],
    'a 99% conversion off three decks is noise'
  );
});

test('converting mode excludes basic energy', () => {
  const stats = [
    { uid: 'a', name: 'Basic', set: 'SVE', number: '1', conversion: 99, day1Count: 50, day2Count: 49 }
  ] as never;
  assert.deepEqual(
    buildRenderModel({ mode: 'converting', size: 10, minDecks: 5, items: MASTER, day2Stats: stats }),
    []
  );
});

// ---------------------------------------------------------------------------
// Fraudulent
// ---------------------------------------------------------------------------

/** A day-2 stat row whose uid matches `item()`, so it joins to a play rate. */
function stat(name: string, conversion: number, day1Count: number) {
  return {
    uid: `${name}::SVI::001`,
    name,
    set: 'SVI',
    number: '1',
    conversion,
    day1Count,
    day2Count: Math.round((conversion / 100) * day1Count)
  };
}

/** Fraudulent needs the field rate, and reads play rate off the master rows. */
function fraudulent(master: CardItem[], stats: unknown, playFloor = 0, fieldConversion: number | null = 20) {
  return buildRenderModel({
    mode: 'fraudulent',
    size: 10,
    minDecks: 5,
    items: master,
    day2Stats: stats as never,
    fieldConversion,
    playFloor
  });
}

test('a conversion far below the field scores as an outlier, and sample size decides how far', () => {
  // Same 10-point shortfall, four times the decks: twice the certainty.
  assert.ok(conversionZScore(10, 20, 100) < FRAUD_MAX_Z);
  assert.ok(conversionZScore(10, 20, 400) < conversionZScore(10, 20, 100));
  // At the field rate a card is nothing special, and above it is not a fraud.
  assert.equal(conversionZScore(20, 20, 100), 0);
  assert.ok(conversionZScore(30, 20, 100) > 0);
  // Degenerate inputs score neutral rather than dividing by zero.
  assert.equal(conversionZScore(0, 20, 0), 0);
  assert.equal(conversionZScore(0, 0, 50), 0);
});

test('fraudulent mode ranks by the strength of the shortfall, not by its size', () => {
  const master = [item('Widespread', 40), item('Narrow', 12)];
  // Narrow is further below the field, but off a sample too small to trust.
  const stats = [stat('Widespread', 10, 400), stat('Narrow', 5, 20)];
  const out = fraudulent(master, stats);
  assert.deepEqual(
    out.map(r => r.name),
    ['Widespread', 'Narrow']
  );
  assert.equal(out[0].playRate, 40, 'the play rate rides along for the subtitle');
  assert.equal(out[0].pct, 10, 'the headline number is still the conversion rate');
});

test('fraudulent mode drops shortfalls that are within noise', () => {
  const master = [item('Unlucky', 30)];
  // One of twelve decks against a 20% field is about a sigma out — an ordinary
  // weekend for a small sample, not a fraud.
  const out = fraudulent(master, [stat('Unlucky', 8, 12)]);
  assert.deepEqual(out, []);
});

test('fraudulent mode ignores cards below the play-rate floor', () => {
  const master = [item('Popular', 25), item('Rare', 4)];
  const stats = [stat('Popular', 8, 200), stat('Rare', 2, 200)];
  assert.deepEqual(
    fraudulent(master, stats, 10).map(r => r.name),
    ['Popular'],
    'a card in 4% of decks was not overplayed, whatever it converted at'
  );
});

test('fraudulent mode excludes basic energy', () => {
  // Basic energy converts like whichever decks happened to sleeve it.
  const master = [
    item('Darkness Energy', 60, { uid: 'Darkness Energy::SVI::001', category: 'energy/basic' } as Partial<CardItem>),
    item('Boss Card', 30)
  ];
  const stats = [stat('Darkness Energy', 8, 400), stat('Boss Card', 9, 300)];
  assert.deepEqual(
    fraudulent(master, stats).map(r => r.name),
    ['Boss Card']
  );
});

test('fraudulent mode renders nothing without a field rate to measure against', () => {
  const master = [item('Widespread', 40)];
  assert.deepEqual(fraudulent(master, [stat('Widespread', 5, 300)], 0, null), []);
});

test('fraudulent mode skips cards it cannot match to a play rate', () => {
  const stats = [
    { uid: 'unmatched', name: 'Ghost', set: 'SVI', number: '9', conversion: 5, day1Count: 80, day2Count: 4 }
  ];
  assert.deepEqual(fraudulent(MASTER, stats, 10), []);
});

// ---------------------------------------------------------------------------
// Partial data
// ---------------------------------------------------------------------------

test('a mode renders nothing until its own data arrives', () => {
  // The export gate reads this emptiness; a partial list would let a click
  // rasterize a half-built graphic.
  assert.deepEqual(buildRenderModel({ mode: 'standard', size: 10, minDecks: 5, items: null }), []);
  assert.deepEqual(
    buildRenderModel({ mode: 'rising', size: 10, minDecks: 5, items: MASTER, comparisonItems: null }),
    [],
    'rising needs the comparison master'
  );
  assert.deepEqual(
    buildRenderModel({ mode: 'converting', size: 10, minDecks: 5, items: MASTER, day2Stats: null }),
    [],
    'converting needs the day-2 stats'
  );
  assert.deepEqual(
    buildRenderModel({
      mode: 'fraudulent',
      size: 10,
      minDecks: 5,
      items: MASTER,
      day2Stats: null,
      fieldConversion: 20
    }),
    [],
    'fraudulent needs the day-2 stats'
  );
});

test('evolution collapsing still lets the list reach the requested size', () => {
  // The pool overcollects, so dropping a pre-evo does not leave a short graphic.
  const many = Array.from({ length: 12 }, (_, i) => item(`Card${i}`, 90 - i, { uid: `Card${i}::SVI::00${i}` }));
  const out = buildRenderModel({ mode: 'standard', size: 8, minDecks: 5, items: many });
  assert.equal(out.length, 8);
});
