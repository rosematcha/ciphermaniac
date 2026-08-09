import test from 'node:test';
import assert from 'node:assert/strict';

import { dimsForLabel, mmToDots, PRINTERS } from '../../src/lib/labelmaker/printers.ts';

test('mmToDots converts and rounds to whole dots', () => {
  // 25.4mm is exactly one inch, so it must land on the dpi exactly.
  assert.strictEqual(mmToDots(25.4, 300), 300);
  assert.strictEqual(mmToDots(25.4, 203), 203);
  // 62mm at 300dpi is 732.28… — the nominal figure the QL series does NOT print.
  assert.strictEqual(mmToDots(62, 300), 732);
});

test('dimsForLabel prefers the explicit dot overrides over the nominal size', () => {
  // The Brother 62mm tape only prints 696 of its nominal 732 dots. Deriving the
  // width from mm instead would overflow the printable area by 36 dots and clip
  // the label's right edge — hence the override, and hence this test.
  const ql800 = PRINTERS.find(p => p.id === 'ql800');
  assert.ok(ql800, 'ql800 preset missing');
  const dk1209 = ql800.labels.find(l => l.id === 'dk1209');
  assert.ok(dk1209, 'DK-1209 label missing');

  const dims = dimsForLabel(ql800.dpi, dk1209);
  assert.strictEqual(dims.wDots, 696);
  assert.strictEqual(dims.hDots, 271);
  // Physical size and dpi pass through untouched — they drive the @page rule.
  assert.deepStrictEqual({ wMm: dims.wMm, hMm: dims.hMm, dpi: dims.dpi }, { wMm: 62, hMm: 29, dpi: 300 });
});

test('dimsForLabel derives dots from mm when no override is given', () => {
  // DYMO and Zebra presets carry no dot overrides — their geometry is computed.
  const zebra = PRINTERS.find(p => p.id === 'zebra203');
  assert.ok(zebra, 'zebra203 preset missing');
  const twoByOne = zebra.labels.find(l => l.id === 'z5125');
  assert.ok(twoByOne, 'z5125 label missing');

  const dims = dimsForLabel(zebra.dpi, twoByOne);
  // 50.8mm x 25.4mm = 2in x 1in at 203dpi.
  assert.strictEqual(dims.wDots, 406);
  assert.strictEqual(dims.hDots, 203);
});

test('every printer preset has at least one label and a sane dpi', () => {
  assert.ok(PRINTERS.length > 0);
  for (const printer of PRINTERS) {
    assert.ok(printer.labels.length > 0, `${printer.id} has no labels`);
    assert.ok(printer.dpi >= 72, `${printer.id} has an implausible dpi`);
    // Label ids are used as <select> values and must be unique within a printer.
    const ids = printer.labels.map(l => l.id);
    assert.strictEqual(new Set(ids).size, ids.length, `${printer.id} has duplicate label ids`);
  }
});
