/**
 * Player accounts end to end, against the real schema in SQLite. What must
 * hold: migration 0006 brings a live database in line with the schema, with
 * each POP ID left on one account and Reese the only admin; an account's
 * role and public profile come with who is signed in; one account holds a
 * POP ID, and lets go of the players it was as an old one; a public profile
 * gets an address of its own, and a new one each time it is turned on.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, mock, test } from 'node:test';

import * as callback from '../../functions/api/auth/callback/[provider].ts';
import * as me from '../../functions/api/me.ts';
import type { Profile } from '../../functions/lib/auth/oauth.ts';
import { createSession, currentUser, linkIdentity, upsertUser } from '../../functions/lib/auth/session.ts';
import type { D1Like } from '../../functions/lib/types.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { apiCalls, type Handler, request } from '../__utils__/apiCalls.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

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

/** Reese's account in production, which the migration makes the first admin. */
const REESE = 'nR5TwUcAaKMoilB6';

/** Accounts and events as a live database held them before 0006. */
function seedBefore0006(db: DatabaseSync) {
  const user = db.prepare('INSERT INTO users (id, name, email, pop_id, created_at) VALUES (?, ?, ?, ?, ?)');
  user.run('first', 'First', null, '111', 1);
  user.run('second', 'Second', null, '111', 2);
  user.run('blank', 'Blank', null, '', 2);
  user.run('tie-a', 'Tie A', null, '222', 3);
  user.run('tie-b', 'Tie B', null, '222', 3);
  user.run(REESE, 'Reese', null, null, 4);
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
  event.run('TOMRUN', REESE, 'tom', players('333'), '{"sanctioned":false}', 'c');
}

