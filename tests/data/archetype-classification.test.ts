import test from 'node:test';
import assert from 'node:assert/strict';

import { buildArchetypeDeckIndex, resolveArchetypeClassification } from '../../functions/lib/archetypeClassifier.js';

test('resolveArchetypeClassification prefers deck-id mapping when name is generic', () => {
  const deckRules = [
    {
      id: 'gholdengo-lunatone',
      name: 'Gholdengo Lunatone',
      cards: [{ name: 'Gholdengo ex' }, { name: 'Lunatone' }]
    }
  ];

  const index = buildArchetypeDeckIndex(deckRules);
  const classification = resolveArchetypeClassification(
    {
      deckName: 'Other',
      deckId: 'gholdengo-lunatone',
      decklist: {
        pokemon: [
          { name: 'Gholdengo ex', count: 4 },
          { name: 'Lunatone', count: 2 }
        ]
      }
    },
    index
  );

  assert.equal(classification.name, 'Gholdengo Lunatone');
  assert.equal(classification.source, 'deck-id');
  assert.equal(classification.id, 'gholdengo-lunatone');
});

test('resolveArchetypeClassification supports Limitless identifier field for deck-id mapping', () => {
  const deckRules = [
    {
      identifier: 'dragapult-dusknoir',
      name: 'Dragapult Dusknoir',
      cards: [{ name: 'Dragapult ex' }, { name: 'Dusknoir' }]
    }
  ];

  const index = buildArchetypeDeckIndex(deckRules);
  const classification = resolveArchetypeClassification(
    {
      deckName: 'Other',
      deckId: 'dragapult-dusknoir',
      decklist: null
    },
    index
  );

  assert.equal(classification.name, 'Dragapult Dusknoir');
  assert.equal(classification.source, 'deck-id');
});

test('resolveArchetypeClassification infers archetype from decklist cards when id is unavailable', () => {
  const deckRules = [
    {
      id: 'dragapult-dusknoir',
      name: 'Dragapult Dusknoir',
      cards: [{ name: 'Dragapult ex' }, { name: 'Dusknoir' }]
    },
    {
      id: 'charizard-pidgeot',
      name: 'Charizard Pidgeot',
      cards: [{ name: 'Charizard ex' }, { name: 'Pidgeot ex' }]
    }
  ];

  const index = buildArchetypeDeckIndex(deckRules);
  const classification = resolveArchetypeClassification(
    {
      deckName: 'Other',
      deckId: null,
      decklist: {
        pokemon: [
          { name: 'Dragapult ex', count: 4 },
          { name: 'Dusknoir', count: 2 },
          { name: 'Drakloak', count: 3 }
        ]
      }
    },
    index
  );

  assert.equal(classification.name, 'Dragapult Dusknoir');
  assert.equal(classification.source, 'decklist-match');
});

test('resolveArchetypeClassification keeps generic name when no confident match exists', () => {
  const index = buildArchetypeDeckIndex([
    {
      id: 'grimmsnarl-froslass',
      name: 'Grimmsnarl Froslass',
      cards: [{ name: 'Grimmsnarl ex' }, { name: 'Froslass' }]
    }
  ]);

  const classification = resolveArchetypeClassification(
    {
      deckName: 'Other',
      deckId: null,
      decklist: {
        pokemon: [{ name: 'Completely Different Card', count: 4 }]
      }
    },
    index
  );

  assert.equal(classification.name, 'Other');
  assert.equal(classification.source, 'fallback');
});
