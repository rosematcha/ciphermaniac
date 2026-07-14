/**
 * tests/data/event-matches.test.ts
 * Match serving builders (playerMatches.json + matches.json) from normalized events.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildCanonicalMatches, buildPlayerMatches } from '../../shared/data/reports/eventMatches.ts';
import { canonicalStringify } from '../../shared/data/canonicalJson.ts';
import type { NormalizedEvent } from '../../shared/data/contracts.ts';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'data-pipeline');
const labs = JSON.parse(readFileSync(join(fixturesDir, 'labs-event.json'), 'utf8')) as NormalizedEvent;
const online = JSON.parse(readFileSync(join(fixturesDir, 'online-window.json'), 'utf8')) as NormalizedEvent;

test('playerMatches: two rows per pair match, one per solo match', () => {
  const rows = buildPlayerMatches(labs);
  // Rows are emitted only from a DECKED pilot's perspective (matching legacy).
  // 3 pair matches (all four pilots decked) = 6 rows, + 103's bye = 1. Player
  // 105 has no decklist, so its unpaired row is excluded. 6 + 1 = 7.
  assert.strictEqual(rows.length, 7);
  assert.strictEqual(rows.some(r => r.playerId === 'labs:0001:105'), false);
});

test('playerMatches: decided match yields win for winner, loss for the other', () => {
  const rows = buildPlayerMatches(labs);
  const r1 = rows.filter(r => r.round === 1 && (r.playerId === 'labs:0001:101' || r.playerId === 'labs:0001:102'));
  const winner = r1.find(r => r.playerId === 'labs:0001:101');
  const loser = r1.find(r => r.playerId === 'labs:0001:102');
  assert.strictEqual(winner?.outcome, 'win');
  assert.strictEqual(loser?.outcome, 'loss');
  // opponent joins resolve
  assert.strictEqual(winner?.opponentId, 'labs:0001:102');
  assert.strictEqual(winner?.opponentName, 'Bob');
  assert.strictEqual(winner?.playerArchetype, labs.decks.find(d => d.participantId === 'labs:0001:101')?.archetype.displayName);
});

test('playerMatches: tie/double_loss/bye/unpaired map through per side', () => {
  const rows = buildPlayerMatches(labs);
  assert.strictEqual(rows.find(r => r.playerId === 'labs:0001:103' && r.round === 1)?.outcome, 'tie');
  assert.strictEqual(rows.find(r => r.playerId === 'labs:0001:101' && r.round === 2)?.outcome, 'double_loss');
  const bye = rows.find(r => r.playerId === 'labs:0001:103' && r.round === 2);
  assert.strictEqual(bye?.outcome, 'bye');
  assert.strictEqual(bye?.opponentId, null);
  // 105 (no decklist) contributes no perspective rows, so its unpaired row is absent.
  assert.strictEqual(rows.find(r => r.playerId === 'labs:0001:105' && r.round === 2), undefined);
});

test('playerMatches: flags come from the pilot participant', () => {
  const rows = buildPlayerMatches(labs);
  const alice = rows.find(r => r.playerId === 'labs:0001:101');
  assert.strictEqual(alice?.madePhase2, true);
  assert.strictEqual(alice?.madeTopCut, true);
});

test('canonical matches: one row per match, winner + archetypes resolved', () => {
  const rows = buildCanonicalMatches(labs);
  assert.strictEqual(rows.length, labs.matches.length);
  const decided = rows.find(r => r.outcome === 'decided');
  assert.ok(decided);
  assert.strictEqual(decided.winnerParticipantId, 'labs:0001:101');
  assert.strictEqual(decided.participant1Archetype, labs.decks.find(d => d.participantId === decided.participant1Id)?.archetype.displayName);
  const bye = rows.find(r => r.outcome === 'bye');
  assert.strictEqual(bye?.participant2Id, null);
  assert.strictEqual(bye?.participant2MadePhase2, null);
});

test('both builders are permutation-invariant (input order cannot change bytes)', () => {
  const reversed: NormalizedEvent = { ...labs, matches: [...labs.matches].reverse() };
  assert.strictEqual(canonicalStringify(buildPlayerMatches(labs)), canonicalStringify(buildPlayerMatches(reversed)));
  assert.strictEqual(canonicalStringify(buildCanonicalMatches(labs)), canonicalStringify(buildCanonicalMatches(reversed)));
});

test('online windows have no matches (empty artifacts)', () => {
  assert.deepStrictEqual(buildPlayerMatches(online), []);
  assert.deepStrictEqual(buildCanonicalMatches(online), []);
});
