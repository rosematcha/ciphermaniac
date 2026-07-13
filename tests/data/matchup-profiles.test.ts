/**
 * tests/data/matchup-profiles.test.ts
 * Matchup-profile quality-model builder from normalized events.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildMatchupProfiles, PHASE_MULTIPLIERS, QUALITY_MODEL } from '../../shared/data/reports/matchupProfiles.ts';
import { canonicalStringify } from '../../shared/data/canonicalJson.ts';
import type { NormalizedEvent } from '../../shared/data/contracts.ts';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'data-pipeline');
const labs = JSON.parse(readFileSync(join(fixturesDir, 'labs-event.json'), 'utf8')) as NormalizedEvent;
const online = JSON.parse(readFileSync(join(fixturesDir, 'online-window.json'), 'utf8')) as NormalizedEvent;

test('counts decided/tie/double_loss matches with known archetypes', () => {
  const body = buildMatchupProfiles(labs);
  // 101v102 decided + 103v104 tie + 101v102 double_loss = 3; byes/unpaired excluded.
  assert.strictEqual(body.profiles.all.matchesConsidered, 3);
});

test('casing variants of one archetype collapse (mirror not split) — D3', () => {
  const body = buildMatchupProfiles(labs);
  const gardevoir = body.profiles.all.byArchetypePair.find(p => p.archetypeA === 'Gardevoir ex');
  assert.ok(gardevoir, 'Gardevoir mirror pair present');
  // archetypeA === archetypeB proves "Gardevoir ex" and "gardevoir EX" merged.
  assert.strictEqual(gardevoir.archetypeA, gardevoir.archetypeB);
  assert.strictEqual(gardevoir.matches, 2); // decided + double_loss
  assert.strictEqual(gardevoir.doubleLosses, 1);
  assert.strictEqual(gardevoir.winsA, 1);
});

test('a tie splits half a win to each side and counts as a tie', () => {
  const body = buildMatchupProfiles(labs);
  const charizard = body.profiles.all.byArchetypePair.find(p => p.archetypeA === 'Charizard Pidgeot');
  assert.ok(charizard);
  assert.strictEqual(charizard.ties, 1);
  assert.strictEqual(charizard.winsA, 0.5);
  assert.strictEqual(charizard.winsB, 0.5);
});

test('quality weighting differs from unweighted and applies phase multipliers', () => {
  const body = buildMatchupProfiles(labs);
  assert.notStrictEqual(body.profiles.qualityWeighted.weightedMatches, body.profiles.all.weightedMatches);
  assert.strictEqual(body.profiles.all.weightedMatches, 3);
  assert.deepStrictEqual(body.phaseMultipliers, { '1': 1, '2': 1.75, '3': 3 });
  assert.strictEqual(body.qualityModel, QUALITY_MODEL);
});

test('phase multipliers table matches the frozen policy', () => {
  assert.strictEqual(PHASE_MULTIPLIERS[1], 1.0);
  assert.strictEqual(PHASE_MULTIPLIERS[2], 1.75);
  assert.strictEqual(PHASE_MULTIPLIERS[3], 3.0);
});

test('pair labels are sorted (archetypeA <= archetypeB) and rows sorted by weightedMatches', () => {
  const body = buildMatchupProfiles(labs);
  for (const pair of body.profiles.all.byArchetypePair) {
    assert.ok(pair.archetypeA <= pair.archetypeB);
  }
  const wm = body.profiles.all.byArchetypePair.map(p => p.weightedMatches);
  assert.deepStrictEqual(wm, [...wm].sort((a, b) => b - a));
});

test('permutation-invariant: input match order cannot change bytes', () => {
  const reversed: NormalizedEvent = { ...labs, matches: [...labs.matches].reverse(), participants: [...labs.participants].reverse() };
  assert.strictEqual(canonicalStringify(buildMatchupProfiles(labs)), canonicalStringify(buildMatchupProfiles(reversed)));
});

test('online windows produce empty profiles', () => {
  const body = buildMatchupProfiles(online);
  assert.strictEqual(body.profiles.all.matchesConsidered, 0);
  assert.deepStrictEqual(body.profiles.all.byArchetypePair, []);
});
