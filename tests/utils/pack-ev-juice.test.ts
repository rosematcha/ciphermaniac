/**
 * The opener's pop-in, simulated from Balatro's juice and spring.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { juiceFrames, queueTilePaint, staggerDelay } from '../../src/pages/packEv/juice.ts';
import { countAt } from '../../src/pages/packEv/tween.ts';

function scaleOf(frame: Keyframe): number {
  return Number(/scale\(([-\d.]+)\)/u.exec(String(frame.transform))?.[1]);
}

test('a pop grows from nothing, overshoots, and lands at rest', () => {
  const { frames, duration } = juiceFrames({ scale: 0.11, rotation: 6, pop: true });
  assert.equal(duration, 500);
  assert.equal(frames.length, 31);
  assert.equal(scaleOf(frames[0]), 0);
  assert.equal(frames[0].opacity, 0);
  assert.ok(Math.max(...frames.slice(0, -1).map(scaleOf)) > 1.05);
  assert.deepEqual(frames.at(-1), { transform: 'none', opacity: 1 });
});

test('a bump dips first and never fades', () => {
  const { frames, duration } = juiceFrames({ scale: 0.1, rotation: -3, pop: false });
  assert.equal(duration, 400);
  assert.equal(scaleOf(frames[0]), 0.94);
  assert.ok(frames.every(frame => frame.opacity === 1));
});

test('stagger steps per tile and caps', () => {
  assert.equal(staggerDelay(0), 0);
  assert.equal(staggerDelay(2), 56);
  assert.equal(staggerDelay(500), 560);
});

test('a count starts fast, lands exactly, and never overshoots', () => {
  assert.equal(countAt(10, 20, 0), 10);
  assert.ok(countAt(10, 20, 0.5) > 15);
  assert.equal(countAt(10, 20, 1), 20);
  assert.equal(countAt(10, 20, 3), 20);
  assert.equal(countAt(20, 10, 1), 10);
});

test('tile paints share a frame, defer animation writes, and discard unmounted tiles', t => {
  let callback!: FrameRequestCallback;
  const frames: number[] = [];
  const cancelled: number[] = [];
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = paint => {
    callback = paint;
    frames.push(frames.length + 1);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = frame => {
    cancelled.push(frame);
  };
  t.after(() => {
    globalThis.requestAnimationFrame = originalRequest;
    globalThis.cancelAnimationFrame = originalCancel;
  });
  const painted: number[] = [];
  queueTilePaint(() => {
    painted.push(1);
  });
  const remove = queueTilePaint(() => {
    painted.push(2);
  });
  queueTilePaint(() => {
    painted.push(3);
  });
  assert.equal(painted.length, 0);
  assert.equal(frames.length, 1);
  remove();
  callback(0);
  assert.deepEqual(painted, [1, 3]);
  const stop = queueTilePaint(() => assert.fail('removed tile painted'));
  stop();
  assert.deepEqual(cancelled, []);
  queueTilePaint(() => {
    painted.push(4);
  });
  callback(16);
  assert.equal(frames.length, 2);
  assert.deepEqual(painted, [1, 3, 4]);
});
