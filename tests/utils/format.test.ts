import test from 'node:test';
import assert from 'node:assert/strict';

import { formatRecord } from '../../src/lib/format.ts';
import type { TournamentParticipant } from '../../src/types/index.ts';

function participant(overrides: Partial<TournamentParticipant> = {}): TournamentParticipant {
  return { tpId: 1, name: 'Test Player', ...overrides };
}

test('formatRecord returns an em dash when wins, losses, and ties are all missing', () => {
  assert.equal(formatRecord(participant()), '—');
  assert.equal(formatRecord(participant({ wins: null, losses: null, ties: null })), '—');
});

test('formatRecord treats missing fields as 0 once at least one value is reported', () => {
  assert.equal(formatRecord(participant({ wins: 3 })), '3-0-0');
  assert.equal(formatRecord(participant({ losses: 2 })), '0-2-0');
  assert.equal(formatRecord(participant({ ties: 1 })), '0-0-1');
});

test('formatRecord renders a full record as-is', () => {
  assert.equal(formatRecord(participant({ wins: 6, losses: 2, ties: 1 })), '6-2-1');
});
