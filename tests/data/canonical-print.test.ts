import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chooseCanonicalPrint, type PrintVariation } from '../../shared/data/canonicalPrint.ts';

function print(set: string, number: string, price: number | null): PrintVariation {
  // eslint-disable-next-line camelcase -- price_usd mirrors the scraped print-table shape
  return { set, number, price_usd: price };
}

function choose(variations: PrintVariation[], cardName: string): [string, string] {
  const result = chooseCanonicalPrint(variations, cardName);
  assert.ok(result, 'expected a canonical print');
  return [result.set, result.number];
}

// Real print tables scraped from Limitless, chooser expectations agreed with Reese.
// Mirror of ChooseCanonicalPrintTests in .github/scripts/tests/test_download_tournament.py.
describe('chooseCanonicalPrint', () => {
  it('prefers the oldest cheap standard print for Pokemon', () => {
    // Dreepy: ASC 247 is a collector print; TWM is the oldest cheap legal print.
    const variations = [
      print('TWM', '128', 0.24),
      print('PRE', '071', 0.15),
      print('ASC', '158', 0.19),
      print('ASC', '247', 10.68)
    ];
    assert.deepEqual(choose(variations, 'Dreepy'), ['TWM', '128']);
  });

  it('excludes rotated prints', () => {
    // Boss's Orders: everything before MEG has rotated; ASC 256 is a secret rare.
    const variations = [
      print('SP', '251', 13.57),
      print('RCL', '154', 1.35),
      print('RCL', '189', 67.04),
      print('RCL', '200', 46.56),
      print('SHF', '058', 0.31),
      print('BRS', '132', 0.44),
      print('LOR', 'TG24', 10.96),
      print('PAL', '172', 0.32),
      print('PAL', '248', 11.18),
      print('PAL', '265', 19.95),
      print('MEG', '114', 0.25),
      print('ASC', '183', 0.23),
      print('ASC', '256', 8.05)
    ];
    assert.deepEqual(choose(variations, "Boss's Orders"), ['MEG', '114']);
  });

  it('takes a lone legal print regardless of age', () => {
    // Pokegear 3.0: only the Black Bolt print is still standard legal.
    const variations = [
      print('HS', '096', 11.78),
      print('UNB', '182B', 2.25),
      print('UNB', '182A', 26.99),
      print('UNB', '182', 0.95),
      print('UNB', '233', 47.12),
      print('SSH', '174', 0.34),
      print('SVI', '186', 0.32),
      print('BLK', '084', 0.29)
    ];
    assert.deepEqual(choose(variations, 'Pokegear 3.0'), ['BLK', '084']);
  });

  it('prefers the newest cheap print for basic energies', () => {
    // Fire Energy: gold prints (CRZ/OBF) and rotated sets drop out; the
    // newest cheap legal print (MEE) beats the SVE energy-set prints.
    const variations = [
      print('BS', '098', 0.37),
      print('EVO', '092', 0.29),
      print('SUM', 'R', 0.17),
      print('TEU', 'R', 0.14),
      print('SSH', 'R', 0.28),
      print('FST', '284', 6.34),
      print('BRS', 'R', null),
      print('CRZ', '153', 3.59),
      print('SVE', '002', 0.19),
      print('SVE', '010', 0.11),
      print('SVE', '018', 0.19),
      print('OBF', '230', 3.55),
      print('MEE', '002', 0.22)
    ];
    assert.deepEqual(choose(variations, 'Fire Energy'), ['MEE', '002']);
  });

  it('drops an expensive promo in favor of a cheap set print', () => {
    // Psyduck: the original Mega Promos print is priced out of reach, so
    // the accessible Ascended Heroes print is canonical despite being newer.
    const variations = [print('MEP', '007', 10.91), print('ASC', '039', 0.26), print('ASC', '226', 83.72)];
    assert.deepEqual(choose(variations, 'Psyduck'), ['ASC', '039']);
  });

  it('uses the most accessible promo for promo-only cards', () => {
    // Pecharunt: promo-only, so the cheap promo wins over the older one.
    const variations = [print('SVP', '129', 2.05), print('SVP', '149', 0.76)];
    assert.deepEqual(choose(variations, 'Pecharunt'), ['SVP', '149']);
  });

  it('keeps the original print canonical once it becomes affordable again', () => {
    // Poke Pad: the original ASC print settled back to a reasonable price,
    // so it beats the newer POR reprint; POR 113 is a collector print.
    const variations = [print('ASC', '198', 0.43), print('POR', '081', 0.3), print('POR', '113', 12.82)];
    assert.deepEqual(choose(variations, 'Poke Pad'), ['ASC', '198']);
  });

  it('strikes unpriced prints when priced alternatives exist', () => {
    const variations = [print('MEG', '050', null), print('ASC', '010', 0.3)];
    assert.deepEqual(choose(variations, 'Some Card'), ['ASC', '010']);
  });

  it('falls back to the oldest legal print when nothing has a price', () => {
    const variations = [print('MEG', '050', null), print('ASC', '010', null)];
    assert.deepEqual(choose(variations, 'Some Card'), ['MEG', '050']);
  });

  it('still picks a canonical for fully rotated cards', () => {
    const variations = [print('RCL', '154', 1.35), print('BRS', '132', 0.44)];
    assert.deepEqual(choose(variations, "Boss's Orders"), ['BRS', '132']);
  });
});
