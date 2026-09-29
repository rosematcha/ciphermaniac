import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { titleLinesFor } from '../../src/lib/labelmaker/renderLabel';
import { defaultConfig } from '../../src/lib/labelmaker/types';

const withTitle = (title: string, extra: Partial<typeof defaultConfig> = {}) => ({
  ...defaultConfig,
  ...extra,
  title
});

test('titles break at manual /n or \\n markers, else at the duo auto-break', () => {
  const cases = [
    ['a title without a manual break stays on one line', withTitle('Team Rocket Honchkrow'), ['Team Rocket Honchkrow']],
    ['/n breaks the title where it was typed', withTitle("Team Rocket's /n Honchkrow"), ["Team Rocket's", 'Honchkrow']],
    ['a backslash-n break works too', withTitle("Team Rocket's \\n Honchkrow"), ["Team Rocket's", 'Honchkrow']],
    ['more than one manual break is honoured', withTitle('a /n b /n c'), ['a', 'b', 'c']],
    [
      'a manual break overrides the duo auto-break',
      withTitle('Team Rocket /n Honchkrow', { pokemon2: 'honchkrow', titleBreak: true }),
      ['Team Rocket', 'Honchkrow']
    ],
    [
      'the duo auto-break still splits at the first space',
      withTitle('Team Rocket Honchkrow', { pokemon2: 'honchkrow', titleBreak: true }),
      ['Team', 'Rocket Honchkrow']
    ]
  ] as const;
  for (const [name, config, expected] of cases) {
    assert.deepEqual(titleLinesFor(config), expected, name);
  }
});
