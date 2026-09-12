/**
 * tests/data/event-cli-catalog.test.ts
 * event-cli rebuild-catalog: dedupe, drop undated, sort by recency.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTournamentCatalog } from '../../.github/scripts/event-cli.ts';

test('sorts dated folders by date descending then name', () => {
  const out = buildTournamentCatalog([
    '2026-01-16, Regional Championship Toronto',
    '2026-02-07, Regional Championship Sydney',
    '2026-02-07, Regional Championship Santiago'
  ]);
  assert.deepStrictEqual(out, [
    '2026-02-07, Regional Championship Santiago',
    '2026-02-07, Regional Championship Sydney',
    '2026-01-16, Regional Championship Toronto'
  ]);
});

test('drops undated folders (online window, snapshots, trends)', () => {
  const out = buildTournamentCatalog(['Snapshots', 'Trends - Last 30 Days', '2026-01-16, Regional X']);
  assert.deepStrictEqual(out, ['2026-01-16, Regional X']);
});

test('dedupes same date + display name, keeping the dated / lexicographically smaller', () => {
  const out = buildTournamentCatalog([
    '2026-01-16, Regional X',
    '2026-01-16, Regional X' // exact dup
  ]);
  assert.deepStrictEqual(out, ['2026-01-16, Regional X']);
});
