/**
 * The card page's rail pin: a rail taller than the window pins by its bottom
 * edge, one that fits keeps the stylesheet's offset, and stopping restores it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { pinReachable } from '../../src/lib/stickyRail.ts';

type Listener = () => void;

/** Stand in for the window and ResizeObserver the helper measures against. */
function browser(innerHeight: number) {
  const listeners = new Set<Listener>();
  let observed: Listener | null = null;
  let disconnected = false;
  const g = globalThis as { window?: unknown; ResizeObserver?: unknown };
  const prev = { window: g.window, ResizeObserver: g.ResizeObserver };
  g.window = {
    innerHeight,
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn)
  };
  g.ResizeObserver = class {
    constructor(fn: Listener) {
      observed = fn;
    }
    observe() {
      // The helper observes the rail right away; nothing to record here.
    }
    disconnect() {
      disconnected = true;
    }
  };
  return {
    resize(height: number) {
      (g.window as { innerHeight: number }).innerHeight = height;
      listeners.forEach(fn => fn());
    },
    railGrew: () => observed?.(),
    listening: () => listeners.size,
    disconnected: () => disconnected,
    restore() {
      g.window = prev.window;
      g.ResizeObserver = prev.ResizeObserver;
    }
  };
}

const rail = (offsetHeight: number) => ({ offsetHeight, style: { top: '' } }) as unknown as HTMLElement;

test('a rail that fits keeps the stylesheet offset', () => {
  const b = browser(900);
  try {
    const el = rail(600);
    pinReachable(el, () => 65);
    assert.equal(el.style.top, '');
  } finally {
    b.restore();
  }
});

test('a rail taller than the window pins by its bottom edge', () => {
  const b = browser(760);
  try {
    const el = rail(800);
    pinReachable(el, () => 65);
    // 800 + 65 + 16 - 760 = 121 of overflow, so top moves up from 65 to -56.
    assert.equal(el.style.top, '-56px');
    b.resize(1000);
    assert.equal(el.style.top, '', 'a taller window lets it pin by the top again');
    (el as unknown as { offsetHeight: number }).offsetHeight = 1200;
    b.railGrew();
    assert.equal(el.style.top, '-216px', 'a rail that grows re-measures');
  } finally {
    b.restore();
  }
});

test('stopping restores the offset and drops the listeners', () => {
  const b = browser(500);
  try {
    const el = rail(800);
    const stop = pinReachable(el, () => 65);
    assert.notEqual(el.style.top, '');
    stop();
    assert.equal(el.style.top, '');
    assert.equal(b.listening(), 0);
    assert.equal(b.disconnected(), true);
  } finally {
    b.restore();
  }
});
