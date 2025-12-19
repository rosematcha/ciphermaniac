import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { LocalTestStorage } from '../__mocks__/cloudflare/local-storage';
import { buildCardTrendReport, buildTrendReport, runOnlineMetaJob } from '../../functions/lib/onlineMeta';

const storage = new LocalTestStorage(path.join(process.cwd(), 'tests', '__fixtures__', 'generated', 'online-meta'));

test('Online meta pipeline end-to-end (aggregation + trends + storage)', async () => {
  await storage.clear();

  // Provide a fake env that uses LocalTestStorage for REPORTS and simple KV
  const env: any = {
    REPORTS: {
      put: async (key: string, val: string) => storage.put(key, val),
      get: async (key: string) => {
        const value = await storage.get(key);
        if (value === null) {
          return null;
        }
        return {
          text: async () => (typeof value === 'string' ? value : JSON.stringify(value))
        } as any;
      }
    },
    CARD_TYPES_KV: { get: async () => null, put: async () => null }
  };

  // Mock fetchJson to return minimal details for recent tournaments
  const fetchJson = async (pathUrl: string, _options: any) => {
    // Check specific paths first before the general /tournaments check
    if (String(pathUrl).includes('/details')) {
      return { decklists: true, isOnline: true, platform: 'Limitless', organizer: { name: 'TestOrg' } };
    }
    if (String(pathUrl).includes('/standings')) {
      return [
        {
          placing: 1,
          name: 'Player1',
          decklist: { pokemon: [{ name: 'Pikachu', count: 4, set: 'SVI', number: '001' }] },
          deck: { name: 'Pika' }
        },
        {
          placing: 2,
          name: 'Player2',
          decklist: { pokemon: [{ name: 'Charizard', count: 3, set: 'SVI', number: '002' }] },
          deck: { name: 'Char' }
        }
      ];
    }
    if (String(pathUrl).startsWith('/tournaments')) {
      // return a small list of tournament summaries
      return [{ id: 'ot1', name: 'Online Test 1', date: new Date().toISOString(), format: 'STANDARD', players: 32 }];
    }
    return [];
  };

  const result = await runOnlineMetaJob(env, { fetchJson, pageSize: 10, maxPages: 1 }).catch(err => {
    return { success: false, error: String(err) } as any;
  });

  assert.ok(result, 'Result must be returned');
  assert.strictEqual(result.success, true, 'Online meta job should succeed');

  // Verify writes in LocalTestStorage
  const index = await storage.get('reports/Online - Last 14 Days/archetypes/index.json');
  assert.ok(Array.isArray(index), 'Archetype index should be written');

  // Verify trend calculations produce consistent output
  const decks = [
    { tournamentId: 't1', tournamentDate: '2025-01-01T00:00:00Z', archetype: 'A', cards: [{ name: 'P', count: 4 }] },
    { tournamentId: 't2', tournamentDate: '2025-02-01T00:00:00Z', archetype: 'A', cards: [{ name: 'P', count: 4 }] },
    { tournamentId: 't3', tournamentDate: '2025-03-01T00:00:00Z', archetype: 'B', cards: [{ name: 'C', count: 2 }] }
  ];
  const tournaments = [
    { id: 't1', date: '2025-01-01T00:00:00Z', players: 32, deckTotal: 2 },
    { id: 't2', date: '2025-02-01T00:00:00Z', players: 32, deckTotal: 2 },
    { id: 't3', date: '2025-03-01T00:00:00Z', players: 32, deckTotal: 1 }
  ];

  const trend = buildTrendReport(decks as any, tournaments as any, { minAppearances: 1, now: '2025-03-02T00:00:00Z' });
  assert.ok(trend.series && Array.isArray(trend.series), 'Trend series must be an array');

  const cardTrends = buildCardTrendReport(decks as any, tournaments as any, { minAppearances: 1 });
  assert.ok(Array.isArray(cardTrends.rising), 'Card trend rising must be an array');

  // Test include/exclude filters: runOnlineMetaJob with a filter that excludes everything
  const fetchJsonExclude = async (pathUrl: string) => {
    if (pathUrl.startsWith('/tournaments')) {
      return [];
    }
    return [];
  };

  const resultExclude = await runOnlineMetaJob(env, { fetchJson: fetchJsonExclude, pageSize: 10, maxPages: 1 }).catch(
    error => ({ success: false, reason: String(error) })
  );
  assert.strictEqual(resultExclude.success, false, 'Job should report failure when no tournaments found');
});
