/**
 * The age rules through the functions (shared/accounts/age.ts): a sign-up
 * waits for its age check and only an adult's makes an account, keeping the
 * birth year alone; a profile names no minor's year; a player under 13 hands
 * a sanctioned event nothing; a minor's cards go as the event ends; and
 * migration 0011 cuts what was already kept.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, mock, test } from 'node:test';

import * as ageCheck from '../../functions/api/auth/age.ts';
import * as callback from '../../functions/api/auth/callback/[provider].ts';
import * as login from '../../functions/api/auth/login/[provider].ts';
import * as me from '../../functions/api/me.ts';
import * as decklists from '../../functions/api/tournaments/[code]/decklists.ts';
import * as report from '../../functions/api/tournaments/[code]/report.ts';
import * as idle from '../../functions/api/tournaments/idle.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { UNDER_13 } from '../../shared/accounts/age.ts';
import { apiCalls, type Handler, request } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, send, settle, playerSays } = eventCalls(hit);

beforeEach(() => {
  env = {
    TOURNAMENT_DB: sqliteD1('tournaments.sql'),
    DEV_LOGIN: 'true',
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret'
  };
  decklists._resetRateLimitStore();
  report._resetRateLimitStore();
});

const raw = () => (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw;
const count = (table: string) => (raw().prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const YEAR = new Date().getUTCFullYear();
/** Birth years: a child under 13, a teenager old enough to hand in a list, and an adult. */
const CHILD = YEAR - 10;
const TEEN = YEAR - 15;
const ADULT = YEAR - 30;
const cookieOf = (response: { headers: Headers }, name: string) =>
  (response.headers.getSetCookie().find(value => value.startsWith(`${name}=`)) ?? '').split(';')[0] ?? '';

/** Google answering for `sub` with `email` (verified) while `body` runs. */
async function asGoogle<T>(sub: string, email: string | null, body: () => Promise<T>): Promise<T> {
  const fetch = mock.method(
    globalThis,
    'fetch',
    async (url: string | URL) =>
      String(url).includes('token')
        ? Response.json({ access_token: 'token' }) // eslint-disable-line camelcase
        : Response.json({ sub, email, email_verified: email !== null }) // eslint-disable-line camelcase
  );
  try {
    return await body();
  } finally {
    fetch.mock.restore();
  }
}

/** A Google sign-in's callback, as the provider sends the browser back. */
function googleCallback() {
  return callback.onRequestGet({
    request: request('/api/auth/callback/google?code=c&state=state', { cookie: 'cm_oauth=state%20%2Fhost' }),
    env,
    params: { provider: 'google' }
  } as never);
}

function checkAge(cookie: string, birthDate: string) {
  return hit(ageCheck.onRequestPost as Handler, '/api/auth/age', {}, { method: 'POST', cookie, body: { birthDate } });
}

test('a minor’s sign-up makes no account and keeps nothing the provider sent', async () => {
  const waiting = await asGoogle('kid', 'kid@example.com', googleCallback);
  assert.equal(waiting.headers.get('location'), '/welcome');
  assert.equal(count('pending_signups'), 1);
  const refused = await checkAge(cookieOf(waiting, 'cm_signup'), `${CHILD + 5}-03-01`);
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.json, { error: ageCheck.ADULTS_ONLY, minor: true });
  assert.equal(cookieOf(refused, 'cm_session'), '', 'no session');
  assert.deepEqual([count('users'), count('identities'), count('pending_signups')], [0, 0, 0]);
  const retry = await checkAge(cookieOf(waiting, 'cm_signup'), `${ADULT}-03-01`);
  assert.equal(retry.status, 410, 'another date needs another sign-in');
});

