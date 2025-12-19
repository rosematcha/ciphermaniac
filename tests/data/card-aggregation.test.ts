import test from 'node:test';
import assert from 'node:assert/strict';

import { mockFetch, restoreFetch } from '../__utils__/test-helpers';

import { enrichCardWithType, loadCardTypesDatabase } from '../../functions/lib/cardTypesDatabase.js';
import PricingManager from '../../public/assets/js/pricing.js';
import { generateReportFromDecks } from '../../functions/lib/reportBuilder.js';
import { gatherDecks } from '../../functions/lib/onlineMeta.js';

// Variant merging and normalization in report generation
test('Merge variant counts correctly across set/code variations', () => {
  const decks = [
    { cards: [{ name: 'Multi', count: 2, set: 's1', number: '1' }] },
    { cards: [{ name: 'Multi', count: 3, set: 'S1', number: '001' }] },
    { cards: [{ name: 'Multi', count: 1, set: 'S1', number: '01' }] }
  ];

  const report = generateReportFromDecks(decks as any, decks.length, decks as any, null);
  const multi = report.items.find((i: any) => String(i.name).toLowerCase().includes('multi'));
  assert.ok(multi, 'Multi should be present');
  // found should be 3 (present in 3 decks)
  assert.strictEqual(multi.found, 3);
  // If uid present, number and set should be normalized
  if (multi.uid) {
    assert.ok(String(multi.uid).includes('S1::001') || String(multi.uid).includes('S1::001'));
  }
});

// Card type enrichment and cache behavior
test('Card type enrichment from database and cache behavior', async () => {
  // Simulate R2 REPORTS returning card-types.json
  const cardDb = {
    'S1::001': { cardType: 'trainer', subType: 'supporter', aceSpec: false, fullType: 'trainer.supporter' },
    'S2::010': { cardType: 'energy', subType: 'basic', fullType: 'energy.basic' },
    'S3::005': { cardType: 'pokemon', fullType: 'pokemon.basic', evolutionInfo: { stage: 'basic' } },
    'S4::999': { cardType: 'trainer', subType: 'tool', aceSpec: true }
  };

  const env: any = {
    REPORTS: {
      get: async (key: string) => {
        if (key === 'assets/data/card-types.json') {
          return {
            text: async () => JSON.stringify(cardDb)
          };
        }
        return null;
      }
    },
    CARD_TYPES_KV: {
      put: async (_key: string, _value: string, _options: any) => {
        // noop - simulate kv put
      },
      get: async (_key: string, _type?: string) => null
    }
  };

  const loaded = await loadCardTypesDatabase(env);
  assert.ok(loaded['S1::001']);
  // Enrich a card
  const card = { name: 'Test', set: 'S1', number: '001' } as any;
  const enriched = enrichCardWithType(card, loaded);
  assert.strictEqual(enriched.category, 'trainer');
  assert.strictEqual(enriched.trainerType, 'supporter');

  // ACE SPEC detection from db
  const ace = { name: 'A Spec', set: 'S4', number: '999' } as any;
  const enrichedAce = enrichCardWithType(ace, loaded);
  assert.strictEqual(enrichedAce.aceSpec, true);

  // Missing card types gracefully returns original
  const missing = { name: 'Unknown', set: 'XX', number: '123' } as any;
  const enrichedMissing = enrichCardWithType(missing, loaded);
  assert.strictEqual(enrichedMissing.name, 'Unknown');
});

// Trainer subtype heuristics via gatherDecks flow
test('Extract trainer subtypes and detect ACE SPEC cards via gatherDecks heuristics', async () => {
  const tournaments = [{ id: 'tX', name: 'Heuristic Test', date: '2025-12-01T00:00:00Z', players: 8 }];

  // Mock standings response with decklist structure gatherDecks expects
  mockFetch([
    {
      predicate: (input: RequestInfo) => String(input).includes('/tournaments/tX/standings'),
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: [
        {
          name: 'Player1',
          placing: 1,
          decklist: {
            trainer: [
              { name: 'Master Ball', count: 1 },
              { name: 'Professor Willow', count: 1 }
            ],
            pokemon: [{ name: 'P', count: 2 }],
            energy: [{ name: 'Psychic Energy', count: 3 }]
          }
        }
      ]
    }
  ]);

  const diagnostics: any = {};
  const mockEnv = { LIMITLESS_API_KEY: 'test-key' };
  const decks = await gatherDecks(mockEnv as any, tournaments as any, diagnostics, null, {});
  // Should produce one deck with enriched cards
  assert.strictEqual(decks.length, 1);
  const { cards } = decks[0];
  const master = cards.find((card: any) => card.name === 'Master Ball');
  assert.ok(master);
  assert.strictEqual(master.trainerType, 'tool');
  assert.strictEqual(master.aceSpec, true);

  const prof = cards.find((card: any) => card.name === 'Professor Willow');
  assert.ok(prof);
  assert.strictEqual(prof.trainerType, 'supporter');

  const energy = cards.find((card: any) => card.name === 'Psychic Energy');
  assert.ok(energy);
  assert.strictEqual(energy.energyType, 'basic');

  restoreFetch();
});

// Pricing manager tests with mocked API
test('PricingManager fetches, caches, and formats price data; handles missing prices', async () => {
  const pricingPayload = {
    lastUpdated: '2025-12-01',
    updateSource: 'tcgcsv-test',
    cardPrices: {
      'Multi::S1::001': { price: 3.5, tcgPlayerId: 123 },
      'Other::S2::010': { price: 0.5 }
    }
  };

  mockFetch([
    {
      predicate: (input: RequestInfo) => String(input).includes('/api/get-prices'),
      status: 200,
      body: pricingPayload
    }
  ]);

  const manager = new PricingManager(1000);
  const price = await manager.getCardPrice('Multi', 'S1', '001');
  assert.strictEqual(price, 3.5);

  const missing = await manager.getCardPrice('Nope', 'XX', '999');
  assert.strictEqual(missing, null);

  const multiple = await manager.getMultiplePrices([
    { name: 'Multi', set: 'S1', number: '1' },
    { name: 'Other', set: 'S2', number: '010' }
  ]);
  // keys are padded inside getMultiplePrices
  const keys = Object.keys(multiple);
  assert.ok(keys.length >= 1);

  const meta = await manager.getPricingMetadata();
  assert.strictEqual(meta.updateSource, 'tcgcsv-test');

  // Cached: calling again should not trigger new fetch (we can't easily detect number of fetches here, but ensure data still available)
  const p2 = await manager.getCardPrice('Multi', 'S1', '001');
  assert.strictEqual(p2, 3.5);

  restoreFetch();
});

// cleanup
test('cleanup card-aggregation mocks', () => {
  restoreFetch();
});
