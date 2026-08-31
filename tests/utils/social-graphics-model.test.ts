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
  FRAUD_PLAYRATE_POOL,
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

test('fraudulent mode ranks the worst converters first and carries the play rate', () => {
  const master = [item('Popular', 60), item('Alright', 50), item('Fine', 40)];
  const stats = [stat('Popular', 12, 300), stat('Alright', 45, 200), stat('Fine', 30, 150)] as never;
  const out = buildRenderModel({ mode: 'fraudulent', size: 10, minDecks: 5, items: master, day2Stats: stats });
  assert.deepEqual(
    out.map(r => r.name),
    ['Popular', 'Fine', 'Alright']
  );
  assert.equal(out[0].playRate, 60, 'the play rate rides along for the subtitle');
  assert.equal(out[0].pct, 12, 'the headline number is still the conversion rate');
});

test('fraudulent mode ties break toward the more played card', () => {
  const master = [item('Everywhere', 70), item('Niche', 12)];
  const stats = [stat('Niche', 20, 60), stat('Everywhere', 20, 400)] as never;
  const out = buildRenderModel({ mode: 'fraudulent', size: 10, minDecks: 5, items: master, day2Stats: stats });
  assert.deepEqual(
    out.map(r => r.name),
    ['Everywhere', 'Niche']
  );
});

test('fraudulent mode only considers the most-played slice of the field', () => {
  // A card has to be popular to be a fraud. Fill the play-rate pool with
  // mediocre converters, then hang a 0% card off the bottom of the field.
  const master = [
    ...Array.from({ length: FRAUD_PLAYRATE_POOL }, (_, i) => item(`Staple${i}`, 90 - i)),
    item('Fringe', 1)
  ];
  const stats = [
    ...Array.from({ length: FRAUD_PLAYRATE_POOL }, (_, i) => stat(`Staple${i}`, 30, 100)),
    stat('Fringe', 0, 20)
  ] as never;
  const out = buildRenderModel({ mode: 'fraudulent', size: 10, minDecks: 5, items: master, day2Stats: stats });
  assert.ok(!out.some(r => r.name === 'Fringe'), 'a card nobody played converting at 0% is noise, not a fraud');
});

test('fraudulent mode drops rows below the sample floor', () => {
  const master = [item('Thin', 80), item('Solid', 70)];
  const stats = [stat('Thin', 0, 3), stat('Solid', 25, 60)] as never;
  const out = buildRenderModel({ mode: 'fraudulent', size: 10, minDecks: 10, items: master, day2Stats: stats });
  assert.deepEqual(
    out.map(r => r.name),
    ['Solid']
  );
});

test('fraudulent mode skips cards it cannot match to a play rate', () => {
  const stats = [
    { uid: 'unmatched', name: 'Ghost', set: 'SVI', number: '9', conversion: 5, day1Count: 80, day2Count: 4 }
  ] as never;
  assert.deepEqual(
    buildRenderModel({ mode: 'fraudulent', size: 10, minDecks: 5, items: MASTER, day2Stats: stats }),
    []
  );
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
    buildRenderModel({ mode: 'fraudulent', size: 10, minDecks: 5, items: MASTER, day2Stats: null }),
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
