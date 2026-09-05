/**
 * tests/utils/printings.test.ts
 * Printings strip logic: cluster → annotated rows (page/cheapest/bling flags),
 * release order from the prints map, price sort, and the empty cases that hide
 * the section.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPrintingRows, formatPrintPrice } from '../../src/utils/printings.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';

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

test('builds rows in release order with the page flag and per-print prices', () => {
  const rows = buildPrintingRows(DB, 'Night Stretcher::SFA::061');
  assert.deepStrictEqual(
    rows.map(r => r.uid),
    ['Night Stretcher::SFA::061', 'Night Stretcher::SSP::251', 'Night Stretcher::MEG::173', 'Night Stretcher::ASC::196']
  );
  assert.deepStrictEqual(
    rows.map(r => r.isPage),
    [true, false, false, false]
  );
  assert.deepStrictEqual(
    rows.map(r => r.price),
    [0.27, 9.1, null, 0.25]
  );
});

test('marks the page print on a variant URL, including non-padded numbers', () => {
  const rows = buildPrintingRows(DB, 'Night Stretcher::ASC::196');
  assert.strictEqual(rows.find(r => r.isPage)?.uid, 'Night Stretcher::ASC::196');
  const loose = buildPrintingRows(DB, 'Night Stretcher::SFA::61');
  assert.strictEqual(loose.find(r => r.isPage)?.uid, 'Night Stretcher::SFA::061');
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
