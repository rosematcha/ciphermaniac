/**
 * The hand-rolled GIF89a encoder.
 *
 * Tested by decoding what it writes: the container is walked block by block and
 * each frame's LZW stream is inflated by an independent decoder written here,
 * because "the file looks about the right size" catches none of the ways a
 * bitstream can be subtly wrong. The encoder was also round-tripped through
 * libvips during development — including a noisy 1280x720 frame, which is what
 * forces the dictionary past 4096 codes and into a reset.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPalette,
  createColorCache,
  createGifWriter,
  lzwCompress,
  quantizeFrame,
  samplePixels
} from '../../src/lib/cardWall/gif.ts';

/** GIF's LZW, decoded from scratch. Deliberately not sharing code with the encoder. */
function lzwDecode(bytes: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let dict: number[][] = [];
  let codeSize = minCodeSize + 1;
  const reset = () => {
    dict = [];
    for (let i = 0; i < clearCode; i++) {
      dict.push([i]);
    }
    dict.push([], []);
    codeSize = minCodeSize + 1;
  };
  reset();

  const out: number[] = [];
  let bitPos = 0;
  let previous: number[] | null = null;
  const readCode = (): number | null => {
    let value = 0;
    for (let i = 0; i < codeSize; i++) {
      const byte = bytes[(bitPos >> 3) | 0];
      if (byte === undefined) {
        return null;
      }
      value |= ((byte >> (bitPos & 7)) & 1) << i;
      bitPos += 1;
    }
    return value;
  };

  for (;;) {
    const code = readCode();
    if (code === null || code === endCode) {
      return out;
    }
    if (code === clearCode) {
      reset();
      previous = null;
      continue;
    }
    let entry: number[];
    if (code < dict.length && dict[code]!.length > 0) {
      entry = dict[code]!;
    } else {
      assert.ok(previous, 'first code after a clear must be in the dictionary');
      entry = [...previous, previous[0]!];
    }
    out.push(...entry);
    if (previous) {
      dict.push([...previous, entry[0]!]);
      if (dict.length === 1 << codeSize && codeSize < 12) {
        codeSize += 1;
      }
    }
    previous = entry;
  }
}

interface ParsedFrame {
  width: number;
  height: number;
  delayCs: number;
  indices: number[];
}

interface ParsedGif {
  width: number;
  height: number;
  paletteSize: number;
  loops: number | null;
  frames: ParsedFrame[];
}

/** Walk the container, so structural mistakes surface as parse failures. */
function parseGif(bytes: Uint8Array): ParsedGif {
  const text = (at: number, len: number) => String.fromCharCode(...bytes.subarray(at, at + len));
  assert.equal(text(0, 6), 'GIF89a');
  const short = (at: number) => bytes[at]! | (bytes[at + 1]! << 8);
  const width = short(6);
  const height = short(8);
  const packed = bytes[10]!;
  assert.equal(packed & 0x80, 0x80, 'a global colour table must be flagged');
  const paletteSize = 1 << ((packed & 0x07) + 1);
  let at = 13 + paletteSize * 3;

  const frames: ParsedFrame[] = [];
  let loops: number | null = null;
  let pendingDelay = 0;

  const skipSubBlocks = (from: number): { end: number; data: Uint8Array } => {
    const parts: number[] = [];
    let cursor = from;
    while (bytes[cursor] !== 0) {
      const len = bytes[cursor]!;
      parts.push(...bytes.subarray(cursor + 1, cursor + 1 + len));
      cursor += 1 + len;
    }
    return { end: cursor + 1, data: Uint8Array.from(parts) };
  };

  while (at < bytes.length) {
    const marker = bytes[at]!;
    if (marker === 0x3b) {
      assert.equal(at, bytes.length - 1, 'the trailer must be the last byte');
      break;
    }
    if (marker === 0x21) {
      const label = bytes[at + 1]!;
      if (label === 0xf9) {
        assert.equal(bytes[at + 2], 4, 'graphic control blocks are 4 bytes');
        pendingDelay = short(at + 4);
        at = skipSubBlocks(at + 3 + 4).end;
      } else if (label === 0xff) {
        assert.equal(text(at + 3, 11), 'NETSCAPE2.0');
        const sub = skipSubBlocks(at + 14);
        loops = sub.data[1]! | (sub.data[2]! << 8);
        at = sub.end;
      } else {
        at = skipSubBlocks(at + 2).end;
      }
      continue;
    }
    assert.equal(marker, 0x2c, `unexpected block 0x${marker.toString(16)}`);
    const fw = short(at + 5);
    const fh = short(at + 7);
    assert.equal(bytes[at + 9]! & 0x80, 0, 'frames should reuse the global colour table');
    const minCodeSize = bytes[at + 10]!;
    const sub = skipSubBlocks(at + 11);
    frames.push({ width: fw, height: fh, delayCs: pendingDelay, indices: lzwDecode(sub.data, minCodeSize) });
    at = sub.end;
  }
  return { width, height, paletteSize, loops, frames };
}

