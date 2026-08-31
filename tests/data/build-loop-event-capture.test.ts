/**
 * tests/data/build-loop-event-capture.test.ts
 * Which event folders the release build captures into immutable roots.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { planEventCapture } from '../../.github/scripts/build-loop.ts';

const populated = { decks: [{ playerId: '1' }], players: [{ tpId: 1 }], meta: { name: 'Event' } };

const reasonFor = (bodies: Parameters<typeof planEventCapture>[0]): string => {
  const plan = planEventCapture(bodies);
  assert.equal(plan.capture, false, 'expected the folder to be skipped');
  return plan.capture ? '' : plan.reason;
};

test('a populated event folder is captured, carrying its bodies through', () => {
  const plan = planEventCapture(populated);
  assert.equal(plan.capture, true);
  assert.deepEqual(plan.capture ? plan.decks : null, populated.decks);
});

test('an event whose decklists are not published yet is skipped', () => {
  // Labs publishes standings first; capturing here would freeze deckTotal:0
  // into an immutable release body that serves 200 and never falls back.
  assert.equal(reasonFor({ ...populated, decks: [] }), '0 decks (decklists not published yet)');
});

test('a folder missing any required body is skipped, naming what is absent', () => {
  assert.equal(reasonFor({ ...populated, decks: null }), 'missing decks.json');
  assert.equal(reasonFor({ ...populated, players: null }), 'missing players.json');
  assert.equal(reasonFor({ ...populated, meta: null }), 'missing meta.json');
  assert.equal(reasonFor({ decks: null, players: null, meta: null }), 'missing decks.json, players.json, meta.json');
});
