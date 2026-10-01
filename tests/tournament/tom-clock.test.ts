/**
 * A TOM event's round clocks are the site's: a synced file's timer is set
 * aside, and the revision a sync is checked against does not see clocks.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { revisionOf } from '../../shared/tournament/revision.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import { withoutClocks, withSiteClocks } from '../../shared/tournament/tomClock.ts';
import type { Round, Tournament } from '../../shared/tournament/types.ts';

const CHALLENGE = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));

const roundsOf = (tournament: Tournament) => tournament.pods[0]?.rounds ?? [];

function withRounds(tournament: Tournament, change: (round: Round) => Round): Tournament {
  return { ...tournament, pods: tournament.pods.map(pod => ({ ...pod, rounds: pod.rounds.map(change) })) };
}

test('a file with no copy held starts every round unstarted with its full time', () => {
  assert.equal(roundsOf(CHALLENGE)[0]?.timeLeft, 612, 'the fixture carries a TOM timer');
  const fresh = roundsOf(withSiteClocks(CHALLENGE, null));
  for (const round of fresh) {
    assert.equal(round.timeLeft, 30 * 60);
    assert.equal(round.startTime, '');
    assert.equal(round.clockStartedAt, null);
  }
  assert.equal(fresh[0]?.status, 'finished', 'only the clock is set aside');
});

test('a top cut round starts with the finals round time', () => {
  const cut = withRounds(CHALLENGE, round => ({ ...round, kind: 'elimination' }));
  assert.equal(roundsOf(withSiteClocks(cut, null))[0]?.timeLeft, 75 * 60);
});

test('a round the site holds keeps its clock whatever the file says', () => {
  const held = withRounds(CHALLENGE, round =>
    round.number === 2 ? { ...round, timeLeft: 900, startTime: '10/03/2026 13:00:00', clockStartedAt: 1_000 } : round
  );
  const file = withRounds(CHALLENGE, round => ({ ...round, timeLeft: 42, startTime: '10/03/2026 13:05:00' }));
  const [first, second] = roundsOf(withSiteClocks(file, held));
  assert.deepEqual(
    { timeLeft: second?.timeLeft, startTime: second?.startTime, clockStartedAt: second?.clockStartedAt },
    { timeLeft: 900, startTime: '10/03/2026 13:00:00', clockStartedAt: 1_000 }
  );
  assert.equal(first?.timeLeft, 612, 'the held round 1 keeps the clock it was created with');
});

test('a round new from TOM gets a fresh clock beside the ones kept', () => {
  const held = { ...CHALLENGE, pods: CHALLENGE.pods.map(pod => ({ ...pod, rounds: pod.rounds.slice(0, 1) })) };
  const [first, second] = roundsOf(withSiteClocks(CHALLENGE, withSiteClocks(held, null)));
  assert.equal(first?.timeLeft, 30 * 60);
  assert.equal(second?.timeLeft, 30 * 60);
  assert.equal(second?.startTime, '');
});

test('the revision does not change with the clock, but does with anything else', async () => {
  const running = withRounds(CHALLENGE, round => ({ ...round, timeLeft: 1, clockStartedAt: 5, startTime: 'x' }));
  assert.equal(await revisionOf(running), await revisionOf(CHALLENGE));
  const renamed = { ...CHALLENGE, info: { ...CHALLENGE.info, name: 'Another' } };
  assert.notEqual(await revisionOf(renamed), await revisionOf(CHALLENGE));
  assert.equal('timeLeft' in (withoutClocks(CHALLENGE).pods[0]?.rounds[0] ?? {}), false);
});
