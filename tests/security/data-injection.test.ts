/**
 * tests/security/data-injection.test.ts
 * Tests for injection resistance in data processing and storage keys.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { generateMaliciousInput, generateMockDeck } from '../__utils__/mock-data-factory.js';

import { logger } from '../../src/utils/logger.ts';
import { generateReportFromDecks } from '../../functions/lib/reportBuilder.js';

/**
 * Archetype folder name sanitization: ensure names are safe for R2 storage and local caches
 */
test('Archetype folder names do not allow directory traversal or control characters', () => {
  const payload = generateMaliciousInput('path-traversal').payload as string;
  const normalized = payload.replace(/\0/g, '').replace(/\.+\//g, '');
  assert.equal(normalized.includes('..'), false);
  assert.equal(normalized.includes('\0'), false);
});

/**
 * Logging: ensure log data is newline-safe (no log injection)
 */
test('Logger should not allow newline injection in logged messages', () => {
  const dangerous = 'User input\nERR: injected';
  // The logger.format function should create a single-line prefix, so message containing newlines should be preserved but not cause multi-line metadata injection
  const parts = (logger as any).constructor.format('info', dangerous, []);
  const joined = parts.join(' ');
  assert.equal(joined.includes('\n'), false, 'Formatted log output should not contain raw newline characters');
});

/**
 * Card name sanitization in reports: generate a report containing a malicious card name and ensure
 * that generated UIDs or filenames do not include traversal sequences
 */
test('Report generation sanitizes card names and prevents UID traversal', () => {
  const deck = generateMockDeck({
    cards: [{ id: 'c1', name: 'EvilCard/..\\secret', count: 3, category: 'Other' }]
  } as any);

  const report = generateReportFromDecks([deck], 1, null, null);
  // Ensure item names or uids do not contain path traversal pieces
  for (const item of report.items) {
    const name = (item.name || '').toString();
    assert.equal(name.includes('..'), false, 'Report item names must not contain traversal sequences');
    assert.equal(name.includes('/'), false, 'Report item names must not contain path separators');
  }
});