test('LZW survives a round trip, including a dictionary that fills up', () => {
  const cases: Uint8Array[] = [
    Uint8Array.from([0]),
    Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1]),
    Uint8Array.from(Array.from({ length: 4096 }, (_, i) => i % 7)),
    // Pseudo-random bytes push past 4096 dictionary entries and force a reset.
    (() => {
      let s = 42;
      return Uint8Array.from(
        Array.from({ length: 90_000 }, () => {
          s = (s * 1664525 + 1013904223) >>> 0;
          return s >>> 24;
        })
      );
    })()
  ];
  for (const input of cases) {
    const compressed = lzwCompress(input, 8);
    // Sub-blocks are stripped the same way a decoder would strip them.
    const payload: number[] = [];
    let at = 0;
    while (compressed[at] !== 0) {
      const len = compressed[at]!;
      payload.push(...compressed.subarray(at + 1, at + 1 + len));
      at += 1 + len;
    }
    const decoded = lzwDecode(Uint8Array.from(payload), 8);
    assert.deepEqual(decoded.slice(0, input.length), Array.from(input), `round trip failed at ${input.length} bytes`);
  }
});

test('a palette is a power of two, capped at 256, and lands on the colours given', () => {
  const colours = [
    [244, 236, 219],
    [26, 24, 22],
    [224, 123, 74],
    [58, 106, 82]
  ];
  const samples = new Uint8Array(colours.length * 200 * 3);
  for (let i = 0; i < colours.length * 200; i++) {
    const c = colours[i % colours.length]!;
    samples.set(c, i * 3);
  }
  const palette = buildPalette(samples, 256);
  assert.equal(palette.size, 1 << palette.bits);
  assert.ok(palette.size <= 256);
  assert.equal(palette.rgb.length, palette.size * 3);
  for (const [r, g, b] of colours) {
    const found = Array.from({ length: palette.size }, (_, i) => i).some(i => {
      const dr = Math.abs(palette.rgb[i * 3]! - r!);
      const dg = Math.abs(palette.rgb[i * 3 + 1]! - g!);
      const db = Math.abs(palette.rgb[i * 3 + 2]! - b!);
      return dr <= 1 && dg <= 1 && db <= 1;
    });
    assert.ok(found, `no palette entry near ${r},${g},${b}`);
  }
});

test('a single-colour source still produces a legal colour table', () => {
  const samples = new Uint8Array(300);
  samples.fill(200);
  const palette = buildPalette(samples, 256);
  assert.ok(palette.bits >= 1);
  assert.equal(palette.size, 1 << palette.bits);
});

test('quantizing snaps pixels to their nearest palette entry', () => {
  const samples = Uint8Array.from([0, 0, 0, 255, 255, 255]);
  const palette = buildPalette(samples, 2);
  const cache = createColorCache();
  const rgba = new Uint8ClampedArray([10, 10, 10, 255, 240, 240, 240, 255]);
  const indices = quantizeFrame(rgba, palette, cache);
  assert.equal(indices.length, 2);
  assert.notEqual(indices[0], indices[1]);
  const dark = palette.rgb[indices[0]! * 3]!;
  const light = palette.rgb[indices[1]! * 3]!;
  assert.ok(dark < light);
});

test('the encoder writes a looping animation whose frames decode back to their indices', () => {
  const width = 24;
  const height = 16;
  const samples = Uint8Array.from([0, 0, 0, 255, 255, 255, 224, 123, 74, 58, 106, 82]);
  const palette = buildPalette(samples, 8);
  const writer = createGifWriter(width, height, palette);
  const expected: number[][] = [];
  for (let f = 0; f < 3; f++) {
    const indices = new Uint8Array(width * height);
    for (let i = 0; i < indices.length; i++) {
      indices[i] = (i + f) % palette.size;
    }
    expected.push(Array.from(indices));
    writer.addFrame(indices, 4 + f);
  }
  const parsed = parseGif(writer.finish());

  assert.equal(parsed.width, width);
  assert.equal(parsed.height, height);
  assert.equal(parsed.paletteSize, palette.size);
  assert.equal(parsed.loops, 0, 'zero means loop forever');
  assert.equal(parsed.frames.length, 3);
  parsed.frames.forEach((frame, f) => {
    assert.equal(frame.width, width);
    assert.equal(frame.height, height);
    assert.equal(frame.delayCs, 4 + f);
    assert.deepEqual(frame.indices.slice(0, width * height), expected[f]);
  });
});

test('delays below the renderable floor are lifted, not written as-is', () => {
  const palette = buildPalette(Uint8Array.from([0, 0, 0, 255, 255, 255]), 2);
  const writer = createGifWriter(4, 4, palette);
  writer.addFrame(new Uint8Array(16), 0);
  writer.addFrame(new Uint8Array(16), 1);
  const parsed = parseGif(writer.finish());
  assert.deepEqual(
    parsed.frames.map(f => f.delayCs),
    [2, 2]
  );
});

test('sampling thins a frame down to RGB triples', () => {
  const rgba = new Uint8ClampedArray(1000 * 4);
  for (let i = 0; i < 1000; i++) {
    rgba[i * 4] = i % 256;
    rgba[i * 4 + 1] = 128;
    rgba[i * 4 + 2] = 64;
    rgba[i * 4 + 3] = 255;
  }
  const sampled = samplePixels(rgba, 100);
  assert.equal(sampled.length % 3, 0);
  assert.ok(sampled.length / 3 <= 110, 'roughly the requested count');
  assert.ok(sampled.length / 3 >= 90);
  assert.equal(sampled[1], 128);
  assert.equal(sampled[2], 64);
});
