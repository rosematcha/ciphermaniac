/**
 * The export decisions a browser makes before any encoding starts.
 *
 * These are the numbers and names the page shows while the user is still
 * deciding — how many frames a loop will be, roughly how big the file lands,
 * what the download will be called — so getting them wrong misinforms someone
 * about a choice they cannot easily undo once they have waited a minute for it.
 *
 * Node has neither VideoEncoder nor MediaRecorder, which makes it exactly the
 * right place to check the "this browser cannot do video" path: it is the one
 * branch a browser test can never reach.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeVideoOutput,
  estimateGifBytes,
  gifFrameCount,
  pickAvcCodec,
  pickVideoType,
  videoExtension
} from '../../src/lib/cardWall/export.ts';

test('frame count follows the loop and the rate, and never degenerates', () => {
  assert.equal(gifFrameCount(10, 20), 200);
  assert.equal(gifFrameCount(3, 25), 75);
  assert.equal(gifFrameCount(2.5, 20), 50);
  // A GIF of one frame is a still image, so two is the floor however short the loop.
  assert.equal(gifFrameCount(0.01, 10), 2);
  assert.equal(gifFrameCount(0, 20), 2);
});

test('the size estimate scales with every term and rewards fewer colours', () => {
  const base = estimateGifBytes(100, 640, 360, 256);
  assert.equal(estimateGifBytes(200, 640, 360, 256), base * 2, 'twice the frames, twice the file');
  assert.ok(estimateGifBytes(100, 1280, 720, 256) > base * 3, 'four times the pixels');
  assert.ok(estimateGifBytes(100, 640, 360, 128) < base);
  assert.ok(estimateGifBytes(100, 640, 360, 64) < estimateGifBytes(100, 640, 360, 128));
  // Sanity against a real export: 20 frames at 640x360 and 128 colours measured
  // 2.26 MB, so the estimate should be the same order of magnitude.
  const measured = 2_256_877;
  const guess = estimateGifBytes(20, 640, 360, 128);
  assert.ok(guess > measured * 0.5 && guess < measured * 2, `estimate ${guess} is nowhere near ${measured}`);
});

test('the extension comes from the container, not the codec', () => {
  assert.equal(videoExtension('video/mp4;codecs=avc1.4d002a'), 'mp4');
  assert.equal(videoExtension('video/mp4'), 'mp4');
  assert.equal(videoExtension('video/webm;codecs=vp9'), 'webm');
  assert.equal(videoExtension('video/webm'), 'webm');
});

test('with no encoder and no recorder, video reports itself unavailable', async () => {
  assert.equal(typeof MediaRecorder, 'undefined', 'this test is only meaningful without one');
  assert.equal(pickVideoType(), null);
  assert.equal(await pickAvcCodec(640, 360, 30), null);
  // Null, rather than a guess the page would then promise the user.
  assert.equal(await describeVideoOutput(640, 360, 30), null);
});
