import test from 'node:test';
import assert from 'node:assert/strict';

import { extractTournamentDatePrefix, sortTournamentNamesByRecency } from '../../src/utils/tournamentRecency.ts';

test('extractTournamentDatePrefix returns ISO prefix when present', () => {
  assert.equal(extractTournamentDatePrefix('2026-02-13, International Championship London'), '2026-02-13');
  assert.equal(extractTournamentDatePrefix('Special Event Bologna'), null);
  assert.equal(extractTournamentDatePrefix(''), null);
});

test('sortTournamentNamesByRecency puts dated tournaments first and newest-first', () => {
  const input = [
    'Special Event Bologna',
    '2025-11-29, Regional Championship Stuttgart',
    '2026-02-13, International Championship London',
    'Regional Championship Stuttgart',
    '2026-02-07, Regional Championship Santiago'
  ];

  const sorted = sortTournamentNamesByRecency(input);
  assert.deepEqual(sorted, [
    '2026-02-13, International Championship London',
    '2026-02-07, Regional Championship Santiago',
    '2025-11-29, Regional Championship Stuttgart',
    'Regional Championship Stuttgart',
    'Special Event Bologna'
  ]);
});

test('sortTournamentNamesByRecency is deterministic for equal classes', () => {
  const input = [
    '2026-02-13, Regional Championship London B',
    '2026-02-13, Regional Championship London A',
    'Undated B',
    'Undated A'
  ];
  const sorted = sortTournamentNamesByRecency(input);
  assert.deepEqual(sorted, [
    '2026-02-13, Regional Championship London A',
    '2026-02-13, Regional Championship London B',
    'Undated A',
    'Undated B'
  ]);
});
