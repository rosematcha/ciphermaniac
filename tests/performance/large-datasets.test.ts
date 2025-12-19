import test from 'node:test';
import assert from 'node:assert/strict';

import { generateLargeTournament } from '../__utils__/mock-data-factory.js';
import { generateReportForFilters } from '../../src/utils/clientSideFiltering.ts';

// Large dataset processing smoke tests

test('process 1000 and 5000 deck tournaments within reasonable time', () => {
  const t1000 = generateLargeTournament(1000);
  const decks1000 = t1000.decks || [];
  const start = Date.now();
  generateReportForFilters(decks1000 as any, decks1000[0]?.archetype || '', []);
  const dur = Date.now() - start;
  assert.ok(dur < 1000, `Processing 1000 decks took ${dur}ms`);

  const t5000 = generateLargeTournament(5000);
  const decks5000 = t5000.decks || [];
  const start2 = Date.now();
  generateReportForFilters(decks5000 as any, decks5000[0]?.archetype || '', []);
  const dur2 = Date.now() - start2;
  assert.ok(dur2 < 5000, `Processing 5000 decks took ${dur2}ms`);
});
