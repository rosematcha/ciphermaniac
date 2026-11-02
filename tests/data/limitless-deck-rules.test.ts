import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DECK_RULES_KEY,
  publishDeckRules,
  type PublishedDeckRules,
  readDeckRules
} from '../../.github/scripts/lib/limitlessDeckRules';

/** Rules as Limitless's /games/PTCG/decks sends them, trimmed from a November 2026 answer. */
const PAYLOAD = [
  {
    identifier: 'dragapult-ex',
    name: 'Dragapult',
    icons: ['dragapult'],
    priority: 11,
    cards: [{ name: 'Dragapult ex', count: '2' }],
    variants: [
      {
        identifier: 'dragapult-lz-box',
        name: 'Dragapult LZ Box',
        icon: 'comfey',
        cards: [{ name: 'Comfey', count: '4', set: 'LOR' }]
      },
      { identifier: 'dragapult-dusknoir', name: 'Dragapult Dusknoir', icon: 'dusknoir', cards: [{ name: 'Dusknoir' }] }
    ],
    generation: 9
  },
  {
    identifier: 'cinccino-control',
    name: 'Cinccino Control',
    icons: ['cinccino'],
    cards: [{ name: 'Bunnelby', count: '2', set: 'PRC', number: '121' }],
    variants: [],
    generation: 6
  },
  // What Limitless sends among the rest, and none of it reads as a rule.
  { identifier: null, name: null, icons: [], priority: 10, cards: [], variants: [] },
  { identifier: 'no-cards', name: 'No cards', priority: 10, cards: [], variants: [] },
  { identifier: 'bad-count', name: 'Bad count', priority: 10, cards: [{ name: 'Pikachu', count: 'two' }] },
  'not a rule'
];

test('Limitless rules read into one shape, in the order Limitless sends them', () => {
  assert.deepEqual(readDeckRules(PAYLOAD), [
    {
      identifier: 'dragapult-ex',
      name: 'Dragapult',
      icons: ['dragapult'],
      cards: [{ name: 'Dragapult ex', count: 2 }],
      priority: 11,
      generation: 9,
      variants: [
        {
          identifier: 'dragapult-lz-box',
          name: 'Dragapult LZ Box',
          icons: ['comfey'],
          cards: [{ name: 'Comfey', count: 4, set: 'LOR' }]
        },
        {
          identifier: 'dragapult-dusknoir',
          name: 'Dragapult Dusknoir',
          icons: ['dusknoir'],
          cards: [{ name: 'Dusknoir', count: 1 }]
        }
      ]
    },
    {
      identifier: 'cinccino-control',
      name: 'Cinccino Control',
      icons: ['cinccino'],
      cards: [{ name: 'Bunnelby', count: 2, set: 'PRC', number: '121' }],
      priority: 10,
      generation: 6,
      variants: []
    }
  ]);
  assert.deepEqual(readDeckRules({ decks: PAYLOAD }), []);
});

test('the rules publish under one key, and a short answer keeps the copy already published', async () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ ...(PAYLOAD[0] as object), identifier: `deck-${i}` }));
  const written: [string, PublishedDeckRules][] = [];
  const lines: string[] = [];
  const run = (payload: unknown) =>
    publishDeckRules({
      fetchJson: async path => {
        assert.equal(path, '/games/PTCG/decks');
        return payload;
      },
      write: async (key, value) => {
        written.push([key, value]);
      },
      log: line => lines.push(line)
    });
  assert.equal(await run(many), true);
  assert.equal(written.length, 1);
  assert.equal(written[0]?.[0], DECK_RULES_KEY);
  assert.equal(written[0]?.[1].rules.length, 120);
  assert.deepEqual(Object.keys(written[0]?.[1] ?? {}), ['rules'], 'no date, so an unchanged day writes nothing');

  assert.equal(await run(PAYLOAD), false);
  assert.equal(written.length, 1);
  assert.match(lines.at(-1) ?? '', /sent 2 rules; keeping the published copy/);
});