test('a date that is no date is asked again; a wait used up or run out asks for sign-in again', async () => {
  const waiting = await asGoogle('g-1', 'gia@example.com', googleCallback);
  const cookie = cookieOf(waiting, 'cm_signup');
  assert.equal((await checkAge(cookie, '06/15/1990')).status, 400);
  assert.equal((await checkAge(cookie, `${YEAR + 1}-01-01`)).status, 400, 'a day not yet come');
  assert.equal(count('pending_signups'), 1, 'neither used the wait up');
  assert.equal((await checkAge(cookie, `${ADULT}-06-15`)).status, 200);
  assert.equal((await checkAge(cookie, `${ADULT}-06-15`)).status, 410, 'each wait is used once');
  assert.equal((await checkAge('', `${ADULT}-06-15`)).status, 410, 'no wait at all');

  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    const late = await asGoogle('g-2', null, googleCallback);
    mock.timers.tick(15 * 60 * 1000 + 1);
    assert.equal((await checkAge(cookieOf(late, 'cm_signup'), `${ADULT}-06-15`)).status, 410);
    await asGoogle('g-3', null, googleCallback);
    assert.equal(count('pending_signups'), 1, 'the next wait swept the one that ran out');
  } finally {
    mock.timers.reset();
  }
});

test('an account made before the age check holds no session, and passes the check at its next sign-in', async () => {
  raw().exec(
    "INSERT INTO users (id, handle, email, birth_date, created_at) VALUES ('old', 'old-hand', 'old@example.com', '02/27/2012', 1);" +
      "INSERT INTO identities (provider, subject, user_id) VALUES ('google', 'g-old', 'old')"
  );
  const { createSession } = await import('../../functions/lib/auth/session.ts');
  const stale = `cm_session=${await createSession(env.TOURNAMENT_DB!, 'old')}`;
  assert.equal((await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: stale })).json.user, null);
  const waiting = await asGoogle('g-old', 'old@example.com', googleCallback);
  assert.equal(waiting.headers.get('location'), '/welcome');
  const passed = await checkAge(cookieOf(waiting, 'cm_signup'), `${ADULT}-12-31`);
  assert.equal(passed.status, 200);
  const { user } = (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: cookieOf(passed, 'cm_session') }))
    .json;
  assert.deepEqual(
    [user.id, user.handle, user.birthDate],
    ['old', 'old-hand', `02/27/${ADULT}`],
    'the check’s year stands over the one the account held'
  );
  assert.equal(count('users'), 1);
});

test('a provider sharing a verified email with an account that passed signs straight in', async () => {
  raw().exec(
    'INSERT INTO users (id, handle, email, birth_date, age_checked_at, created_at) ' +
      "VALUES ('kept', 'kept', 'pat@example.com', '02/27/1980', 1, 1)"
  );
  const signedIn = await asGoogle('g-pat', 'pat@example.com', googleCallback);
  assert.equal(signedIn.headers.get('location'), '/host');
  assert.ok(cookieOf(signedIn, 'cm_session'));
  assert.equal(count('pending_signups'), 0);
});

test('a dev sign-in is an adult’s unless it says otherwise, and a minor’s is refused', async () => {
  const signInBorn = (birth: string) =>
    login.onRequestGet({
      request: request(`/api/auth/login/dev?name=Kid&birth=${birth}`),
      env,
      params: { provider: 'dev' }
    } as never);
  assert.equal((await signInBorn(`${CHILD}-01-01`)).status, 403);
  assert.equal((await signInBorn('nonsense')).status, 403);
  assert.equal(count('users'), 0);
  const gated = await login.onRequestGet({
    request: request('/api/auth/login/dev?name=Gate&gate=1&next=/apply'),
    env,
    params: { provider: 'dev' }
  } as never);
  assert.equal(gated.headers.get('location'), '/welcome');
  const passed = await checkAge(cookieOf(gated, 'cm_signup'), `${ADULT}-01-01`);
  assert.deepEqual(passed.json, { next: '/apply' });
});

