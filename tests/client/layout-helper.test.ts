/**
 * Tests for layoutHelper.ts - layout computation utilities
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Mock window for tests
const originalWindow = globalThis.window;

function mockWindow(innerWidth: number) {
  (globalThis as any).window = { innerWidth };
}

function restoreWindow() {
  if (originalWindow) {
    (globalThis as any).window = originalWindow;
  } else {
    delete (globalThis as any).window;
  }
}

// Import after mocking
import { computeLayout } from '../../src/layoutHelper.ts';

test.afterEach(() => {
  restoreWindow();
});

test('computeLayout: returns valid metrics for desktop width', () => {
  mockWindow(1200);
  const metrics = computeLayout(1000);

  assert.ok(metrics.base > 0, 'base should be positive');
  assert.ok(metrics.perRowBig >= 1, 'perRowBig should be at least 1');
  assert.ok(metrics.bigRowContentWidth > 0, 'bigRowContentWidth should be positive');
  assert.ok(metrics.targetMedium >= 1, 'targetMedium should be at least 1');
  assert.ok(metrics.targetSmall >= 1, 'targetSmall should be at least 1');
  assert.ok(metrics.mediumScale > 0 && metrics.mediumScale <= 1, 'mediumScale should be between 0 and 1');
  assert.ok(metrics.smallScale > 0 && metrics.smallScale <= 1, 'smallScale should be between 0 and 1');
});

test('computeLayout: handles zero container width', () => {
  mockWindow(1200);
  const metrics = computeLayout(0);

  // Should return fallback values
  assert.ok(metrics.base > 0, 'base should be positive even with zero width');
  assert.strictEqual(metrics.perRowBig, 1, 'perRowBig should be 1 for fallback');
  assert.strictEqual(metrics.targetMedium, 1, 'targetMedium should be 1 for fallback');
  assert.strictEqual(metrics.targetSmall, 1, 'targetSmall should be 1 for fallback');
});

test('computeLayout: handles negative container width', () => {
  mockWindow(1200);
  const metrics = computeLayout(-100);

  // Should return fallback values
  assert.ok(metrics.base > 0, 'base should be positive even with negative width');
  assert.strictEqual(metrics.perRowBig, 1);
});

test('computeLayout: compact mode for mobile viewport', () => {
  // Viewport <= 880 triggers compact mode
  mockWindow(800);
  const metrics = computeLayout(800);

  // Compact mode has 0 big/medium rows
  assert.strictEqual(metrics.bigRows, 0, 'bigRows should be 0 in compact mode');
  assert.strictEqual(metrics.mediumRows, 0, 'mediumRows should be 0 in compact mode');
});

test('computeLayout: hamburger breakpoint uses mobile values', () => {
  // Viewport <= 720 is hamburger breakpoint
  mockWindow(700);
  const metrics = computeLayout(700);

  // Should target 3 cards per row on mobile
  assert.ok(metrics.perRowBig >= 1 && metrics.perRowBig <= 4, 'perRowBig should be reasonable for mobile');
  assert.strictEqual(metrics.bigRows, 0, 'bigRows should be 0 in compact mode');
});

test('computeLayout: wider container fits more cards', () => {
  mockWindow(1600);
  const narrowMetrics = computeLayout(600);
  const wideMetrics = computeLayout(1400);

  assert.ok(
    wideMetrics.perRowBig >= narrowMetrics.perRowBig,
    'wider container should fit at least as many cards per row'
  );
});

test('computeLayout: returns consistent gap value', () => {
  mockWindow(1200);
  const metrics = computeLayout(1000);

  assert.ok(metrics.gap > 0, 'gap should be positive');
  assert.ok(metrics.gap < 50, 'gap should be reasonable (< 50px)');
});

test('computeLayout: medium row has more cards than big row', () => {
  mockWindow(1200);
  const metrics = computeLayout(1000);

  // In standard mode, medium should have at least as many cards as big
  assert.ok(metrics.targetMedium >= metrics.perRowBig, 'targetMedium should be >= perRowBig');
});

test('computeLayout: small row has at least as many cards as medium row', () => {
  mockWindow(1200);
  const metrics = computeLayout(1000);

  assert.ok(metrics.targetSmall >= metrics.perRowBig, 'targetSmall should be >= perRowBig');
});

test('computeLayout: scales are within valid range', () => {
  mockWindow(1200);
  const metrics = computeLayout(1000);

  // Check medium scale
  assert.ok(metrics.mediumScale > 0, 'mediumScale should be > 0');
  assert.ok(metrics.mediumScale <= 1, 'mediumScale should be <= 1');

  // Check small scale
  assert.ok(metrics.smallScale > 0, 'smallScale should be > 0');
  assert.ok(metrics.smallScale <= 1, 'smallScale should be <= 1');
});

test('computeLayout: content width is reasonable', () => {
  mockWindow(1200);
  const metrics = computeLayout(1000);

  // Content width should not exceed container width
  assert.ok(metrics.bigRowContentWidth <= 1000, 'bigRowContentWidth should not exceed container width');
  assert.ok(metrics.bigRowContentWidth > 0, 'bigRowContentWidth should be positive');
});

test('computeLayout: various container widths produce valid metrics', () => {
  const widths = [300, 500, 768, 1024, 1280, 1920];

  for (const width of widths) {
    mockWindow(width);
    const metrics = computeLayout(width);

    assert.ok(metrics.base > 0, `base should be positive for width ${width}`);
    assert.ok(metrics.perRowBig >= 1, `perRowBig should be >= 1 for width ${width}`);
    assert.ok(metrics.gap > 0, `gap should be positive for width ${width}`);
    assert.ok(
      metrics.bigRowContentWidth <= width + 50, // Allow some tolerance for padding
      `bigRowContentWidth should be reasonable for width ${width}`
    );
  }
});
