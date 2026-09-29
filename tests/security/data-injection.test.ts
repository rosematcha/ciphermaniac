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
test('Logger flattens CR/LF in string arguments so input cannot forge log lines', () => {
  assert.deepEqual(formatForTest('User input\nERR: injected', ['a\r\nb', 5]), ['User input ERR: injected', 'a b', 5]);
});

/**
 * Card name sanitization in reports: a malicious card name must not carry
 * traversal sequences or separators into the generated report.
 */
test('Report generation sanitizes card names', () => {
  const deck = generateMockDeck({
    cards: [{ id: 'c1', name: 'EvilCard/..\\secret', count: 3, category: 'Other' }]
  } as any);

  const report = generateReportFromDecks([deck], 1, null);
  assert.deepEqual(
    report.items.map(item => item.name),
    ['EvilCardsecret']
  );
});
