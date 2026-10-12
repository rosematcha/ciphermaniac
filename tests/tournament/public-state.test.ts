import assert from 'node:assert/strict';
import test from 'node:test';

import { publicTournament } from '../../shared/tournament/view.ts';
import { context, generatedEvent, operated } from './conformance-generated.ts';

test('public lifecycle state preserves ranking inputs and replaces every flight player ID', () => {
  const ctx = context(1);
  const started = operated(generatedEvent(64, ctx, { flights: 2 }), { type: 'start' }, ctx);
  const keys = Object.fromEntries(started.players.map((p, i) => [p.id, `public-${i}`]));
  const visible = publicTournament(started, keys);
  assert.deepEqual(visible.settings, started.settings);
  assert.deepEqual(
    visible.players.map(p => p.tiebreaker),
    started.players.map(p => p.tiebreaker)
  );
  assert.deepEqual(
    visible.players.map(p => p.order),
    started.players.map(p => p.order)
  );
  assert.deepEqual(
    visible.pods[0]!.flights,
    started.pods[0]!.flights!.map(f => ({ ...f, playerIds: f.playerIds.map(id => keys[id]!) }))
  );
  assert.ok(visible.players.every(p => p.birthDate === '' && p.created === '' && p.modified === ''));
  assert.equal(visible.passthrough, undefined);
});

test('public lifecycle state replaces player IDs in recorded tie orders', () => {
  const ctx = context(1);
  const started = operated(generatedEvent(8, ctx), { type: 'start' }, ctx);
  const [a, b] = started.players.map(p => p.id);
  const group = { category: started.pods[0]!.category, playerIds: [a!, b!] };
  const ordered = {
    ...started,
    eliminationTieOrder: [group],
    thirdPlaceOrder: [group],
    headToHeadOrder: [group]
  };
  const keys = Object.fromEntries(started.players.map((p, i) => [p.id, `public-${i}`]));
  const visible = publicTournament(ordered, keys);
  const hidden = [{ category: group.category, playerIds: [keys[a!]!, keys[b!]!] }];
  assert.deepEqual(visible.eliminationTieOrder, hidden);
  assert.deepEqual(visible.thirdPlaceOrder, hidden);
  assert.deepEqual(visible.headToHeadOrder, hidden);
});
