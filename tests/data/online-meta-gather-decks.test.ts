import test from 'node:test';
import assert from 'node:assert/strict';

import { gatherDecks } from '../../functions/lib/onlineMeta';

test('gatherDecks includes entries without decklists when archetype metadata is available', async () => {
  const env = { LIMITLESS_API_KEY: 'test-key' };
  const diagnostics: Record<string, any> = {};
  const tournaments = [
    {
      id: 't1',
      name: 'Online Event',
      date: '2026-02-14T00:00:00.000Z',
      players: 32,
      format: 'STANDARD',
      platform: 'Limitless',
      organizer: 'Test Org'
    }
  ];

  const fetchJson = async (path: string) => {
    if (path === '/games/PTCG/decks') {
      return [
        {
          identifier: 'dragapult-dusknoir',
          name: 'Dragapult Dusknoir',
          cards: [{ name: 'Dragapult ex' }, { name: 'Dusknoir' }]
        }
      ];
    }

    if (path === '/tournaments/t1/standings') {
      return [
        {
          placing: 1,
          name: 'A',
          player: 'p1',
          deck: { id: 'dragapult-dusknoir', name: 'Other' },
          decklist: { pokemon: [{ name: 'Dragapult ex', count: 4, set: 'TWM', number: '130' }] }
        },
        {
          placing: 2,
          name: 'B',
          player: 'p2',
          deck: { id: 'dragapult-dusknoir', name: 'Other' }
        },
        {
          placing: 3,
          name: 'C',
          player: 'p3'
        }
      ];
    }

    return [];
  };

  const decks = await gatherDecks(env, tournaments, diagnostics, null, { fetchJson });
  assert.equal(decks.length, 2);
  assert.equal(decks[0].archetype, 'Dragapult Dusknoir');
  assert.equal(decks[1].archetype, 'Dragapult Dusknoir');
  assert.equal(decks[0].hasDecklist, true);
  assert.equal(decks[1].hasDecklist, false);
});

test('gatherDecks uses full standings instead of top-cut caps', async () => {
  const env = { LIMITLESS_API_KEY: 'test-key' };
  const diagnostics: Record<string, any> = {};
  const tournaments = [
    {
      id: 't2',
      name: 'Large Online Event',
      date: '2026-02-14T00:00:00.000Z',
      players: 200,
      format: 'STANDARD',
      platform: 'Limitless',
      organizer: 'Test Org'
    }
  ];

  const standings = Array.from({ length: 150 }, (_, index) => ({
    placing: index + 1,
    name: `Player ${index + 1}`,
    player: `p-${index + 1}`,
    deck: { name: `Deck ${index + 1}` },
    decklist: {
      pokemon: [{ name: 'Test Pokemon', count: 4, set: 'SVI', number: '001' }]
    }
  }));

  const fetchJson = async (path: string) => {
    if (path === '/games/PTCG/decks') {
      return [];
    }
    if (path === '/tournaments/t2/standings') {
      return standings;
    }
    return [];
  };

  const decks = await gatherDecks(env, tournaments, diagnostics, null, { fetchJson });
  assert.equal(decks.length, 150);
});
