/**
 * A GIF89a encoder, written here rather than pulled in.
 *
 * The wall only needs one narrow case — a fixed-size animation with a single
 * global palette and no frame differencing — and every off-the-shelf encoder
 * ships a worker, a quantizer, and a codec path far past that. This is the
 * subset, in about the size of the dependency's README.
 *
 * Two passes, because the palette has to be global but the frames are far too
 * large to hold in memory at once: sample a handful of frames to build the
 * palette, then render each frame again, index it, encode it, and drop it.
 * @module src/lib/cardWall/gif
 */

/** GIF's hard ceiling, and what the format's largest code size buys you. */
const MAX_COLORS = 256;
/** Colour cache key precision. 5 bits per channel is 32k buckets — one Int16Array. */
const CACHE_BITS = 5;
const CACHE_SIZE = 1 << (CACHE_BITS * 3);
const CACHE_SHIFT = 8 - CACHE_BITS;

export interface Palette {
  /** RGB triples, `size * 3` bytes long. */
  rgb: Uint8Array;
  /** Entry count. Always a power of two, so it can be a GIF colour table. */
  size: number;
  /** log2(size), which is what the header encodes. */
  bits: number;
}

interface Box {
  start: number;
  end: number;
  channel: number;
  range: number;
}

function boxExtent(
  samples: Uint8Array,
  order: Uint32Array,
  start: number,
  end: number
): { channel: number; range: number } {
  const lo = [255, 255, 255];
  const hi = [0, 0, 0];
  for (let i = start; i < end; i++) {
    const base = order[i]! * 3;
    for (let c = 0; c < 3; c++) {
      const v = samples[base + c]!;
      if (v < lo[c]!) {
        lo[c] = v;
      }
      if (v > hi[c]!) {
        hi[c] = v;
      }
    }
  }
  // Weighted toward green, which is where the eye resolves the most detail —
  // splitting on raw range spends colours on blue gradients nobody can see.
  const spread = [(hi[0]! - lo[0]!) * 0.9, (hi[1]! - lo[1]!) * 1.2, (hi[2]! - lo[2]!) * 0.7];
  let channel = 0;
  if (spread[1]! > spread[channel]!) {
    channel = 1;
  }
  if (spread[2]! > spread[channel]!) {
    channel = 2;
  }
  return { channel, range: spread[channel]! };
}

/**
 * Median-cut palette over sampled pixels.
 * @param samples - RGB triples
 * @param maxColors - upper bound, rounded up to a power of two
 * @returns A GIF-shaped colour table
 */
export function buildPalette(samples: Uint8Array, maxColors = MAX_COLORS): Palette {
  const count = Math.floor(samples.length / 3);
  const limit = Math.max(2, Math.min(MAX_COLORS, maxColors));
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    order[i] = i;
  }

  const boxes: Box[] = count > 0 ? [{ start: 0, end: count, ...boxExtent(samples, order, 0, count) }] : [];
  while (boxes.length > 0 && boxes.length < limit) {
    let pick = -1;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!;
      if (box.end - box.start > 1 && box.range > 0 && (pick === -1 || box.range > boxes[pick]!.range)) {
        pick = i;
      }
    }
    if (pick === -1) {
      break;
    }
    const box = boxes[pick]!;
    const { channel } = box;
    // Sorting a copy of the slice keeps the shared `order` buffer contiguous
    // without an in-place partition that would need its own median selection.
    const slice = Array.from(order.subarray(box.start, box.end));
    slice.sort((a, b) => samples[a * 3 + channel]! - samples[b * 3 + channel]!);
    order.set(slice, box.start);
    const mid = box.start + ((box.end - box.start) >> 1);
    boxes.splice(
      pick,
      1,
      { start: box.start, end: mid, ...boxExtent(samples, order, box.start, mid) },
      { start: mid, end: box.end, ...boxExtent(samples, order, mid, box.end) }
    );
  }

  const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, boxes.length))));
  const size = 1 << bits;
  const rgb = new Uint8Array(size * 3);
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]!;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let j = box.start; j < box.end; j++) {
      const base = order[j]! * 3;
      r += samples[base]!;
      g += samples[base + 1]!;
      b += samples[base + 2]!;
    }
    const n = Math.max(1, box.end - box.start);
    rgb[i * 3] = Math.round(r / n);
    rgb[i * 3 + 1] = Math.round(g / n);
    rgb[i * 3 + 2] = Math.round(b / n);
  }
  return { rgb, size, bits };
}

/** A reusable nearest-colour cache. Kept across frames — the wall's palette never changes. */
export function createColorCache(): Int16Array {
  return new Int16Array(CACHE_SIZE).fill(-1);
}

/**
 * Map RGBA pixels onto palette indices, nearest colour, alpha ignored (the
 * stage always paints an opaque background).
 */
export function quantizeFrame(rgba: Uint8ClampedArray, palette: Palette, cache: Int16Array): Uint8Array {
  const pixels = Math.floor(rgba.length / 4);
  const out = new Uint8Array(pixels);
  const { rgb, size } = palette;
  for (let p = 0; p < pixels; p++) {
    const r = rgba[p * 4]!;
    const g = rgba[p * 4 + 1]!;
    const b = rgba[p * 4 + 2]!;
    const key = ((r >> CACHE_SHIFT) << (CACHE_BITS * 2)) | ((g >> CACHE_SHIFT) << CACHE_BITS) | (b >> CACHE_SHIFT);
    let index = cache[key]!;
    if (index < 0) {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < size; i++) {
        const dr = r - rgb[i * 3]!;
        const dg = g - rgb[i * 3 + 1]!;
        const db = b - rgb[i * 3 + 2]!;
        const dist = dr * dr * 3 + dg * dg * 4 + db * db * 2;
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      index = best;
      cache[key] = best;
    }
    out[p] = index;
  }
  return out;
}

