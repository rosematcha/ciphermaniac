import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildToneCurve } from '../../src/lib/labelmaker/renderLabel';

/** A histogram built from a list of [luminance, pixelCount] pairs. */
function histOf(pairs: [number, number][]): { hist: Uint32Array; total: number } {
  const hist = new Uint32Array(256);
  let total = 0;
  for (const [g, n] of pairs) {
    hist[g]! += n;
    total += n;
  }
  return { hist, total };
}

/** Share of pixels that would print as solid ink, mirroring rasterize()'s cutoffs. */
function coverage(pairs: [number, number][]): number {
  const { hist, total } = histOf(pairs);
  const lut = buildToneCurve(hist, total);
  let ink = 0;
  for (const [g, n] of pairs) {
    // Midtones dither, so count them at their tone's ink fraction.
    ink += n * (1 - lut[g]! / 255);
  }
  return ink / total;
}

// An outline, a spread of body tones, and a highlight — the shape of a real
// sprite's histogram, just coarser.
function sprite(outline: number, bodyLo: number, bodyHi: number, highlight: number): [number, number][] {
  const pairs: [number, number][] = [[outline, 200]];
  for (let g = bodyLo; g <= bodyHi; g += 2) {
    pairs.push([g, 30]);
  }
  pairs.push([highlight, 100]);
  return pairs;
}

const dark = sprite(18, 34, 96, 190);
const pale = sprite(18, 150, 220, 250);

test('a dark sprite is lifted off the black cutoff', () => {
  const { hist, total } = histOf(dark);
  const lut = buildToneCurve(hist, total);
  assert.ok(lut[70]! > 64, `body tone ${lut[70]} should land in the dither band, not solid black`);
});

test('outlines still print solid black', () => {
  const { hist, total } = histOf(dark);
  assert.equal(buildToneCurve(hist, total)[18], 0);
});

test('dark and pale sprites land at a similar ink coverage', () => {
  // Not identical: the gamma clamp deliberately lets a genuinely dark sprite
  // stay the darker of the two rather than forcing every sprite to one density.
  assert.ok(Math.abs(coverage(dark) - coverage(pale)) < 0.2);
});

test('both sprite kinds sit near half coverage', () => {
  for (const sprite of [dark, pale]) {
    const c = coverage(sprite);
    assert.ok(c > 0.3 && c < 0.65, `coverage ${c.toFixed(2)} out of range`);
  }
});

test('the curve is monotonic', () => {
  const { hist, total } = histOf(dark);
  const lut = buildToneCurve(hist, total);
  for (let g = 1; g < 256; g++) {
    assert.ok(lut[g]! >= lut[g - 1]!);
  }
});

test('an empty sprite yields an identity curve', () => {
  const lut = buildToneCurve(new Uint32Array(256), 0);
  assert.equal(lut[0], 0);
  assert.equal(lut[128], 128);
  assert.equal(lut[255], 255);
});

test('a flat sprite is not stretched into noise', () => {
  const flat: [number, number][] = [[120, 1000]];
  const { hist, total } = histOf(flat);
  const lut = buildToneCurve(hist, total);
  assert.ok(lut[120]! > 0 && lut[120]! < 255);
});
