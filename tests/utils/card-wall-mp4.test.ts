/**
 * The MP4 muxer.
 *
 * Walked back apart box by box, because an MP4 that is structurally wrong still
 * downloads fine and only fails when somebody tries to play it — which, for an
 * export tool, is the worst possible place to find out. The sample tables are
 * where the real risk lives: a wrong chunk offset or sample count produces a
 * file that opens and shows nothing.
 *
 * Output from this muxer was also checked with ffprobe during development,
 * which reported the expected codec, dimensions and duration.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMp4, type Mp4Sample } from '../../src/lib/cardWall/mp4.ts';

interface Box {
  type: string;
  start: number;
  size: number;
  /** Payload, after the 8-byte size and type header. */
  body: Uint8Array;
}

/** Split a byte range into the boxes it contains, without descending. */
function boxesIn(bytes: Uint8Array, from = 0, to = bytes.length): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + at);
    const size = view.getUint32(0);
    assert.ok(size >= 8, `box at ${at} declares an impossible size ${size}`);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    out.push({ type, start: at, size, body: bytes.subarray(at + 8, at + size) });
    at += size;
  }
  assert.equal(at, to, 'boxes must tile their container exactly');
  return out;
}

function find(boxes: Box[], type: string): Box {
  const hit = boxes.find(b => b.type === type);
  assert.ok(hit, `expected a ${type} box, saw ${boxes.map(b => b.type).join(',')}`);
  return hit;
}

/** Descend a path of box types, e.g. 'moov/trak/mdia'. */
function descend(bytes: Uint8Array, path: string): Box {
  let boxes = boxesIn(bytes);
  let box = find(boxes, path.split('/')[0]!);
  for (const step of path.split('/').slice(1)) {
    boxes = boxesIn(box.body);
    box = find(boxes, step);
  }
  return box;
}

function u32At(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset);
}

const AVCC = Uint8Array.from([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 1, 2, 3, 1, 0, 3, 0x68, 4, 5]);

function samplesOf(sizes: readonly number[], keyEvery = 1): Mp4Sample[] {
  return sizes.map((size, i) => ({ data: new Uint8Array(size).fill(i + 1), key: i % keyEvery === 0 }));
}

function input(overrides: Partial<Parameters<typeof buildMp4>[0]> = {}) {
  return buildMp4({
    width: 640,
    height: 360,
    timescale: 90_000,
    sampleDelta: 3000,
    samples: samplesOf([120, 90, 80, 95]),
    avcC: AVCC,
    ...overrides
  });
}

test('the file opens with an ftyp and the boxes tile it exactly', () => {
  const bytes = input();
  const boxes = boxesIn(bytes);
  assert.deepEqual(
    boxes.map(b => b.type),
    ['ftyp', 'mdat', 'moov']
  );
  assert.equal(String.fromCharCode(...boxes[0]!.body.subarray(0, 4)), 'isom');
});

test('mdat holds the samples back to back, and stco points at the first one', () => {
  const sizes = [120, 90, 80, 95];
  const bytes = input({ samples: samplesOf(sizes) });
  const mdat = find(boxesIn(bytes), 'mdat');
  assert.equal(
    mdat.body.length,
    sizes.reduce((a, b) => a + b, 0)
  );
  // Each sample was filled with its own index, so the boundaries are checkable.
  let at = 0;
  sizes.forEach((size, i) => {
    assert.equal(mdat.body[at], i + 1, `sample ${i} does not start where the table says`);
    at += size;
  });

  const stco = descend(bytes, 'moov/trak/mdia/minf/stbl/stco');
  assert.equal(u32At(stco.body, 4), 1, 'one chunk');
  const offset = u32At(stco.body, 8);
  assert.equal(offset, mdat.start + 8, 'the chunk must start past mdat s own header');
  assert.equal(bytes[offset], 1, 'and land on the first sample');
});

test('the sample tables agree with the samples', () => {
  const sizes = [120, 90, 80, 95];
  const bytes = input({ samples: samplesOf(sizes) });
  const stbl = boxesIn(descend(bytes, 'moov/trak/mdia/minf/stbl').body);

  const stsz = find(stbl, 'stsz');
  assert.equal(u32At(stsz.body, 4), 0, 'a zero default size means per-sample sizes follow');
  assert.equal(u32At(stsz.body, 8), sizes.length);
  sizes.forEach((size, i) => assert.equal(u32At(stsz.body, 12 + i * 4), size));

  const stts = find(stbl, 'stts');
  assert.equal(u32At(stts.body, 4), 1, 'one run, since every frame lasts the same');
  assert.equal(u32At(stts.body, 8), sizes.length);
  assert.equal(u32At(stts.body, 12), 3000);

  const stsc = find(stbl, 'stsc');
  assert.equal(u32At(stsc.body, 4), 1);
  assert.equal(u32At(stsc.body, 8), 1, 'first chunk');
  assert.equal(u32At(stsc.body, 12), sizes.length, 'holding every sample');
});

test('an all-keyframe track omits stss, and a mixed one lists its sync samples', () => {
  const allKey = boxesIn(descend(input(), 'moov/trak/mdia/minf/stbl').body);
  assert.equal(
    allKey.find(b => b.type === 'stss'),
    undefined,
    'no stss is how the format says every sample is a sync sample'
  );

  const mixed = input({ samples: samplesOf([100, 100, 100, 100, 100, 100], 3) });
  const stss = descend(mixed, 'moov/trak/mdia/minf/stbl/stss');
  assert.equal(u32At(stss.body, 4), 2);
  // Sample numbers are 1-based, so keyframes at index 0 and 3 are samples 1 and 4.
  assert.equal(u32At(stss.body, 8), 1);
  assert.equal(u32At(stss.body, 12), 4);
});

test('the sample entry carries the dimensions and the decoder config', () => {
  const bytes = input({ width: 1280, height: 720 });
  const stsd = descend(bytes, 'moov/trak/mdia/minf/stbl/stsd');
  const avc1 = find(boxesIn(stsd.body, 8, stsd.body.length), 'avc1');
  const view = new DataView(avc1.body.buffer, avc1.body.byteOffset);
  assert.equal(view.getUint16(24), 1280, 'width');
  assert.equal(view.getUint16(26), 720, 'height');
  const avcC = find(boxesIn(avc1.body, 78, avc1.body.length), 'avcC');
  assert.deepEqual(Array.from(avcC.body), Array.from(AVCC));
});

test('durations follow from the frame count, in both timescales', () => {
  // 4 samples at 3000/90000 ticks is 4 frames at 30fps: a third of a second.
  const bytes = input();
  const mdhd = descend(bytes, 'moov/trak/mdia/mdhd');
  assert.equal(u32At(mdhd.body, 12), 90_000, 'media timescale');
  assert.equal(u32At(mdhd.body, 16), 12_000, 'media duration in media ticks');

  const mvhd = descend(bytes, 'moov/mvhd');
  assert.equal(u32At(mvhd.body, 12), 1000, 'movie timescale');
  assert.equal(u32At(mvhd.body, 16), 133, 'movie duration in milliseconds');
});

test('the track header states the display size as 16.16 fixed point', () => {
  const tkhd = descend(input({ width: 1920, height: 1080 }), 'moov/trak/tkhd');
  assert.equal(u32At(tkhd.body, 76) >>> 16, 1920);
  assert.equal(u32At(tkhd.body, 80) >>> 16, 1080);
});

test('a track with no frames is refused rather than written empty', () => {
  assert.throws(() => input({ samples: [] }), /no frames/i);
});
