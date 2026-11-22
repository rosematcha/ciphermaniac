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
  exportFileName,
  type RenderItem,
  shortTournament,
  splitPartner,
  statsAreClose,
  thumbUrl
} from '../../src/pages/socialGraphics/model.ts';
import { buildEventField, type EventField } from '../../src/pages/socialGraphics/eventField.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';
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

test('thumbnails load same-origin, which is what keeps the export canvas untainted', () => {
  assert.equal(thumbUrl('svi', 181), '/thumbnails/lg/SVI/181');
});

test('an export is named in plain ASCII, accents folded to their base letter', () => {
  const selection = { mode: 'standard', size: 20, theme: 'light' } as const;
  assert.equal(
    exportFileName({ tournament: '2026-11-20, International Championship São Paulo', ...selection }, 'png'),
    'international-championship-sao-paulo-standard-top20-light.png'
  );
});

test('a Legendary stadium shows both of its prints, any other card one', () => {
  assert.equal(splitPartner('DLR', '094'), '095');
  assert.equal(splitPartner('dlr', '098'), '099');
  assert.equal(splitPartner('DLR', '095'), null);
  assert.equal(splitPartner('SVI', '094'), null);
});

test('a tournament label drops its date prefix', () => {
  assert.equal(shortTournament('2026-05-08, Regional Championship LA'), 'Regional Championship LA');
  assert.equal(shortTournament('Online - Last 14 Days'), 'Online events');
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

test('a pre-evolution collapses into its evolution only when their stats are close', () => {
  const cases = [
    // Rellor 37% / Rabsca 35%: the only reason to play Rellor is to reach Rabsca.
    ['close usage', [row('Rellor', 37), row('Rabsca', 35)], 'standard', ['Rabsca']],
    // A 30-point gap means the pre-evo is doing something on its own.
    ['far apart on usage', [row('Rellor', 60), row('Rabsca', 20)], 'standard', ['Rellor', 'Rabsca']],
    // Rising mode compares deltas rather than usage.
    ['close deltas', [row('Rellor', 5, { delta: 3 }), row('Rabsca', 40, { delta: 4 })], 'rising', ['Rabsca']],
    [
      'far apart on deltas',
      [row('Rellor', 5, { delta: 1 }), row('Rabsca', 40, { delta: 20 })],
      'rising',
      ['Rellor', 'Rabsca']
    ]
  ] as const;
  for (const [name, rows, mode, expected] of cases) {
    const out = collapseEvolutions([...rows], EVO_MAP, mode);
    assert.deepEqual(
      out.map(r => r.name),
      expected,
      name
    );
  }
});

test('the close-stats bands are 5 points on usage and 2 on deltas', () => {
  assert.equal(statsAreClose(row('a', 30), row('b', 35), 'standard'), true);
  assert.equal(statsAreClose(row('a', 30), row('b', 36), 'standard'), false);
  assert.equal(statsAreClose(row('a', 0, { delta: 3 }), row('b', 0, { delta: 5 }), 'rising'), true);
  assert.equal(statsAreClose(row('a', 0, { delta: 3 }), row('b', 0, { delta: 6 }), 'rising'), false);
});

test('nothing collapses without both halves of a pair and a map naming them', () => {
  assert.equal(collapseEvolutions([row('Rabsca', 35)], EVO_MAP, 'standard').length, 1, 'no pre-evo in the list');
  const rows = [row('Rellor', 37), row('Rabsca', 35)];
  assert.equal(collapseEvolutions(rows, undefined, 'standard').length, 2, 'no map');
  assert.equal(collapseEvolutions(rows, new Map(), 'standard').length, 2, 'empty map');
});

// ---------------------------------------------------------------------------
// Mode selection
// ---------------------------------------------------------------------------

const MASTER = [
  item('Alpha', 90),
  item('Beta', 80, { uid: 'Beta::SVI::002' }),
  item('Energy', 70, { set: 'SVE' }),
  item('Psychic Energy', 60, { set: 'MEE', uid: 'Psychic Energy::MEE::005', category: 'energy/basic' })
];

test('standard mode ranks the master report from one, minus basic energy', () => {
  const out = buildRenderModel({ mode: 'standard', size: 10, minDecks: 5, items: MASTER });
  assert.deepEqual(
    out.map(r => r.name),
    ['Alpha', 'Beta']
  );
  assert.deepEqual(
    out.map(r => r.rank),
    [1, 2]
  );
});

function baselineField(deckTotal: number, found: Record<string, number>, sets = ['SVI']): EventField {
  return {
    deckTotal,
    cards: new Map(Object.entries(found)),
    sets: new Set(sets)
  };
}

test('rising joins event-date prints and includes older prints before a reprint set appeared', () => {
  const prints = [
    ['Dudunsparce', 'TEF', '129', 'PRE', '080'],
    ['Prime Catcher', 'TEF', '157', 'PRE', '119'],
    ['Dunsparce', 'PRE', '079', 'TEF', '128']
  ];
  const synonyms = Object.fromEntries(
    prints.map(([name, set, number, canonicalSet, canonicalNumber]) => [
      `${name}::${set}::${number}`,
      `${name}::${canonicalSet}::${canonicalNumber}`
    ])
  );
  const db = { synonyms, canonicals: {} } as SynonymDatabase;
  const items = prints.map(([name, set, number]) =>
    item(name, 28, {
      set,
      number,
      uid: `${name}::${set}::${number}`,
      found: 28,
      total: 100
    })
  );
  const priorItems = prints.map(([name, , , set, number]) =>
    item(name, 25, {
      set,
      number,
      uid: `${name}::${set}::${number}`,
      found: 25,
      total: 100
    })
  );
  const baseline = [buildEventField({ deckTotal: 100, items: priorItems }, db)];
  const out = buildRenderModel({ mode: 'rising', size: 10, minDecks: 5, items, baseline });
  assert.equal(out.length, 3);
  for (const row of out) {
    assert.equal(row.delta, 3, `${row.name} must compare against 25%, not zero`);
    assert.equal(row.set, items.find(candidate => candidate.name === row.name)?.set);
  }
  const olderField = buildEventField({ deckTotal: 100, items: [items[0]] }, db);
  const reprint = { ...priorItems[0], found: 30, pct: 30 };
  const reprintOut = buildRenderModel({
    mode: 'rising',
    size: 10,
    minDecks: 5,
    items: [reprint],
    baseline: [olderField]
  });
  assert.equal(olderField.sets.has('PRE'), false);
  assert.ok(
    Math.abs((reprintOut[0]?.delta ?? 0) - 2) < 1e-10,
    'an older played print establishes legality before the reprint set'
  );
});

test('rising mode lists only cards that gained over the pooled baseline, biggest gain first', () => {
  const out = buildRenderModel({
    mode: 'rising',
    size: 10,
    minDecks: 5,
    items: MASTER,
    // Alpha: 95 of 100 pooled decks; Beta: 40 of 100.
    baseline: [
      baselineField(75, { 'Alpha::SVI::001': 70, 'Beta::SVI::002': 30 }),
      baselineField(25, { 'Alpha::SVI::001': 25, 'Beta::SVI::002': 10 })
    ]
  });
  assert.deepEqual(
    out.map(r => r.name),
    ['Beta'],
    'Alpha fell, so it is not rising'
  );
  assert.equal(out[0].delta, 40);
});

test('rising mode skips cards whose set was legal at no baseline event', () => {
  const out = buildRenderModel({
    mode: 'rising',
    size: 10,
    minDecks: 5,
    items: MASTER,
    baseline: [baselineField(100, { 'Other::PAL::001': 10 }, ['PAL'])]
  });
  assert.deepEqual(out, []);
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
    { uid: 'a', name: 'Basic', set: 'SVE', number: '1', conversion: 99, day1Count: 50, day2Count: 49 },
    {
      uid: 'Psychic Energy::MEE::005',
      name: 'Psychic Energy',
      set: 'MEE',
      number: '005',
      conversion: 98,
      day1Count: 50,
      day2Count: 49
    }
  ] as never;
  assert.deepEqual(
    buildRenderModel({ mode: 'converting', size: 10, minDecks: 5, items: MASTER, day2Stats: stats }),
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
    buildRenderModel({ mode: 'rising', size: 10, minDecks: 5, items: MASTER, baseline: null }),
    [],
    'rising needs the baseline events'
  );
  assert.deepEqual(
    buildRenderModel({ mode: 'converting', size: 10, minDecks: 5, items: MASTER, day2Stats: null }),
    [],
    'converting needs the day-2 stats'
  );
});

test('evolution collapsing still lets the list reach the requested size', () => {
  // The pool overcollects, so dropping a pre-evo does not leave a short graphic.
  const many = Array.from({ length: 12 }, (_, i) =>
    item(`Card${i}`, 90 - i, { uid: `Card${i}::SVI::${i}`, number: String(i) })
  );
  // Card1 evolves from Card0, one point apart: Card0 is collapsed away.
  const evolutionMap = new Map([['SVI::1', 'card0']]);
  const out = buildRenderModel({ mode: 'standard', size: 8, minDecks: 5, items: many, evolutionMap });
  assert.equal(out.length, 8);
  assert.equal(out[0].name, 'Card1');
});
