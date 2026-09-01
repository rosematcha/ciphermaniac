import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { titleLinesFor } from '../../src/lib/labelmaker/renderLabel';
import { defaultConfig } from '../../src/lib/labelmaker/types';

const withTitle = (title: string, extra: Partial<typeof defaultConfig> = {}) => ({
  ...defaultConfig,
  ...extra,
  title
});

test('a title without a manual break stays on one line', () => {
  assert.deepEqual(titleLinesFor(withTitle('Team Rocket Honchkrow')), ['Team Rocket Honchkrow']);
});

test('/n breaks the title where it was typed', () => {
  assert.deepEqual(titleLinesFor(withTitle("Team Rocket's /n Honchkrow")), ["Team Rocket's", 'Honchkrow']);
});

test('a backslash-n break works too', () => {
  assert.deepEqual(titleLinesFor(withTitle("Team Rocket's \\n Honchkrow")), ["Team Rocket's", 'Honchkrow']);
});

test('more than one manual break is honoured', () => {
  assert.deepEqual(titleLinesFor(withTitle('a /n b /n c')), ['a', 'b', 'c']);
});

test('a manual break overrides the duo auto-break', () => {
  const config = withTitle('Team Rocket /n Honchkrow', { pokemon2: 'honchkrow', titleBreak: true });
  assert.deepEqual(titleLinesFor(config), ['Team Rocket', 'Honchkrow']);
});

test('the duo auto-break still splits at the first space', () => {
  const config = withTitle('Team Rocket Honchkrow', { pokemon2: 'honchkrow', titleBreak: true });
  assert.deepEqual(titleLinesFor(config), ['Team', 'Rocket Honchkrow']);
});
