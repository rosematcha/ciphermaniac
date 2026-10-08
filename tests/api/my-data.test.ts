/**
 * My Data end to end, against the real schema in SQLite. What must hold: the
 * export is the signed-in account's own data as Markdown, with no secrets in
 * it; each wipe part clears what it names and nothing else; organizer history
 * waits for running events, then takes the organizer off their events while
 * players keep them; deleting an account removes everything kept under it,
 * waits while it runs an event or owns a store, and signs out.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import * as history from '../../functions/api/history.ts';
import * as me from '../../functions/api/me.ts';
import * as data from '../../functions/api/me/data.ts';
import * as tournaments from '../../functions/api/tournaments/index.ts';
import * as report from '../../functions/api/tournaments/[code]/report.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { sha256 } from '../../functions/lib/auth/session.ts';
import { loadTournament } from '../../functions/lib/tournaments/store.ts';
import type { HistoryEntry } from '../../shared/accounts/types.ts';
import { apiCalls, type Handler, ORIGIN, request } from '../__utils__/apiCalls.ts';
import { eventCalls } from '../__utils__/eventCalls.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { newEvent, newSwiss, addPlayers, settle, playerSays, send } = eventCalls(hit);

/** Ash and Gary at an unsanctioned event, as staff add them by name. */
async function addNamed(code: string, owner: string) {
  await send(code, owner, { type: 'addPlayer', player: { firstName: 'Ash', lastName: 'Ketchum' } });
  await send(code, owner, { type: 'addPlayer', player: { firstName: 'Gary', lastName: 'Oak' } });
}

/** The account under `cookie` says it is the player named `lastName`. */
async function claim(code: string, lastName: string, cookie: string) {
  const said = await playerSays(code, { lastName, device: lastName }, { cookie });
  assert.equal(said.status, 200, JSON.stringify(said.json));
}

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
  report._resetRateLimitStore();
  event._resetRateLimitStore();
});

afterEach(() => {
  mock.restoreAll();
});

