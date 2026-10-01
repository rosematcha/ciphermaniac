/**
 * Player accounts end to end, against the real schema in SQLite. What must
 * hold: migration 0005 brings a live database in line with the schema, with
 * each POP ID left on one account and Reese the only admin; an account's
 * role and public profile come with who is signed in; one account holds a
 * POP ID, and lets go of the players it was as an old one; a public profile
 * gets an address of its own, and a new one each time it is turned on.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, mock, test } from 'node:test';

import * as me from '../../functions/api/me.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
});

/** The test database itself, for what no request sets yet. */
const raw = () => (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw;

const sql = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** Every table's columns and every index, as a database made from scratch and a migrated one must agree on. */
function shape(db: DatabaseSync) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
    name: string;
  }[];
  return {
    tables: tables.map(({ name }) => ({ name, columns: db.prepare(`PRAGMA table_info(${name})`).all() })),
    indexes: db
      .prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name")
      .all()
  };
}

/** Accounts and events as a live database held them before 0005. */
function seedBefore0005(db: DatabaseSync) {
  const user = db.prepare('INSERT INTO users (id, name, email, pop_id, created_at) VALUES (?, ?, ?, ?, ?)');
  user.run('first', 'First', null, '111', 1);
  user.run('second', 'Second', null, '111', 2);
  user.run('blank', 'Blank', null, '', 2);
  user.run('tie-a', 'Tie A', null, '222', 3);
  user.run('tie-b', 'Tie B', null, '222', 3);
  user.run('reese', 'Reese', 'Reese@Rosematcha.com', null, 4);
  user.run('owner', 'Owner', 'owner@example.com', '333', 5);
  const event = db.prepare(
    'INSERT INTO tournaments (code, owner_id, mode, state, settings, staff_token, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, 1, 1)'
  );
  const players = (...ids: string[]) => JSON.stringify({ players: ids.map(id => ({ id })) });
  // Stored before the sanctioned setting existed, so it reads as sanctioned.
  event.run('SANCTN', 'owner', 'swiss', players('111', '222'), '{}', 'a');
  event.run('CASUAL', 'owner', 'swiss', players('9000000001'), '{"sanctioned":false}', 'b');
  // A TOM event is sanctioned whatever its settings say.
  event.run('TOMRUN', 'reese', 'tom', players('333'), '{"sanctioned":false}', 'c');
}

test('migration 0005 brings a database made before accounts in line with the schema', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(sql('../fixtures/d1/tournaments-before-0005.sql'));
  seedBefore0005(db);
  db.exec(sql('../../config/d1/migrations/tournaments-0005-player-accounts.sql'));
  const backfill = sql('../../config/d1/migrations/tournaments-0006-pop-history-backfill.sql');
  db.exec(backfill);
  db.exec(backfill);

  assert.deepEqual(shape(db), shape(sqliteD1('tournaments.sql').raw));
  const users = db.prepare('SELECT id, pop_id AS popId, role, role_by AS roleBy FROM users ORDER BY id').all();
  assert.deepEqual(
    users.map(row => ({ ...row })),
    [
      { id: 'blank', popId: null, role: null, roleBy: null },
      { id: 'first', popId: '111', role: null, roleBy: null },
      { id: 'owner', popId: '333', role: null, roleBy: null },
      { id: 'reese', popId: null, role: 'admin', roleBy: null },
      { id: 'second', popId: null, role: null, roleBy: null },
      { id: 'tie-a', popId: '222', role: null, roleBy: null },
      { id: 'tie-b', popId: null, role: null, roleBy: null }
    ],
    'the oldest account keeps a POP ID, an empty one is none, Reese is admin and an event owner is not an organizer'
  );
  const seeded = db.prepare("SELECT role_at AS roleAt FROM users WHERE id = 'reese'").get() as { roleAt: number };
  assert.ok(Math.abs(seeded.roleAt - Date.now()) < 60_000, 'the seed records when, in milliseconds');
  const history = db.prepare('SELECT pop_id AS popId, code FROM pop_history ORDER BY code, pop_id').all();
  assert.deepEqual(
    history.map(row => ({ ...row })),
    [
      { popId: '111', code: 'SANCTN' },
      { popId: '222', code: 'SANCTN' },
      { popId: '333', code: 'TOMRUN' }
    ],
    'sanctioned events only, once each however often the back-fill runs'
  );
});

test('who is signed in comes with their role and public profile address', async () => {
  const cookie = await signIn('Player');
  const player = (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie })).json.user;
  assert.deepEqual([player.role, player.publicSlug], [null, null]);
  raw().exec("UPDATE users SET role = 'organizer', public_slug = 'K7PQ2MXA'");
  const organizer = (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie })).json.user;
  assert.deepEqual([organizer.role, organizer.publicSlug], ['organizer', 'K7PQ2MXA']);
  raw().exec("UPDATE users SET role = 'superuser'");
  const unknown = (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie })).json.user;
  assert.equal(unknown.role, null, 'a role the code does not know grants nothing');
});

const profileOf = (popId: string, firstName = 'Pat') => ({
  popId,
  firstName,
  lastName: 'Player',
  birthDate: '02/27/2001'
});

const saveProfile = (cookie: string, profile: ReturnType<typeof profileOf>) =>
  hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie, body: profile });

