/**
 * tests/utils/format.test.ts
 * Tests for src/utils/format.ts formatting utilities
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { prettyTournamentName } from '../../src/utils/format.js';

// ============================================================================
// prettyTournamentName tests
// ============================================================================

test('prettyTournamentName extracts name from date-prefixed key', () => {
  assert.strictEqual(prettyTournamentName('2025-01-15, Some Tournament'), 'Some Tournament');
});

test('prettyTournamentName handles different date formats', () => {
  assert.strictEqual(prettyTournamentName('2024-12-31, New Years Eve Cup'), 'New Years Eve Cup');
  assert.strictEqual(prettyTournamentName('2020-01-01, First Tournament'), 'First Tournament');
});

test('prettyTournamentName preserves extra commas in tournament name', () => {
  // Only the first comma (after date) should be used as delimiter
  assert.strictEqual(prettyTournamentName('2025-06-20, Championship, Round 1'), 'Championship, Round 1');
});

test('prettyTournamentName returns key unchanged if no date prefix', () => {
  assert.strictEqual(prettyTournamentName('No Date Tournament'), 'No Date Tournament');
  assert.strictEqual(prettyTournamentName('Regular Name'), 'Regular Name');
});

test('prettyTournamentName returns key unchanged for partial date format', () => {
  // Missing parts of the date pattern
  assert.strictEqual(prettyTournamentName('2025-01, Some Tournament'), '2025-01, Some Tournament');
  assert.strictEqual(prettyTournamentName('2025, Some Tournament'), '2025, Some Tournament');
  assert.strictEqual(prettyTournamentName('01-15, Some Tournament'), '01-15, Some Tournament');
});

test('prettyTournamentName handles whitespace variations after comma', () => {
  // Single space (standard)
  assert.strictEqual(prettyTournamentName('2025-01-15, Tournament'), 'Tournament');
  // Multiple spaces - the regex uses \s* so extra spaces are consumed
  assert.strictEqual(prettyTournamentName('2025-01-15,  Tournament'), 'Tournament');
  // No space - also matches since \s* allows zero spaces
  assert.strictEqual(prettyTournamentName('2025-01-15,Tournament'), 'Tournament');
});

test('prettyTournamentName handles empty string', () => {
  assert.strictEqual(prettyTournamentName(''), '');
});

test('prettyTournamentName handles null and undefined gracefully', () => {
  // The function checks for falsy values and returns the input unchanged
  assert.strictEqual(prettyTournamentName(null as unknown as string), null);
  assert.strictEqual(prettyTournamentName(undefined as unknown as string), undefined);
});

test('prettyTournamentName handles non-string input gracefully', () => {
  // The function has typeof check and returns input unchanged for non-strings
  assert.strictEqual(prettyTournamentName(123 as unknown as string), 123);
  // Objects are also returned unchanged - use deepStrictEqual for object comparison
  assert.deepStrictEqual(prettyTournamentName({} as unknown as string), {});
});

test('prettyTournamentName handles unicode characters in tournament name', () => {
  assert.strictEqual(prettyTournamentName('2025-03-15, 東京カップ'), '東京カップ');
  assert.strictEqual(prettyTournamentName('2025-03-15, Türkiye Şampiyonası'), 'Türkiye Şampiyonası');
  assert.strictEqual(prettyTournamentName('2025-03-15, 🏆 Trophy Event'), '🏆 Trophy Event');
});

test('prettyTournamentName handles only date without name', () => {
  // Date followed by comma and only whitespace - regex requires at least one char after comma+space
  // The regex is: /^\d{4}-\d{2}-\d{2},\s*(.+)$/ - (.+) matches at least one char
  // With trailing space, it matches ' ' as the name
  assert.strictEqual(prettyTournamentName('2025-01-15, '), ' ');
  // No trailing content - doesn't match, returns unchanged
  assert.strictEqual(prettyTournamentName('2025-01-15,'), '2025-01-15,');
});

test('prettyTournamentName handles date-like strings that are not valid dates', () => {
  // Invalid month/day values - regex only checks format, not validity
  assert.strictEqual(prettyTournamentName('2025-13-45, Invalid Date'), 'Invalid Date');
  assert.strictEqual(prettyTournamentName('9999-99-99, Far Future'), 'Far Future');
});
