import test from 'node:test';
import assert from 'node:assert/strict';

import { LIST_MAX_HEIGHT, placeComboList } from '../../src/utils/comboListPlacement.ts';
import type { Rect } from '../../src/utils/hoverPreviewPlacement.ts';

const BAND = { top: 0, height: 800 };

function field(over: Partial<Rect> = {}): Rect {
  return { left: 300, top: 200, width: 400, height: 34, ...over };
}

test('hangs under the field, as wide as it, when there is room', () => {
  const p = placeComboList(field(), BAND);
  assert.equal(p.side, 'below');
  assert.equal(p.top, 200 + 34 + 4);
  assert.equal(p.left, 300);
  assert.equal(p.width, 400);
  assert.equal(p.maxHeight, LIST_MAX_HEIGHT);
});

test('turns upward for a field near the bottom, its bottom edge at the field', () => {
  const p = placeComboList(field({ top: 700 }), BAND);
  assert.equal(p.side, 'above');
  assert.equal(p.top, 700 - 4);
  assert.equal(p.maxHeight, LIST_MAX_HEIGHT);
});

test('stays under a field with less than a full list either way, if under is roomier', () => {
  const p = placeComboList(field({ top: 150 }), { top: 0, height: 400 });
  assert.equal(p.side, 'below');
  // 400 - 184 - 4 gap - 8 pad
  assert.equal(p.maxHeight, 204);
});

test('is held to the room above when it turns upward', () => {
  const p = placeComboList(field({ top: 250 }), { top: 0, height: 320 });
  assert.equal(p.side, 'above');
  // 250 - 4 gap - 8 pad
  assert.equal(p.maxHeight, 238);
});

test('measures from the visible band, not the top of the layout viewport', () => {
  // A phone keyboard: the band sits lower and shorter than the page.
  const p = placeComboList(field({ top: 500 }), { top: 300, height: 300 });
  assert.equal(p.side, 'above');
  // 500 - 300 - 4 - 8
  assert.equal(p.maxHeight, 188);
});

test('never asks for a negative height from a band with no room either side', () => {
  const p = placeComboList(field({ top: 10 }), { top: 0, height: 20 });
  assert.equal(p.maxHeight, 0);
});
