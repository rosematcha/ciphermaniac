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
  FRAUD_MAX_Z,
  fraudScore,
  isBasicEnergy,
  playRateZScore,
  rateZScore,
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

/**
 * A tournament: how often each card was played, and how the decks that played
 * it then did. `conversions` is a card's Day 2 rate; omit it and the event
 * published no cut, which drops that term from the score.
 */
function field(opts: {
  rates: Record<string, number>;
  conversions?: Record<string, number>;
  fieldConversion?: number | null;
  deckTotal?: number;
  sets?: string[];
}) {
  const deckTotal = opts.deckTotal ?? 800;
  const cards = new Map<string, { found: number; day1: number; day2: number }>();
  for (const [name, rate] of Object.entries(opts.rates)) {
    const found = Math.round((rate / 100) * deckTotal);
    const conversion = opts.conversions?.[name];
    cards.set(`${name}::SVI::001`, {
      found,
      day1: conversion === undefined ? 0 : found,
      day2: conversion === undefined ? 0 : Math.round((conversion / 100) * found)
    });
  }
  return {
    deckTotal,
    cards,
    sets: new Set(opts.sets ?? ['SVI']),
    fieldConversion: opts.fieldConversion ?? (opts.conversions ? 20 : null)
  };
}

/** The online window's finish rates: each card's rate against a 25% field. */
function finishes(rates: Record<string, number>, decks = 3000) {
  const cards = new Map<string, { decks: number; success: number }>();
  for (const [name, rate] of Object.entries(rates)) {
    cards.set(`${name}::SVI::001`, { decks, success: Math.round((rate / 100) * decks) });
  }
  return { tag: 'top25', deckTotal: 10000, successTotal: 2500, cards };
}

/**
 * Fraudulent reads its candidates off the ONLINE rows and their results off the
 * selected tournament; `items` is that tournament's own master, which the mode
 * never reads but the model still requires.
 */
function fraudulent(onlineItems: CardItem[], eventField: unknown, playFloor = 0, onlineField: unknown = null) {
  return buildRenderModel({
    mode: 'fraudulent',
    size: 10,
    minDecks: 5,
    items: MASTER,
    onlineItems,
    eventField: eventField as never,
    onlineField: onlineField as never,
    playFloor
  });
}

/** An online master row: `pct` of `total` decks played it. */
function online(name: string, pct: number, total = 10000, extra: Partial<CardItem> = {}): CardItem {
  return item(name, pct, { found: Math.round((pct / 100) * total), total, ...extra });
}

test('a drop from the online rate scores as an outlier, and both deck totals decide how far', () => {
  // Same 10-point drop, four times the event decks: a stronger reading.
  assert.ok(playRateZScore(3000, 10000, 200, 1000) < FRAUD_MAX_Z);
  assert.ok(playRateZScore(3000, 10000, 800, 4000) < playRateZScore(3000, 10000, 200, 1000));
  // At its online rate a card is nothing special, and above it is no fraud.
  assert.equal(playRateZScore(3000, 10000, 300, 1000), 0);
  assert.ok(playRateZScore(3000, 10000, 400, 1000) > 0);
  // Degenerate inputs score neutral rather than dividing by zero.
  assert.equal(playRateZScore(3000, 10000, 0, 0), 0);
  assert.equal(playRateZScore(0, 0, 100, 1000), 0);
  assert.equal(playRateZScore(0, 10000, 0, 1000), 0);
});

test('a rate below the field scores by how unlikely it is, not how low', () => {
  // Same 10-point shortfall, four times the decks: twice the certainty.
  assert.ok(rateZScore(10, 20, 100) < FRAUD_MAX_Z);
  assert.ok(rateZScore(10, 20, 400) < rateZScore(10, 20, 100));
  assert.equal(rateZScore(20, 20, 100), 0);
  assert.ok(rateZScore(30, 20, 100) > 0);
  assert.equal(rateZScore(0, 20, 0), 0);
  assert.equal(rateZScore(0, 0, 50), 0);
});

test('the score pools whatever signals exist, and two agreeing beat one', () => {
  assert.equal(fraudScore({ play: -2, conversion: null, online: null }), -2);
  // Two independent one-sigma shortfalls are stronger evidence than either.
  assert.ok(Math.abs(fraudScore({ play: -1, conversion: -1, online: null }) + Math.SQRT2) < 1e-9);
  assert.ok(fraudScore({ play: -1, conversion: -1, online: null }) < -1);
  // A card the event dropped but that won when played is pulled back toward
  // the middle, which is the whole point of blending.
  assert.ok(fraudScore({ play: -3, conversion: 2, online: null }) > -3);
  assert.equal(fraudScore({ play: 0, conversion: null, online: null }), 0);
});

