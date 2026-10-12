/**
 * Applications for a store, from the applicant's side, against the real
 * schema in SQLite. What must hold: only a signed-in account with a complete
 * profile applies, whatever its role; an Application says what store it is
 * for and that the applicant is certified, with a note optional, one pending
 * at a time, with the profile as it stood; withdrawing takes the pending
 * Application.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as applications from '../../functions/api/applications/index.ts';
import * as mine from '../../functions/api/applications/mine.ts';
import * as me from '../../functions/api/me.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { apiCalls, type Handler, ORIGIN } from '../__utils__/apiCalls.ts';
import { storeApplication } from '../__utils__/storeApplication.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
  applications._resetRateLimitStore();
});

/** The test database itself, for what no applicant's request sets. */
const raw = () => (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw;

const PROFILE = { popId: '1234567', firstName: 'Pat', lastName: 'Player', birthDate: '02/27/2001' };

/** An account signed in with its profile saved, as only such an account may apply. */
async function applicant(name = 'Applicant', profile: Partial<typeof PROFILE> = {}) {
  const cookie = await signIn(name);
  const saved = await hit(
    me.onRequestPut as Handler,
    '/api/me',
    {},
    {
      method: 'PUT',
      cookie,
      body: { ...PROFILE, ...profile }
    }
  );
  assert.equal(saved.status, 200);
  return cookie;
}

/** Sends an Application; for Combat Power's league unless `body` says what store it is for. */
const apply = (cookie: string, body: Record<string, unknown>) =>
  hit(
    applications.onRequestPost as Handler,
    '/api/applications',
    {},
    {
      method: 'POST',
      cookie,
      body: { store: storeApplication(), ...body }
    }
  );

const state = async (cookie: string) =>
  (await hit(mine.onRequestGet as Handler, '/api/applications/mine', {}, { cookie })).json;

const withdraw = (cookie: string) =>
  hit(mine.onRequestDelete as Handler, '/api/applications/mine', {}, { method: 'DELETE', cookie });

test('a signed-in account with a complete profile may apply; the state says so before it does', async () => {
  const cookie = await applicant();
  assert.deepEqual(await state(cookie), { application: null, eligible: { profile: true, email: true } });
  const sent = await apply(cookie, { explanation: '  I run the league at my store.  ' });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.application.status, 'pending');
  assert.equal(sent.json.application.explanation, 'I run the league at my store.');
  assert.deepEqual(sent.json.application.store, storeApplication(), 'the store it asks for, as sent');
  const after = await state(cookie);
  assert.deepEqual(after.application, sent.json.application);
});

test('signed out, or from another site, nothing is read or sent', async () => {
  const cookie = await applicant();
  assert.equal((await hit(mine.onRequestGet as Handler, '/api/applications/mine', {})).status, 401);
  assert.equal(
    (await hit(applications.onRequestPost as Handler, '/api/applications', {}, { method: 'POST', body: {} })).status,
    401
  );
  const foreign = await hit(
    applications.onRequestPost as Handler,
    '/api/applications',
    {},
    { method: 'POST', cookie, origin: 'https://elsewhere.test', body: { explanation: 'Hi' } }
  );
  assert.equal(foreign.status, 403);
  assert.equal(raw().prepare('SELECT COUNT(*) AS n FROM applications').get()?.n, 0);
});

test('an account without a complete profile is sent to finish it', async () => {
  const cookie = await signIn('Newcomer');
  assert.deepEqual((await state(cookie)).eligible, { profile: false, email: true });
  const sent = await apply(cookie, { explanation: 'Please' });
  assert.deepEqual([sent.status, sent.json], [400, { error: 'Complete your profile first', profile: true }]);
});

