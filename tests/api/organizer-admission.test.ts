import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as tournaments from '../../functions/api/tournaments/index.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { admitTry, FREE_TRIES } from '../../functions/lib/tournaments/attempts.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { eventCalls } from '../__utils__/eventCalls.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { storeOf } = eventCalls(hit);
const db = () => env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
const create = (cookie: string, store?: string) =>
  hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    {
      method: 'POST',
      cookie,
      body: { name: 'Friday', mode: 'swiss', store }
    }
  );

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
});

test('a correct year cannot outrun a lockout landing before admission', async () => {
  const inner = db();
  const now = Date.now();
  const raced = racing(inner, 'INSERT INTO identify_failures', () => {
    inner.raw.prepare('INSERT INTO identify_failures VALUES (?, ?, ?, ?)').run('CODE', '123', FREE_TRIES, now + 60_000);
  });
  assert.equal(await admitTry({ db: raced, code: 'CODE', popId: '123', right: true, now }), false);
  assert.equal(inner.raw.prepare('SELECT failures FROM identify_failures').get()?.failures, FREE_TRIES);
});

test('a correct year atomically resets expired failures and the next wrong year starts at one', async () => {
  const inner = db();
  const now = Date.now();
  inner.raw.prepare('INSERT INTO identify_failures VALUES (?, ?, ?, ?)').run('CODE', '123', FREE_TRIES, now);
  assert.equal(await admitTry({ db: inner, code: 'CODE', popId: '123', right: true, now }), true);
  assert.equal(await admitTry({ db: inner, code: 'CODE', popId: '123', right: false, now }), true);
  assert.equal(inner.raw.prepare('SELECT failures FROM identify_failures').get()?.failures, 1);
});

test('community revocation during event creation admits no event and spends no quota', async () => {
  const cookie = await signIn('Community', 'community');
  const inner = db();
  env.TOURNAMENT_DB = racing(inner, 'INSERT OR IGNORE INTO event_creations', () => {
    inner.raw.exec("UPDATE users SET role = 'revoked'");
  });
  assert.equal((await create(cookie)).status, 403);
  assert.equal(inner.raw.prepare('SELECT count(*) AS n FROM tournaments').get()?.n, 0);
  assert.equal(inner.raw.prepare('SELECT count(*) AS n FROM event_creations').get()?.n, 0);
});

test('store revocation and removal during creation admit no event and spend no quota', async () => {
  const cookie = await signIn('Manager', 'organizer');
  const store = await storeOf(cookie);
  assert.ok(store);
  const inner = db();
  env.TOURNAMENT_DB = racing(inner, 'INSERT OR IGNORE INTO event_creations', () => {
    inner.raw.prepare("UPDATE stores SET status = 'revoked' WHERE id = ?").run(store);
  });
  assert.equal((await create(cookie, store)).status, 403);
  inner.raw.prepare("UPDATE stores SET status = 'active' WHERE id = ?").run(store);
  env.TOURNAMENT_DB = racing(inner, 'INSERT OR IGNORE INTO event_creations', () => {
    inner.raw.prepare('DELETE FROM store_members WHERE store_id = ?').run(store);
  });
  assert.equal((await create(cookie, store)).status, 403);
  assert.equal(inner.raw.prepare('SELECT count(*) AS n FROM tournaments').get()?.n, 0);
  assert.equal(inner.raw.prepare('SELECT count(*) AS n FROM event_creations').get()?.n, 0);
});

test('the retained-event ceiling is checked atomically even for an admin', async () => {
  const cookie = await signIn('Admin', 'admin');
  const first = await create(cookie);
  assert.equal(first.status, 201);
  const inner = db();
  const insert = inner.raw.prepare(
    'INSERT INTO tournaments (code, owner_id, mode, state, settings, staff_token, created_at, updated_at) ' +
      'SELECT ?, owner_id, mode, state, settings, ?, created_at, updated_at FROM tournaments WHERE code = ?'
  );
  for (let i = 0; i < 198; i += 1) {
    insert.run(`EVENT${i}`, `token${i}`, first.json.code as string);
  }
  env.TOURNAMENT_DB = racing(inner, 'SELECT (EXISTS', () => {
    insert.run('FINAL', 'final-token', first.json.code as string);
  });
  assert.equal((await create(cookie)).status, 403);
  assert.equal(inner.raw.prepare('SELECT count(*) AS n FROM tournaments').get()?.n, 200);
});
