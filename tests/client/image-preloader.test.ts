import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DESKTOP_EAGER_PRELOAD_COUNT,
  getEagerPreloadLimitForViewport,
  MOBILE_EAGER_PRELOAD_COUNT,
  shouldUseSmPreloadVariantForViewport
} from '../../src/render/images/preloader.ts';

test('preloader uses mobile eager cap on narrow viewport widths', () => {
  const eagerCount = getEagerPreloadLimitForViewport(375);
  assert.strictEqual(eagerCount, MOBILE_EAGER_PRELOAD_COUNT);
  assert.strictEqual(shouldUseSmPreloadVariantForViewport(375), false);
});

test('preloader uses desktop eager cap on wide viewport widths', () => {
  const eagerCount = getEagerPreloadLimitForViewport(1280);
  assert.strictEqual(eagerCount, DESKTOP_EAGER_PRELOAD_COUNT);
  assert.strictEqual(shouldUseSmPreloadVariantForViewport(1280), true);
});
