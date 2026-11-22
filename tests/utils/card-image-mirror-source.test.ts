/**
 * The R2 mirror's source per tier: Limitless's pre-sized PNG for the sets it
 * carries, pokemontcg.io's scan resized to the tier for the vintage sets it
 * lacks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  graphRefs,
  mayPrune,
  mirrorable,
  printRefs,
  PRINTS_KEY,
  readyMarker,
  stripInventory,
  tierSource,
  unconvertedPrints
} from '../../scripts/cardImageSource.ts';
import { buildAttempts, imageKey, paddedNumber, printOnR2From } from '../../src/components/cardImage/sources.ts';

test('a set on the Limitless CDN mirrors its pre-sized tier as is', () => {
  assert.deepEqual(tierSource('SVI', '181', 'SM'), {
    urls: ['https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVI/SVI_181_R_EN_SM.png'],
    width: null
  });
});

test('a vintage set mirrors the pokemontcg.io scan, resized to the Limitless tier width', () => {
  const scans = ['https://images.pokemontcg.io/ex7/19_hires.png', 'https://images.pokemontcg.io/ex7/19.png'];
  assert.deepEqual(tierSource('TRR', '019', 'XS'), { urls: scans, width: 136 });
  assert.deepEqual(tierSource('TRR', '019', 'SM'), { urls: scans, width: 274 });
  assert.deepEqual(tierSource('TRR', '019', 'LG'), { urls: scans, width: 460 });
});

test('a newly mapped POP series set no longer falls through to the Limitless CDN', () => {
  assert.equal(tierSource('P4', '010', 'LG').urls[0], 'https://images.pokemontcg.io/pop4/10_hires.png');
});

test('the printings list yields every printing, and nothing when it is not a printings list', () => {
  assert.deepEqual(printRefs({ prints: { 'Porygon-Z::Kind::X::TEF::161': 1 } }), [{ set: 'TEF', number: '161' }]);
  assert.deepEqual(printRefs({ prints: { 'Iono::PAL::185': 0.25, 'Iono::PAL::269': 12, bad: 1 } }), [
    { set: 'PAL', number: '185' },
    { set: 'PAL', number: '269' }
  ]);
  for (const payload of [null, [], { prints: [] }, { prints: 'x' }, {}]) {
    assert.equal(printRefs(payload), null, JSON.stringify(payload));
  }
});

test('the mirror converts gallery and suffixed printings under the keys the browser asks for', () => {
  for (const [set, number, expected] of [
    ['LOR', 'TG24', 'LOR_TG24'],
    ['UNB', '182A', 'UNB_182a'],
    ['PRE', '37', 'PRE_037'],
    ['SUM', 'P', 'SUM_P']
  ]) {
    assert.ok(mirrorable(set, number), `${set} ${number}`);
    const key = `card-images/${set}/${set}_${paddedNumber(number)}_R_EN_XS.webp`;
    assert.ok(key.includes(expected), key);
    assert.ok(buildAttempts(set, number, 'xs', 'r2')[0].endsWith(key), buildAttempts(set, number, 'xs', 'r2')[0]);
  }
  assert.equal(mirrorable('LOR', 'TG24A1'), false);
});

test('the ready marker claims every printing only when the staged printings list was read', () => {
  assert.equal(PRINTS_KEY, 'assets/card-prints.json', 'staging, which the next release captures');
  assert.deepEqual(readyMarker(5, null, ['B_002', 'A_001']), {
    cards: 5,
    prints: false,
    unmirrored: ['A_001', 'B_002']
  });
  const prints = printRefs({ prints: { 'Iono::PAL::185': 0.25 } });
  assert.deepEqual(readyMarker(5, prints, []), { cards: 5, prints: true, unmirrored: [] });
  assert.equal(readyMarker(5, printRefs({ prints: [] }), []).prints, false);
});

test('art is pruned only after a clean run that read the printings list', () => {
  const prints = printRefs({ prints: { 'Iono::PAL::185': 0.25 } });
  assert.equal(mayPrune(0, prints), true);
  assert.equal(mayPrune(0, null), false);
  assert.equal(mayPrune(1, prints), false);
});

test('the strip loads a printing from R2 only when the marker covers it, whatever the suffix case', () => {
  const readiness = { prints: true, unmirrored: new Set([imageKey('UNB', '182A')]) };
  assert.equal(imageKey('unb', '182a'), 'UNB_182a');
  assert.equal(printOnR2From(readiness, 'UNB', '182A'), false);
  assert.equal(printOnR2From(readiness, 'UNB', '182a'), false);
  assert.equal(printOnR2From(readiness, 'SUM', 'P'), true);
  assert.equal(printOnR2From({ ...readiness, prints: false }, 'SUM', 'P'), false);
});

test('printings the mirror will not convert are listed under the key the browser asks for', () => {
  const prints = [
    { set: 'SUM', number: 'P' },
    { set: 'LOR', number: 'TG24A1' },
    { set: 'UNB', number: '182A' }
  ];
  assert.deepEqual(unconvertedPrints(prints, imageKey), ['LOR_TG24A1']);
});

test('printings only the synonym graph names are mirrored too', () => {
  const graph = { synonyms: { 'Grass Energy::SVE::017': 'Grass Energy::MEE::001', bad: 3 } };
  assert.deepEqual(graphRefs(graph), [
    { set: 'SVE', number: '017' },
    { set: 'MEE', number: '001' }
  ]);
  assert.equal(graphRefs(null), null);
  assert.ok((graphRefs(graph) ?? []).every(ref => mirrorable(ref.set, ref.number)));
});

test('coverage needs both inventories, so an unreadable graph cannot get graph-only art pruned', () => {
  const prints = { prints: { 'Grass Energy::SVI::001': 1 } };
  const graph = { synonyms: { 'Grass Energy::SVE::017': 'Grass Energy::SVI::001' } };
  assert.equal(stripInventory(prints, graph).covered?.length, 3);
  assert.equal(stripInventory(prints, undefined).covered, null);
  assert.equal(stripInventory(undefined, graph).covered, null);
  assert.equal(mayPrune(0, stripInventory(prints, undefined).covered), false);
  assert.deepEqual(stripInventory(prints, undefined).strip, [{ set: 'SVI', number: '001' }]);
});
