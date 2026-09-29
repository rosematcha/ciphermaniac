/**
 * Tab inside a modal layer: focus wraps between its first and last controls,
 * comes back in from outside, and a layer with nothing to focus holds it.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { focusableIn, keepTabIn } from '../../src/lib/focusTrap.ts';

interface FakeElement {
  name: string;
  disabled?: boolean;
  focus: () => void;
  hasAttribute: (name: string) => boolean;
}

const doc = globalThis as unknown as { document?: { activeElement: unknown } };
afterEach(() => {
  delete doc.document;
});

function layer(names: string[]) {
  const focused: string[] = [];
  const nodes: FakeElement[] = names.map(name => ({
    name,
    disabled: name.startsWith('off'),
    focus: () => {
      focused.push(name);
      doc.document = { activeElement: nodes.find(n => n.name === name) };
    },
    hasAttribute(attribute: string) {
      return attribute === 'disabled' && this.disabled === true;
    }
  }));
  const root = {
    querySelectorAll: () => nodes,
    contains: (node: unknown) => nodes.includes(node as FakeElement)
  } as unknown as HTMLElement;
  return { root, nodes, focused };
}

function tab(shiftKey = false, key = 'Tab') {
  let prevented = false;
  return {
    event: { key, shiftKey, preventDefault: () => (prevented = true) } as unknown as KeyboardEvent,
    prevented: () => prevented
  };
}

test('only enabled controls count', () => {
  const { root } = layer(['close', 'off-save', 'name']);
  assert.deepEqual(
    focusableIn(root).map(node => (node as unknown as FakeElement).name),
    ['close', 'name']
  );
});

test('Tab from the last control wraps to the first, and Shift+Tab from the first to the last', () => {
  const { root, nodes, focused } = layer(['close', 'name', 'send']);
  doc.document = { activeElement: nodes[2] };
  const forward = tab();
  keepTabIn(root, forward.event);
  assert.equal(forward.prevented(), true);
  const back = tab(true);
  keepTabIn(root, back.event);
  assert.deepEqual(focused, ['close', 'send']);
});

test('Tab in the middle moves on as usual, and other keys pass through', () => {
  const { root, nodes, focused } = layer(['close', 'name', 'send']);
  doc.document = { activeElement: nodes[1] };
  const middle = tab();
  keepTabIn(root, middle.event);
  const enter = tab(false, 'Enter');
  keepTabIn(root, enter.event);
  assert.deepEqual([middle.prevented(), enter.prevented(), focused], [false, false, []]);
});

test('focus outside the layer comes back in', () => {
  const { root, focused } = layer(['close', 'send']);
  doc.document = { activeElement: { name: 'page behind' } };
  keepTabIn(root, tab().event);
  keepTabIn(root, tab(true).event);
  assert.deepEqual(focused, ['close', 'send']);
});

test('a layer with nothing to focus keeps Tab from leaving', () => {
  const { root } = layer([]);
  const pressed = tab();
  keepTabIn(root, pressed.event);
  assert.equal(pressed.prevented(), true);
});