test('a profile keeps its birth year alone, and no year only a minor could be born in', async () => {
  const cookie = await signIn('Pat');
  const save = (birthDate: string) =>
    hit(
      me.onRequestPut as Handler,
      '/api/me',
      {},
      {
        method: 'PUT',
        cookie,
        body: { popId: '4242', firstName: 'Pat', lastName: 'Lee', birthDate }
      }
    );
  assert.equal((await save(`02/27/${YEAR - 17}`)).status, 400);
  assert.equal((await save(`02/27/${CHILD}`)).status, 400);
  const saved = await save(`06/15/${ADULT}`);
  assert.equal(saved.status, 200);
  assert.equal(saved.json.user.birthDate, `02/27/${ADULT}`);
  const stored = raw().prepare('SELECT birth_date FROM users WHERE pop_id = ?').get('4242') as { birth_date: string };
  assert.equal(stored.birth_date, `02/27/${ADULT}`, 'the day and month are never kept');
});

/** A sanctioned event with decklists open and one player born in each of `years`, Player IDs 950 on. */
async function eventWith(owner: string, years: number[]): Promise<string> {
  const code = await newSwiss(owner);
  for (const [i, year] of years.entries()) {
    const added = await send(code, owner, {
      type: 'addPlayer',
      player: { firstName: 'P', lastName: `${i}`, id: `${950 + i}`, birthDate: `06/15/${year}` }
    });
    assert.equal(added.status, 200);
  }
  await settle(code, owner, { decklists: 'open' });
  return code;
}

function submit(code: string, popId: string, year: number) {
  return hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    body: {
      deck: '60 Basic {P} Energy SVE 5',
      profile: { popId, firstName: 'P', lastName: popId, birthDate: `02/27/${year}` }
    }
  });
}

/** The birth dates the event keeps, as stored. */
function storedBirthDates(code: string): string[] {
  const row = raw().prepare('SELECT state FROM tournaments WHERE code = ?').get(code) as { state: string };
  return (JSON.parse(row.state) as { players: { birthDate: string }[] }).players.map(player => player.birthDate);
}

test('staff add a player with a full birth date and the event keeps the year alone', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await eventWith(owner, [ADULT]);
  assert.deepEqual(storedBirthDates(code), [`02/27/${ADULT}`]);
  const edited = await send(code, owner, {
    type: 'editPlayer',
    id: '950',
    firstName: 'P',
    lastName: '0',
    birthDate: `11/30/${TEEN}`
  });
  assert.equal(edited.status, 200);
  assert.deepEqual(storedBirthDates(code), [`02/27/${TEEN}`]);
});

test('a player under 13 neither says who they are nor sends a list at a sanctioned event, and no try counts', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await eventWith(owner, [CHILD, ADULT]);
  const child = await playerSays(code, { popId: '950', birthYear: String(CHILD) });
  assert.deepEqual([child.status, child.json.error], [403, UNDER_13]);
  assert.equal((await playerSays(code, { popId: '951', birthYear: String(ADULT) })).status, 200);
  const list = await submit(code, '950', CHILD);
  assert.deepEqual([list.status, list.json.error], [403, UNDER_13]);
  assert.equal(count('decklists'), 0);
  assert.equal(
    raw().prepare("SELECT count(*) AS n FROM identify_failures WHERE pop_id = '950'").get()?.n,
    0,
    'a child’s year is not a wrong guess'
  );
  assert.equal((await submit(code, '951', ADULT)).status, 200);
});