test('an Application says what store and that the applicant is certified; a note is optional', async () => {
  const cookie = await applicant();
  const refused = async (store: unknown, error: string) => {
    const sent = await apply(cookie, { store });
    assert.deepEqual([sent.status, sent.json.error], [400, error], JSON.stringify(store));
  };
  await refused(undefined, 'Enter the store’s league ID');
  await refused({ ...storeApplication(), leagueId: 'abc' }, 'Enter the store’s league ID');
  await refused({ ...storeApplication(), details: { name: '' } }, 'Check the store’s details');
  await refused({ ...storeApplication(), timeZone: 'Mars/Olympus' }, 'Pick the store’s time zone');
  await refused({ ...storeApplication(), relationship: 'fan' }, 'Say why you are applying for the store');
  await refused({ ...storeApplication(), certified: false }, 'Confirm you are a certified organizer, or work with one');
  await refused({ ...storeApplication(), nights: [{ id: 'x', weekday: 9, time: '25:00' }] }, 'Check the league nights');
  const unparsed = await hit(
    applications.onRequestPost as Handler,
    '/api/applications',
    {},
    {
      method: 'POST',
      cookie,
      body: 'not an application'
    }
  );
  assert.equal(unparsed.status, 400);
  const tooLong = await apply(cookie, { explanation: 'x'.repeat(2001) });
  assert.deepEqual([tooLong.status, tooLong.json.error], [400, 'Up to 2000 characters']);
  // Ten tries an hour from one address; the rest of this test is not about that.
  applications._resetRateLimitStore();
  const byUrl = storeApplication('https://www.pokemon.com/us/play-pokemon/pokemon-events/leagues/6238620/');
  const bare = await apply(cookie, { store: byUrl });
  assert.equal(bare.status, 201, 'no note');
  assert.equal(bare.json.application.store.leagueId, '6238620', 'the league page reads as its ID');
});

test('one Application is pending at a time', async () => {
  const cookie = await applicant();
  assert.equal((await apply(cookie, { explanation: '' })).status, 201);
  const again = await apply(cookie, { explanation: 'Another' });
  assert.deepEqual([again.status, again.json.error], [409, 'Your application is pending']);
});

test('two sends at once leave one Application pending', async () => {
  const cookie = await applicant();
  const both = await Promise.all([apply(cookie, { explanation: 'First' }), apply(cookie, { explanation: 'Second' })]);
  assert.deepEqual(both.map(sent => sent.status).sort(), [201, 409]);
  assert.equal(raw().prepare("SELECT COUNT(*) AS n FROM applications WHERE status = 'pending'").get()?.n, 1);
});

test('a send that read no Application pending still loses to one that landed since', async () => {
  const cookie = await applicant();
  const first = await apply(cookie, { explanation: 'First' });
  const db = env.TOURNAMENT_DB as NonNullable<TournamentEnv['TOURNAMENT_DB']>;
  // The first is withdrawn and sent again by another tab, between this send's read and its write.
  raw().prepare('DELETE FROM applications').run();
  env.TOURNAMENT_DB = {
    ...db,
    prepare: sql => {
      if (sql.startsWith('INSERT OR IGNORE INTO applications')) {
        raw()
          .prepare(
            'INSERT INTO applications (id, user_id, status, pop_id, first_name, last_name, created_at) ' +
              "SELECT 'rival', id, 'pending', pop_id, first_name, last_name, 1 FROM users WHERE handle = 'applicant'"
          )
          .run();
      }
      return db.prepare(sql);
    }
  };
  const second = await apply(cookie, { explanation: 'Second' });
  env.TOURNAMENT_DB = db;
  assert.equal(first.status, 201);
  assert.deepEqual([second.status, second.json.error], [409, 'Your application is pending']);
  assert.equal(raw().prepare('SELECT id FROM applications').get()?.id, 'rival');
});

test('an Application keeps the profile as it stood when the account applied', async () => {
  const cookie = await applicant();
  await apply(cookie, { explanation: 'Hello' });
  await hit(
    me.onRequestPut as Handler,
    '/api/me',
    {},
    {
      method: 'PUT',
      cookie,
      body: { ...PROFILE, popId: '7654321', lastName: 'Renamed' }
    }
  );
  const row = raw()
    .prepare('SELECT pop_id AS popId, first_name AS firstName, last_name AS lastName FROM applications')
    .get();
  assert.deepEqual({ ...row }, { popId: '1234567', firstName: 'Pat', lastName: 'Player' });
});

/** Sends the Application with `meanwhile` run while its body is still arriving, after the send has read the account. */
async function applyWhile(cookie: string, body: Record<string, unknown>, meanwhile: () => void) {
  const slow = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        meanwhile();
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ store: storeApplication(), ...body })));
        controller.close();
      }
    },
    { highWaterMark: 0 }
  );
  const request = new Request(`${ORIGIN}/api/applications`, {
    method: 'POST',
    headers: { origin: ORIGIN, cookie, 'content-type': 'application/json' },
    body: slow,
    duplex: 'half'
  } as RequestInit);
  const response = await applications.onRequestPost({ request, env, params: {} } as never);
  return { status: response.status, json: (await response.json()) as any };
}

