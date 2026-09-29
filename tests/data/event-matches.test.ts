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
import type { NormalizedEvent } from '../../shared/data/contracts.ts';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'data-pipeline');
const labs = JSON.parse(readFileSync(join(fixturesDir, 'labs-event.json'), 'utf8')) as NormalizedEvent;

test('unknown match outcomes stay unknown for both participants', () => {
  const event = structuredClone(labs);
  event.matches = event.matches.map(match => ({ ...match, outcome: 'unknown' }));
  const rows = buildPlayerMatches(event);
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => row.outcome === 'unknown'));
});

test('playerMatches: two rows per pair match, one per solo match', () => {
  const rows = buildPlayerMatches(labs);
  // Rows are emitted only from a DECKED pilot's perspective (matching legacy).
  // 3 pair matches (all four pilots decked) = 6 rows, + 103's bye = 1. Player
  // 105 has no decklist, so its unpaired row is excluded. 6 + 1 = 7.
  assert.strictEqual(rows.length, 7);
  assert.strictEqual(
    rows.some(r => r.playerId === 'labs:0001:105'),
    false
  );
});

test('playerMatches: each row maps its outcome, opponent, and flags from the pilot side', () => {
  const rows = buildPlayerMatches(labs);
  const row = (playerId: string, round: number) => rows.find(r => r.playerId === playerId && r.round === round);
  const winner = row('labs:0001:101', 1);
  assert.strictEqual(winner?.outcome, 'win');
  assert.strictEqual(row('labs:0001:102', 1)?.outcome, 'loss');
  assert.strictEqual(row('labs:0001:103', 1)?.outcome, 'tie');
  assert.strictEqual(row('labs:0001:101', 2)?.outcome, 'double_loss');
  // opponent joins resolve
  assert.strictEqual(winner?.opponentId, 'labs:0001:102');
  assert.strictEqual(winner?.opponentName, 'Bob');
  assert.strictEqual(
    winner?.playerArchetype,
    labs.decks.find(d => d.participantId === 'labs:0001:101')?.archetype.displayName
  );
  assert.strictEqual(winner?.madePhase2, true);
  assert.strictEqual(winner?.madeTopCut, true);
  const bye = row('labs:0001:103', 2);
  assert.strictEqual(bye?.outcome, 'bye');
  assert.strictEqual(bye?.opponentId, null);
});

test('canonical matches: one row per match, winner + archetypes resolved', () => {
  const rows = buildCanonicalMatches(labs);
  assert.strictEqual(rows.length, labs.matches.length);
  const decided = rows.find(r => r.outcome === 'decided');
  assert.ok(decided);
  assert.strictEqual(decided.winnerParticipantId, 'labs:0001:101');
  assert.strictEqual(
    decided.participant1Archetype,
    labs.decks.find(d => d.participantId === decided.participant1Id)?.archetype.displayName
  );
  const bye = rows.find(r => r.outcome === 'bye');
  assert.strictEqual(bye?.participant2Id, null);
  assert.strictEqual(bye?.participant2MadePhase2, null);
});