test('as an event ends, the cards of lists whose player may be under 18 go and their archetypes stay', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await eventWith(owner, [TEEN, YEAR - 18, ADULT]);
  for (const [popId, year] of [
    ['950', TEEN],
    ['951', YEAR - 18],
    ['952', ADULT]
  ] as const) {
    assert.equal((await submit(code, popId, year)).status, 200);
  }
  const cards = () =>
    Object.fromEntries(
      (
        raw().prepare('SELECT pop_id, deck, archetype FROM decklists ORDER BY pop_id').all() as {
          pop_id: string;
          deck: string;
          archetype: string;
        }[]
      ).map(row => [row.pop_id, [row.deck !== '', row.archetype]])
    );
  // The player's own word for their deck, as one would have sent it.
  raw().exec("UPDATE decklists SET archetype = 'Psychic'");
  assert.deepEqual(cards(), { 950: [true, 'Psychic'], 951: [true, 'Psychic'], 952: [true, 'Psychic'] });
  assert.equal((await settle(code, owner, { finished: true })).status, 200);
  assert.deepEqual(
    cards(),
    { 950: [false, 'Psychic'], 951: [false, 'Psychic'], 952: [true, 'Psychic'] },
    'born this many years back, someone may still be 17'
  );
  const staffView = await hit(decklists.onRequestGet as Handler, '/decklists', at(code), { cookie: owner });
  const teen = (staffView.json.decklists as { popId: string; problems: string[] }[]).find(list => list.popId === '950');
  assert.deepEqual(teen?.problems, [], 'an emptied list shows no problems');
});

test('an unsanctioned event knows no birth years, so its lists stay as it ends', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { sanctioned: false, decklists: 'open' });
  const sent = await hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    body: {
      deck: '60 Basic {P} Energy SVE 5',
      profile: { popId: '', firstName: 'Ana', lastName: 'Ruiz', birthDate: '' }
    }
  });
  assert.equal(sent.status, 200);
  await settle(code, owner, { finished: true });
  const row = raw().prepare('SELECT deck FROM decklists').get() as { deck: string };
  assert.notEqual(row.deck, '');
});

const sql = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('migration 0011 signs everyone out, cuts kept birth dates to years, inside events too, and deletes minors’ cards at ended events', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(sql('../fixtures/d1/tournaments-before-0006.sql'));
  for (const name of ['0006-player-accounts', '0007-pop-history-backfill', '0008-verified-email-uniqueness']) {
    db.exec(sql(`../../config/d1/migrations/tournaments-${name}.sql`));
  }
  db.exec(sql('../../config/d1/migrations/tournaments-0009-identify-failures.sql'));
  db.exec(sql('../../config/d1/migrations/tournaments-0010-usernames.sql'));
  const players = JSON.stringify({
    players: [
      { id: '1', birthDate: '06/15/2014' },
      { id: '2', birthDate: '' },
      { id: '3' },
      { id: '4', birthDate: '1/2/1990' }
    ]
  });
  db.exec(
    "INSERT INTO users (id, handle, birth_date, created_at) VALUES ('a', 'a', '06/15/1990', 1), ('b', 'b', 'junk', 1), ('c', 'c', NULL, 1);" +
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h', 'a', 9999999999999);" +
      'INSERT INTO tournaments (code, owner_id, mode, state, settings, staff_token, created_at, updated_at) VALUES ' +
      `('ENDED', 'a', 'swiss', '${players}', '{"finished":true}', 't', 1, 1),` +
      `('LIVE', 'a', 'swiss', '${JSON.stringify({ players: [] })}', '{}', 'u', 1, 1);` +
      'INSERT INTO decklists (code, user_id, pop_id, first_name, last_name, birth_date, deck, submitted_at) VALUES ' +
      "('ENDED', 'pop:1', '1', 'A', 'B', '06/15/2014', 'cards', 1), ('ENDED', 'pop:2', '2', 'A', 'B', '01/01/1990', 'cards', 1)," +
      "('LIVE', 'pop:1', '1', 'A', 'B', '06/15/2014', 'cards', 1)"
  );
  db.exec(sql('../../config/d1/migrations/tournaments-0011-age-gate.sql'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get()?.n, 0, 'every account passes the check anew');
  const users = db.prepare('SELECT id, birth_date FROM users ORDER BY id').all() as {
    id: string;
    birth_date: string;
  }[];
  assert.deepEqual(
    users.map(row => [row.id, row.birth_date]),
    [
      ['a', '02/27/1990'],
      ['b', null],
      ['c', null]
    ]
  );
  const lists = db.prepare('SELECT code, pop_id, birth_date, deck FROM decklists ORDER BY code, pop_id').all() as {
    code: string;
    pop_id: string;
    birth_date: string;
    deck: string;
  }[];
  assert.deepEqual(
    lists.map(row => [row.code, row.pop_id, row.birth_date, row.deck]),
    [
      ['ENDED', '1', '02/27/2014', ''],
      ['ENDED', '2', '02/27/1990', 'cards'],
      ['LIVE', '1', '02/27/2014', 'cards']
    ]
  );
  const ended = JSON.parse(
    (db.prepare("SELECT state FROM tournaments WHERE code = 'ENDED'").get() as { state: string }).state
  ) as { players: { id: string; birthDate: string }[] };
  assert.deepEqual(ended.players, [
    { id: '1', birthDate: '02/27/2014' },
    { id: '2', birthDate: '' },
    { id: '3', birthDate: '' },
    { id: '4', birthDate: '02/27/1990' }
  ]);
});

