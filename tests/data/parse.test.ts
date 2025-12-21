/**
 * Comprehensive tests for src/parse.ts
 * Tests parseReport function with various input scenarios.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseReport } from '../../src/parse.js';
import type { CardItem, ParsedReport } from '../../src/types/index.js';

// =============================================================================
// parseReport() - Valid Report Parsing
// =============================================================================

describe('parseReport() - Valid Report Parsing', () => {
  test('parses a valid report with all required fields', () => {
    const input = {
      deckTotal: 100,
      items: [
        { name: 'Pikachu', found: 80, total: 100, pct: 80 },
        { name: 'Charizard', found: 50, total: 100, pct: 50 }
      ]
    };

    const result = parseReport(input);

    assert.strictEqual(result.deckTotal, 100);
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.items[0].name, 'Pikachu');
    assert.strictEqual(result.items[0].found, 80);
    assert.strictEqual(result.items[0].pct, 80);
    assert.strictEqual(result.items[1].name, 'Charizard');
  });

  test('preserves optional variant metadata (uid, set, number)', () => {
    const input = {
      deckTotal: 10,
      items: [
        {
          name: 'Rare Candy',
          found: 8,
          total: 10,
          pct: 80,
          uid: 'Rare Candy::SFA::025',
          set: 'SFA',
          number: '025'
        }
      ]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items[0].uid, 'Rare Candy::SFA::025');
    assert.strictEqual(result.items[0].set, 'SFA');
    assert.strictEqual(result.items[0].number, '025');
  });

  test('preserves category, trainerType, energyType, and aceSpec fields', () => {
    const input = {
      deckTotal: 10,
      items: [
        {
          name: 'Boss Order',
          found: 9,
          total: 10,
          pct: 90,
          category: 'Trainer',
          trainerType: 'Supporter'
        },
        {
          name: 'Master Ball',
          found: 5,
          total: 10,
          pct: 50,
          category: 'Trainer',
          trainerType: 'Item',
          aceSpec: true
        },
        {
          name: 'Basic Fire Energy',
          found: 10,
          total: 10,
          pct: 100,
          category: 'Energy',
          energyType: 'Basic'
        }
      ]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items[0].category, 'trainer');
    assert.strictEqual(result.items[0].trainerType, 'supporter');
    assert.strictEqual(result.items[1].aceSpec, true);
    assert.strictEqual(result.items[2].energyType, 'basic');
  });

  test('preserves rank field when present', () => {
    const input = {
      deckTotal: 50,
      items: [
        { name: 'Popular Card', found: 45, total: 50, pct: 90, rank: 1 },
        { name: 'Common Card', found: 30, total: 50, pct: 60, rank: 2 }
      ]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items[0].rank, 1);
    assert.strictEqual(result.items[1].rank, 2);
  });

  test('handles numeric number field (not just string)', () => {
    const input = {
      deckTotal: 5,
      items: [{ name: 'TestCard', found: 5, total: 5, pct: 100, number: 42 }]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items[0].number, 42);
  });
});

// =============================================================================
// parseReport() - Empty Report Handling
// =============================================================================

describe('parseReport() - Empty Report Handling', () => {
  test('handles report with empty items array', () => {
    const input = { deckTotal: 0, items: [] };

    const result = parseReport(input);

    assert.strictEqual(result.deckTotal, 0);
    assert.strictEqual(result.items.length, 0);
  });

  test('uses items length as fallback when deckTotal is missing', () => {
    const input = {
      items: [
        { name: 'Card1', found: 1, total: 1, pct: 100 },
        { name: 'Card2', found: 1, total: 1, pct: 100 }
      ]
    };

    const result = parseReport(input);

    // Should fallback to valid items count
    assert.strictEqual(result.deckTotal, 2);
  });

  test('uses items length as fallback when deckTotal is negative', () => {
    const input = {
      deckTotal: -5,
      items: [{ name: 'Card', found: 1, total: 1, pct: 100 }]
    };

    const result = parseReport(input);

    assert.strictEqual(result.deckTotal, 1);
  });

  test('uses items length as fallback when deckTotal is not a number', () => {
    const input = {
      deckTotal: 'invalid' as any,
      items: [{ name: 'Card', found: 1, total: 1, pct: 100 }]
    };

    const result = parseReport(input);

    assert.strictEqual(result.deckTotal, 1);
  });
});

// =============================================================================
// parseReport() - Malformed Data Handling
// =============================================================================

describe('parseReport() - Malformed Data Handling', () => {
  test('throws AppError for null data', () => {
    assert.throws(
      () => parseReport(null),
      (error: Error) => {
        return error.message.includes('null or undefined');
      }
    );
  });

  test('throws AppError for undefined data', () => {
    assert.throws(
      () => parseReport(undefined),
      (error: Error) => {
        return error.message.includes('null or undefined');
      }
    );
  });

  test('throws AppError when items is not an array', () => {
    assert.throws(
      () => parseReport({ deckTotal: 10, items: 'not-an-array' }),
      (error: Error) => {
        return error.message.includes('items array');
      }
    );
  });

  test('throws AppError when items is missing', () => {
    assert.throws(
      () => parseReport({ deckTotal: 10 }),
      (error: Error) => {
        return error.message.includes('items array');
      }
    );
  });

  test('throws AppError when data is not an object', () => {
    assert.throws(
      () => parseReport('string data'),
      (error: Error) => {
        return error.message.includes('must be object');
      }
    );
  });

  test('filters out items that are not objects', () => {
    const input = {
      deckTotal: 5,
      items: [{ name: 'ValidCard', found: 5, total: 5, pct: 100 }, 'invalid string', 123, null, undefined]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0].name, 'ValidCard');
  });

  test('filters out items with missing name', () => {
    const input = {
      deckTotal: 3,
      items: [
        { name: 'ValidCard', found: 5, total: 5, pct: 100 },
        { found: 3, total: 5, pct: 60 }, // missing name
        { name: '', found: 2, total: 5, pct: 40 } // empty name
      ]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0].name, 'ValidCard');
  });

  test('filters out items with non-string name', () => {
    const input = {
      deckTotal: 2,
      items: [
        { name: 123, found: 5, total: 5, pct: 100 },
        { name: { nested: 'object' }, found: 3, total: 5, pct: 60 }
      ]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items.length, 0);
  });

  test('defaults found and total to 0 when not numbers', () => {
    const input = {
      deckTotal: 1,
      items: [{ name: 'TestCard', found: 'invalid', total: null, pct: 50 }]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items[0].found, 0);
    assert.strictEqual(result.items[0].total, 0);
  });
});

// =============================================================================
// parseReport() - Distribution Calculation
// =============================================================================

describe('parseReport() - Distribution Calculation', () => {
  test('calculates percentage when missing but total > 0', () => {
    const input = {
      deckTotal: 100,
      items: [{ name: 'TestCard', found: 75, total: 100 }]
    };

    const result = parseReport(input);

    // Should calculate: (75/100) * 100 = 75
    assert.strictEqual(result.items[0].pct, 75);
  });

  test('calculates percentage when pct is 0 and total > 0', () => {
    const input = {
      deckTotal: 80,
      items: [{ name: 'TestCard', found: 40, total: 80, pct: 0 }]
    };

    const result = parseReport(input);

    // Should calculate: (40/80) * 100 = 50
    assert.strictEqual(result.items[0].pct, 50);
  });

  test('calculates percentage when pct is NaN', () => {
    const input = {
      deckTotal: 50,
      items: [{ name: 'TestCard', found: 25, total: 50, pct: NaN }]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items[0].pct, 50);
  });

  test('rounds percentage to 2 decimal places', () => {
    const input = {
      deckTotal: 30,
      items: [{ name: 'TestCard', found: 7, total: 30 }]
    };

    const result = parseReport(input);

    // 7/30 * 100 = 23.333...
    assert.strictEqual(result.items[0].pct, 23.33);
  });

  test('preserves valid pct when provided', () => {
    const input = {
      deckTotal: 100,
      items: [{ name: 'TestCard', found: 80, total: 100, pct: 82.5 }]
    };

    const result = parseReport(input);

    // Should preserve the provided pct (rounded to 2 decimals)
    assert.strictEqual(result.items[0].pct, 82.5);
  });

  test('handles dist array with numeric values (legacy format)', () => {
    const input = {
      deckTotal: 10,
      items: [
        {
          name: 'TestCard',
          found: 10,
          total: 10,
          pct: 100,
          dist: [1, 2, 3, 4]
        }
      ]
    };

    const result = parseReport(input);

    assert.ok(Array.isArray(result.items[0].dist));
    assert.strictEqual(result.items[0].dist!.length, 4);
    assert.strictEqual(result.items[0].dist![0].copies, 1);
    assert.strictEqual(result.items[0].dist![2].copies, 3);
  });

  test('handles dist array with v2 schema objects', () => {
    const input = {
      deckTotal: 10,
      items: [
        {
          name: 'TestCard',
          found: 10,
          total: 10,
          pct: 100,
          dist: [
            { copies: 1, players: 2, percent: 20 },
            { copies: 2, players: 5, percent: 50 },
            { copies: 3, players: 3, percent: 30 }
          ]
        }
      ]
    };

    const result = parseReport(input);

    assert.ok(Array.isArray(result.items[0].dist));
    assert.strictEqual(result.items[0].dist!.length, 3);
    assert.strictEqual(result.items[0].dist![0].copies, 1);
    assert.strictEqual(result.items[0].dist![0].players, 2);
    assert.strictEqual(result.items[0].dist![0].percent, 20);
  });

  test('filters out invalid dist entries', () => {
    const input = {
      deckTotal: 10,
      items: [
        {
          name: 'TestCard',
          found: 10,
          total: 10,
          pct: 100,
          dist: [{ copies: 1, players: 5 }, 'invalid', null, { copies: 2 }]
        }
      ]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items[0].dist!.length, 2);
  });

  test('handles dist with non-finite values', () => {
    const input = {
      deckTotal: 10,
      items: [
        {
          name: 'TestCard',
          found: 10,
          total: 10,
          pct: 100,
          dist: [{ copies: Infinity, players: NaN, percent: 50 }]
        }
      ]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items[0].dist![0].copies, undefined);
    assert.strictEqual(result.items[0].dist![0].players, undefined);
    assert.strictEqual(result.items[0].dist![0].percent, 50);
  });
});

// =============================================================================
// parseReport() - Edge Cases
// =============================================================================

describe('parseReport() - Edge Cases', () => {
  test('trims whitespace from card names', () => {
    const input = {
      deckTotal: 1,
      items: [{ name: '  Padded Name  ', found: 1, total: 1, pct: 100 }]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items[0].name, 'Padded Name');
  });

  test('handles Unicode characters in card names', () => {
    const input = {
      deckTotal: 3,
      items: [
        { name: 'Pikachu ex', found: 1, total: 3, pct: 33.33 },
        { name: 'Miraidon \u00e9x', found: 1, total: 3, pct: 33.33 },
        { name: '\u30DD\u30B1\u30E2\u30F3', found: 1, total: 3, pct: 33.33 } // Japanese
      ]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items.length, 3);
    assert.strictEqual(result.items[0].name, 'Pikachu ex');
    assert.strictEqual(result.items[1].name, 'Miraidon \u00e9x');
    assert.strictEqual(result.items[2].name, '\u30DD\u30B1\u30E2\u30F3');
  });

  test('handles very large datasets', () => {
    const items: Array<{ name: string; found: number; total: number; pct: number }> = [];
    for (let i = 0; i < 10000; i++) {
      items.push({
        name: `Card ${i}`,
        found: Math.floor(Math.random() * 100),
        total: 100,
        pct: Math.random() * 100
      });
    }

    const input = { deckTotal: 100, items };

    const result = parseReport(input);

    assert.strictEqual(result.items.length, 10000);
  });

  test('handles empty string uid/set gracefully', () => {
    const input = {
      deckTotal: 1,
      items: [
        {
          name: 'TestCard',
          found: 1,
          total: 1,
          pct: 100,
          uid: '',
          set: ''
        }
      ]
    };

    const result = parseReport(input);

    // Empty strings should not be preserved
    assert.strictEqual(result.items[0].uid, undefined);
    assert.strictEqual(result.items[0].set, undefined);
  });

  test('handles whitespace-only category/trainerType/energyType', () => {
    const input = {
      deckTotal: 1,
      items: [
        {
          name: 'TestCard',
          found: 1,
          total: 1,
          pct: 100,
          category: '   ',
          trainerType: '   ',
          energyType: '   '
        }
      ]
    };

    const result = parseReport(input);

    // Whitespace-only should not be preserved
    assert.strictEqual(result.items[0].category, undefined);
    assert.strictEqual(result.items[0].trainerType, undefined);
    assert.strictEqual(result.items[0].energyType, undefined);
  });

  test('normalizes category to lowercase', () => {
    const input = {
      deckTotal: 1,
      items: [
        {
          name: 'TestCard',
          found: 1,
          total: 1,
          pct: 100,
          category: 'Pokemon'
        }
      ]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items[0].category, 'pokemon');
  });

  test('aceSpec is only preserved when exactly true', () => {
    const input = {
      deckTotal: 3,
      items: [
        { name: 'Card1', found: 1, total: 3, pct: 33, aceSpec: true },
        { name: 'Card2', found: 1, total: 3, pct: 33, aceSpec: false },
        { name: 'Card3', found: 1, total: 3, pct: 33, aceSpec: 'yes' }
      ]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items[0].aceSpec, true);
    assert.strictEqual(result.items[1].aceSpec, undefined);
    assert.strictEqual(result.items[2].aceSpec, undefined);
  });

  test('handles zero found and total values', () => {
    const input = {
      deckTotal: 0,
      items: [{ name: 'ZeroCard', found: 0, total: 0, pct: 0 }]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items[0].found, 0);
    assert.strictEqual(result.items[0].total, 0);
    assert.strictEqual(result.items[0].pct, 0);
  });

  test('handles report with only invalid items', () => {
    const input = {
      deckTotal: 5,
      items: [null, undefined, 'string', 123, { noName: true }]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items.length, 0);
    // deckTotal is preserved if valid (>= 0), even when all items are filtered out
    assert.strictEqual(result.deckTotal, 5);
  });

  test('handles mixed valid and invalid items', () => {
    const input = {
      deckTotal: 10,
      items: [
        { name: 'ValidCard1', found: 5, total: 10, pct: 50 },
        null,
        { name: 'ValidCard2', found: 3, total: 10, pct: 30 },
        { invalid: 'item' },
        { name: 'ValidCard3', found: 2, total: 10, pct: 20 }
      ]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items.length, 3);
    assert.strictEqual(result.deckTotal, 10); // Original deckTotal preserved since valid
  });

  test('type safety: result conforms to ParsedReport', () => {
    const input = {
      deckTotal: 5,
      items: [{ name: 'TestCard', found: 5, total: 5, pct: 100 }]
    };

    const result: ParsedReport = parseReport(input);

    // TypeScript compilation ensures type safety
    assert.ok(typeof result.deckTotal === 'number');
    assert.ok(Array.isArray(result.items));
    assert.ok(result.items.every((item: CardItem) => typeof item.name === 'string'));
  });
});

// =============================================================================
// parseReport() - Invalid Data Types
// =============================================================================

describe('parseReport() - Invalid Data Types', () => {
  test('throws for array input (not object)', () => {
    assert.throws(
      () => parseReport([{ name: 'Card', found: 1, total: 1, pct: 100 }]),
      (error: Error) => {
        // Arrays are technically objects in JS, but our validation checks for items array
        return error.message.includes('items array');
      }
    );
  });

  test('throws for number input', () => {
    assert.throws(
      () => parseReport(42),
      (error: Error) => {
        return error.message.includes('must be object');
      }
    );
  });

  test('throws for boolean input', () => {
    assert.throws(
      () => parseReport(true),
      (error: Error) => {
        return error.message.includes('must be object');
      }
    );
  });

  test('throws for function input', () => {
    assert.throws(
      () => parseReport(() => {}),
      (error: Error) => {
        return error.message.includes('must be object');
      }
    );
  });

  test('handles object with items as null', () => {
    assert.throws(
      () => parseReport({ deckTotal: 5, items: null }),
      (error: Error) => {
        return error.message.includes('items array');
      }
    );
  });

  test('handles object with items as object (not array)', () => {
    assert.throws(
      () => parseReport({ deckTotal: 5, items: { 0: { name: 'Card' } } }),
      (error: Error) => {
        return error.message.includes('items array');
      }
    );
  });
});

// =============================================================================
// parseReport() - Boundary Conditions
// =============================================================================

describe('parseReport() - Boundary Conditions', () => {
  test('handles deckTotal of exactly 0', () => {
    const input = {
      deckTotal: 0,
      items: []
    };

    const result = parseReport(input);

    assert.strictEqual(result.deckTotal, 0);
  });

  test('handles very large deckTotal', () => {
    const input = {
      deckTotal: Number.MAX_SAFE_INTEGER,
      items: [{ name: 'Card', found: 1, total: 1, pct: 100 }]
    };

    const result = parseReport(input);

    assert.strictEqual(result.deckTotal, Number.MAX_SAFE_INTEGER);
  });

  test('handles percentage of 0%', () => {
    const input = {
      deckTotal: 100,
      items: [{ name: 'RareCard', found: 0, total: 100, pct: 0 }]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items[0].pct, 0);
  });

  test('handles percentage of 100%', () => {
    const input = {
      deckTotal: 50,
      items: [{ name: 'StapleCard', found: 50, total: 50, pct: 100 }]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items[0].pct, 100);
  });

  test('handles percentage > 100 (edge case from bad data)', () => {
    const input = {
      deckTotal: 10,
      items: [{ name: 'OverflowCard', found: 15, total: 10, pct: 150 }]
    };

    const result = parseReport(input);

    // Should preserve the provided pct even if > 100
    assert.strictEqual(result.items[0].pct, 150);
  });

  test('handles floating point precision in percentage', () => {
    const input = {
      deckTotal: 3,
      items: [{ name: 'Card', found: 1, total: 3 }]
    };

    const result = parseReport(input);

    // 1/3 * 100 = 33.333... should round to 33.33
    assert.strictEqual(result.items[0].pct, 33.33);
  });

  test('handles single item report', () => {
    const input = {
      deckTotal: 1,
      items: [{ name: 'OnlyCard', found: 1, total: 1, pct: 100 }]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0].name, 'OnlyCard');
  });

  test('handles special characters in card name', () => {
    const input = {
      deckTotal: 1,
      items: [{ name: "Professor's Research (Professor Sada)", found: 1, total: 1, pct: 100 }]
    };

    const result = parseReport(input);

    assert.strictEqual(result.items[0].name, "Professor's Research (Professor Sada)");
  });

  test('handles card names with HTML-like characters', () => {
    const input = {
      deckTotal: 1,
      items: [{ name: '<script>alert("xss")</script>', found: 1, total: 1, pct: 100 }]
    };

    const result = parseReport(input);

    // parseReport should preserve the name as-is (sanitization happens at render time)
    assert.strictEqual(result.items[0].name, '<script>alert("xss")</script>');
  });
});
