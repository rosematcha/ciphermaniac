/**
 * Everything that arrives over the wire is checked before a handler sees it:
 * commands, whole tournament documents, settings changes and player profiles.
 * A malformed field refuses the lot.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { emptyTournament } from '../../shared/tournament/create.ts';
import { profileErrors, readProfile } from '../../shared/tournament/profile.ts';
import { readCommand } from '../../shared/tournament/readCommand.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import { readTournament } from '../../shared/tournament/validate.ts';
import { decksVisible, DEFAULT_SETTINGS, readSettings } from '../../shared/tournament/view.ts';
import { decodeEntities, encodeEntities } from '../../shared/tournament/xml.ts';

test('reads every well-formed command', () => {
  const good = [
    {
      type: 'addPlayer',
      player: { firstName: 'A', lastName: 'B', id: '1', birthDate: '02/27/2000', division: 'senior' }
    },
    { type: 'editPlayer', id: '1', firstName: 'A', lastName: 'B', birthDate: '' },
    { type: 'removePlayer', id: '1' },
    { type: 'dropPlayer', id: '1' },
    { type: 'undropPlayer', id: '1' },
    { type: 'pairRound', pod: 'mixed' },
    { type: 'repairRound', pod: 'junior', keepReported: false },
    { type: 'deleteRound', pod: 'masters' },
    { type: 'startClock', pod: 'senior' },
    { type: 'stopClock', pod: 'senior' },
    { type: 'adjustClock', pod: 'senior', seconds: -60 },
    { type: 'reportResult', pod: 'mixed', round: 1, table: 2, p1: '1', p2: '2', outcome: 'tie' },
    { type: 'swapPlayers', pod: 'mixed', a: '1', b: '2' },
    { type: 'startTopCut', pod: 'masters', size: 8 },
    { type: 'startTopCut', pod: 'mixed', size: 4, division: 'junior' },
    { type: 'updateInfo', info: { name: 'Cup', roundTime: 50 } }
  ];
  for (const command of good) {
    assert.ok(readCommand(command), command.type);
  }
});

test('refuses malformed commands', () => {
  const bad: unknown[] = [
    null,
    [],
    { type: 'toString' },
    { type: 'pairRound', pod: 'everyone' },
    { type: 'addPlayer', player: { firstName: 'A' } },
    { type: 'addPlayer', player: { firstName: 'A', lastName: 'B', division: 'toddler' } },
    { type: 'addPlayer', player: { firstName: 'A', lastName: 'B', id: 7 } },
    { type: 'reportResult', pod: 'mixed', round: 1, table: 1, p1: '1', p2: null, outcome: 'bye' },
    { type: 'reportResult', pod: 'mixed', round: 1, table: 1, p1: '1', outcome: 'p1' },
    { type: 'startTopCut', pod: 'mixed', size: 4, division: 'toddler' },
    { type: 'adjustClock', pod: 'mixed', seconds: 1.5 },
    { type: 'updateInfo', info: { organizerPopId: '1' } },
    { type: 'updateInfo', info: { roundTime: '50' } },
    { type: 'updateInfo', info: null }
  ];
  for (const command of bad) {
    assert.equal(readCommand(command), null, JSON.stringify(command));
  }
});

test('a tournament document must be whole and consistent', () => {
  const t = parseTdf(readFileSync(new URL('../fixtures/tdf/cup-finalized.tdf', import.meta.url), 'utf8'));
  const copy = () => JSON.parse(JSON.stringify(t));
  assert.ok(readTournament(copy()));
  assert.ok(readTournament({ ...emptyTournament({ name: 'x' }, true) })?.combined);
  const strangerInMatch = copy();
  strangerInMatch.pods[0].rounds[0].matches[0].p2 = 'ghost';
  const duplicatePlayer = copy();
  duplicatePlayer.players.push(duplicatePlayer.players[0]);
  const badOutcome = copy();
  badOutcome.pods[0].rounds[0].matches[0].outcome = 'win';
  const badCategory = copy();
  badCategory.pods[0].category = 'toddlers';
  const tooLongName = copy();
  tooLongName.info.name = 'x'.repeat(500);
  const badPassthrough = copy();
  badPassthrough.passthrough.rootAttrs = 'type=3';
  for (const broken of [
    strangerInMatch,
    duplicatePlayer,
    badOutcome,
    badCategory,
    tooLongName,
    badPassthrough,
    null,
    'x'
  ]) {
    assert.equal(readTournament(broken), null);
  }
});

test('settings changes are checked field by field', () => {
  assert.deepEqual(readSettings({ format: 'Expanded', startsAt: '2026-10-10T11:00' }, DEFAULT_SETTINGS), {
    ...DEFAULT_SETTINGS,
    format: 'Expanded',
    startsAt: '2026-10-10T11:00'
  });
  assert.equal(readSettings({ startsAt: 'tomorrow' }, DEFAULT_SETTINGS), null);
  assert.equal(readSettings({ admin: true }, DEFAULT_SETTINGS), null);
  assert.equal(readSettings({ details: 'x'.repeat(1001) }, DEFAULT_SETTINGS), null);
  assert.equal(readSettings('open', DEFAULT_SETTINGS), null);
  assert.equal(readSettings({ constructor: {} }, DEFAULT_SETTINGS), null);
  assert.equal(readSettings(JSON.parse('{"__proto__": 1}'), DEFAULT_SETTINGS), null);
  assert.equal(decksVisible({ ...DEFAULT_SETTINGS, deckVisibility: 'always' }), true);
  assert.equal(decksVisible({ ...DEFAULT_SETTINGS, deckVisibility: 'after' }), false);
  assert.equal(decksVisible({ ...DEFAULT_SETTINGS, deckVisibility: 'after', finished: true }), true);
  assert.equal(decksVisible({ ...DEFAULT_SETTINGS, deckVisibility: 'never', finished: true }), false);
});

test('a player profile needs an ID, a name and a birth date', () => {
  const profile = { popId: '1234567', firstName: 'Ada', lastName: 'Lovelace', birthDate: '02/27/1999' };
  assert.deepEqual(readProfile({ ...profile, firstName: '  Ada ' }), profile);
  assert.deepEqual(Object.keys(profileErrors({ popId: 'x', firstName: '', lastName: '', birthDate: '1999' })), [
    'popId',
    'firstName',
    'lastName',
    'birthDate'
  ]);
  assert.equal(readProfile(null), null);
  assert.equal(readProfile({ ...profile, popId: '12345678901' }), null);
});

test('XML entities decode and encode', () => {
  assert.equal(decodeEntities('&amp;&lt;&gt;&quot;&apos;&#233;&#x41;&unknown;'), '&<>"\'éA&unknown;');
  assert.equal(encodeEntities('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});