/** The deck column of each stored list, by Player ID. */
const decks = () =>
  Object.fromEntries(
    (raw().prepare('SELECT pop_id, deck FROM decklists').all() as { pop_id: string; deck: string }[]).map(row => [
      row.pop_id,
      row.deck
    ])
  );

test('once an event is over, a player who may be under 18 sends no list, even one racing the end', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await eventWith(owner, [TEEN, ADULT]);
  await settle(code, owner, { finished: true });
  const late = await submit(code, '950', TEEN);
  assert.deepEqual([late.status, late.json.error], [403, 'This event is over.']);
  assert.equal((await submit(code, '951', ADULT)).status, 200, 'an adult’s list still comes in');

  const open = await eventWith(owner, [TEEN]);
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  env.TOURNAMENT_DB = racing(db, 'INSERT INTO decklists', () =>
    db.raw
      .prepare("UPDATE tournaments SET settings = json_set(settings, '$.finished', json('true')) WHERE code = ?")
      .run(open)
  );
  await submit(open, '950', TEEN);
  assert.equal(
    db.raw.prepare('SELECT count(*) AS n FROM decklists WHERE code = ?').get(open)?.n,
    0,
    'the end landing between the check and the write keeps the list out'
  );
});

test('an end that loses its race to another write deletes no cards', async () => {
  const owner = await signIn('Organizer', 'organizer');
  // Seventeen plays in Masters, so one pod holds all four.
  const code = await eventWith(owner, [YEAR - 17, ADULT, ADULT - 1, ADULT - 2]);
  const paired = await send(code, owner, { type: 'pairRound', pod: 'masters' });
  assert.equal(paired.status, 200, JSON.stringify(paired.json));
  assert.equal((await submit(code, '950', YEAR - 17)).status, 200);
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  // Abandoned a week and more: the sweep would end it.
  db.raw.prepare('UPDATE tournaments SET updated_at = ? WHERE code = ?').run(Date.now() - 8 * 24 * 3600 * 1000, code);
  env.IDLE_SWEEP_TOKEN = 'sweep-token';
  // The organizer's write lands between the sweep's read and its end.
  env.TOURNAMENT_DB = racing(db, 'UPDATE tournaments SET', () =>
    db.raw.prepare('UPDATE tournaments SET version = version + 1, updated_at = ? WHERE code = ?').run(Date.now(), code)
  );
  const swept = await idle.onRequestPost({
    request: new Request('https://cm.test/api/tournaments/idle', {
      method: 'POST',
      headers: { authorization: 'Bearer sweep-token' }
    }),
    env,
    params: {}
  } as never);
  assert.deepEqual(((await swept.json()) as { ended: string[] }).ended, [], 'no longer idle, so not ended');
  assert.notEqual(decks()['950'], '', 'and the cards stay for the deck checks still to come');
});