const raw = () => (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw;

const idOf = async (cookie: string) => {
  const hash = await sha256(cookie.slice(cookie.indexOf('=') + 1));
  return (raw().prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get(hash) as { user_id: string }).user_id;
};

const account = (id: string) => raw().prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown>;

const saveProfile = (cookie: string, popId: string) =>
  hit(
    me.onRequestPut as Handler,
    '/api/me',
    {},
    { method: 'PUT', cookie, body: { popId, firstName: 'Pat', lastName: 'Player', birthDate: '02/27/2001' } }
  );

const rename = (cookie: string, handle: string) =>
  hit(me.onRequestPatch as Handler, '/api/me', {}, { method: 'PATCH', cookie, body: { handle } });

const wipe = (cookie: string, parts: unknown) =>
  hit(data.onRequestPost as Handler, '/api/me/data', {}, { method: 'POST', cookie, body: { parts } });

const remove = (cookie: string, confirm: unknown) =>
  hit(me.onRequestDelete as Handler, '/api/me', {}, { method: 'DELETE', cookie, body: { confirm } });

const codesOf = async (cookie: string) =>
  ((await hit(history.onRequestGet as Handler, '/api/history', {}, { cookie })).json.entries as HistoryEntry[]).map(
    entry => entry.code
  );

const eventsOf = async (cookie: string) =>
  (
    (await hit(tournaments.onRequestGet as Handler, '/api/tournaments', {}, { cookie })).json.tournaments as {
      code: string;
    }[]
  ).map(summary => summary.code);

/** Moves an event's making back a second, as one made before a wipe in the same millisecond would not be. */
const backdate = (code: string) =>
  raw().prepare('UPDATE tournaments SET created_at = created_at - 1000 WHERE code = ?').run(code);

async function exported(cookie?: string) {
  const response = await data.onRequestGet({ request: request('/api/me/data', { cookie }), env } as never);
  return { status: response.status, headers: response.headers, text: await response.text() };
}

/** A store organizer's sanctioned event with four players, the account under `cookie` holding POP ID 901. */
async function playedEvent(player: string) {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  await saveProfile(player, '901');
  return { owner, code };
}

// ---------- Export ----------

test('the export is the account’s data as a Markdown file, and nothing secret', async () => {
  const player = await signIn('Player');
  const { code } = await playedEvent(player);
  const file = await exported(player);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-type') ?? '', /^text\/markdown/u);
  assert.match(file.headers.get('content-disposition') ?? '', /^attachment; filename="ciphermaniac-.+\.md"$/u);
  assert.equal(file.headers.get('cache-control'), 'no-store');
  assert.match(file.text, /^# Your data on Ciphermaniac\n/u);
  assert.match(file.text, /- POP ID: 901\n/u);
  assert.match(file.text, /- First name: Pat\n/u);
  assert.match(file.text, /- Username: player\n/u);
  assert.match(file.text, /- Public profile: no\n/u);
  assert.match(file.text, /## Sign-ins\n\n- Provider: dev\n/u);
  assert.match(file.text, new RegExp(`### Test Cup\\n\\n- Event: Test Cup\\n- Event code: ${code}\\n`, 'u'));
  assert.match(file.text, new RegExp(`- Page: ${ORIGIN}/t/${code}\\n`, 'u'));
  assert.match(file.text, /- Created at: \d{4}-\d\d-\d\dT/u, 'times read as dates');
  for (const secret of ['token_hash', 'Token hash', 'staff_token', 'Staff token']) {
    assert.ok(!file.text.includes(secret), secret);
  }
});

test('the export lists the events an organizer runs, and escapes what could break the file', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newEvent(owner, { name: 'Cup *one* `x`' });
  const file = await exported(owner);
  assert.match(file.text, /## Events you organized or staffed\n\n### Cup \\\*one\\\* \\`x\\`\n/u);
  assert.match(file.text, new RegExp(`- Event code: ${code}\\n- Start date: .+\\n- Role: organizer\\n`, 'u'));
});

test('the export is for a signed-in account from this site only', async () => {
  assert.equal((await exported()).status, 401);
  assert.equal((await exported('session=nope')).status, 401);
  const player = await signIn('Player');
  const elsewhere = await data.onRequestGet({
    request: new Request(`${ORIGIN}/api/me/data`, { headers: { cookie: player, origin: 'https://evil.test' } }),
    env
  } as never);
  assert.equal(elsewhere.status, 403);
});

// ---------- Wipe ----------

test('a wipe names at least one part, and only parts', async () => {
  const player = await signIn('Player');
  for (const parts of [[], ['everything'], 'profile', ['profile', 7], undefined]) {
    assert.equal((await wipe(player, parts)).status, 400, JSON.stringify(parts));
  }
  assert.equal((await wipe('', ['profile'])).status, 401);
});

test('wiping the profile clears the POP ID, name and birth year, and with them sanctioned History', async () => {
  const player = await signIn('Player');
  const { code } = await playedEvent(player);
  assert.deepEqual(await codesOf(player), [code]);
  const wiped = await wipe(player, ['profile']);
  assert.equal(wiped.status, 200);
  assert.equal(wiped.json.user.popId, null);
  const row = account(await idOf(player));
  assert.deepEqual([row.pop_id, row.first_name, row.last_name, row.birth_date], [null, null, null, null]);
  assert.equal(wiped.json.user.name, row.handle, 'the site calls the account by its username');
  assert.deepEqual(await codesOf(player), []);
});

test('wiping the username gives a random one, and lets go of the old ones at once', async () => {
  const player = await signIn('Player');
  assert.equal((await rename(player, 'first.name')).status, 200);
  assert.equal((await rename(player, 'second.name')).status, 200);
  const wiped = await wipe(player, ['username']);
  assert.match(wiped.json.user.handle, /^player-[a-z0-9]{8}$/u);
  const other = await signIn('Other');
  assert.equal((await rename(other, 'first.name')).status, 200, 'a username let go before the wipe is free');
  assert.equal((await rename(other, 'second.name')).status, 200, 'and so is the one it wiped');
});

test('wiping event history hides the ended events and unlinks the account there, and leaves running ones', async () => {
  const player = await signIn('Player');
  const { owner, code } = await playedEvent(player);
  await settle(code, owner, { finished: true });
  const casual = await newEvent(owner, { settings: { sanctioned: false } });
  await addNamed(casual, owner);
  await claim(casual, 'Ketchum', player);
  await settle(casual, owner, { finished: true });
  const running = await newEvent(owner, { settings: { sanctioned: false } });
  await addNamed(running, owner);
  await claim(running, 'Oak', player);
  // Made before the wipe, played after it.
  const ahead = await newSwiss(owner);
  assert.deepEqual((await codesOf(player)).sort(), [code, casual, running].sort());

  assert.equal((await wipe(player, ['events'])).status, 200);
  assert.deepEqual(await codesOf(player), [running], 'a running event stays');
  const linked = raw()
    .prepare('SELECT code FROM report_devices WHERE user_id = ?')
    .all(await idOf(player))
    .map(row => row.code);
  assert.deepEqual(linked, [running], 'the account still reports where the event runs');
  assert.equal(account(await idOf(player)).pop_id, '901', 'the profile stays');
  await addPlayers(ahead, owner, 2);
  assert.deepEqual((await codesOf(player)).sort(), [running, ahead].sort(), 'an event played after shows');
});

test('wiping the username keeps the day’s renames counted', async () => {
  const player = await signIn('Player');
  for (const handle of ['one.name', 'two.name', 'three.name']) {
    assert.equal((await rename(player, handle)).status, 200);
  }
  assert.equal((await wipe(player, ['username'])).status, 200);
  assert.equal((await rename(player, 'four.name')).status, 429);
});

test('wiping organizer history waits for running events, then takes the organizer off while players keep them', async () => {
  const player = await signIn('Player');
  const owner = await signIn('Casual', 'community');
  await saveProfile(owner, '7777');
  const code = await newEvent(owner, { name: 'Community Night' });
  await settle(code, owner, { sanctioned: false });
  await addNamed(code, owner);
  await claim(code, 'Ketchum', player);
  const refused = await wipe(owner, ['organizer']);
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.json.running, [{ code, name: 'Community Night' }]);
  assert.deepEqual(refused.json.ownedStores, []);

  await settle(code, owner, { finished: true });
  assert.equal((await wipe(owner, ['organizer', 'profile'])).status, 200);
  const stored = await loadTournament(env.TOURNAMENT_DB!, code);
  assert.equal(stored?.tournament.info.organizerName, '');
  assert.equal(stored?.tournament.info.organizerPopId, '');
  assert.equal(stored?.ownerId, `wiped:${code}`);
  assert.deepEqual(await eventsOf(owner), [], 'the organizer no longer has it');
  assert.deepEqual(await codesOf(player), [code], 'the player keeps it');
});

test('wiping organizer history takes the name off an event that names the account’s POP ID', async () => {
  const organizer = await signIn('Organizer', 'organizer');
  await saveProfile(organizer, '5150');
  const code = await newSwiss(organizer);
  await settle(code, organizer, { finished: true });
  assert.equal((await loadTournament(env.TOURNAMENT_DB!, code))?.tournament.info.organizerPopId, '5150');
  assert.equal((await wipe(organizer, ['organizer'])).status, 200);
  const stored = await loadTournament(env.TOURNAMENT_DB!, code);
  assert.equal(stored?.tournament.info.organizerPopId, '');
  assert.equal(stored?.tournament.info.organizerName, '');
});

// ---------- Delete ----------

test('deleting asks for the username, and waits while the account owns a store or runs an event', async () => {
  const organizer = await signIn('Organizer', 'organizer');
  const handle = account(await idOf(organizer)).handle as string;
  assert.equal((await remove(organizer, 'someone-else')).status, 400);
  assert.equal((await remove(organizer, undefined)).status, 400);
  const code = await newSwiss(organizer);
  const refused = await remove(organizer, handle);
  assert.equal(refused.status, 409);
  assert.equal(refused.json.running[0].code, code);
  assert.deepEqual(refused.json.ownedStores, ['Organizer Games']);
  await settle(code, organizer, { finished: true });
  const still = await remove(organizer, handle);
  assert.equal(still.status, 409);
  assert.deepEqual(still.json.running, []);
  assert.ok(account(await idOf(organizer)), 'nothing was deleted');
});

/** Every row under `id`, by table, leaving out tables with none. */
function rowsUnder(id: string) {
  const counts: Record<string, number> = {};
  for (const [table, column] of [
    ['users', 'id'],
    ['identities', 'user_id'],
    ['sessions', 'user_id'],
    ['handle_changes', 'user_id'],
    ['staff', 'user_id'],
    ['report_devices', 'user_id'],
    ['decklists', 'account'],
    ['applications', 'user_id'],
    ['proof_uploads', 'user_id'],
    ['store_members', 'user_id'],
    ['tournaments', 'owner_id'],
    ['event_creations', 'owner']
  ] as const) {
    const value = table === 'event_creations' ? `user:${id}` : id;
    const { n } = raw().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(value) as { n: number };
    if (n > 0) {
      counts[table] = n;
    }
  }
  return counts;
}

test('deleting removes everything under the account, keeps its finished events for players, and signs out', async () => {
  const player = await signIn('Player');
  const owner = await signIn('Casual', 'community');
  const id = await idOf(owner);
  await rename(owner, 'casual.host');
  const code = await newEvent(owner, { name: 'Community Night' });
  await settle(code, owner, { sanctioned: false });
  await addNamed(code, owner);
  await claim(code, 'Oak', owner);
  await claim(code, 'Ketchum', player);
  await settle(code, owner, { finished: true });
  raw()
    .prepare("INSERT INTO proof_uploads (user_id, key, type, size) VALUES (?, 'proofs/one', 'image/png', 9)")
    .run(id);
  assert.ok(Object.keys(rowsUnder(id)).length > 4);

  const deleted = await remove(owner, 'casual.host');
  assert.equal(deleted.status, 204);
  assert.match(deleted.headers.get('set-cookie') ?? '', /Max-Age=0/u);
  assert.deepEqual(rowsUnder(id), {});
  assert.deepEqual({ ...raw().prepare('SELECT key FROM proof_deletions').get() }, { key: 'proofs/one' });
  assert.equal((await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: owner })).json.user, null);
  assert.deepEqual(await codesOf(player), [code], 'the player keeps the event');
  assert.equal((await rename(player, 'casual.host')).status, 200, 'the username is free');
});

