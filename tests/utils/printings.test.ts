/**
 * tests/utils/printings.test.ts
 * Printings strip logic: cluster → annotated rows (page/cheapest/bling flags),
 * release order from the prints map, price sort, and the empty cases that hide
 * the section.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPrintingRows, formatPrintPrice, sortPrintings } from '../../src/utils/printings.ts';
import type { SynonymDatabase } from '../../shared/synonyms.ts';

// prints keys are in scrape (release) order: SFA → SSP → MEG → ASC.
const DB: SynonymDatabase = {
  synonyms: {
    'Night Stretcher::ASC::196': 'Night Stretcher::SFA::061',
    'Night Stretcher::MEG::173': 'Night Stretcher::SFA::061',
    'Night Stretcher::SSP::251': 'Night Stretcher::SFA::061'
  },
  canonicals: { 'Night Stretcher': 'Night Stretcher::SFA::061' },
  prints: {
    'Night Stretcher::SFA::061': 0.27,
    'Night Stretcher::SSP::251': 9.1,
    'Night Stretcher::MEG::173': null,
    'Night Stretcher::ASC::196': 0.25
  }
};

test('builds rows in release order with page/cheapest/bling flags', () => {
  const rows = buildPrintingRows(DB, 'Night Stretcher::SFA::061');
  assert.deepStrictEqual(
    rows.map(r => r.uid),
    ['Night Stretcher::SFA::061', 'Night Stretcher::SSP::251', 'Night Stretcher::MEG::173', 'Night Stretcher::ASC::196']
  );
  assert.strictEqual(rows[0].isPage, true);
  assert.strictEqual(rows[2].price, null);
  assert.strictEqual(rows.find(r => r.isCheapest)?.uid, 'Night Stretcher::ASC::196');
  assert.strictEqual(rows.find(r => r.isBling)?.uid, 'Night Stretcher::SSP::251');
});

test('marks the page print on a variant URL, including non-padded numbers', () => {
  const rows = buildPrintingRows(DB, 'Night Stretcher::ASC::196');
  assert.strictEqual(rows.find(r => r.isPage)?.uid, 'Night Stretcher::ASC::196');
  const loose = buildPrintingRows(DB, 'Night Stretcher::SFA::61');
  assert.strictEqual(loose.find(r => r.isPage)?.uid, 'Night Stretcher::SFA::061');
});

test('price sort is ascending with unpriced prints last, and does not mutate', () => {
  const rows = buildPrintingRows(DB, 'Night Stretcher::SFA::061');
  const byPrice = sortPrintings(rows, 'price');
  assert.deepStrictEqual(
    byPrice.map(r => r.number),
    ['196', '061', '251', '173']
  );
  // original release order untouched
  assert.strictEqual(rows[0].number, '061');
  assert.deepStrictEqual(
    sortPrintings(rows, 'oldest').map(r => r.number),
    rows.map(r => r.number)
  );
});

test('bling is not set when every print costs the same', () => {
  const flat: SynonymDatabase = {
    synonyms: { 'Ultra Ball::PAF::091': 'Ultra Ball::SVI::196' },
    canonicals: {},
    prints: { 'Ultra Ball::SVI::196': 0.1, 'Ultra Ball::PAF::091': 0.1 }
  };
  const rows = buildPrintingRows(flat, 'Ultra Ball::SVI::196');
  assert.strictEqual(rows.filter(r => r.isCheapest).length, 1);
  assert.strictEqual(rows.filter(r => r.isBling).length, 0);
});

test('returns [] for single-print clusters, name-only uids, and missing prints map', () => {
  assert.deepStrictEqual(buildPrintingRows(DB, 'Rare Candy::SVI::191'), []);
  assert.deepStrictEqual(buildPrintingRows(DB, 'Night Stretcher'), []);
  assert.deepStrictEqual(buildPrintingRows({ synonyms: DB.synonyms, canonicals: {} }, 'Night Stretcher::SFA::061'), []);
  assert.deepStrictEqual(buildPrintingRows(null, 'Night Stretcher::SFA::061'), []);
});

test('formatPrintPrice renders cents or an em dash', () => {
  assert.strictEqual(formatPrintPrice(0.25), '$0.25');
  assert.strictEqual(formatPrintPrice(183.76), '$183.76');
  assert.strictEqual(formatPrintPrice(null), '—');
});
