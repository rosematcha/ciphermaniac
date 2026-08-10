import test from 'node:test';
import assert from 'node:assert/strict';

import { placeHoverPreview, type Rect } from '../../src/utils/hoverPreviewPlacement.ts';

const VIEWPORT = { width: 1280, height: 800 };
const PREVIEW = { width: 200, height: 279 };

function anchor(over: Partial<Rect> = {}): Rect {
  return { left: 500, top: 400, width: 160, height: 18, ...over };
}

test('sits above the anchor and centered on it when there is room', () => {
  const p = placeHoverPreview(anchor(), PREVIEW, VIEWPORT);
  assert.equal(p.side, 'above');
  // 400 - 10 gap - 279 height
  assert.equal(p.top, 111);
  // 500 + 80 - 100
  assert.equal(p.left, 480);
});

test('flips below when the anchor is near the top of the viewport', () => {
  const p = placeHoverPreview(anchor({ top: 40 }), PREVIEW, VIEWPORT);
  assert.equal(p.side, 'below');
  assert.equal(p.top, 40 + 18 + 10);
});

test('stays above when the anchor is near the bottom, clamped to the edge', () => {
  const p = placeHoverPreview(anchor({ top: 780 }), PREVIEW, VIEWPORT);
  assert.equal(p.side, 'above');
  assert.ok(p.top >= 8, 'must respect the top edge pad');
  assert.ok(p.top + PREVIEW.height <= VIEWPORT.height - 8, 'must not hang off the bottom');
});

test('clamps to the left viewport edge instead of centering', () => {
  const p = placeHoverPreview(anchor({ left: 4, width: 40 }), PREVIEW, VIEWPORT);
  assert.equal(p.left, 8);
});

test('clamps to the right viewport edge instead of centering', () => {
  const p = placeHoverPreview(anchor({ left: 1250, width: 40 }), PREVIEW, VIEWPORT);
  assert.equal(p.left, VIEWPORT.width - 8 - PREVIEW.width);
});

test('a preview taller than the viewport still lands inside it', () => {
  const tall = { width: 200, height: 900 };
  const p = placeHoverPreview(anchor(), tall, { width: 400, height: 500 });
  assert.equal(p.top, 8, 'clamps to the top pad rather than going negative');
  assert.ok(p.left >= 8);
});

test('prefers the side with more room when neither fits', () => {
  // Anchor near the top of a short viewport: below has more room.
  const short = { width: 1280, height: 320 };
  const p = placeHoverPreview(anchor({ top: 20 }), PREVIEW, short);
  assert.equal(p.side, 'below');
});