test('fraudulent mode ranks by the pooled score', () => {
  const master = [online('Dropped Hard', 30), online('Dropped And Lost', 30)];
  const out = fraudulent(
    master,
    field({
      rates: { 'Dropped Hard': 16, 'Dropped And Lost': 18 },
      conversions: { 'Dropped Hard': 20, 'Dropped And Lost': 8 }
    })
  );
  assert.deepEqual(
    out.map(r => r.name),
    ['Dropped And Lost', 'Dropped Hard'],
    'the smaller play-rate drop wins the ranking because its decks also missed Day 2'
  );
  assert.ok((out[0].score ?? 0) < (out[1].score ?? 0));
  assert.equal(out[0].pct, 30, 'the online rate is what the drop is measured from');
  assert.equal(Math.round(out[0].eventRate ?? 0), 18);
  assert.equal(Math.round(out[0].conversion ?? 0), 8);
  assert.equal(out[0].total, 800, 'the deck counts describe the event, which is the claim');
});

test('a card the event underplayed but won with is not a fraud', () => {
  // The case the blend exists for: barely sleeved, and every deck that did
  // sleeve it made the cut. That card is underrated, not fraudulent.
  const master = [online('Underrated', 25)];
  const out = fraudulent(
    master,
    field({ rates: { Underrated: 10 }, conversions: { Underrated: 75 }, fieldConversion: 20 })
  );
  assert.deepEqual(out, []);
});

test('losing online counts against a card too', () => {
  const master = [online('Ladder Trap', 30)];
  const played = field({ rates: { 'Ladder Trap': 28 } });
  assert.deepEqual(fraudulent(master, played), [], 'the play-rate drop alone is within noise');
  const out = fraudulent(master, played, 0, finishes({ 'Ladder Trap': 19 }));
  assert.deepEqual(
    out.map(r => r.name),
    ['Ladder Trap'],
    'a card losing on ladder as well clears the gate'
  );
  assert.equal(Math.round(out[0].onlineSuccessRate ?? 0), 19);
});

test('an event with no published cut still scores on play rate alone', () => {
  const master = [online('Widespread', 40)];
  const out = fraudulent(master, field({ rates: { Widespread: 20 } }));
  assert.deepEqual(
    out.map(r => r.name),
    ['Widespread']
  );
  assert.equal(out[0].conversion, undefined, 'no cut, no conversion to show');
});

test('a card nobody at the tournament sleeved is the strongest fraud there is', () => {
  const out = fraudulent([online('Absent', 25)], field({ rates: {} }));
  assert.deepEqual(
    out.map(r => r.name),
    ['Absent']
  );
  assert.equal(out[0].eventRate, 0);
  assert.equal(out[0].found, 0);
});

test('fraudulent mode ignores cards below the online play floor', () => {
  const master = [online('Popular', 25), online('Fringe', 4)];
  assert.deepEqual(
    fraudulent(master, field({ rates: { Popular: 8, Fringe: 0 } }), 10).map(r => r.name),
    ['Popular'],
    'a card in 4% of online decks was never hyped enough to be a fraud'
  );
});

test('fraudulent mode excludes basic energy', () => {
  // Basic energy tracks whichever archetypes happened to sleeve it.
  const master = [
    online('Darkness Energy', 60, 10000, { category: 'energy/basic' } as Partial<CardItem>),
    online('Boss Card', 30)
  ];
  const out = fraudulent(master, field({ rates: { 'Darkness Energy': 30, 'Boss Card': 12 } }));
  assert.deepEqual(
    out.map(r => r.name),
    ['Boss Card']
  );
});

test('a set the event never saw is a format gap, not a fraud', () => {
  // The online window is always current, so a set that released after the
  // chosen event would otherwise put its whole roster at the top of the list.
  const master = [online('Brand New', 30)];
  assert.deepEqual(fraudulent(master, field({ rates: {}, sets: ['MEG'] })), []);
  assert.deepEqual(
    fraudulent(master, field({ rates: {}, sets: ['SVI'] })).map(r => r.name),
    ['Brand New'],
    'the same card is a fraud once its set is on the table'
  );
});

test('fraudulent mode renders nothing without a tournament to measure against', () => {
  const master = [online('Widespread', 40)];
  assert.deepEqual(fraudulent(master, null), []);
  assert.deepEqual(fraudulent(master, { deckTotal: 0, cards: new Map(), sets: new Set(), fieldConversion: null }), []);
});

test('fraudulent mode renders nothing until the online window arrives', () => {
  assert.deepEqual(
    buildRenderModel({
      mode: 'fraudulent',
      size: 10,
      minDecks: 5,
      items: MASTER,
      onlineItems: null,
      eventField: field({ rates: { Alpha: 5 } }) as never
    }),
    [],
    'the candidates come from the online side, so there are none without it'
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
    buildRenderModel({ mode: 'fraudulent', size: 10, minDecks: 5, items: MASTER, eventField: null }),
    [],
    'fraudulent needs the tournament it measures'
  );
});

test('evolution collapsing still lets the list reach the requested size', () => {
  // The pool overcollects, so dropping a pre-evo does not leave a short graphic.
  const many = Array.from({ length: 12 }, (_, i) => item(`Card${i}`, 90 - i, { uid: `Card${i}::SVI::00${i}` }));
  const out = buildRenderModel({ mode: 'standard', size: 8, minDecks: 5, items: many });
  assert.equal(out.length, 8);
});