const accountOf = async (cookie: string) =>
  (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie })).json.user;

test('one account holds a POP ID: the second to save it is refused, and none of its profile is saved', async () => {
  const first = await signIn('First');
  const second = await signIn('Second');
  assert.equal((await saveProfile(first, profileOf('1234567'))).status, 200);
  const again = await saveProfile(first, profileOf('1234567', 'Patricia'));
  assert.equal(again.status, 200, 'saving the POP ID the account holds is no clash');
  await saveProfile(second, profileOf('7654321', 'Sam'));
  const taken = await saveProfile(second, profileOf('1234567', 'Robin'));
  assert.equal(taken.status, 409);
  assert.deepEqual([taken.json.error, taken.json.popIdTaken], ['This POP ID is on another account', true]);
  const kept = await accountOf(second);
  assert.deepEqual([kept.popId, kept.firstName], ['7654321', 'Sam']);
  assert.deepEqual([(await accountOf(first)).popId, (await accountOf(first)).firstName], ['1234567', 'Patricia']);
});

/** A reporter row: which player a device, or an account through its Claim or POP ID, is at an event. */
function holdPlayer(code: string, playerId: string, userId: string | null) {
  raw()
    .prepare(
      'INSERT INTO report_devices (code, player_id, token_hash, device, claimed_at, user_id) ' +
        "VALUES (?, ?, 'token', 'device', 1, ?)"
    )
    .run(code, playerId, userId);
}

const heldRows = () =>
  raw()
    .prepare('SELECT code, player_id AS playerId FROM report_devices ORDER BY code')
    .all()
    .map(row => ({ ...row }));

test('an account that changes its POP ID frees the old one and lets go of the players it was as it', async () => {
  const first = await signIn('First');
  const second = await signIn('Second');
  await saveProfile(first, profileOf('111'));
  await saveProfile(second, profileOf('333'));
  const firstId = (await accountOf(first)).id as string;
  holdPlayer('AAAAAA', '111', firstId);
  holdPlayer('BBBBBB', '111', firstId);
  // A Claim at an unsanctioned event is under another player ID, and a device's row belongs to no account.
  holdPlayer('CCCCCC', '5', firstId);
  holdPlayer('DDDDDD', '111', null);
  holdPlayer('EEEEEE', '333', (await accountOf(second)).id as string);

  assert.equal((await saveProfile(first, profileOf('222'))).status, 200);
  assert.deepEqual(heldRows(), [
    { code: 'CCCCCC', playerId: '5' },
    { code: 'DDDDDD', playerId: '111' },
    { code: 'EEEEEE', playerId: '333' }
  ]);
  assert.equal((await saveProfile(second, profileOf('222'))).status, 409);
  assert.ok(
    heldRows().some(row => row.code === 'EEEEEE'),
    'a refused change keeps the players the account already is'
  );
  assert.equal((await saveProfile(second, profileOf('111'))).status, 200, 'the old POP ID is free');
  assert.equal((await accountOf(second)).popId, '111');
});

const patchAccount = (cookie: string, body: unknown) =>
  hit(me.onRequestPatch as Handler, '/api/me', {}, { method: 'PATCH', cookie, body });

test('the public profile turns on at an address of its own, and off again', async () => {
  const cookie = await signIn('Player');
  const on = await patchAccount(cookie, { publicProfile: true });
  const slug = on.json.user.publicSlug as string;
  assert.match(slug, /^[A-HJKMNP-Z2-9]{8}$/, 'eight characters of the event-code alphabet');
  assert.equal((await accountOf(cookie)).publicSlug, slug);
  assert.equal(
    (await patchAccount(cookie, { publicProfile: true })).json.user.publicSlug,
    slug,
    'on stays where it is'
  );
  const renamed = await patchAccount(cookie, { name: 'Pat' });
  assert.deepEqual([renamed.json.user.name, renamed.json.user.publicSlug], ['Pat', slug]);

  assert.equal((await patchAccount(cookie, { publicProfile: false })).json.user.publicSlug, null);
  assert.equal((await accountOf(cookie)).publicSlug, null);
  const again = (await patchAccount(cookie, { publicProfile: true })).json.user.publicSlug as string;
  assert.notEqual(again, slug, 'turned on again, a link shared before stays dead');

  const both = await patchAccount(cookie, { name: 'Pat', publicProfile: false });
  assert.deepEqual([both.status, both.json.error], [400, 'Change one thing at a time']);
  assert.equal((await patchAccount(cookie, { publicProfile: 'yes' })).status, 400);
  assert.equal((await accountOf(cookie)).publicSlug, again, 'a refused change changes nothing');
});

test('a profile address another account holds is drawn again', async () => {
  const random = mock.method(Math, 'random', () => 0);
  try {
    const first = await patchAccount(await signIn('First'), { publicProfile: true });
    assert.equal(first.json.user.publicSlug, 'AAAAAAAA');
    // The second account's first draw is the first's address; its next is free.
    let draws = 0;
    random.mock.mockImplementation(() => {
      draws += 1;
      return draws <= 8 ? 0 : 0.5;
    });
    const second = await patchAccount(await signIn('Second'), { publicProfile: true });
    assert.equal(second.json.user.publicSlug, 'SSSSSSSS');
  } finally {
    random.mock.restore();
  }
});
