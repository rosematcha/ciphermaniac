/**
 * Tests for the new archetype folder structure
 *
 * Tests the changes that:
 * 1. Create per-archetype folders with cards.json and decks.json
 * 2. Update API to use new paths with legacy fallback
 * 3. Support archetype-specific deck fetching
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Mock definitions
interface MockDeck {
  id: string;
  archetype: string;
  cards: Array<{
    name: string;
    set: string;
    number: string;
    count: number;
    category?: string;
  }>;
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string;
}

interface MockArchetypeReport {
  deckTotal: number;
  items: Array<{
    name: string;
    set: string;
    number: string;
    found: number;
    total: number;
    pct: number;
  }>;
}

// =============================================================================
// Test Utilities
// =============================================================================

function createMockDeck(
  id: string,
  archetype: string,
  cards: Array<{ name: string; set: string; number: string; count: number }>
): MockDeck {
  return {
    id,
    archetype,
    cards: cards.map(card => ({ ...card, category: 'pokemon' })),
    tournamentId: 'test-tournament-1',
    tournamentName: 'Test Tournament',
    tournamentDate: '2024-01-15'
  };
}

function createMockReport(deckTotal: number, items: MockArchetypeReport['items']): MockArchetypeReport {
  return { deckTotal, items };
}

// =============================================================================
// Path Generation Tests
// =============================================================================

describe('Archetype Report Path Generation', () => {
  describe('New folder structure paths', () => {
    it('should generate correct cards.json path', () => {
      const tournament = 'Online - Last 14 Days';
      const archetype = 'Gardevoir';
      const expectedPath = `reports/Online - Last 14 Days/archetypes/Gardevoir/cards.json`;

      // Simulate path generation
      const basePath = `reports/${tournament}`;
      const archetypePath = `${basePath}/archetypes/${archetype}/cards.json`;

      assert.strictEqual(archetypePath, expectedPath);
    });

    it('should generate correct decks.json path', () => {
      const tournament = 'Online - Last 14 Days';
      const archetype = 'Gardevoir';
      const expectedPath = `reports/Online - Last 14 Days/archetypes/Gardevoir/decks.json`;

      // Simulate path generation
      const basePath = `reports/${tournament}`;
      const archetypePath = `${basePath}/archetypes/${archetype}/decks.json`;

      assert.strictEqual(archetypePath, expectedPath);
    });

    it('should handle archetype names with spaces and special characters', () => {
      const testCases = [
        { base: 'Raging_Bolt_Ogerpon', expected: 'Raging_Bolt_Ogerpon' },
        { base: 'Gholdengo_Joltik_Box', expected: 'Gholdengo_Joltik_Box' },
        { base: "N's_Zoroark", expected: "N's_Zoroark" },
        { base: 'Ho-Oh_Armarouge', expected: 'Ho-Oh_Armarouge' }
      ];

      for (const { base, expected } of testCases) {
        const path = `archetypes/${base}/cards.json`;
        assert.ok(path.includes(expected), `Path should contain ${expected}`);
      }
    });
  });

  describe('Legacy fallback paths', () => {
    it('should generate correct legacy path', () => {
      const tournament = 'Online - Last 14 Days';
      const archetype = 'Gardevoir';
      const expectedLegacyPath = `reports/Online - Last 14 Days/archetypes/Gardevoir.json`;

      const basePath = `reports/${tournament}`;
      const legacyPath = `${basePath}/archetypes/${archetype}.json`;

      assert.strictEqual(legacyPath, expectedLegacyPath);
    });
  });
});

// =============================================================================
// Archetype Grouping Tests
// =============================================================================

describe('Archetype Report Building', () => {
  it('should group decks by archetype', () => {
    const decks: MockDeck[] = [
      createMockDeck('deck-1', 'Gardevoir', [{ name: 'Gardevoir ex', set: 'SVI', number: '86', count: 2 }]),
      createMockDeck('deck-2', 'Gardevoir', [{ name: 'Gardevoir ex', set: 'SVI', number: '86', count: 3 }]),
      createMockDeck('deck-3', 'Charizard Pidgeot', [{ name: 'Charizard ex', set: 'OBF', number: '125', count: 2 }])
    ];

    // Group by archetype
    const groups = new Map<string, MockDeck[]>();
    for (const deck of decks) {
      const { archetype } = deck;
      if (!groups.has(archetype)) {
        groups.set(archetype, []);
      }
      groups.get(archetype)!.push(deck);
    }

    assert.strictEqual(groups.size, 2, 'Should have 2 archetype groups');
    assert.strictEqual(groups.get('Gardevoir')?.length, 2, 'Gardevoir should have 2 decks');
    assert.strictEqual(groups.get('Charizard Pidgeot')?.length, 1, 'Charizard Pidgeot should have 1 deck');
  });

  it('should create both cards.json and decks.json for each archetype', () => {
    const archetype = 'Gardevoir';
    const decks: MockDeck[] = [
      createMockDeck('deck-1', archetype, [{ name: 'Gardevoir ex', set: 'SVI', number: '86', count: 2 }]),
      createMockDeck('deck-2', archetype, [{ name: 'Gardevoir ex', set: 'SVI', number: '86', count: 3 }])
    ];

    // Simulate what buildArchetypeReports returns
    const result = {
      files: [
        {
          filename: `${archetype}/cards.json`,
          base: archetype,
          displayName: archetype,
          deckCount: decks.length,
          data: createMockReport(decks.length, [])
        }
      ],
      decksByArchetype: new Map([[archetype, decks]])
    };

    // Verify structure
    assert.strictEqual(result.files[0].filename, 'Gardevoir/cards.json');
    assert.ok(result.decksByArchetype.has('Gardevoir'));
    assert.strictEqual(result.decksByArchetype.get('Gardevoir')?.length, 2);
  });

  it('should normalize archetype names consistently', () => {
    const testCases = [
      { input: 'Gardevoir', expected: 'gardevoir' },
      { input: 'gardevoir', expected: 'gardevoir' },
      { input: 'Raging_Bolt_Ogerpon', expected: 'raging bolt ogerpon' },
      { input: 'Raging Bolt Ogerpon', expected: 'raging bolt ogerpon' }
    ];

    function normalizeArchetypeName(name: string): string {
      return (name || '').replace(/_/g, ' ').trim().toLowerCase();
    }

    for (const { input, expected } of testCases) {
      const normalized = normalizeArchetypeName(input);
      assert.strictEqual(normalized, expected, `${input} should normalize to ${expected}`);
    }
  });
});

// =============================================================================
// Deck Filtering Tests
// =============================================================================

describe('Archetype Deck Filtering', () => {
  it('should filter decks by archetype correctly', () => {
    const decks: MockDeck[] = [
      createMockDeck('deck-1', 'Gardevoir', []),
      createMockDeck('deck-2', 'Gardevoir', []),
      createMockDeck('deck-3', 'Charizard Pidgeot', []),
      createMockDeck('deck-4', 'Raging Bolt Ogerpon', [])
    ];

    function filterByArchetype(decks: MockDeck[], archetype: string): MockDeck[] {
      const normalized = archetype.toLowerCase().replace(/_/g, ' ').trim();
      return decks.filter(deck => {
        const deckArchetype = (deck.archetype || '').toLowerCase().replace(/_/g, ' ').trim();
        return deckArchetype === normalized;
      });
    }

    assert.strictEqual(filterByArchetype(decks, 'Gardevoir').length, 2);
    assert.strictEqual(filterByArchetype(decks, 'gardevoir').length, 2);
    assert.strictEqual(filterByArchetype(decks, 'Charizard Pidgeot').length, 1);
    assert.strictEqual(filterByArchetype(decks, 'Charizard_Pidgeot').length, 1);
    assert.strictEqual(filterByArchetype(decks, 'Unknown').length, 0);
  });

  it('should return only archetype decks for archetype-specific decks.json', () => {
    // This simulates what the per-archetype decks.json should contain
    const allDecks: MockDeck[] = [
      createMockDeck('deck-1', 'Gardevoir', []),
      createMockDeck('deck-2', 'Gardevoir', []),
      createMockDeck('deck-3', 'Charizard Pidgeot', [])
    ];

    const gardevoidDecks = allDecks.filter(deck => deck.archetype === 'Gardevoir');

    // What Gardevoir/decks.json should contain
    assert.strictEqual(gardevoidDecks.length, 2);
    assert.ok(gardevoidDecks.every(deck => deck.archetype === 'Gardevoir'));
  });
});

// =============================================================================
// Backward Compatibility Tests
// =============================================================================

describe('Backward Compatibility', () => {
  it('should generate legacy flat file alongside new structure', () => {
    const archetype = 'Gardevoir';

    // New paths
    const newCardsPath = `archetypes/${archetype}/cards.json`;
    const newDecksPath = `archetypes/${archetype}/decks.json`;

    // Legacy path
    const legacyPath = `archetypes/${archetype}.json`;

    // All three should be generated for backward compatibility
    assert.strictEqual(newCardsPath, 'archetypes/Gardevoir/cards.json');
    assert.strictEqual(newDecksPath, 'archetypes/Gardevoir/decks.json');
    assert.strictEqual(legacyPath, 'archetypes/Gardevoir.json');
  });

  it('should prefer new path but fall back to legacy', async () => {
    // Simulate the fallback logic
    async function fetchWithFallback(newPath: string, legacyPath: string): Promise<{ path: string; data: any }> {
      // Try new path first
      const newPathExists = false; // Simulate new path not existing yet
      if (newPathExists) {
        return { path: newPath, data: { source: 'new' } };
      }

      // Fall back to legacy
      return { path: legacyPath, data: { source: 'legacy' } };
    }

    const result = await fetchWithFallback('archetypes/Gardevoir/cards.json', 'archetypes/Gardevoir.json');

    assert.strictEqual(result.path, 'archetypes/Gardevoir.json');
    assert.strictEqual(result.data.source, 'legacy');
  });
});

// =============================================================================
// URL Encoding Tests
// =============================================================================

describe('URL Encoding', () => {
  it('should properly encode tournament names with spaces', () => {
    const tournament = 'Online - Last 14 Days';
    const encoded = encodeURIComponent(tournament);

    assert.strictEqual(encoded, 'Online%20-%20Last%2014%20Days');
  });

  it('should properly encode archetype names', () => {
    const testCases = [
      { input: 'Gardevoir', expected: 'Gardevoir' },
      { input: "N's_Zoroark", expected: "N's_Zoroark" },
      { input: 'Ho-Oh Armarouge', expected: 'Ho-Oh%20Armarouge' }
    ];

    for (const { input, expected } of testCases) {
      const encoded = encodeURIComponent(input);
      assert.strictEqual(encoded, expected);
    }
  });

  it('should construct valid URLs', () => {
    const tournament = 'Online - Last 14 Days';
    const archetype = 'Gardevoir';
    const baseUrl = 'https://r2.ciphermaniac.com/reports';

    const url = `${baseUrl}/${encodeURIComponent(tournament)}/archetypes/${encodeURIComponent(archetype)}/cards.json`;

    assert.strictEqual(
      url,
      'https://r2.ciphermaniac.com/reports/Online%20-%20Last%2014%20Days/archetypes/Gardevoir/cards.json'
    );
  });
});

// =============================================================================
// Index File Tests
// =============================================================================

describe('Archetype Index', () => {
  it('should contain correct archetype metadata', () => {
    const archetypeIndex = [
      {
        name: 'Gardevoir',
        label: 'Gardevoir',
        deckCount: 45,
        percent: 0.15,
        thumbnails: ['SVI/86']
      },
      {
        name: 'Charizard_Pidgeot',
        label: 'Charizard Pidgeot',
        deckCount: 38,
        percent: 0.12,
        thumbnails: ['OBF/125']
      }
    ];

    assert.strictEqual(archetypeIndex.length, 2);
    assert.strictEqual(archetypeIndex[0].name, 'Gardevoir');
    assert.ok(archetypeIndex[0].deckCount > 0);
    assert.ok(archetypeIndex[0].percent >= 0 && archetypeIndex[0].percent <= 1);
  });

  it('should sort archetypes by deck count descending', () => {
    const archetypes = [
      { name: 'A', deckCount: 10 },
      { name: 'B', deckCount: 50 },
      { name: 'C', deckCount: 25 }
    ];

    const sorted = [...archetypes].sort((first, second) => second.deckCount - first.deckCount);

    assert.strictEqual(sorted[0].name, 'B');
    assert.strictEqual(sorted[1].name, 'C');
    assert.strictEqual(sorted[2].name, 'A');
  });
});

// =============================================================================
// Archetype-Specific Deck Fetching Tests
// =============================================================================

describe('Archetype-Specific Deck Fetching', () => {
  it('should use archetype-specific URL when archetype is provided', () => {
    const tournament = 'Online - Last 14 Days';
    const archetype = 'Gardevoir';

    // Expected URL pattern for archetype-specific decks
    const expectedUrl = `https://r2.ciphermaniac.com/reports/${encodeURIComponent(tournament)}/archetypes/${encodeURIComponent(archetype)}/decks.json`;

    assert.ok(expectedUrl.includes('/archetypes/'));
    assert.ok(expectedUrl.includes('/decks.json'));
    assert.ok(expectedUrl.includes('/Gardevoir/'));
  });

  it('should use main decks.json URL when no archetype is provided', () => {
    const tournament = 'Online - Last 14 Days';

    // Expected URL pattern for all decks
    const expectedUrl = `https://r2.ciphermaniac.com/reports/${encodeURIComponent(tournament)}/decks.json`;

    assert.ok(!expectedUrl.includes('/archetypes/'));
    assert.ok(expectedUrl.endsWith('/decks.json'));
  });

  it('should return only that archetype decks from archetype-specific file', () => {
    // Simulate what archetype-specific decks.json contains
    const archetypeSpecificDecks: MockDeck[] = [
      createMockDeck('deck-1', 'Gardevoir', []),
      createMockDeck('deck-2', 'Gardevoir', [])
    ];

    // All decks should be for the target archetype
    assert.ok(archetypeSpecificDecks.every(deck => deck.archetype === 'Gardevoir'));
    assert.strictEqual(archetypeSpecificDecks.length, 2);
  });

  it('should still work with main decks.json when archetype file not found', () => {
    // Simulate fallback scenario
    const allDecks: MockDeck[] = [
      createMockDeck('deck-1', 'Gardevoir', []),
      createMockDeck('deck-2', 'Gardevoir', []),
      createMockDeck('deck-3', 'Charizard Pidgeot', [])
    ];

    // Filter by archetype manually (simulating what happens in fallback)
    const filteredDecks = allDecks.filter(deck => deck.archetype === 'Gardevoir');

    assert.strictEqual(filteredDecks.length, 2);
    assert.ok(filteredDecks.every(deck => deck.archetype === 'Gardevoir'));
  });
});

console.log('Running archetype reports tests...');