test('deleting an account that signs in with a password deletes its Clerk user too', async () => {
  env = {
    ...env,
    CLERK_PUBLISHABLE_KEY: `pk_test_${btoa('clerk.example.test$')}`,
    CLERK_JWT_KEY: 'pem',
    CLERK_SECRET_KEY: 'sk_test'
  };
  const player = await signIn('Player');
  const id = await idOf(player);
  raw().prepare("INSERT INTO identities (provider, subject, user_id) VALUES ('clerk', 'user_abc', ?)").run(id);
  const calls: { url: string; method: string; auth: string | null }[] = [];
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', auth: new Headers(init.headers).get('authorization') });
    return new Response(null, { status: 200 });
  });
  assert.equal((await remove(player, account(id).handle)).status, 204);
  assert.deepEqual(calls, [
    { url: 'https://api.clerk.com/v1/users/user_abc', method: 'DELETE', auth: 'Bearer sk_test' }
  ]);
});

test('an account is deleted even when Clerk cannot be reached', async () => {
  env = {
    ...env,
    CLERK_PUBLISHABLE_KEY: `pk_test_${btoa('clerk.example.test$')}`,
    CLERK_JWT_KEY: 'pem',
    CLERK_SECRET_KEY: 'sk_test'
  };
  const player = await signIn('Player');
  const id = await idOf(player);
  raw().prepare("INSERT INTO identities (provider, subject, user_id) VALUES ('clerk', 'user_abc', ?)").run(id);
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  mock.method(console, 'error', () => undefined);
  assert.equal((await remove(player, account(id).handle)).status, 204);
  assert.deepEqual(rowsUnder(id), {});
});