test('migration 0006 brings a database made before accounts in line with the schema', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(sql('../fixtures/d1/tournaments-before-0006.sql'));
  seedBefore0006(db);
  db.exec(sql('../../config/d1/migrations/tournaments-0006-player-accounts.sql'));
  const backfill = sql('../../config/d1/migrations/tournaments-0007-pop-history-backfill.sql');
  db.exec(backfill);
  db.exec(backfill);

  db.exec(sql('../../config/d1/migrations/tournaments-0008-verified-email-uniqueness.sql'));

  assert.deepEqual(shape(db), shape(sqliteD1('tournaments.sql').raw));
  const users = db.prepare('SELECT id, pop_id AS popId, role, role_by AS roleBy FROM users ORDER BY id').all();
  assert.deepEqual(
    users.map(row => ({ ...row })),
    [
      { id: 'blank', popId: null, role: null, roleBy: null },
      { id: 'first', popId: '111', role: null, roleBy: null },
      { id: REESE, popId: null, role: 'admin', roleBy: null },
      { id: 'owner', popId: '333', role: null, roleBy: null },
      { id: 'second', popId: null, role: null, roleBy: null },
      { id: 'tie-a', popId: '222', role: null, roleBy: null },
      { id: 'tie-b', popId: null, role: null, roleBy: null }
    ],
    'the oldest account keeps a POP ID, an empty one is none, Reese is admin and an event owner is not an organizer'
  );
  const seeded = db.prepare('SELECT role_at AS roleAt FROM users WHERE id = ?').get(REESE) as { roleAt: number };
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

/** Has `meanwhile` land between the request's read and its next write that starts with `prefix`. */
const beforeWrite = (prefix: string, meanwhile: () => void) => {
  env.TOURNAMENT_DB = racing(env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>, prefix, meanwhile);
};

test('a POP ID change lets go of the players the account is as the POP ID it holds when the change lands', async () => {
  const cookie = await signIn('Player');
  await saveProfile(cookie, profileOf('111'));
  const id = (await accountOf(cookie)).id as string;
  // Another change, to 222, lands after this request read 111, and the account is a player as 222.
  beforeWrite('UPDATE OR IGNORE users', () => {
    raw().prepare("UPDATE users SET pop_id = '222' WHERE id = ?").run(id);
    holdPlayer('AAAAAA', '222', id);
  });
  assert.equal((await saveProfile(cookie, profileOf('333'))).status, 200);
  assert.equal((await accountOf(cookie)).popId, '333');
  assert.deepEqual(heldRows(), [], 'the players as 222 are let go');
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

test('two requests turning the profile on at once both answer the one address it keeps', async () => {
  const cookie = await signIn('Player');
  // The other request read the profile off too, and its address lands first.
  beforeWrite('UPDATE OR IGNORE users SET public_slug', () => {
    raw().exec("UPDATE users SET public_slug = 'K7PQ2MXA'");
  });
  const on = await patchAccount(cookie, { publicProfile: true });
  assert.equal(on.json.user.publicSlug, 'K7PQ2MXA');
  assert.equal((await accountOf(cookie)).publicSlug, 'K7PQ2MXA', 'the first address still works');
});

test('turning on a profile that another request turned off meanwhile gives it an address that works', async () => {
  const cookie = await signIn('Player');
  await patchAccount(cookie, { publicProfile: true });
  // This request reads the profile on; the other turns it off before this one answers.
  const inner = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  let pending = true;
  env.TOURNAMENT_DB = {
    ...inner,
    batch: async statements => {
      const results = await inner.batch(statements);
      if (pending) {
        pending = false;
        raw().exec('UPDATE users SET public_slug = NULL');
      }
      return results;
    }
  };
  const again = (await patchAccount(cookie, { publicProfile: true })).json.user.publicSlug as string | null;
  assert.notEqual(again, null);
  assert.equal((await accountOf(cookie)).publicSlug, again);
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

const authProfile = (overrides: Partial<Profile> = {}): Profile => ({
  provider: 'google',
  subject: 'google-player',
  name: 'Player',
  email: 'player@example.com',
  emailVerified: true,
  avatar: null,
  ...overrides
});

/** D1 serializes batches; keep concurrent requests' reads free to interleave. */
function serializedAccounts(): D1Like {
  const db = env.TOURNAMENT_DB!;
  let pending: Promise<unknown> = Promise.resolve();
  return {
    ...db,
    batch: statements => {
      const result = pending.then(() => db.batch(statements));
      pending = result.catch(() => undefined);
      return result;
    }
  };
}

const identityRows = () =>
  raw()
    .prepare('SELECT user_id FROM identities')
    .all()
    .map(row => row.user_id);
const userCount = () => raw().prepare('SELECT count(*) AS n FROM users').get()?.n;

test('simultaneous first logins return the identity winner and leave no orphan accounts or sessions', async () => {
  const db = serializedAccounts();
  const profile = authProfile({ email: null });
  const ids = await Promise.all([upsertUser(db, profile), upsertUser(db, profile)]);
  assert.equal(ids[0], ids[1]);
  assert.deepEqual(identityRows(), [ids[0]]);
  assert.equal(userCount(), 1);
  for (const id of ids) {
    const token = await createSession(db, id);
    const request = new Request('https://ciphermaniac.test/api/me', { headers: { cookie: `cm_session=${token}` } });
    assert.equal((await currentUser(db, request))?.id, ids[0]);
  }
});

test('concurrent providers sharing a verified email link to one account, including case and whitespace', async () => {
  const db = serializedAccounts();
  const profiles = [
    authProfile(),
    authProfile({ provider: 'discord', subject: 'discord-player', email: ' Player@Example.COM ' })
  ];
  const ids = await Promise.all(profiles.map(profile => upsertUser(db, profile)));
  assert.equal(ids[0], ids[1]);
  assert.deepEqual(identityRows(), ids);
  assert.equal(userCount(), 1);
  assert.equal(raw().prepare('SELECT email FROM users').get()?.email, 'player@example.com');
  assert.equal(await upsertUser(db, authProfile({ subject: 'another-google' })), ids[0]);
});

test('unverified emails never link accounts or reserve verified email ownership', async () => {
  const db = serializedAccounts();
  const profiles = [
    authProfile({ emailVerified: false }),
    authProfile({ provider: 'discord', subject: 'unverified', emailVerified: false }),
    authProfile({ subject: 'verified' })
  ];
  const ids = await Promise.all(profiles.map(profile => upsertUser(db, profile)));
  assert.equal(new Set(ids).size, 3);
  assert.equal(userCount(), 3);
  assert.equal(raw().prepare('SELECT count(*) AS n FROM users WHERE email IS NULL').get()?.n, 2);
  assert.equal(await upsertUser(db, profiles[0]!), ids[0]);
});

test('reauthentication keeps identity ownership even when its verified email belongs to another account', async () => {
  const db = env.TOURNAMENT_DB!;
  const first = await upsertUser(db, authProfile());
  const secondProfile = authProfile({ provider: 'discord', subject: 'second', email: null });
  const second = await upsertUser(db, secondProfile);
  assert.notEqual(first, second);
  assert.equal(await upsertUser(db, { ...secondProfile, email: 'player@example.com', avatar: 'avatar' }), second);
  assert.equal(raw().prepare('SELECT email FROM users WHERE id = ?').get(second)?.email, null);
  assert.equal(raw().prepare('SELECT avatar FROM users WHERE id = ?').get(second)?.avatar, 'avatar');
  assert.equal(await upsertUser(db, { ...secondProfile, email: 'new@example.com' }), second);
  assert.equal(raw().prepare('SELECT email FROM users WHERE id = ?').get(second)?.email, 'new@example.com');
});

test('explicit linking refuses an owned identity and is idempotent for its owner', async () => {
  const db = env.TOURNAMENT_DB!;
  const profile = authProfile();
  const owner = await upsertUser(db, profile);
  const other = await upsertUser(db, authProfile({ subject: 'other', email: null }));
  assert.equal(await linkIdentity(db, profile, other), false);
  assert.equal(await linkIdentity(db, profile, owner), true);
  assert.equal(await linkIdentity(db, authProfile({ provider: 'discord', subject: 'free' }), other), true);
  assert.deepEqual(identityRows().sort(), [owner, other, other].sort());
});

test('concurrent explicit linking resolves the identity winner without changing its owner', async () => {
  const db = serializedAccounts();
  const first = await upsertUser(db, authProfile({ subject: 'first', email: null }));
  const second = await upsertUser(db, authProfile({ subject: 'second', email: null }));
  const profile = authProfile({ provider: 'discord', subject: 'contested' });
  assert.deepEqual(await Promise.all([linkIdentity(db, profile, first), linkIdentity(db, profile, second)]), [
    true,
    false
  ]);
  assert.equal(await upsertUser(db, profile), first);
});

test('an identity winner rolls back updates to an account selected by email', async () => {
  const inner = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  const emailAccount = await upsertUser(inner, authProfile());
  const winner = await upsertUser(inner, authProfile({ subject: 'winner', email: null }));
  const profile = authProfile({ provider: 'discord', subject: 'race', avatar: 'loser-avatar' });
  const db = racing(inner, 'UPDATE users SET avatar', () => {
    raw().prepare('INSERT INTO identities VALUES (?, ?, ?)').run(profile.provider, profile.subject, winner);
  });
  assert.equal(await upsertUser(db, profile), winner);
  assert.equal(raw().prepare('SELECT avatar FROM users WHERE id = ?').get(emailAccount)?.avatar, null);
});

test('unrelated database failures roll back account creation and propagate', async () => {
  raw().exec(
    "CREATE TRIGGER fail_identity BEFORE INSERT ON identities BEGIN SELECT RAISE(ABORT, 'identity unavailable'); END"
  );
  const db = env.TOURNAMENT_DB!;
  await assert.rejects(upsertUser(db, authProfile()), /identity unavailable/);
  assert.equal(userCount(), 0);
  await assert.rejects(linkIdentity(db, authProfile(), 'missing'), /identity unavailable/);
});

test('email conflict resolution propagates a failed linking transaction', async () => {
  const inner = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  const db = racing(inner, 'INSERT INTO users', () => {
    raw()
      .prepare('INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)')
      .run('winner', 'Player', 'player@example.com', 1);
    raw().exec(
      "CREATE TRIGGER fail_identity BEFORE INSERT ON identities BEGIN SELECT RAISE(ABORT, 'identity unavailable'); END"
    );
  });
  await assert.rejects(upsertUser(db, authProfile()), /identity unavailable/);
  assert.equal(userCount(), 1);
  assert.deepEqual(identityRows(), []);
});

test('migration 0008 preserves accounts and identities while assigning duplicate emails to the oldest account', () => {
  const db = raw();
  db.exec('DROP INDEX users_by_verified_email; CREATE INDEX users_by_email ON users (email)');
  const insert = db.prepare('INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)');
  insert.run('a', 'A', ' Player@Example.COM ', 1);
  insert.run('b', 'B', 'player@example.com', 1);
  insert.run('c', 'C', 'PLAYER@example.com', 2);
  insert.run('blank', 'Blank', ' ', 0);
  db.exec("INSERT INTO identities VALUES ('google', 'b', 'b')");
  const migration = sql('../../config/d1/migrations/tournaments-0008-verified-email-uniqueness.sql');
  db.exec(migration);
  db.exec(migration);
  assert.deepEqual(
    db
      .prepare('SELECT id, email FROM users ORDER BY id')
      .all()
      .map(row => ({ ...row })),
    [
      { id: 'a', email: 'player@example.com' },
      { id: 'b', email: null },
      { id: 'blank', email: null },
      { id: 'c', email: null }
    ]
  );
  const backups = db.prepare('SELECT user_id, email, cleared_at FROM duplicate_emails_backup ORDER BY user_id').all();
  assert.deepEqual(
    backups.map(row => ({ userId: row.user_id, email: row.email })),
    [
      { userId: 'b', email: 'player@example.com' },
      { userId: 'c', email: 'PLAYER@example.com' }
    ]
  );
  assert.ok(backups.every(row => typeof row.cleared_at === 'string' && Number.isFinite(Date.parse(row.cleared_at))));
  assert.deepEqual(identityRows(), ['b']);
  assert.throws(() => insert.run('duplicate', 'D', 'player@example.com', 3), /UNIQUE/);
  assert.deepEqual(shape(db), shape(sqliteD1('tournaments.sql').raw));
});

[
  ['google', 'google'],
  ['google', 'discord']
].forEach(providers => {
  test(`concurrent ${providers.join('/')} callbacks establish sessions for the winning account`, async () => {
    env.TOURNAMENT_DB = serializedAccounts();
    env.GOOGLE_CLIENT_ID = 'id';
    env.GOOGLE_CLIENT_SECRET = 'secret';
    env.DISCORD_CLIENT_ID = 'id';
    env.DISCORD_CLIENT_SECRET = 'secret';
    const fetch = mock.method(globalThis, 'fetch', async (url: string | URL) => {
      if (String(url).includes('token')) {
        return new Response('{"access_token":"token"}', { headers: { 'content-type': 'application/json' } });
      }
      const body = String(url).includes('discord')
        ? '{"id":"discord-player","email":"player@example.com","verified":true}'
        : '{"sub":"google-player","email":"player@example.com","email_verified":true}';
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    });
    try {
      const responses = await Promise.all(
        providers.map(provider =>
          callback.onRequestGet({
            request: request(`/api/auth/callback/${provider}?code=c&state=state`, {
              cookie: 'cm_oauth=state%20%2Fhost'
            }),
            env,
            params: { provider }
          } as never)
        )
      );
      const sessions = responses.map(response => {
        assert.equal(response.headers.get('location'), '/host');
        const cookie = response.headers.getSetCookie().find(value => value.startsWith('cm_session='));
        assert.ok(cookie);
        return cookie.split(';')[0]!;
      });
      const users = await Promise.all(
        sessions.map(cookie => currentUser(env.TOURNAMENT_DB!, request('/api/me', { cookie })))
      );
      assert.ok(users[0]);
      assert.equal(users[0].id, users[1]?.id);
      assert.equal(userCount(), 1);
      assert.ok(identityRows().every(id => id === users[0]?.id));
      assert.equal(raw().prepare('SELECT count(*) AS n FROM sessions').get()?.n, 2);
    } finally {
      fetch.mock.restore();
    }
  });
});

test('email lookup and refresh use the verified email index without scanning users', async () => {
  const inner = env.TOURNAMENT_DB!;
  const queries: string[] = [];
  const db: D1Like = {
    ...inner,
    prepare: query => {
      if (query.includes('WHERE email IS NOT NULL AND email = ?')) {
        queries.push(query);
      }
      return inner.prepare(query);
    }
  };
  const profile = authProfile();
  const owner = await upsertUser(db, profile);
  assert.equal(await upsertUser(db, profile), owner);
  assert.equal(queries.length, 2);
  for (const query of queries) {
    const values = query.startsWith('UPDATE') ? [null, profile.email, profile.email, owner] : [profile.email];
    const details = raw()
      .prepare(`EXPLAIN QUERY PLAN ${query}`)
      .all(...values)
      .map(row => String(row.detail));
    assert.ok(
      details.some(detail => /SEARCH users USING (?:COVERING )?INDEX users_by_verified_email/.test(detail)),
      details.join('\n')
    );
    assert.ok(
      details.every(detail => !detail.includes('SCAN users')),
      details.join('\n')
    );
  }
  assert.equal(raw().prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'users_by_email'").get()?.n, 0);
});

test('successful linking to an email race winner skips the final identity read', async () => {
  const inner = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  const raced = racing(inner, 'INSERT INTO users', () => {
    raw()
      .prepare('INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)')
      .run('winner', 'Player', 'player@example.com', 1);
  });
  let identityReads = 0;
  const db: D1Like = {
    ...raced,
    prepare: query => {
      if (query.startsWith('SELECT user_id FROM identities')) {
        identityReads += 1;
      }
      return raced.prepare(query);
    }
  };
  assert.equal(await upsertUser(db, authProfile()), 'winner');
  assert.equal(identityReads, 2);
  assert.deepEqual(identityRows(), ['winner']);
});

test('email conflict resolution still returns an identity that another account wins during linking', async () => {
  const inner = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  const raced = racing(inner, 'INSERT INTO users', () => {
    raw()
      .prepare('INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)')
      .run('email-winner', 'Player', 'player@example.com', 1);
  });
  let identityInserts = 0;
  const db: D1Like = {
    ...raced,
    prepare: query => {
      if (query.startsWith('INSERT INTO identities')) {
        identityInserts += 1;
        if (identityInserts === 2) {
          raw()
            .prepare('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)')
            .run('identity-winner', 'Player', 2);
          raw()
            .prepare('INSERT INTO identities (provider, subject, user_id) VALUES (?, ?, ?)')
            .run('google', 'google-player', 'identity-winner');
        }
      }
      return raced.prepare(query);
    }
  };
  assert.equal(await upsertUser(db, authProfile()), 'identity-winner');
  assert.deepEqual(identityRows(), ['identity-winner']);
  assert.equal(userCount(), 2);
});
