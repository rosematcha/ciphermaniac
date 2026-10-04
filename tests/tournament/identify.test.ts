/**
 * Finding a player on the event's list from what they typed: by Player ID at
 * a sanctioned event, by name at an unsanctioned one.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCommand, type Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import {
  decklistMatcher,
  decklistPlayer,
  findPlayer,
  nameKey,
  shortLastNames
} from '../../shared/tournament/identify.ts';
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
  let t = emptyTournament({ name: 'Cup' });
  NAMES.forEach(([firstName, lastName], i) => {
    // The last player has no birth date on the list.
    const born = i < NAMES.length - 1 ? { birthDate: `02/27/${1990 + i}` } : {};
    const command: Command = { type: 'addPlayer', player: { firstName, lastName, id: String(100 + i), ...born } };
    const result = applyCommand(t, command, { now: 0, localTime: '', season: 2027, random: seededRandom(1) });
    assert.ok(result.ok);
    t = result.tournament;
  });
  return t;
}

test('a player is found by Player ID when sanctioned and by name when not', () => {
  const t = field();
  assert.deepEqual(findPlayer(t, true, { popId: '101', birthYear: ' 1991 ' }), { ok: true, id: '101' });
  assert.equal(findPlayer(t, true, { popId: '101' }).ok, false, 'a Player ID alone does not do');
  const wrongYear = findPlayer(t, true, { popId: '101', birthYear: '1990' });
  const wrongId = findPlayer(t, true, { popId: '999', birthYear: '1991' });
  assert.deepEqual(wrongYear, wrongId, 'one answer for either miss');
  for (const birthYear of [undefined, '', '1994', '0']) {
    assert.deepEqual(findPlayer(t, true, { popId: '104', birthYear }), wrongId, 'no year on record fits none');
  }
  assert.equal(findPlayer(t, true, { lastName: 'Ketchum' }).ok, false, 'a name does not do at a sanctioned event');
  assert.deepEqual(findPlayer(t, false, { lastName: ' ketchum ' }), { ok: true, id: '100' });
  const shared = findPlayer(t, false, { lastName: 'Oak' });
  assert.equal(shared.ok, false);
  assert.ok(!shared.ok && shared.ambiguous);
  assert.deepEqual(findPlayer(t, false, { lastName: 'Oak', firstName: 'daisy' }), { ok: true, id: '104' });
  assert.equal(findPlayer(t, false, { lastName: 'Nobody' }).ok, false);
  assert.equal(nameKey(' Peña '), 'pena');
});

test('a decklist finds its player by Player ID, or unsanctioned by full name', () => {
  const t = field();
  const list = { popId: '', firstName: 'Gary', lastName: 'OAK' };
  assert.equal(decklistPlayer(t, list, false), '103');
  assert.equal(decklistPlayer(t, { ...list, firstName: 'Blue' }, false), undefined);
  assert.equal(decklistPlayer(t, { ...list, popId: '103' }, true), '103');
  assert.equal(decklistPlayer(t, list, true), undefined);
});

test('an unsanctioned event shows last names as short as they can be and still tell players apart', () => {
  const players = [
    ['1', 'Ash', 'Ketchum'],
    ['2', 'Ash', 'Keller'],
    ['3', 'Misty', 'Waterflower'],
    ['4', 'Brock', 'Kettle'],
    ['5', 'Gary', 'Oak'],
    ['6', 'Gary', 'Oak'],
    ['7', 'Ash', 'Ke']
  ].map(([id, firstName, lastName]) => ({
    id: id as string,
    firstName: firstName as string,
    lastName: lastName as string,
    birthDate: '',
    droppedAfter: null,
    created: '',
    modified: ''
  }));
  const short = shortLastNames(players);
  assert.equal(short.get('1'), 'Ket.');
  assert.equal(short.get('2'), 'Kel.');
  assert.equal(short.get('3'), 'W.');
  assert.equal(short.get('4'), 'K.', 'only players with the same first name compete');
  assert.equal(short.get('5'), 'Oak', 'two identical names keep the whole name');
  assert.equal(short.get('7'), 'Ke', 'a name no prefix can separate is shown whole');
});

test('one matcher finds every list its player, and none where two players share the name', () => {
  let t = field();
  const twin: Command = { type: 'addPlayer', player: { firstName: 'gary', lastName: 'Oak ', id: '200' } };
  const added = applyCommand(t, twin, { now: 0, localTime: '', season: 2027, random: seededRandom(1) });
  assert.ok(added.ok);
  t = added.tournament;
  const byName = decklistMatcher(t, false);
  const named = (firstName: string, lastName: string) => byName({ popId: '', firstName, lastName });
  assert.equal(named('ASH', ' ketchum'), '100');
  assert.equal(named('Daisy', 'Oak'), '104');
  assert.equal(named('Gary', 'Oak'), undefined, 'two players by that name: staff tell them apart');
  assert.equal(named('Ash Ketchum', ''), undefined, 'the two names are kept apart');
  const byId = decklistMatcher(t, true);
  assert.equal(byId({ popId: '200', firstName: '', lastName: '' }), '200');
  assert.equal(byId({ popId: '', firstName: 'Ash', lastName: 'Ketchum' }), undefined);
});