test('deleting waits when a store is handed to the account after it was checked', async () => {
  const from = await idOf(await signIn('Organizer', 'organizer'));
  const player = await signIn('Player');
  const id = await idOf(player);
  const handOver = () => raw().prepare('UPDATE store_members SET user_id = ? WHERE user_id = ?').run(id, from);
  env = { ...env, TOURNAMENT_DB: racing(env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>, 'SELECT subject', handOver) };
  const refused = await remove(player, account(id).handle);
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.json.ownedStores, ['Organizer Games']);
  assert.deepEqual(
    Object.keys(rowsUnder(id)),
    ['users', 'identities', 'sessions', 'store_members'],
    'nothing was deleted'
  );
});

test('deleting an admin takes its id off what it decided', async () => {
  const admin = await signIn('Admin', 'admin');
  const id = await idOf(admin);
  const other = await idOf(await signIn('Other'));
  raw().prepare("UPDATE users SET role = 'community', role_by = ? WHERE id = ?").run(id, other);
  assert.equal((await remove(admin, account(id).handle)).status, 204);
  assert.equal(account(other).role_by, null);
  assert.equal(account(other).role, 'community', 'the decision stands');
});

test('the export holds decklists sent under the POP ID while signed out, and the events hidden from History', async () => {
  const player = await signIn('Player');
  const { owner, code } = await playedEvent(player);
  raw()
    .prepare(
      'INSERT INTO decklists (code, user_id, pop_id, first_name, last_name, birth_date, deck, submitted_at) ' +
        "VALUES (?, 'pop:901', '901', 'Pat', 'Player', '02/27/2001', '4 Pikachu', 1)"
    )
    .run(code);
  await settle(code, owner, { finished: true });
  await wipe(player, ['events']);
  const file = (await exported(player)).text;
  assert.match(file, /## Decklists\n\n### Test Cup\n/u);
  assert.match(file, /```\n4 Pikachu\n```/u);
  assert.match(
    file,
    new RegExp(
      `## Events hidden from your history\\n\\n### Test Cup\\n\\n- Event: Test Cup\\n- Event code: ${code}`,
      'u'
    )
  );
});
