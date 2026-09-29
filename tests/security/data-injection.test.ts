/**
 * tests/security/data-injection.test.ts
 * Tests for injection resistance in data processing and storage keys.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { generateMockDeck } from '../__utils__/mock-data-factory.js';

import { formatForTest } from '../../shared/logger.ts';
import { generateReportFromDecks } from '../../shared/data/reports/cardReport.js';

/**
 * Logging: ensure log data is newline-safe (no log injection)
 */
test('Logger should not allow newline injection in logged messages', () => {
  const dangerous = 'User input\nERR: injected';
  // The logger.format function should create a single-line prefix, so message containing newlines should be preserved but not cause multi-line metadata injection
  const parts = formatForTest(dangerous, []);
  const joined = parts.join(' ');
  assert.equal(joined.includes('\n'), false, 'Formatted log output should not contain raw newline characters');
});

/**
 * Card name sanitization in reports: generate a report containing a malicious card name and ensure
 * that generated UIDs or filenames do not include traversal sequences
 */
test('Report generation sanitizes card names before publishing', () => {
  const deck = generateMockDeck({
    cards: [{ id: 'c1', name: 'EvilCard/..\\secret', count: 3, category: 'Other' }]
  } as any);

  const report = generateReportFromDecks([deck], 1, null);
  assert.deepEqual(
    report.items.map(item => item.name),
    ['EvilCardsecret']
  );
});
