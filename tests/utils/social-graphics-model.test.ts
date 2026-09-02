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
  isBasicEnergy,
  playRateZScore,
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

/** A tournament in which every named card sits at `rate` percent of its decks. */
function field(rates: Record<string, number>, deckTotal = 800, sets = ['SVI']) {
  const found = new Map<string, number>();
  for (const [name, rate] of Object.entries(rates)) {
    found.set(`${name}::SVI::001`, Math.round((rate / 100) * deckTotal));
  }
  return { deckTotal, found, sets: new Set(sets) };
}

/**
 * Fraudulent reads its candidates off the ONLINE rows and their results off the
 * selected tournament; `items` is that tournament's own master, which the mode
 * never reads but the model still requires.
 */
function fraudulent(onlineItems: CardItem[], eventField: unknown, playFloor = 0) {
  return buildRenderModel({
    mode: 'fraudulent',
    size: 10,
    minDecks: 5,
    items: MASTER,
    onlineItems,
    eventField: eventField as never,
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

test('fraudulent mode ranks by how far a card fell, not by how popular it was', () => {
  const master = [online('Ladder Darling', 30), online('Bigger Faller', 40)];
  const out = fraudulent(master, field({ 'Ladder Darling': 18, 'Bigger Faller': 22 }));
  assert.deepEqual(
    out.map(r => r.name),
    ['Bigger Faller', 'Ladder Darling']
  );
  assert.equal(out[0].pct, 40, 'the online rate is what the drop is measured from');
  assert.equal(Math.round(out[0].eventRate ?? 0), 22, 'the event rate rides along for the subtitle');
  assert.equal(Math.round(out[0].delta ?? 0), -18);
  assert.equal(out[0].total, 800, 'the deck counts describe the events, which is the claim');
});

test('fraudulent mode drops gaps that are within noise', () => {
  // Two points off a 20% card, against 800 event decks, is an ordinary weekend.
  assert.deepEqual(fraudulent([online('Steady', 20)], field({ Steady: 18 })), []);
});

test('a card nobody at the tournament sleeved is the strongest fraud there is', () => {
  const out = fraudulent([online('Absent', 25)], field({}));
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
    fraudulent(master, field({ Popular: 8, Fringe: 0 }), 10).map(r => r.name),
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
  const out = fraudulent(master, field({ 'Darkness Energy': 30, 'Boss Card': 12 }));
  assert.deepEqual(
    out.map(r => r.name),
    ['Boss Card']
  );
});

test('a set the event never saw is a format gap, not a fraud', () => {
  // The online window is always current, so a set that released after the
  // chosen event would otherwise put its whole roster at the top of the list.
  const master = [online('Brand New', 30)];
  assert.deepEqual(fraudulent(master, field({}, 800, ['MEG'])), []);
  assert.deepEqual(
    fraudulent(master, field({}, 800, ['SVI'])).map(r => r.name),
    ['Brand New'],
    'the same card is a fraud once its set is on the table'
  );
});

test('fraudulent mode renders nothing without a tournament to measure against', () => {
  const master = [online('Widespread', 40)];
  assert.deepEqual(fraudulent(master, null), []);
  assert.deepEqual(fraudulent(master, { deckTotal: 0, found: new Map(), sets: new Set() }), []);
});

test('fraudulent mode renders nothing until the online window arrives', () => {
  assert.deepEqual(
    buildRenderModel({
      mode: 'fraudulent',
      size: 10,
      minDecks: 5,
      items: MASTER,
      onlineItems: null,
      eventField: field({ Alpha: 5 }) as never
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
