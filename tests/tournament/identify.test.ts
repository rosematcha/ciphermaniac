/**
 * Finding a player on the event's list: by Player ID at a sanctioned event,
 * by name at an unsanctioned one.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCommand, type Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { decklistPlayer, nameKey } from '../../shared/tournament/identify.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import type { Tournament } from '../../shared/tournament/types.ts';

const NAMES: [string, string][] = [
  ['Ash', 'Ketchum'],
  ['Misty', 'Waterflower'],
  ['Brock', 'Harrison'],
  ['Gary', 'Oak'],
  ['Daisy', 'Oak']
];

function field(): Tournament {
  let t = emptyTournament({ name: 'Cup' }, true);
  NAMES.forEach(([firstName, lastName], i) => {
    const command: Command = { type: 'addPlayer', player: { firstName, lastName, id: String(100 + i) } };
    const result = applyCommand(t, command, { now: 0, localTime: '', season: 2027, random: seededRandom(1) });
    assert.ok(result.ok);
    t = result.tournament;
  });
  return t;
}

test('a decklist finds its player by Player ID, or unsanctioned by full name', () => {
  const t = field();
  const list = { popId: '', firstName: 'Gary', lastName: 'OAK' };
  assert.equal(decklistPlayer(t, list, false), '103');
  assert.equal(decklistPlayer(t, { ...list, firstName: 'Blue' }, false), undefined);
  assert.equal(decklistPlayer(t, { ...list, popId: '103' }, true), '103');
  assert.equal(decklistPlayer(t, list, true), undefined);
  assert.equal(nameKey(' Peña '), 'pena');
});