test('a send holds to the account as it is when the Application lands, not as it was read', async () => {
  const cookie = await applicant();
  const setUser = (sql: string) => () => raw().prepare(`UPDATE users SET ${sql} WHERE handle = 'applicant'`).run();
  // An Admin takes the POP ID off the account while its Application is still arriving.
  const cleared = await applyWhile(cookie, { explanation: 'Hello' }, setUser('pop_id = NULL'));
  assert.deepEqual([cleared.status, cleared.json], [400, { error: 'Complete your profile first', profile: true }]);
  setUser("pop_id = '1234567'")();
  assert.equal(raw().prepare('SELECT COUNT(*) AS n FROM applications').get()?.n, 0);
  // Renamed meanwhile, the account applies under the name it has now.
  const renamed = await applyWhile(cookie, { explanation: 'Hello' }, setUser("last_name = 'Renamed'"));
  assert.equal(renamed.status, 201);
  const row = raw().prepare('SELECT pop_id AS popId, last_name AS lastName FROM applications').get();
  assert.deepEqual({ ...row }, { popId: '1234567', lastName: 'Renamed' });
});

test('a send that keeps losing to changes to the account gives up, and one whose account is gone stores nothing', async () => {
  const cookie = await applicant();
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  let renames = 0;
  const rename = () => {
    renames += 1;
    raw().prepare("UPDATE users SET last_name = ? WHERE handle = 'applicant'").run(`Renamed${renames}`);
  };
  env.TOURNAMENT_DB = racing(db, 'INSERT OR IGNORE INTO applications', rename, 3);
  const busy = await apply(cookie, { explanation: 'Hello' });
  assert.deepEqual([busy.status, busy.json.error, renames], [409, 'Busy; try again', 3]);
  env.TOURNAMENT_DB = racing(db, 'INSERT OR IGNORE INTO applications', () => {
    raw().prepare("DELETE FROM users WHERE handle = 'applicant'").run();
  });
  assert.equal((await apply(cookie, { explanation: 'Hello' })).status, 401);
  assert.equal(raw().prepare('SELECT COUNT(*) AS n FROM applications').get()?.n, 0);
});

test('withdrawing takes the pending Application; with none pending there is nothing to take', async () => {
  const cookie = await applicant();
  assert.deepEqual([(await withdraw(cookie)).status], [404]);
  await apply(cookie, { explanation: '' });
  assert.equal((await withdraw(cookie)).status, 204);
  assert.equal(raw().prepare('SELECT COUNT(*) AS n FROM applications').get()?.n, 0);
  assert.deepEqual(await state(cookie), { application: null, eligible: { profile: true, email: true } });
});

test('a decided Application stays: it cannot be withdrawn, and a rejected account applies again', async () => {
  const cookie = await applicant();
  const first = await apply(cookie, { explanation: 'Hello' });
  raw()
    .prepare("UPDATE applications SET status = 'rejected', decided_at = 5, note = 'Send your certificate' WHERE id = ?")
    .run(first.json.application.id);
  assert.equal((await withdraw(cookie)).status, 404);
  const seen = (await state(cookie)).application;
  assert.deepEqual([seen.status, seen.note, seen.decidedAt], ['rejected', 'Send your certificate', 5]);
  const again = await apply(cookie, { explanation: '' });
  assert.equal(again.status, 201);
  assert.equal((await state(cookie)).application.id, again.json.application.id, 'the newest is the one shown');
});

test('any account with a complete profile applies, whatever its role or the stores it is in', async () => {
  for (const [i, role] of ['community', 'revoked', 'admin'].entries()) {
    const cookie = await applicant(`Has ${role}`, { popId: String(i + 1) });
    raw().prepare('UPDATE users SET role = ? WHERE handle = ?').run(role, `has-${role}`);
    assert.deepEqual((await state(cookie)).eligible, { profile: true, email: true });
    assert.equal((await apply(cookie, { store: storeApplication(`77${i}0`) })).status, 201);
  }
  const manager = await signIn('Store Manager', 'organizer');
  await hit(
    me.onRequestPut as Handler,
    '/api/me',
    {},
    { method: 'PUT', cookie: manager, body: { ...PROFILE, popId: '9' } }
  );
  assert.equal(
    (await apply(manager, { store: storeApplication('7790') })).status,
    201,
    'a second store for someone who runs one'
  );
});

test('without the database, Applications are not available', async () => {
  const cookie = await applicant();
  delete env.TOURNAMENT_DB;
  assert.equal((await hit(mine.onRequestGet as Handler, '/api/applications/mine', {}, { cookie })).status, 503);
});

test('sends are limited per address', async () => {
  const cookie = await applicant();
  for (let i = 0; i < 10; i += 1) {
    await apply(cookie, { explanation: '' });
  }
  assert.equal((await apply(cookie, { explanation: 'Hi' })).status, 429);
});
