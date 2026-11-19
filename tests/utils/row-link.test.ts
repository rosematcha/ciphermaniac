import assert from 'node:assert/strict';
import test from 'node:test';

import { followRowLink } from '../../src/lib/rowLink';

interface Click {
  insideControl?: boolean;
  button?: number;
  ctrlKey?: boolean;
  selection?: string;
}

/** Clicks a row whose name link counts its clicks; returns how often it was followed. */
function rowClick({ insideControl = false, button = 0, ctrlKey = false, selection = '' }: Click = {}) {
  const link = { clicks: 0, click: () => (link.clicks += 1) };
  const row = { querySelector: (selector: string) => (selector === '.col-name a' ? link : null) };
  const target = { closest: (selector: string) => (insideControl && selector === 'a, button' ? {} : null) };
  const saved = globalThis.getSelection;
  globalThis.getSelection = (() => ({ toString: () => selection })) as unknown as typeof getSelection;
  try {
    followRowLink({ target, currentTarget: row, button, ctrlKey } as unknown as MouseEvent & {
      currentTarget: HTMLElement;
    });
  } finally {
    globalThis.getSelection = saved;
  }
  return link.clicks;
}

test('a click on a row follows the link in its name cell', () => {
  assert.equal(rowClick(), 1);
});

test('a click on a link or button inside the row is left to that control', () => {
  assert.equal(rowClick({ insideControl: true }), 0);
});

test('a modified or non-primary click, or one that ends a text selection, stays put', () => {
  assert.equal(rowClick({ ctrlKey: true }), 0);
  assert.equal(rowClick({ button: 1 }), 0);
  assert.equal(rowClick({ selection: '42' }), 0);
});
