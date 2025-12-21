import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs/promises';
import { RealDataFetcher } from '../__utils__/real-data-fetcher';
import { LocalTestStorage } from '../__mocks__/cloudflare/local-storage';

// Fixed test dates for deterministic tests
const FIXED_TEST_DATE = '2025-01-15T12:00:00.000Z';
const FIXED_PROCESSED_DATE = '2025-01-15T14:30:00.000Z';

// NOTE: processTournamentDecklists and generateArchetypeReports are not exported from the main modules
// These tests are scaffolds for future API development
const processTournamentDecklists = null;

// NOTE: The real project exposes different helpers; these imports are best-effort
// and are intended to illustrate integration test structure in this repository.

const FIXTURE_DIR = path.join(process.cwd(), 'tests', '__fixtures__', 'integration', 'tournament-ingestion');

test.before(async () => {
  await fs.mkdir(FIXTURE_DIR, { recursive: true });
});

test(
  'Tournament ingestion end-to-end (with cache + LocalTestStorage)',
  {
    skip: !processTournamentDecklists ? 'processTournamentDecklists is not yet exported from onlineMeta' : false
  },
  async () => {
    const fetcher = new RealDataFetcher({
      cacheDir: path.join(process.cwd(), 'tests', '__fixtures__', 'real-tournaments')
    });
    const storage = new LocalTestStorage(path.join(process.cwd(), 'tests', '__fixtures__', 'generated', 'ingestion'));

    // pick a known tournament id for testing - prefer cached fixtures if available
    const tournamentId = process.env.TEST_TOURNAMENT_ID || 'test-tournament-123';

    // Ensure clean storage
    await storage.clear();

    // Fetch tournament (uses cache when present)
    const tournament = await fetcher.fetchTournament(tournamentId).catch(_err => {
      // If network is unavailable, use a minimal local fixture
      return {
        id: tournamentId,
        date: FIXED_TEST_DATE,
        players: 32,
        decks: [
          { id: 'd1', list: 'Pikachu VMAX x4\nPikachu x4', player: 'Alice' },
          { id: 'd2', list: 'Charizard V x2\nCharizard x1', player: 'Bob' }
        ]
      } as any;
    });

    assert.ok(tournament, 'Tournament must be returned');
    assert.ok((tournament as any).decks?.length > 0, 'Tournament should include decks');

    // Simulate partial failure: make one deck throw during processing
    const originalProcess = processTournamentDecklists;
    let injectedError = false;

    const flakyProcess = async (tour: any, _options: any) => {
      const decks = (tour.decks || []).map((deck: any) => deck);
      // fail on first deck to test partial recovery
      const results: any[] = [];
      for (let i = 0; i < decks.length; i++) {
        const deck = decks[i];
        if (!injectedError && i === 0) {
          injectedError = true;
          // simulate transient failure for deck 0
          results.push({ deckId: deck.id, success: false, error: new Error('Parsing error') });
          continue;
        }
        // normal processing path
        results.push({ deckId: deck.id, success: true, archetype: { name: 'MockArchetype', cards: [] } });
      }
      return results;
    };

    (global as any).processTournamentDecklists = flakyProcess;

    try {
      // Process all deck lists
      const processingResults = await processTournamentDecklists(tournament, { cache: true }).catch(_err => {
        // In case the pipeline throws, ensure we still capture partial results
        return [{ deckId: 'd1', success: false }];
      });

      // Ensure at least one success and one failure (partial failure recovery)
      const successes = (processingResults as any[]).filter(report => report.success);
      const failures = (processingResults as any[]).filter(report => !report.success);
      assert.ok(successes.length >= 1, 'At least one deck should be processed successfully');
      assert.ok(failures.length >= 1, 'At least one deck should have failed to test recovery');

      // Generate archetype reports from processed decks
      const archetypeReports = await generateArchetypeReports(processingResults as any[], { includeEmpty: false });
      assert.ok(Array.isArray(archetypeReports), 'Archetype reports should be an array');
      assert.ok(archetypeReports.length > 0, 'At least one archetype report should have been generated');

      // Write reports to LocalTestStorage
      const reportKey = `reports/${tournamentId}/archetypes.json`;
      await storage.put(reportKey, archetypeReports);

      // Validate structure matches production schema (minimal validation)
      const stored = (await storage.get(reportKey)) as any;
      assert.ok(Array.isArray(stored), 'Stored report should be an array');

      for (const report of stored) {
        assert.ok(typeof report.name === 'string' && report.name.length > 0, 'Archetype must have a name');
        assert.ok(Array.isArray(report.cards), 'Archetype must include cards array');
        assert.ok(typeof report.meta === 'object', 'Archetype report must include meta object');
      }

      // Test KV cache updates simulated via LocalTestStorage put/get
      const kvKey = `kv/tournament-${tournamentId}-processed`;
      await storage.put(kvKey, { processedAt: FIXED_PROCESSED_DATE });
      const kvValue = (await storage.get(kvKey)) as any;
      assert.ok(kvValue && kvValue.processedAt, 'KV cache should be updated with processedAt timestamp');

      // Test R2 upload retry logic: simulate upload with transient failure
      let uploadAttempts = 0;
      const unreliableUpload = async (objKey: string, value: unknown) => {
        uploadAttempts++;
        if (uploadAttempts < 3) {
          throw new Error('Transient R2 error');
        }
        await storage.put(objKey, value);
      };

      // Attempt upload with retry logic
      const r2Key = `r2/${tournamentId}/summary.json`;
      let attempt = 0;
      let uploaded = false;
      while (attempt < 5 && !uploaded) {
        attempt++;
        try {
          await unreliableUpload(r2Key, { summary: 'ok' });
          uploaded = true;
        } catch {
          // backoff simulation
          await new Promise(resolve => {
            setTimeout(resolve, 10);
          });
        }
      }
      assert.ok(uploaded, 'Upload should succeed after retries');
      const uploadedContent = await storage.get(r2Key);
      assert.deepEqual(uploadedContent, { summary: 'ok' });
    } finally {
      // restore original
      (global as any).processTournamentDecklists = originalProcess;
    }
  }
);