/** Growable byte sink. */
function createBytes() {
  let buf = new Uint8Array(1 << 16);
  let len = 0;
  const ensure = (extra: number) => {
    if (len + extra <= buf.length) {
      return;
    }
    let next = buf.length * 2;
    while (next < len + extra) {
      next *= 2;
    }
    const grown = new Uint8Array(next);
    grown.set(buf.subarray(0, len));
    buf = grown;
  };
  return {
    byte(value: number) {
      ensure(1);
      buf[len] = value & 0xff;
      len += 1;
    },
    short(value: number) {
      ensure(2);
      buf[len] = value & 0xff;
      buf[len + 1] = (value >> 8) & 0xff;
      len += 2;
    },
    bytes(values: ArrayLike<number>) {
      ensure(values.length);
      buf.set(values as Uint8Array, len);
      len += values.length;
    },
    ascii(text: string) {
      ensure(text.length);
      for (let i = 0; i < text.length; i++) {
        buf[len + i] = text.charCodeAt(i);
      }
      len += text.length;
    },
    take(): Uint8Array {
      return buf.slice(0, len);
    },
    get length() {
      return len;
    }
  };
}

type Bytes = ReturnType<typeof createBytes>;

/**
 * LZW-compress indices into GIF sub-blocks (a length byte then up to 255 bytes,
 * terminated by a zero length).
 */
export function lzwCompress(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const out = createBytes();
  const block = new Uint8Array(255);
  let blockLen = 0;
  let bitBuffer = 0;
  let bitCount = 0;

  const flushBlock = () => {
    if (blockLen > 0) {
      out.byte(blockLen);
      out.bytes(block.subarray(0, blockLen));
      blockLen = 0;
    }
  };
  const pushByte = (value: number) => {
    block[blockLen] = value;
    blockLen += 1;
    if (blockLen === 255) {
      flushBlock();
    }
  };

  let codeSize = minCodeSize + 1;
  const write = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      pushByte(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  let dict = new Map<number, number>();
  let next = endCode + 1;
  const reset = () => {
    dict = new Map<number, number>();
    next = endCode + 1;
    codeSize = minCodeSize + 1;
  };

  write(clearCode);
  let prefix = indices.length > 0 ? indices[0]! : -1;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!;
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    write(prefix);
    if (next < 4096) {
      dict.set(key, next);
      next += 1;
      // The decoder grows its code size one entry EARLIER than the encoder adds
      // it, so the test is against the code just assigned, not the next free one.
      if (next - 1 === 1 << codeSize && codeSize < 12) {
        codeSize += 1;
      }
    } else {
      write(clearCode);
      reset();
    }
    prefix = k;
  }
  if (prefix >= 0) {
    write(prefix);
  }
  write(endCode);
  if (bitCount > 0) {
    pushByte(bitBuffer & 0xff);
  }
  flushBlock();
  out.byte(0);
  return out.take();
}

function writeHeader(out: Bytes, width: number, height: number, palette: Palette): void {
  out.ascii('GIF89a');
  out.short(width);
  out.short(height);
  // Global colour table present, 8-bit colour resolution, unsorted, size 2^(bits).
  out.byte(0x80 | 0x70 | (palette.bits - 1));
  out.byte(0);
  out.byte(0);
  out.bytes(palette.rgb);
  // NETSCAPE2.0 application extension: loop forever.
  out.byte(0x21);
  out.byte(0xff);
  out.byte(0x0b);
  out.ascii('NETSCAPE2.0');
  out.byte(0x03);
  out.byte(0x01);
  out.short(0);
  out.byte(0);
}

export interface GifWriter {
  addFrame(indices: Uint8Array, delayCs: number): void;
  finish(): Uint8Array;
}

/** Start a GIF. Frames are appended as they are encoded, never buffered as pixels. */
export function createGifWriter(width: number, height: number, palette: Palette): GifWriter {
  const out = createBytes();
  writeHeader(out, width, height, palette);
  const minCodeSize = Math.max(2, palette.bits);
  return {
    addFrame(indices, delayCs) {
      // Graphic control extension: no disposal, no transparency, just a delay.
      out.byte(0x21);
      out.byte(0xf9);
      out.byte(0x04);
      out.byte(0x00);
      out.short(Math.max(2, Math.round(delayCs)));
      out.byte(0);
      out.byte(0);
      // Image descriptor: full frame, no local colour table, not interlaced.
      out.byte(0x2c);
      out.short(0);
      out.short(0);
      out.short(width);
      out.short(height);
      out.byte(0);
      out.byte(minCodeSize);
      out.bytes(lzwCompress(indices, minCodeSize));
    },
    finish() {
      out.byte(0x3b);
      return out.take();
    }
  };
}

/**
 * Pull an evenly spread RGB sample out of a frame, for palette building.
 * @param rgba - one frame's pixels
 * @param target - roughly how many pixels to keep
 */
export function samplePixels(rgba: Uint8ClampedArray, target: number): Uint8Array {
  const pixels = Math.floor(rgba.length / 4);
  const stride = Math.max(1, Math.floor(pixels / Math.max(1, target)));
  const kept = Math.ceil(pixels / stride);
  const out = new Uint8Array(kept * 3);
  let w = 0;
  for (let p = 0; p < pixels; p += stride) {
    out[w] = rgba[p * 4]!;
    out[w + 1] = rgba[p * 4 + 1]!;
    out[w + 2] = rgba[p * 4 + 2]!;
    w += 3;
  }
  return out.subarray(0, w);
}
