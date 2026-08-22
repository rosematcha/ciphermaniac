/**
 * A minimal MP4 muxer for a single H.264 track.
 *
 * WebCodecs hands back encoded AVC access units and a decoder configuration; it
 * does not put them in a container. This does, and nothing more: one video
 * track, constant frame duration, every sample in one chunk. That last choice
 * is what keeps the sample tables to a single entry each — the wall has no
 * audio to interleave with, so there is no reason to split the media into
 * chunks at all.
 *
 * Layout is ftyp / mdat / moov, with the index last. That is not streamable —
 * a player must read to the end before it can start — but this file is being
 * downloaded, not streamed, and writing the index last means sample offsets are
 * known by the time they have to be written rather than patched in afterwards.
 *
 * Pure bytes in, bytes out, so the box structure can be tested without a
 * browser or an encoder.
 * @module src/lib/cardWall/mp4
 */

/** One encoded frame. */
export interface Mp4Sample {
  data: Uint8Array;
  /** Whether this is a sync sample (IDR). Non-sync samples get listed in `stss`. */
  key: boolean;
}

export interface Mp4Input {
  width: number;
  height: number;
  /** Media timescale, in ticks per second. */
  timescale: number;
  /** Ticks each sample is displayed for. Constant — the wall renders at a fixed rate. */
  sampleDelta: number;
  samples: readonly Mp4Sample[];
  /** The `avcC` payload from `VideoEncoder`'s decoder config. */
  avcC: Uint8Array;
}

/** Movie-level timescale. Milliseconds, so durations read sensibly in a debugger. */
const MOVIE_TIMESCALE = 1000;

function u32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function u16(value: number): Uint8Array {
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i);
  }
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) {
    length += part.length;
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** `[size][type][payload]`, the shape every box in the file has. */
function box(type: string, ...payload: readonly Uint8Array[]): Uint8Array {
  const body = concat(payload);
  return concat([u32(body.length + 8), ascii(type), body]);
}

/** A box whose payload opens with a version byte and three flag bytes. */
function fullBox(type: string, version: number, flags: number, ...payload: readonly Uint8Array[]): Uint8Array {
  return box(type, new Uint8Array([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...payload);
}

/** The identity transform, which every mvhd and tkhd has to carry. */
const UNITY_MATRIX = concat([
  u32(0x00010000),
  u32(0),
  u32(0),
  u32(0),
  u32(0x00010000),
  u32(0),
  u32(0),
  u32(0),
  u32(0x40000000)
]);

function visualSampleEntry(width: number, height: number, avcC: Uint8Array): Uint8Array {
  const compressorName = new Uint8Array(32);
  return box(
    'avc1',
    new Uint8Array(6), // reserved
    u16(1), // data_reference_index
    u16(0), // pre_defined
    u16(0), // reserved
    new Uint8Array(12), // pre_defined
    u16(width),
    u16(height),
    u32(0x00480000), // 72dpi horizontal
    u32(0x00480000), // 72dpi vertical
    u32(0), // reserved
    u16(1), // frame_count
    compressorName,
    u16(0x0018), // depth
    u16(0xffff), // pre_defined
    box('avcC', avcC)
  );
}

function sampleTable(input: Mp4Input, mdatDataOffset: number): Uint8Array {
  const { samples } = input;
  const sizes = concat(samples.map(sample => u32(sample.data.length)));
  const syncIndexes: number[] = [];
  samples.forEach((sample, i) => {
    if (sample.key) {
      syncIndexes.push(i + 1); // sample numbers are 1-based
    }
  });

  const boxes: Uint8Array[] = [
    box('stsd', new Uint8Array([0, 0, 0, 0]), u32(1), visualSampleEntry(input.width, input.height, input.avcC)),
    // One run: every sample is displayed for the same number of ticks.
    fullBox('stts', 0, 0, u32(1), u32(samples.length), u32(input.sampleDelta)),
    // One chunk holding every sample, so this is a single mapping.
    fullBox('stsc', 0, 0, u32(1), u32(1), u32(samples.length), u32(1)),
    fullBox('stsz', 0, 0, u32(0), u32(samples.length), sizes),
    fullBox('stco', 0, 0, u32(1), u32(mdatDataOffset))
  ];
  // Omitted entirely when every sample is a sync sample, which is what the box's
  // absence means — listing them all would say the same thing at 4 bytes each.
  if (syncIndexes.length < samples.length) {
    boxes.splice(2, 0, fullBox('stss', 0, 0, u32(syncIndexes.length), concat(syncIndexes.map(u32))));
  }
  return box('stbl', ...boxes);
}

function movie(input: Mp4Input, mdatDataOffset: number): Uint8Array {
  const mediaDuration = input.samples.length * input.sampleDelta;
  const movieDuration = Math.round((mediaDuration / input.timescale) * MOVIE_TIMESCALE);

  const mvhd = fullBox(
    'mvhd',
    0,
    0,
    u32(0), // creation_time — left at zero, the file is not about when it was made
    u32(0), // modification_time
    u32(MOVIE_TIMESCALE),
    u32(movieDuration),
    u32(0x00010000), // rate 1.0
    u16(0x0100), // volume 1.0
    u16(0), // reserved
    u32(0),
    u32(0), // reserved
    UNITY_MATRIX,
    new Uint8Array(24), // pre_defined
    u32(2) // next_track_ID
  );

  // flags 0x7: enabled, in movie, in preview.
  const tkhd = fullBox(
    'tkhd',
    0,
    0x7,
    u32(0), // creation_time
    u32(0), // modification_time
    u32(1), // track_ID
    u32(0), // reserved
    u32(movieDuration),
    u32(0),
    u32(0), // reserved
    u16(0), // layer
    u16(0), // alternate_group
    u16(0), // volume — zero for video
    u16(0), // reserved
    UNITY_MATRIX,
    u32(input.width << 16), // 16.16 fixed point
    u32(input.height << 16)
  );

  const mdhd = fullBox(
    'mdhd',
    0,
    0,
    u32(0),
    u32(0),
    u32(input.timescale),
    u32(mediaDuration),
    u16(0x55c4), // 'und', packed five bits per letter
    u16(0)
  );

  const hdlr = fullBox('hdlr', 0, 0, u32(0), ascii('vide'), new Uint8Array(12), ascii('VideoHandler\0'));

  const minf = box(
    'minf',
    fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)),
    box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))),
    sampleTable(input, mdatDataOffset)
  );

  return box('moov', mvhd, box('trak', tkhd, box('mdia', mdhd, hdlr, minf)));
}

/**
 * Wrap encoded AVC samples in an MP4 container.
 * @param input - track geometry, timing, and the encoded samples
 * @returns the complete file
 */
export function buildMp4(input: Mp4Input): Uint8Array {
  if (input.samples.length === 0) {
    throw new Error('Cannot write an MP4 with no frames.');
  }
  const ftyp = box('ftyp', ascii('isom'), u32(0x200), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));
  const media = concat(input.samples.map(sample => sample.data));
  // Samples start 8 bytes into mdat, past its own size and type.
  const mdatDataOffset = ftyp.length + 8;
  return concat([ftyp, box('mdat', media), movie(input, mdatDataOffset)]);
}
