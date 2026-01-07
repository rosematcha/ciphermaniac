/**
 * tests/utils/tooltip.test.ts
 * Tests for src/utils/tooltip.ts - TooltipManager
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Create minimal DOM mocks for testing
let mockElements: Map<HTMLElement, HTMLElement | null> = new Map();
let appendedToBody: HTMLElement[] = [];

interface MockElement {
  className: string;
  innerHTML: string;
  id: string;
  style: Record<string, string>;
  remove: () => void;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => {
    width: number;
    height: number;
    top: number;
    left: number;
    right: number;
    bottom: number;
  };
  _attributes: Map<string, string>;
}

function createMockDocument(): void {
  mockElements = new Map();
  appendedToBody = [];

  // Mock window/document dimensions for viewport clamping
  // @ts-expect-error - mocking window
  globalThis.window = {
    innerWidth: 1024,
    innerHeight: 768
  };

  // @ts-expect-error - mocking document
  globalThis.document = {
    createElement: (tagName: string): MockElement => {
      const attributes = new Map<string, string>();
      const element: MockElement = {
        className: '',
        innerHTML: '',
        id: '',
        style: {},
        _attributes: attributes,
        setAttribute(name: string, value: string) {
          attributes.set(name, value);
        },
        getAttribute(name: string) {
          return attributes.get(name) || null;
        },
        getBoundingClientRect() {
          return { width: 100, height: 50, top: 0, left: 0, right: 100, bottom: 50 };
        },
        remove() {
          const idx = appendedToBody.indexOf(element as unknown as HTMLElement);
          if (idx !== -1) {
            appendedToBody.splice(idx, 1);
          }
        }
      };
      return element;
    },
    body: {
      appendChild: (element: HTMLElement): void => {
        appendedToBody.push(element);
      }
    },
    documentElement: {
      clientWidth: 1024,
      clientHeight: 768
    }
  };
}

function cleanupMockDocument(): void {
  // @ts-expect-error - cleaning up mock
  delete globalThis.document;
  // @ts-expect-error - cleaning up mock
  delete globalThis.window;
}

// ============================================================================
// createTooltipManager tests
// ============================================================================

test('tooltip: createTooltipManager returns manager with show, hide, destroy methods', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager();

  assert.strictEqual(typeof manager.show, 'function', 'should have show method');
  assert.strictEqual(typeof manager.hide, 'function', 'should have hide method');
  assert.strictEqual(typeof manager.destroy, 'function', 'should have destroy method');

  cleanupMockDocument();
});

test('tooltip: show() creates element and appends to body', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager();

  // Initially no elements
  assert.strictEqual(appendedToBody.length, 0, 'should start with no elements');

  manager.show('<p>Test</p>', 100, 200);

  assert.strictEqual(appendedToBody.length, 1, 'should append element to body');

  cleanupMockDocument();
});

test('tooltip: show() positions tooltip with 12px offset', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager();

  manager.show('<p>Test</p>', 100, 200);

  const element = appendedToBody[0] as unknown as MockElement;
  assert.strictEqual(element.style.left, '112px', 'left should be x + 12');
  assert.strictEqual(element.style.top, '212px', 'top should be y + 12');

  cleanupMockDocument();
});

test('tooltip: show() sets innerHTML correctly', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager();

  const html = '<strong>Tooltip Content</strong>';
  manager.show(html, 50, 50);

  const element = appendedToBody[0] as unknown as MockElement;
  assert.strictEqual(element.innerHTML, html, 'innerHTML should match');

  cleanupMockDocument();
});

test('tooltip: show() sets display to block', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager();

  manager.show('<p>Test</p>', 0, 0);

  const element = appendedToBody[0] as unknown as MockElement;
  assert.strictEqual(element.style.display, 'block', 'should set display to block');

  cleanupMockDocument();
});

test('tooltip: multiple show() calls reuse same element', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager();

  manager.show('<p>First</p>', 0, 0);
  manager.show('<p>Second</p>', 10, 20);
  manager.show('<p>Third</p>', 30, 40);

  assert.strictEqual(appendedToBody.length, 1, 'should only create one element');

  const element = appendedToBody[0] as unknown as MockElement;
  assert.strictEqual(element.innerHTML, '<p>Third</p>', 'should have last content');
  assert.strictEqual(element.style.left, '42px', 'should have last position');

  cleanupMockDocument();
});

test('tooltip: hide() sets display to none', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager();

  manager.show('<p>Test</p>', 0, 0);
  manager.hide();

  const element = appendedToBody[0] as unknown as MockElement;
  assert.strictEqual(element.style.display, 'none', 'should set display to none');

  cleanupMockDocument();
});

test('tooltip: hide() before show() does not throw', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager();

  // Should not throw
  assert.doesNotThrow(() => {
    manager.hide();
  }, 'hide before show should not throw');

  cleanupMockDocument();
});

test('tooltip: destroy() removes element from DOM', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager();

  manager.show('<p>Test</p>', 0, 0);
  assert.strictEqual(appendedToBody.length, 1, 'element should exist');

  manager.destroy();
  assert.strictEqual(appendedToBody.length, 0, 'element should be removed');

  cleanupMockDocument();
});

test('tooltip: destroy() before show() does not throw', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager();

  assert.doesNotThrow(() => {
    manager.destroy();
  }, 'destroy before show should not throw');

  cleanupMockDocument();
});

test('tooltip: show() after destroy() creates new element', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager();

  manager.show('<p>First</p>', 0, 0);
  manager.destroy();
  assert.strictEqual(appendedToBody.length, 0, 'element should be removed');

  manager.show('<p>Second</p>', 10, 20);
  assert.strictEqual(appendedToBody.length, 1, 'new element should be created');

  cleanupMockDocument();
});

test('tooltip: uses default className "graph-tooltip"', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager();

  manager.show('<p>Test</p>', 0, 0);

  const element = appendedToBody[0] as unknown as MockElement;
  assert.strictEqual(element.className, 'graph-tooltip', 'should use default className');

  cleanupMockDocument();
});

test('tooltip: uses custom className when provided', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager({ className: 'custom-tooltip' });

  manager.show('<p>Test</p>', 0, 0);

  const element = appendedToBody[0] as unknown as MockElement;
  assert.strictEqual(element.className, 'custom-tooltip', 'should use custom className');

  cleanupMockDocument();
});

test('tooltip: element has correct base styles', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager();

  manager.show('<p>Test</p>', 0, 0);

  const element = appendedToBody[0] as unknown as MockElement;
  // The cssText is set on creation, should contain fixed positioning
  assert.ok(element.style.cssText?.includes('position:fixed'), 'should have fixed position');
  assert.ok(element.style.cssText?.includes('pointer-events:none'), 'should have pointer-events:none');
  assert.ok(element.style.cssText?.includes('z-index:9999'), 'should have high z-index');

  cleanupMockDocument();
});

test('tooltip: handles zero coordinates', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager();

  manager.show('<p>Test</p>', 0, 0);

  const element = appendedToBody[0] as unknown as MockElement;
  assert.strictEqual(element.style.left, '12px', 'left should be 0 + 12');
  assert.strictEqual(element.style.top, '12px', 'top should be 0 + 12');

  cleanupMockDocument();
});

test('tooltip: handles negative coordinates', async t => {
  createMockDocument();

  const { createTooltipManager } = await import('../../src/utils/tooltip.js');
  const manager = createTooltipManager();

  manager.show('<p>Test</p>', -50, -100);

  const element = appendedToBody[0] as unknown as MockElement;
  assert.strictEqual(element.style.left, '-38px', 'left should be -50 + 12');
  assert.strictEqual(element.style.top, '-88px', 'top should be -100 + 12');

  cleanupMockDocument();
});
