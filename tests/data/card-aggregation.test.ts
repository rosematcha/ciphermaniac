import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { mockFetch, restoreFetch } from '../__utils__/test-helpers';

import { enrichCardWithType, loadCardTypesDatabase } from '../../shared/data/cardTypesDatabase.js';
import { generateReportFromDecks } from '../../shared/data/reports/cardReport.js';
import { gatherDecks } from '../../shared/onlineMeta/index.js';

afterEach(() => {
  restoreFetch();
});
// Variant merging and normalization in report generation
test('Merge variant counts correctly across set/code variations', () => {
  const decks = [
    { cards: [{ name: 'Multi', count: 2, set: 's1', number: '1' }] },
    { cards: [{ name: 'Multi', count: 3, set: 'S1', number: '001' }] },
    { cards: [{ name: 'Multi', count: 1, set: 'S1', number: '01' }] }
  ];

  const report = generateReportFromDecks(decks as any, decks.length, null);
  assert.strictEqual(report.items.length, 1, 'casing and padding variants are one card');
  assert.strictEqual(report.items[0].uid, 'Multi::S1::001');
  assert.strictEqual(report.items[0].found, 3);
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

test('a decklist number without padding still finds its card-types entry', () => {
  // Limitless decklists send "57"; the database keys pad to "SFA::057". A miss
  // left the name heuristic to call this supporter an item.
  const database = { 'SFA::057': { cardType: 'trainer', subType: 'supporter', regulationMark: 'H' } };
  const card: { name: string; set: string; number: string; trainerType?: string; regulationMark?: string } = {
    name: "Colress's Tenacity",
    set: 'SFA',
    number: '57'
  };
  const enriched = enrichCardWithType(card, database);
  assert.strictEqual(enriched.trainerType, 'supporter');
  assert.strictEqual(enriched.regulationMark, 'H');
});

test('a lower-case set or a number 0 still finds its card-types entry', () => {
  const database = {
    'SFA::057': { cardType: 'trainer', subType: 'supporter' },
    'SVP::000': { cardType: 'trainer', subType: 'item' }
  };
  const lookup = (set: string, number: string | number) =>
    enrichCardWithType<{ name: string; set: string; number: string | number; trainerType?: string }>(
      { name: 'Card', set, number },
      database
    ).trainerType;
  assert.strictEqual(lookup('sfa', '57'), 'supporter');
  assert.strictEqual(lookup('SVP', 0), 'item');
});

// Trainer subtype heuristics via gatherDecks flow
test('Extract trainer subtypes and detect ACE SPEC cards via gatherDecks heuristics', async () => {
  const tournaments = [{ id: 'tX', name: 'Heuristic Test', date: '2025-12-01T00:00:00Z', players: 8 }];

  // Mock standings response with decklist structure gatherDecks expects
  mockFetch([
    {
      predicate: (input: RequestInfo) => String(input).includes('/games/PTCG/decks'),
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: []
    },
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
  const decks = await gatherDecks(mockEnv as any, tournaments as any, diagnostics, { minFieldPlayers: 1 });
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
});
