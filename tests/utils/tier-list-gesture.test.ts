/**
 * tests/utils/tier-list-gesture.test.ts
 * The tier list's gesture split, on a stub DOM.
 *
 * One press has to resolve to exactly one thing. A press that never moves is a
 * tap — on a phone that picks the tile up for tap-to-place — and a press that
 * moves is a drag, which ends in a drop. The two cannot both fire, and this is
 * the reason taps are reported from the sortable at all rather than from a
 * `click` handler on the tile: a completed drag also ends in a click, on
 * whatever the tile was released over, so a page listening for clicks acts
 * twice on one gesture and drops the tile into a tier it was only passing over.
 *
 * The stub is deliberately the smallest document this module will run against:
 * a real one needs a browser, and the Playwright suites cover the parts that
 * do. Everything asserted here is gesture arithmetic, not layout.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { installItemSortable } from '../../src/lib/tierList/itemSortable';

interface StubNode {
  className: string;
  dataset: Record<string, string>;
  style: Record<string, string>;
  classList: { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean };
  parentNode: StubNode | null;
  nextSibling: StubNode | null;
  children: StubNode[];
  closest: (selector: string) => StubNode | null;
  getBoundingClientRect: () => {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  setParent: (parent: StubNode | null) => void;
  insertBefore: (child: StubNode, before: StubNode | null) => void;
  appendChild: (child: StubNode) => void;
  remove: () => void;
  setPointerCapture?: (id: number) => void;
  offsetWidth: number;
}

function node(className = ''): StubNode {
  const classes = new Set(className.split(' ').filter(Boolean));
  const self: StubNode = {
    className,
    dataset: {},
    style: {},
    classList: {
      add: c => void classes.add(c),
      remove: c => void classes.delete(c),
      contains: c => classes.has(c)
    },
    parentNode: null,
    nextSibling: null,
    children: [],
    // Only ever asked for `.tl-item`, `.tl-tools` and the like: a class match on
    // this node or its ancestors is the whole of the selector support needed.
    closest: selector => {
      const wanted = selector.replace('.', '');
      let cursor: StubNode | null = self;
      while (cursor) {
        if (cursor.classList.contains(wanted)) {
          return cursor;
        }
        cursor = cursor.parentNode;
      }
      return null;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 40, bottom: 40, width: 40, height: 40 }),
    setParent: parent => {
      self.parentNode = parent;
    },
    insertBefore: (child, before) => {
      child.setParent(self);
      const at = before ? self.children.indexOf(before) : self.children.length;
      self.children.splice(at < 0 ? self.children.length : at, 0, child);
    },
    appendChild: child => {
      child.setParent(self);
      self.children.push(child);
    },
    remove: () => {
      const at = self.parentNode?.children.indexOf(self) ?? -1;
      if (at >= 0) {
        self.parentNode!.children.splice(at, 1);
      }
      self.setParent(null);
    },
    setPointerCapture: () => {},
    offsetWidth: 40
  };
  return self;
}

/** A document holding one tile in one zone, plus the listeners the module adds. */
function stubDocument(): {
  tile: StubNode;
  fire: (type: string, event: Record<string, unknown>) => void;
  restore: () => void;
} {
  const zone = node('tl-zone');
  const tile = node('tl-item');
  tile.dataset.id = 'Dragapult';
  zone.appendChild(tile);
  const body = node('body');
  const listeners = new Map<string, ((event: unknown) => void)[]>();

  const doc = {
    body,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter(entry => entry !== fn)
      );
    },
    createElement: () => node(''),
    querySelectorAll: () => [] as StubNode[],
    querySelector: () => null
  };

  const previous = {
    document: globalThis.document,
    raf: globalThis.requestAnimationFrame,
    caf: globalThis.cancelAnimationFrame
  };
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  // Never fires: the frame loop is layout work, and nothing here asserts layout.
  Object.defineProperty(globalThis, 'requestAnimationFrame', { value: () => 1, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: () => {}, configurable: true, writable: true });

  return {
    tile,
    fire: (type, event) => {
      for (const fn of listeners.get(type) ?? []) {
        fn(event);
      }
    },
    restore: () => {
      Object.defineProperty(globalThis, 'document', { value: previous.document, configurable: true, writable: true });
      Object.defineProperty(globalThis, 'requestAnimationFrame', {
        value: previous.raf,
        configurable: true,
        writable: true
      });
      Object.defineProperty(globalThis, 'cancelAnimationFrame', {
        value: previous.caf,
        configurable: true,
        writable: true
      });
    }
  };
}

test('a press that never moves is reported as a tap, not a drop', () => {
  const dom = stubDocument();
  const taps: string[] = [];
  const drops: string[] = [];
  const uninstall = installItemSortable({
    onDrop: drop => drops.push(drop.itemId),
    onTap: id => taps.push(id)
  });

  dom.fire('pointerdown', { target: dom.tile, button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  dom.fire('pointerup', {});

  assert.deepEqual(taps, ['Dragapult']);
  assert.deepEqual(drops, []);
  uninstall();
  dom.restore();
});

test('a press within the threshold is still a tap — a finger never holds perfectly still', () => {
  const dom = stubDocument();
  const taps: string[] = [];
  const uninstall = installItemSortable({ onDrop: () => {}, onTap: id => taps.push(id) });

  dom.fire('pointerdown', { target: dom.tile, button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  dom.fire('pointermove', { clientX: 12, clientY: 11, preventDefault: () => {} });
  dom.fire('pointerup', {});

  assert.deepEqual(taps, ['Dragapult']);
  uninstall();
  dom.restore();
});

test('a press that becomes a drag is not also a tap', () => {
  const dom = stubDocument();
  const taps: string[] = [];
  const uninstall = installItemSortable({ onDrop: () => {}, onTap: id => taps.push(id) });

  dom.fire('pointerdown', { target: dom.tile, button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  dom.fire('pointermove', { clientX: 60, clientY: 90, preventDefault: () => {} });
  dom.fire('pointerup', {});

  assert.deepEqual(taps, []);
  uninstall();
  dom.restore();
});

test('a press on nothing draggable reports neither', () => {
  const dom = stubDocument();
  const taps: string[] = [];
  const uninstall = installItemSortable({ onDrop: () => {}, onTap: id => taps.push(id) });

  dom.fire('pointerdown', { target: node('tl-add'), button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  dom.fire('pointerup', {});

  assert.deepEqual(taps, []);
  uninstall();
  dom.restore();
});

test('a page that does not want taps is not handed any', () => {
  const dom = stubDocument();
  const uninstall = installItemSortable({ onDrop: () => {} });

  dom.fire('pointerdown', { target: dom.tile, button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  assert.doesNotThrow(() => dom.fire('pointerup', {}));

  uninstall();
  dom.restore();
});
