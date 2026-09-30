/**
 * The tournament and account functions end to end, against the real schema in
 * SQLite. What must hold: sign-in makes a session and only a local server
 * allows the dev provider; only an event's staff change it; the public copy
 * never carries Player IDs or birth dates; a TOM event takes results as
 * pending until its synced file settles them; decklists come in only while
 * submission is open, from players with no account, and put a new submitter
 * on the player list.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, mock, test } from 'node:test';

import * as callback from '../../functions/api/auth/callback/[provider].ts';
import * as login from '../../functions/api/auth/login/[provider].ts';
import * as logout from '../../functions/api/auth/logout.ts';
import * as me from '../../functions/api/me.ts';
import * as commands from '../../functions/api/tournaments/[code]/commands.ts';
import * as decklists from '../../functions/api/tournaments/[code]/decklists.ts';
import * as decks from '../../functions/api/tournaments/[code]/decks.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as report from '../../functions/api/tournaments/[code]/report.ts';
import * as settings from '../../functions/api/tournaments/[code]/settings.ts';
import * as staff from '../../functions/api/tournaments/[code]/staff.ts';
import * as sync from '../../functions/api/tournaments/[code]/sync.ts';
import * as tournaments from '../../functions/api/tournaments/index.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { REPORT_WINDOW_MS } from '../../shared/tournament/reports.ts';
import { revisionOf } from '../../shared/tournament/revision.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import type { TournamentView } from '../../shared/tournament/view.ts';
import { publishView } from '../../functions/lib/tournaments/publish.ts';
import { loadTournament, rotateStaff } from '../../functions/lib/tournaments/store.ts';
import { countingTrips, sqliteD1 } from '../__utils__/sqliteD1.ts';

const ORIGIN = 'https://cm.test';
let env: TournamentEnv;

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
  decklists._resetRateLimitStore();
  report._resetRateLimitStore();
  event._resetRateLimitStore();
});

interface Call {
  method?: string;
  body?: unknown;
  cookie?: string;
  origin?: string | null;
}

function request(path: string, call: Call = {}): Request {
  const method = call.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (call.cookie) {
    headers.cookie = call.cookie;
  }
  if (method !== 'GET' && call.origin !== null) {
    headers.origin = call.origin ?? ORIGIN;
  }
  if (call.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  return new Request(ORIGIN + path, {
    method,
    headers,
    body: call.body === undefined ? undefined : JSON.stringify(call.body)
  });
}

type Handler = (context: never) => Promise<Response>;

async function hit(handler: Handler, path: string, params: Record<string, string>, call: Call = {}) {
  const response = await handler({ request: request(path, call), env, params } as never);
  const text = await response.text();
  return { status: response.status, headers: response.headers, json: text ? (JSON.parse(text) as any) : null };
}

async function signIn(name: string): Promise<string> {
  const response = await login.onRequestGet({
    request: request(`/api/auth/login/dev?name=${encodeURIComponent(name)}&next=/host`),
    env,
    params: { provider: 'dev' }
  } as never);
  assert.equal(response.status, 302);
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

const at = (code: string) => ({ code });

async function newSwiss(cookie: string): Promise<string> {
  const created = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    {
      method: 'POST',
      cookie,
      body: { mode: 'swiss', name: 'Test Cup', combined: true }
    }
  );
  assert.equal(created.status, 201);
  return created.json.code as string;
}

function send(code: string, cookie: string, command: unknown) {
  return hit(commands.onRequestPost as Handler, `/api/tournaments/${code}/commands`, at(code), {
    method: 'POST',
    cookie,
    body: { command, localTime: '10/10/2026 12:00:00' }
  });
}

async function addPlayers(code: string, cookie: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    const added = await send(code, cookie, {
      type: 'addPlayer',
      player: { firstName: 'Player', lastName: `${i}`, id: `${900 + i}`, birthDate: '02/27/1990' }
    });
    assert.equal(added.status, 200);
  }
}

/** The revision of the event's document as the console loads it, as the browser following the .tdf sends it. */
async function revisionNow(code: string, cookie: string): Promise<string> {
  return revisionOf((await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie })).json.tournament);
}

const view = async (code: string, cookie?: string) =>
  (await hit(event.onRequestGet as Handler, `/api/tournaments/${code}`, at(code), { cookie })).json as TournamentView;

test('dev sign-in starts a session that /api/me reads, and sign-out ends it', async () => {
  const cookie = await signIn('Organizer');
  const signedIn = await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie });
  assert.equal(signedIn.json.user.name, 'Organizer');
  assert.deepEqual(signedIn.json.providers, ['dev']);
  const out = await hit(logout.onRequestPost as Handler, '/api/auth/logout', {}, { method: 'POST', cookie });
  assert.equal(out.status, 204);
  const after = await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie });
  assert.equal(after.json.user, null);
});

test('a signed-in player saves their profile; a bad one is refused', async () => {
  const cookie = await signIn('Player');
  const profile = { popId: '1234567', firstName: 'Pat', lastName: 'Player', birthDate: '02/27/2001' };
  const saved = await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie, body: profile });
  assert.equal(saved.json.user.popId, '1234567');
  const reread = await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie });
  assert.equal(reread.json.user.lastName, 'Player');
  const bad = await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie, body: { popId: 'x' } });
  assert.equal(bad.status, 400);
  const anonymous = await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', body: profile });
  assert.equal(anonymous.status, 401);
});

test('an account name is chosen independently of the player profile', async () => {
  const cookie = await signIn('Organizer');
  const renamed = await hit(
    me.onRequestPatch as Handler,
    '/api/me',
    {},
    { method: 'PATCH', cookie, body: { name: 'Reese' } }
  );
  assert.equal(renamed.json.user.name, 'Reese');
  const bad = await hit(me.onRequestPatch as Handler, '/api/me', {}, { method: 'PATCH', cookie, body: { name: '' } });
  assert.equal(bad.status, 400);
  const missing = await hit(me.onRequestPatch as Handler, '/api/me', {}, { method: 'PATCH', cookie, body: {} });
  assert.equal(missing.status, 400);
  const anonymous = await hit(me.onRequestPatch as Handler, '/api/me', {}, { method: 'PATCH', body: { name: 'X' } });
  assert.equal(anonymous.status, 401);
  const foreign = await hit(
    me.onRequestPatch as Handler,
    '/api/me',
    {},
    { method: 'PATCH', cookie, origin: 'https://evil.test', body: { name: 'X' } }
  );
  assert.equal(foreign.status, 403);
  const reread = await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie });
  assert.equal(reread.json.user.name, 'Reese');
});

test('the dev provider is refused in production', async () => {
  env.ENVIRONMENT = 'production';
  const refused = await hit(login.onRequestGet as Handler, '/api/auth/login/dev?name=x', { provider: 'dev' });
  assert.equal(refused.status, 404);
});

test('an unconfigured provider says so rather than redirecting', async () => {
  const google = await hit(login.onRequestGet as Handler, '/api/auth/login/google', { provider: 'google' });
  assert.equal(google.status, 503);
});

test('linking a provider requires a signed-in account', async () => {
  env.GOOGLE_CLIENT_ID = 'id';
  env.GOOGLE_CLIENT_SECRET = 'secret';
  const response = await hit(login.onRequestGet as Handler, '/api/auth/login/google?link=1', { provider: 'google' });
  assert.equal(response.status, 401);
});

test('Google sign-in: state round-trips, the code is exchanged, a session begins', async () => {
  env.GOOGLE_CLIENT_ID = 'id';
  env.GOOGLE_CLIENT_SECRET = 'secret';
  const start = await login.onRequestGet({
    request: request('/api/auth/login/google?next=/host'),
    env,
    params: { provider: 'google' }
  } as never);
  const location = new URL(start.headers.get('location') ?? '');
  assert.equal(location.origin, 'https://accounts.google.com');
  assert.equal(location.searchParams.get('redirect_uri'), `${ORIGIN}/api/auth/callback/google`);
  const state = location.searchParams.get('state') ?? '';
  const oauthCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  const realFetch = globalThis.fetch;
  // Google's own field names, as its endpoints send them.
  /* eslint-disable camelcase */
  globalThis.fetch = (async (url: string | URL) =>
    String(url).includes('token')
      ? Response.json({ access_token: 'token' })
      : Response.json({ sub: 'g-1', name: 'Gia', email: 'gia@example.com', email_verified: true })) as typeof fetch;
  /* eslint-enable camelcase */
  try {
    const wrong = await callback.onRequestGet({
      request: request(`/api/auth/callback/google?code=c&state=forged`, { cookie: oauthCookie }),
      env,
      params: { provider: 'google' }
    } as never);
    assert.equal(wrong.headers.get('location'), '/settings?signin=failed');
    const done = await callback.onRequestGet({
      request: request(`/api/auth/callback/google?code=c&state=${state}`, { cookie: oauthCookie }),
      env,
      params: { provider: 'google' }
    } as never);
    assert.equal(done.headers.get('location'), '/host');
    const session = done.headers.getSetCookie().find(value => value.startsWith('cm_session=')) ?? '';
    const who = await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: session.split(';')[0] });
    assert.equal(who.json.user.email, 'gia@example.com');
    assert.equal(who.json.user.name, 'Player');
    assert.deepEqual(who.json.user.providers, ['google']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a signed-in user links Google with a different email without changing their name', async () => {
  env.GOOGLE_CLIENT_ID = 'id';
  env.GOOGLE_CLIENT_SECRET = 'secret';
  const sessionCookie = await signIn('Organizer');
  const start = await login.onRequestGet({
    request: request('/api/auth/login/google?next=/settings&link=1', { cookie: sessionCookie }),
    env,
    params: { provider: 'google' }
  } as never);
  const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
  const oauthCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const realFetch = globalThis.fetch;
  /* eslint-disable camelcase */
  globalThis.fetch = (async (url: string | URL) =>
    String(url).includes('token')
      ? Response.json({ access_token: 'token' })
      : Response.json({
          sub: 'g-2',
          name: 'Other Name',
          email: 'different@example.com',
          email_verified: true
        })) as typeof fetch;
  /* eslint-enable camelcase */
  try {
    const done = await callback.onRequestGet({
      request: request(`/api/auth/callback/google?code=c&state=${state}`, {
        cookie: `${oauthCookie}; ${sessionCookie}`
      }),
      env,
      params: { provider: 'google' }
    } as never);
    assert.equal(done.headers.get('location'), '/settings');
    const who = await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: sessionCookie });
    assert.equal(who.json.user.name, 'Organizer');
    assert.deepEqual(who.json.user.providers.sort(), ['dev', 'google']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a provider that refuses the code sends the browser back to Settings', async () => {
  env.DISCORD_CLIENT_ID = 'id';
  env.DISCORD_CLIENT_SECRET = 'secret';
  const start = await login.onRequestGet({
    request: request('/api/auth/login/discord?next=/host'),
    env,
    params: { provider: 'discord' }
  } as never);
  const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
  const oauthCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('denied', { status: 401 })) as typeof fetch;
  const log = console.error;
  console.error = () => undefined;
  try {
    const done = await callback.onRequestGet({
      request: request(`/api/auth/callback/discord?code=c&state=${state}`, { cookie: oauthCookie }),
      env,
      params: { provider: 'discord' }
    } as never);
    assert.equal(done.headers.get('location'), '/settings?signin=failed');
  } finally {
    globalThis.fetch = realFetch;
    console.error = log;
  }
});

test('creating an event needs a signed-in, same-origin request', async () => {
  const anonymous = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    {
      method: 'POST',
      body: { mode: 'swiss', name: 'x' }
    }
  );
  assert.equal(anonymous.status, 401);
  const cookie = await signIn('Organizer');
  const crossSite = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    {
      method: 'POST',
      cookie,
      origin: 'https://evil.test',
      body: { mode: 'swiss', name: 'x' }
    }
  );
  assert.equal(crossSite.status, 403);
  const code = await newSwiss(cookie);
  const list = await hit(tournaments.onRequestGet as Handler, '/api/tournaments', {}, { cookie });
  assert.deepEqual(
    list.json.tournaments.map((t: { code: string; role: string }) => [t.code, t.role]),
    [[code, 'owner']]
  );
});

test('only staff change an event, and bad commands are refused', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  const stranger = await signIn('Stranger');
  assert.equal((await send(code, stranger, { type: 'pairRound', pod: 'mixed' })).status, 403);
  assert.equal((await send(code, owner, { type: 'launchMissiles' })).status, 400);
  assert.equal(
    (await send(code, owner, { type: 'pairRound', pod: 'mixed' })).json.error,
    'Add at least two players first'
  );
  assert.equal((await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: stranger })).status, 403);
});

test('a Swiss event pairs, reports, seats a late arrival and hides private fields publicly', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 5);
  const paired = await send(code, owner, { type: 'pairRound', pod: 'mixed' });
  const table = paired.json.tournament.pods[0].rounds[0].matches[0];
  await send(code, owner, {
    type: 'reportResult',
    pod: 'mixed',
    round: 1,
    table: table.table,
    p1: table.p1,
    p2: table.p2,
    outcome: 'p1'
  });
  await send(code, owner, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'Arrival', id: '999' } });
  const repaired = await send(code, owner, { type: 'repairRound', pod: 'mixed', keepReported: true });
  const seated = repaired.json.tournament.pods[0].rounds[0].matches.flatMap((m: { p1: string; p2: string | null }) => [
    m.p1,
    m.p2
  ]);
  assert.ok(seated.includes('999'));
  assert.equal(
    repaired.json.tournament.pods[0].rounds[0].matches.filter((m: { outcome: string }) => m.outcome === 'p1').length,
    1
  );

  const publicView = await view(code);
  // Without the timestamps, whose digits can happen to contain an ID.
  const text = JSON.stringify({ ...publicView, updatedAt: 0, version: 0 });
  assert.ok(!text.includes('999') && !text.includes('900'), 'no Player IDs');
  assert.ok(!text.includes('02/27/1990'), 'no birth dates');
  assert.equal(publicView.tournament.players.length, 6);
  assert.deepEqual(publicView.viewer, { role: null, me: null, signedIn: false });

  const unchanged = await event.onRequestGet({
    request: request(`/api/tournaments/${code}?since=${publicView.version}`),
    env,
    params: at(code)
  } as never);
  assert.equal(unchanged.status, 204);
});

test('staff join by invite link, and a new link retires the old one', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  const { staffToken } = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json;
  const helper = await signIn('Helper');
  const bad = await hit(staff.onRequestPost as Handler, '/staff', at(code), {
    method: 'POST',
    cookie: helper,
    body: { token: 'nope' }
  });
  assert.equal(bad.status, 403);
  const joined = await hit(staff.onRequestPost as Handler, '/staff', at(code), {
    method: 'POST',
    cookie: helper,
    body: { token: staffToken }
  });
  assert.deepEqual(joined.json, { role: 'staff' });
  assert.equal(
    (await send(code, helper, { type: 'addPlayer', player: { firstName: 'A', lastName: 'B' } })).status,
    200
  );
  const notOwner = await hit(staff.onRequestPost as Handler, '/staff', at(code), {
    method: 'POST',
    cookie: helper,
    body: { rotate: true }
  });
  assert.equal(notOwner.status, 403);
  const rotated = await hit(staff.onRequestPost as Handler, '/staff', at(code), {
    method: 'POST',
    cookie: owner,
    body: { rotate: true }
  });
  assert.notEqual(rotated.json.staffToken, staffToken);
  assert.equal(
    (await send(code, helper, { type: 'addPlayer', player: { firstName: 'C', lastName: 'D' } })).status,
    403,
    'a new link removes everyone who joined through the old one'
  );
  const late = await signIn('Latecomer');
  const stale = await hit(staff.onRequestPost as Handler, '/staff', at(code), {
    method: 'POST',
    cookie: late,
    body: { token: staffToken }
  });
  assert.equal(stale.status, 403);
});

test('a TOM event holds site results as pending until the synced file settles them', async () => {
  const owner = await signIn('Organizer');
  const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  const created = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    {
      method: 'POST',
      cookie: owner,
      body: { mode: 'tom', tournament: tdf }
    }
  );
  const { code } = created.json;
  const reported = await send(code, owner, {
    type: 'reportResult',
    pod: 'mixed',
    round: 2,
    table: 1,
    p1: '7200001',
    p2: '7200004',
    outcome: 'p1'
  });
  const decided = await send(code, owner, {
    type: 'reportResult',
    pod: 'mixed',
    round: 2,
    table: 2,
    p1: '7200005',
    p2: '7200007',
    outcome: 'p1'
  });
  assert.match(decided.json.error, /TOM already has a result/);
  assert.equal(reported.json.pending.length, 1);
  assert.equal(reported.json.tournament.pods[0].rounds[1].matches[1].outcome, 'pending', 'TOM’s copy is untouched');
  assert.match((await send(code, owner, { type: 'pairRound', pod: 'mixed' })).json.error, /TOM runs this event/);

  const publicView = await view(code);
  assert.equal(publicView.pending.length, 1);
  assert.notEqual(publicView.pending[0]?.p1, '7200001', 'pending results use public keys too');

  const refused = await hit(sync.onRequestPut as Handler, '/sync', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { junk: true }
  });
  assert.equal(refused.status, 400);
  const matches = tdf.pods[0]?.rounds[1]?.matches ?? [];
  const settled = {
    ...tdf,
    pods: [
      {
        ...tdf.pods[0]!,
        rounds: [
          tdf.pods[0]!.rounds[0]!,
          {
            ...tdf.pods[0]!.rounds[1]!,
            matches: matches.map((m, i) => (i === 1 ? { ...m, outcome: 'p1' as const } : m))
          }
        ]
      }
    ]
  };
  const synced = await hit(sync.onRequestPut as Handler, '/sync', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { tournament: settled, base: await revisionNow(code, owner) }
  });
  assert.equal(synced.status, 200);
  assert.deepEqual(synced.json.pending, []);
});

test('a Swiss event cannot be synced from a file', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  const refused = await hit(sync.onRequestPut as Handler, '/sync', at(code), {
    method: 'PUT',
    cookie: owner,
    body: {}
  });
  assert.equal(refused.status, 400);
});

test('decklists come in only while open, and decks show as the visibility setting allows', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  const player = await signIn('Player');
  const submission = {
    deck: '4 Iono PAL 185\n56 Basic {P} Energy SVE 5',
    profile: { popId: '777', firstName: 'Pat', lastName: 'Player', birthDate: '02/27/2001' },
    archetype: 'Gardevoir ex'
  };
  const off = await hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    cookie: player,
    body: submission
  });
  assert.deepEqual([off.status, off.json.error], [403, 'This event does not take decklists'], 'off by default');
  await hit(settings.onRequestPut as Handler, '/settings', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { decklists: 'closed' }
  });
  const closed = await hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    cookie: player,
    body: submission
  });
  assert.deepEqual([closed.status, closed.json.error], [403, 'Decklist submission is closed']);
  await hit(settings.onRequestPut as Handler, '/settings', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { decklists: 'open', deckVisibility: 'after' }
  });
  const badProfile = await hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    cookie: player,
    body: { ...submission, profile: { ...submission.profile, popId: 'abc' } }
  });
  assert.equal(badProfile.status, 400);
  const sent = await hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    cookie: player,
    body: submission
  });
  assert.deepEqual(sent.json.decklist.problems, []);
  assert.equal(sent.json.registration, 'added', 'a submitter not on the list is added to it');
  assert.deepEqual([sent.json.decklist.registered, sent.json.decklist.fromList], [true, true]);

  const mine = await hit(decklists.onRequestGet as Handler, `/decklists?popId=777&token=${sent.json.token}`, at(code), {
    cookie: player
  });
  assert.deepEqual([mine.json.decklists.length, mine.json.mine.popId], [0, '777']);
  const all = await hit(decklists.onRequestGet as Handler, '/decklists', at(code), { cookie: owner });
  assert.deepEqual([all.json.decklists.length, all.json.decklists[0].archetype], [1, 'Gardevoir ex']);

  await send(code, owner, {
    type: 'addPlayer',
    player: { firstName: 'Pat', lastName: 'Player', id: '777', birthDate: '02/27/2001' }
  });
  await hit(settings.onRequestPut as Handler, '/settings', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { finished: true }
  });
  assert.deepEqual((await view(code)).decks, {}, 'a player’s word is not public until staff apply it');
  const impostor = await signIn('Impostor');
  await hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    cookie: impostor,
    body: { ...submission, archetype: 'Joke Deck' }
  });
  assert.deepEqual((await view(code)).decks, {}, 'nobody can set what someone else is on');
  await hit(decks.onRequestPut as Handler, '/decks', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { playerId: '777', archetype: 'Gardevoir ex' }
  });
  await hit(settings.onRequestPut as Handler, '/settings', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { finished: false }
  });
  assert.deepEqual(Object.values((await view(code)).decks), [], 'hidden until the event ends');
  await hit(settings.onRequestPut as Handler, '/settings', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { finished: true }
  });
  assert.deepEqual(Object.values((await view(code)).decks), ['Gardevoir ex']);
  const playerView = await view(code, player);
  assert.equal(playerView.viewer.me, playerView.tournament.players[0]?.id, 'the profile finds the player');

  const staffDeck = await hit(decks.onRequestPut as Handler, '/decks', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { playerId: '777', archetype: null }
  });
  assert.deepEqual(staffDeck.json.decks, {});
  const badSettings = await hit(settings.onRequestPut as Handler, '/settings', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { deckVisibility: 'sometimes' }
  });
  assert.equal(badSettings.status, 400);
});

test('sign-in only ever returns to a path on this site', async () => {
  for (const next of ['/\t/evil.example', '//evil.example', 'https://evil.example', '/\\evil.example']) {
    const response = await login.onRequestGet({
      request: request(`/api/auth/login/dev?name=x&next=${encodeURIComponent(next)}`),
      env,
      params: { provider: 'dev' }
    } as never);
    assert.equal(response.headers.get('location'), '/', JSON.stringify(next));
  }
});

test('an event too large for one D1 row is refused with a message', async () => {
  const owner = await signIn('Organizer');
  const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  const long = 'x'.repeat(190);
  const players = Array.from({ length: 4800 }, (_, i) => ({
    ...tdf.players[0]!,
    id: String(1_000_000 + i),
    firstName: long,
    lastName: long
  }));
  const huge = { ...tdf, players, pods: [{ ...tdf.pods[0]!, playerIds: players.map(p => p.id), rounds: [] }] };
  const refused = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    {
      method: 'POST',
      cookie: owner,
      body: { mode: 'tom', tournament: huge }
    }
  );
  assert.deepEqual([refused.status, refused.json.error], [413, 'This event is too large to store']);
});

test('every change publishes the public view to R2, and deleting the event removes it', async () => {
  const objects = new Map<string, { body: string; cacheControl: string }>();
  env.REPORTS = {
    put: async (key, value, options) => {
      objects.set(key, { body: value, cacheControl: options.httpMetadata.cacheControl ?? '' });
    },
    delete: async key => {
      objects.delete(key);
    }
  };
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  const key = `tournaments/v1/${code}.json`;
  assert.ok(objects.has(key), 'published on creation');
  await addPlayers(code, owner, 2);
  await hit(settings.onRequestPut as Handler, '/settings', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { deckVisibility: 'after' }
  });
  await hit(decks.onRequestPut as Handler, '/decks', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { playerId: '900', archetype: 'Gardevoir' }
  });
  const published = JSON.parse(objects.get(key)?.body ?? '{}');
  assert.equal(published.tournament.players.length, 2, 'a player just added is published');
  const stable = JSON.stringify({ ...published, updatedAt: 0, version: 0 });
  assert.ok(!stable.includes('900'), 'no Player IDs, not even for a player just added');
  assert.ok(!('viewer' in published));
  assert.deepEqual(published.decks, {}, 'decks stay hidden until the event allows them');
  assert.equal(objects.get(key)?.cacheControl, 'public, max-age=5');
  const staffView = await view(code, owner);
  assert.deepEqual(Object.values(staffView.decks), ['Gardevoir'], 'staff see decks through the API');
  await hit(settings.onRequestPut as Handler, '/settings', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { deckVisibility: 'always' }
  });
  assert.deepEqual(Object.values(JSON.parse(objects.get(key)?.body ?? '{}').decks), ['Gardevoir']);
  await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: owner });
  assert.ok(!objects.has(key), 'deleting the event unpublishes it');
});

test('a failed publish does not fail the change', async () => {
  env.REPORTS = {
    put: async () => {
      throw new Error('R2 down');
    },
    delete: async () => {
      throw new Error('R2 down');
    }
  };
  const log = console.error;
  console.error = () => undefined;
  try {
    const owner = await signIn('Organizer');
    const code = await newSwiss(owner);
    assert.equal(
      (await send(code, owner, { type: 'addPlayer', player: { firstName: 'A', lastName: 'B' } })).status,
      200
    );
    assert.equal(
      (await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: owner })).status,
      204
    );
  } finally {
    console.error = log;
  }
});

test('only the organizer deletes an event', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  const other = await signIn('Other');
  assert.equal(
    (await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: other })).status,
    403
  );
  assert.equal(
    (await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: owner })).status,
    204
  );
  assert.equal((await hit(event.onRequestGet as Handler, '/', at(code))).status, 404);
});

afterEach(() => {
  mock.timers.reset();
  delete env.ENVIRONMENT;
  delete env.REPORTS;
});

function settle(code: string, cookie: string, change: Record<string, unknown>) {
  return hit(settings.onRequestPut as Handler, '/settings', at(code), { method: 'PUT', cookie, body: change });
}

function playerSays(code: string, body: Record<string, unknown>) {
  return hit(report.onRequestPost as Handler, '/report', at(code), {
    method: 'POST',
    body: { ...body, localTime: '10/10/2026 12:00:00' }
  });
}

/** A player's phone: it says who they are once, keeps the token it is given, and reports with it. */
async function phoneOf(code: string, popId: string, device = `phone-${popId}`) {
  const said = await playerSays(code, { popId, device });
  const token = said.json.reportToken as string | undefined;
  return { said, report: (result: string) => playerSays(code, { popId, result, device, reportToken: token }) };
}

test('an event starts with the settings its setup chose', async () => {
  const owner = await signIn('Organizer');
  const created = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    {
      method: 'POST',
      cookie: owner,
      body: {
        mode: 'swiss',
        name: 'Friday Locals',
        combined: false,
        roundTime: 25,
        settings: { sanctioned: false, playerReporting: true, format: 'Expanded', finished: true, roundCap: 3 }
      }
    }
  );
  assert.equal(created.status, 201);
  const code = created.json.code as string;
  const made = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json;
  assert.equal(made.tournament.info.roundTime, 25);
  assert.equal(made.tournament.combined, true, 'no birth years, so no divisions to split');
  assert.equal(made.settings.sanctioned, false);
  assert.equal(made.settings.playerReporting, true);
  assert.equal(made.settings.format, 'Expanded');
  assert.equal(made.settings.finished, false, 'an event does not start closed');
  assert.equal(made.settings.deckVisibility, 'off');
  assert.equal(made.settings.decklists, 'off');
  assert.equal(made.settings.roundCap, 3, 'a league that plays three rounds');
  const bad = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    { method: 'POST', cookie: owner, body: { mode: 'swiss', name: 'X', settings: { sanctioned: 'yes' } } }
  );
  assert.equal(bad.status, 400);
});

test('an unsanctioned event takes decklists by name and leaves the account’s Player ID alone', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { sanctioned: false, decklists: 'open' });
  await send(code, owner, { type: 'addPlayer', player: { firstName: 'Pat', lastName: 'Player' } });
  const player = await signIn('Player');
  const profile = { popId: '1234567', firstName: 'Pat', lastName: 'Player', birthDate: '02/27/2001' };
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: player, body: profile });
  const sent = await hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    cookie: player,
    body: { deck: '60 Basic {P} Energy SVE 5', profile: { firstName: 'Pat', lastName: 'player' } }
  });
  assert.equal(sent.status, 200);
  assert.equal(sent.json.decklist.popId, '');
  assert.equal(sent.json.decklist.registered, true, 'matched to the list by name');
  const account = await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: player });
  assert.equal(account.json.user.popId, '1234567');
});

test('players report their own results: agreement stands once locked, disagreement waits for staff', async () => {
  const owner = await signIn('Organizer');
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  const paired = await send(code, owner, { type: 'pairRound', pod: 'mixed' });
  const [first, second] = paired.json.tournament.pods[0].rounds[0].matches;
  assert.equal((await playerSays(code, { popId: first.p1, result: 'win' })).status, 403, 'off until staff turn it on');
  await settle(code, owner, { playerReporting: true });

  const p1 = await phoneOf(code, first.p1);
  const p2 = await phoneOf(code, first.p2);
  const who = p1.said;
  assert.equal(who.status, 200);
  assert.ok(who.json.reportToken && who.json.reporter, 'the first device to say who they are reports for them');
  assert.ok(who.json.key && who.json.key !== first.p1, 'a public key, never the Player ID');
  assert.equal((await playerSays(code, { popId: '1' })).status, 404);
  assert.equal((await p1.report('forfeit')).status, 400);

  const forged = await playerSays(code, { popId: first.p2, result: 'loss', device: `phone-${first.p1}` });
  assert.equal(forged.status, 403, 'knowing the opponent’s Player ID does not report for them');
  const later = await playerSays(code, { popId: first.p2, device: 'another-phone' });
  assert.deepEqual([later.json.reporter, later.json.reportToken], [false, undefined], 'a second device only follows');
  const one = await p1.report('win');
  assert.equal(one.json.view.reports.length, 1);
  assert.ok(!JSON.stringify(one.json.view.reports).includes(first.p1), 'reports go out under public keys');
  const agreed = await p2.report('loss');
  assert.equal(agreed.json.view.reports.length, 2, 'agreeing reports wait out the window');
  assert.equal(agreed.json.view.tournament.pods[0].rounds[0].matches[0].outcome, 'pending');
  const changed = await p2.report('win');
  assert.equal(changed.json.view.reports.length, 2, 'a change replaces the report inside the window');
  await p2.report('loss');

  mock.timers.tick(REPORT_WINDOW_MS);
  assert.match((await p2.report('win')).json.error, /already has a result/);
  const settled = await playerSays(code, { popId: first.p1 });
  assert.deepEqual(settled.json.view.reports, []);
  assert.equal(settled.json.view.tournament.pods[0].rounds[0].matches[0].outcome, 'p1', 'once locked, it stands');

  const s1 = await phoneOf(code, second.p1);
  const s2 = await phoneOf(code, second.p2);
  await s1.report('win');
  const disputed = await s2.report('win');
  assert.equal(disputed.json.view.reports.length, 2);
  assert.ok(!JSON.stringify(disputed.json.view).includes('device'), 'which device reported stays with staff');
  mock.timers.tick(REPORT_WINDOW_MS);
  assert.match((await s2.report('loss')).json.error, /locked/);
  assert.equal(
    (await playerSays(code, { popId: second.p1 })).json.view.tournament.pods[0].rounds[0].matches[1].outcome,
    'pending'
  );
  const staffView = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json;
  assert.deepEqual(
    staffView.reports.map((r: { by: string }) => r.by).sort(),
    [second.p1, second.p2].sort(),
    'staff see who said what'
  );
  const overridden = await send(code, owner, {
    type: 'reportResult',
    pod: 'mixed',
    round: 1,
    table: second.table,
    p1: second.p1,
    p2: second.p2,
    outcome: 'p2'
  });
  assert.deepEqual(overridden.json.reports, [], 'a staff result settles the dispute');
  assert.deepEqual((await view(code)).reports, []);

  await send(code, owner, {
    type: 'reportResult',
    pod: 'mixed',
    round: 1,
    table: first.table,
    p1: first.p1,
    p2: first.p2,
    outcome: 'pending'
  });
  assert.equal((await p1.report('win')).json.view.reports.length, 1);
  const off = await settle(code, owner, { playerReporting: false });
  assert.deepEqual(off.json.reports, [], 'turning reporting off drops what was waiting');
  const marked = await playerSays(code, { popId: first.p1 });
  assert.equal(marked.status, 200, 'a player still says who they are with reporting off');
  assert.ok(marked.json.key);
  const refused = await p1.report('win');
  assert.equal(refused.status, 403, 'but reports go to staff');
  assert.equal((await playerSays(code, { popId: '0000000' })).status, 404, 'a Player ID not in the event finds nobody');
});

test('a report for the match a stale page showed does not land on the next round', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 2);
  await settle(code, owner, { playerReporting: true });
  const [first] = (await send(code, owner, { type: 'pairRound', pod: 'mixed' })).json.tournament.pods[0].rounds[0]
    .matches;
  const phone = await phoneOf(code, first.p1);
  const token = phone.said.json.reportToken as string;
  const shownFirst = { pod: 'mixed', round: 1, table: first.table };
  const says = (match: unknown) =>
    playerSays(code, { popId: first.p1, result: 'win', match, device: `phone-${first.p1}`, reportToken: token });
  assert.equal((await says(shownFirst)).status, 200, 'the match the page showed takes the report');
  await send(code, owner, { type: 'reportResult', ...shownFirst, p1: first.p1, p2: first.p2, outcome: 'p1' });
  await send(code, owner, { type: 'pairRound', pod: 'mixed' });
  const stale = await says(shownFirst);
  assert.equal(stale.status, 400);
  assert.match(stale.json.error, /pairing has changed/);
  assert.deepEqual((await view(code)).reports, [], 'nothing was filed against round 2');
});

test('an unsanctioned event finds players by last name, asking for a first name when two share it', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { sanctioned: false, playerReporting: true });
  for (const [firstName, lastName] of [
    ['Gary', 'Oak'],
    ['Daisy', 'Oak'],
    ['Ash', 'Ketchum']
  ]) {
    await send(code, owner, { type: 'addPlayer', player: { firstName, lastName } });
  }
  const shared = await playerSays(code, { lastName: 'oak' });
  assert.equal(shared.status, 404);
  assert.equal(shared.json.ambiguous, true);
  assert.equal((await playerSays(code, { lastName: 'Oak', firstName: 'Daisy' })).status, 200);
  assert.equal((await playerSays(code, { lastName: 'Ketchum' })).status, 200);
  const shown = (await view(code)).tournament.players.map(p => `${p.firstName} ${p.lastName}`).sort();
  assert.deepEqual(shown, ['Ash K.', 'Daisy O.', 'Gary O.'], 'the public sees initials, never full last names');
  const staffNames = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json;
  assert.ok(staffNames.tournament.players.some((p: { lastName: string }) => p.lastName === 'Ketchum'));
  const byId = await playerSays(code, { popId: '9000000000' });
  assert.equal(byId.status, 404, 'no Player IDs at an unsanctioned event');
});

test('at a TOM event an agreed report becomes a pending result for TOM', async () => {
  const owner = await signIn('Organizer');
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  const created = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    { method: 'POST', cookie: owner, body: { mode: 'tom', tournament: tdf, settings: { sanctioned: false } } }
  );
  const { code } = created.json;
  await settle(code, owner, { playerReporting: true });
  await playerSays(code, { popId: '7200001', result: 'tie' });
  const both = await playerSays(code, { popId: '7200004', result: 'tie' });
  assert.equal(both.status, 200, 'a TOM event goes by Player ID whatever its setting says');
  const { version } = both.json.view;
  assert.ok(version > 0, 'the console polls with the version it holds');
  mock.timers.tick(REPORT_WINDOW_MS);
  const agreed = (await hit(manage.onRequestGet as Handler, `/manage?since=${version}`, at(code), {
    cookie: owner
  })) as {
    json: { pending: { outcome: string }[]; tournament: TournamentView['tournament'] };
  };
  assert.equal(agreed.json.pending.length, 1, 'the console’s next look settles it');
  assert.equal(agreed.json.pending[0]?.outcome, 'tie');
  const table = agreed.json.tournament.pods[0]?.rounds[1]?.matches.find(m => m.table === 1);
  assert.equal(table?.outcome, 'pending', 'TOM’s copy is untouched');
});

const LIST = { deck: '60 Basic {P} Energy SVE 5', archetype: null };

function submitAs(code: string, profile: Record<string, string>, extra: Record<string, unknown> = {}) {
  return hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    body: { ...LIST, profile, ...extra }
  });
}

function listOf(code: string, query: string) {
  return hit(decklists.onRequestGet as Handler, `/decklists?${query}`, at(code));
}

test('a player with no account submits a list, reads it back with its device token, and withdraws it', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open' });
  const profile = { popId: '4242', firstName: 'Nia', lastName: 'Okafor', birthDate: '02/27/2001' };
  const sent = await submitAs(code, profile);
  assert.equal(sent.status, 200, 'no sign-in needed');
  assert.equal(sent.json.registration, 'added');
  const { token } = sent.json;
  assert.ok(typeof token === 'string' && token.length > 20);
  const roster = await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner });
  const added = roster.json.tournament.players.find((p: { id: string }) => p.id === '4242');
  assert.equal(added?.fromList, true, 'marked as added from a list');

  const mine = await listOf(code, `popId=4242&token=${token}`);
  assert.equal(mine.json.mine.firstName, 'Nia');
  assert.equal((await listOf(code, 'popId=4242&token=nope')).json.mine, null, 'the Player ID alone reads nothing');
  assert.equal((await listOf(code, 'popId=4242')).json.mine, null);

  const stranger = await submitAs(code, profile, { deck: '60 Basic {G} Energy SVE 1' });
  assert.equal(stranger.status, 409, 'the same Player ID from another device cannot replace the list');
  assert.match(stranger.json.error, /sent from another device/);
  const again = await submitAs(code, { ...profile, firstName: 'Nia R.' }, { deck: '60 Basic {D} Energy SVE 7', token });
  assert.equal(again.json.registration, 'matched', 'the sending device replaces the list, and they are already in');
  const staffLists = await hit(decklists.onRequestGet as Handler, '/decklists', at(code), { cookie: owner });
  assert.equal(staffLists.json.decklists.length, 1, 'one list per identity');
  assert.equal(
    again.json.token,
    token,
    'the device keeps its token, so a retry after a lost answer still owns the list'
  );
  const retried = await submitAs(code, profile, { token });
  assert.equal(retried.status, 200);

  const forged = await hit(decklists.onRequestDelete as Handler, '/decklists?popId=4242', at(code), {
    method: 'DELETE'
  });
  assert.equal(forged.status, 409, 'nor withdraw it');
  const withdrawn = await hit(
    decklists.onRequestDelete as Handler,
    `/decklists?popId=4242&token=${again.json.token}`,
    at(code),
    { method: 'DELETE' }
  );
  assert.equal(withdrawn.status, 204);
  const after = await hit(decklists.onRequestGet as Handler, '/decklists', at(code), { cookie: owner });
  assert.equal(after.json.decklists.length, 0);

  const own = 'device-made-token-0001';
  const first = await submitAs(code, { ...profile, popId: '4243' }, { token: own });
  assert.equal(first.json.token, own, 'a first list takes the token its device made before sending');
  assert.equal((await submitAs(code, { ...profile, popId: '4243' }, { token: own })).status, 200);
  const foreign = await hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    origin: 'https://elsewhere.test',
    body: { ...LIST, profile }
  });
  assert.equal(foreign.status, 403, 'another site’s page cannot submit for a player');
});

test('a submitter is only added to an open Swiss event, and an unsanctioned one by name', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open', finished: true });
  const closed = await submitAs(code, { popId: '5151', firstName: 'Ada', lastName: 'Byron', birthDate: '02/27/1990' });
  assert.deepEqual([closed.status, closed.json.registration], [200, 'not-added'], 'a closed event takes nobody new');

  const casual = await newSwiss(owner);
  await settle(casual, owner, { decklists: 'open', sanctioned: false });
  const byName = await submitAs(casual, { firstName: 'Grace', lastName: 'Hopper' });
  assert.equal(byName.json.registration, 'added');
  const again = await submitAs(casual, { firstName: 'grace', lastName: 'HOPPER' }, { token: byName.json.token });
  assert.equal(again.json.registration, 'matched', 'names match however they are typed');
  const roster = await hit(manage.onRequestGet as Handler, '/manage', at(casual), { cookie: owner });
  assert.equal(roster.json.tournament.players.length, 1);
  const mine = await listOf(casual, `firstName=Grace&lastName=Hopper&token=${again.json.token}`);
  assert.equal(mine.json.mine.lastName, 'HOPPER');
});

test('a signed-in player’s profile reads no list without the device token', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open' });
  const player = await signIn('Player');
  const profile = { popId: '6161', firstName: 'Lin', lastName: 'Park', birthDate: '02/27/2001' };
  const sent = await hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    cookie: player,
    body: { ...LIST, profile }
  });
  assert.equal(sent.status, 200);
  // Anyone can put another player's details in their profile, so the profile alone must not read the list.
  const bySession = await hit(decklists.onRequestGet as Handler, '/decklists?popId=6161', at(code), { cookie: player });
  assert.equal(bySession.json.mine, null);
  const byToken = await hit(
    decklists.onRequestGet as Handler,
    `/decklists?popId=6161&token=${sent.json.token}`,
    at(code),
    {
      cookie: player
    }
  );
  assert.equal(byToken.json.mine.lastName, 'Park');
});

test('names split differently are different players’ lists', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open', sanctioned: false });
  await submitAs(code, { firstName: 'Mary Ann', lastName: 'Smith' });
  await submitAs(code, { firstName: 'Mary', lastName: 'Ann Smith' });
  const staffLists = await hit(decklists.onRequestGet as Handler, '/decklists', at(code), { cookie: owner });
  assert.equal(staffLists.json.decklists.length, 2);
});

test('staff unlock a list for a player on a new device, who then takes it over', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open' });
  const profile = { popId: '7373', firstName: 'Ren', lastName: 'Aoki', birthDate: '02/27/2001' };
  await submitAs(code, profile);
  assert.equal((await submitAs(code, profile)).status, 409);
  const byPlayer = await hit(decklists.onRequestPatch as Handler, '/decklists?popId=7373', at(code), {
    method: 'PATCH'
  });
  assert.equal(byPlayer.status, 401, 'only staff unlock');
  const unlocked = await hit(decklists.onRequestPatch as Handler, '/decklists?popId=7373', at(code), {
    method: 'PATCH',
    cookie: owner
  });
  assert.equal(unlocked.status, 204);
  const newPhone = await submitAs(code, profile, { deck: '60 Basic {W} Energy SVE 3' });
  assert.equal(newPhone.status, 200);
  assert.equal((await submitAs(code, profile)).status, 409, 'and it is locked to the new device');
});

test('two agreeing reports from one device wait for staff, and staff can free a player’s device', async () => {
  const owner = await signIn('Organizer');
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  const paired = await send(code, owner, { type: 'pairRound', pod: 'mixed' });
  const [first] = paired.json.tournament.pods[0].rounds[0].matches;
  await settle(code, owner, { playerReporting: true });
  // One phone claims both seats before either player does.
  const mine = await phoneOf(code, first.p1, 'one-phone');
  const theirs = await phoneOf(code, first.p2, 'one-phone');
  await mine.report('win');
  await theirs.report('loss');
  mock.timers.tick(REPORT_WINDOW_MS);
  const after = await playerSays(code, { popId: first.p1, device: 'one-phone' });
  assert.equal(after.json.view.tournament.pods[0].rounds[0].matches[0].outcome, 'pending', 'not settled');
  assert.deepEqual(
    after.json.view.reports.map((r: { device?: string }) => r.device),
    ['shared', 'shared'],
    'the public view says only that one device sent both, so the page does not call it settled'
  );
  const staffView = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json;
  const [a, b] = staffView.reports as { device?: string }[];
  assert.ok(a?.device && a.device === b?.device, 'staff can see both came from one device');

  const released = await hit(report.onRequestDelete as Handler, `/report?player=${first.p2}`, at(code), {
    method: 'DELETE',
    cookie: owner
  });
  assert.equal(released.status, 204);
  const real = await phoneOf(code, first.p2, 'their-own-phone');
  assert.equal(real.said.json.reporter, true, 'the real player can claim their seat once staff free it');
});

/** An event with one member of staff, who joined through the invite link. */
async function withHelper() {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  const token = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json.staffToken;
  const helper = await signIn('Helper');
  await hit(staff.onRequestPost as Handler, '/staff', at(code), { method: 'POST', cookie: helper, body: { token } });
  return { owner, code, helper };
}

test('the organizer sees who joined staff, and when, and removes one of them', async () => {
  const { owner, code, helper } = await withHelper();
  const listed = await hit(staff.onRequestGet as Handler, '/staff', at(code), { cookie: owner });
  assert.equal(listed.json.staff.length, 1);
  assert.equal(listed.json.staff[0].name, 'Helper');
  assert.ok(typeof listed.json.staff[0].joinedAt === 'number');
  assert.equal((await hit(staff.onRequestGet as Handler, '/staff', at(code), { cookie: helper })).status, 403);
  const removed = await hit(staff.onRequestDelete as Handler, `/staff?user=${listed.json.staff[0].id}`, at(code), {
    method: 'DELETE',
    cookie: owner
  });
  assert.deepEqual(removed.json.staff, []);
  assert.equal((await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: helper })).status, 403);
});

test('only the organizer shows decks sooner; staff can still hide them', async () => {
  const { owner, code, helper } = await withHelper();
  const put = (cookie: string, deckVisibility: string) =>
    hit(settings.onRequestPut as Handler, '/settings', at(code), { method: 'PUT', cookie, body: { deckVisibility } });
  assert.equal((await put(helper, 'always')).status, 403, 'staff cannot reveal decks early');
  assert.equal((await put(owner, 'always')).status, 200);
  assert.equal((await put(helper, 'after')).status, 200, 'but can hide them');
});

/** Every statement the functions prepare from here on, in order. */
function recordSql(): string[] {
  const db = env.TOURNAMENT_DB as NonNullable<TournamentEnv['TOURNAMENT_DB']>;
  const seen: string[] = [];
  env.TOURNAMENT_DB = {
    ...db,
    prepare: sql => {
      seen.push(sql);
      return db.prepare(sql);
    }
  };
  return seen;
}

test('a change reads the event once and writes only the columns it changed', async () => {
  const cookie = await signIn('Organizer');
  const code = await newSwiss(cookie);
  await addPlayers(code, cookie, 2);
  const seen = recordSql();
  const saved = await hit(decks.onRequestPut as Handler, '/decks', at(code), {
    method: 'PUT',
    cookie,
    body: { playerId: '900', archetype: 'Gardevoir' }
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.decks['900'], 'Gardevoir');
  assert.equal(seen.filter(sql => sql.startsWith('SELECT * FROM tournaments')).length, 1);
  const update = seen.find(sql => sql.startsWith('UPDATE tournaments')) ?? '';
  assert.match(update, /decks = \?/);
  assert.doesNotMatch(update, /state = |staff_token = |settings = /);
});

test('a join that read the old invite link cannot land after the organizer replaces it', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  const { staffToken } = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json;
  const helper = await signIn('Helper');
  const db = env.TOURNAMENT_DB as NonNullable<TournamentEnv['TOURNAMENT_DB']>;
  // The organizer's new link lands after the join request read the event, just before it writes.
  env.TOURNAMENT_DB = {
    ...db,
    prepare: sql => {
      if (sql.startsWith('INSERT OR IGNORE INTO staff')) {
        void rotateStaff(db, code);
      }
      return db.prepare(sql);
    }
  };
  const joined = await hit(staff.onRequestPost as Handler, '/staff', at(code), {
    method: 'POST',
    cookie: helper,
    body: { token: staffToken }
  });
  env.TOURNAMENT_DB = db;
  assert.equal(joined.status, 403);
  assert.equal(
    (await send(code, helper, { type: 'addPlayer', player: { firstName: 'A', lastName: 'B' } })).status,
    403
  );
});

test('a list cannot be withdrawn once submission closes, even with its token', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open' });
  const sent = await submitAs(code, { popId: '4343', firstName: 'Ola', lastName: 'Nordmann', birthDate: '02/27/2001' });
  await settle(code, owner, { decklists: 'closed' });
  const withdrawn = await hit(
    decklists.onRequestDelete as Handler,
    `/decklists?popId=4343&token=${sent.json.token}`,
    at(code),
    { method: 'DELETE' }
  );
  assert.equal(withdrawn.status, 403);
  const lists = await hit(decklists.onRequestGet as Handler, '/decklists', at(code), { cookie: owner });
  assert.equal(lists.json.decklists.length, 1);
});

function memoryBucket() {
  const objects = new Map<string, string>();
  env.REPORTS = {
    put: async (key, value) => {
      objects.set(key, value);
    },
    delete: async key => {
      objects.delete(key);
    }
  };
  return objects;
}

test('a publish that lands late puts the newest view back, and cannot bring back a deleted event', async () => {
  const objects = memoryBucket();
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  const key = `tournaments/v1/${code}.json`;
  const db = env.TOURNAMENT_DB as NonNullable<TournamentEnv['TOURNAMENT_DB']>;
  const older = await loadTournament(db, code);
  await addPlayers(code, owner, 1);
  const newest = JSON.parse(objects.get(key) ?? '{}').version as number;
  assert.ok(older && newest > older.version);
  await publishView(env, older);
  assert.equal(JSON.parse(objects.get(key) ?? '{}').version, newest, 'the late copy is replaced by the newest');

  const latest = await loadTournament(db, code);
  await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: owner });
  assert.ok(latest);
  await publishView(env, latest);
  assert.ok(!objects.has(key), 'a publish after the delete takes its copy down again');
});

test('a publish R2 refuses takes the stale copy down, so the page asks the API', async () => {
  const objects = memoryBucket();
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  assert.ok(objects.has(`tournaments/v1/${code}.json`));
  const bucket = env.REPORTS as NonNullable<TournamentEnv['REPORTS']>;
  env.REPORTS = { ...bucket, put: () => Promise.reject(new Error('R2 down')) };
  const log = console.error;
  console.error = () => undefined;
  try {
    await addPlayers(code, owner, 1);
  } finally {
    console.error = log;
  }
  assert.ok(!objects.has(`tournaments/v1/${code}.json`));
});

test('a publish still behind after a burst of writes takes its copy down rather than leave it stale', async () => {
  const objects = memoryBucket();
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  const key = `tournaments/v1/${code}.json`;
  const db = env.TOURNAMENT_DB as NonNullable<TournamentEnv['TOURNAMENT_DB']>;
  const older = await loadTournament(db, code);
  assert.ok(older);
  // Every look after a put finds a newer version, as in a burst of writes.
  env.TOURNAMENT_DB = {
    ...db,
    prepare: sql =>
      sql.startsWith('SELECT version FROM tournaments')
        ? ({ ...db.prepare(sql), bind: () => ({ ...db.prepare(sql), first: async () => ({ version: 1e9 }) }) } as never)
        : db.prepare(sql)
  };
  await publishView(env, older);
  env.TOURNAMENT_DB = db;
  assert.ok(!objects.has(key));
});

test('a .tdf sent from a copy the site no longer holds is refused, not synced over newer rounds', async () => {
  const owner = await signIn('Organizer');
  const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  const created = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    { method: 'POST', cookie: owner, body: { mode: 'tom', tournament: tdf } }
  );
  const { code } = created.json;
  const base = await revisionNow(code, owner);
  const newer = { ...tdf, info: { ...tdf.info, name: 'Newer copy' } };
  const first = await hit(sync.onRequestPut as Handler, '/sync', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { tournament: newer, base }
  });
  assert.equal(first.status, 200);
  assert.equal(first.json.revision, await revisionNow(code, owner), 'the answer carries the revision now held');
  const older = await hit(sync.onRequestPut as Handler, '/sync', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { tournament: tdf, base }
  });
  assert.equal(older.status, 409, 'a second browser still on the first copy');
  const kept = await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner });
  assert.equal(kept.json.tournament.info.name, 'Newer copy');
  const next = await hit(sync.onRequestPut as Handler, '/sync', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { tournament: tdf, base: first.json.revision }
  });
  assert.equal(next.status, 200, 'the browser that synced last carries on');
  const again = await hit(sync.onRequestPut as Handler, '/sync', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { tournament: tdf, base }
  });
  assert.equal(again.status, 200, 'the copy the site already holds is no conflict, from any tab');
  assert.equal(again.json.version, next.json.version, 'and changes nothing');
  const bare = await hit(sync.onRequestPut as Handler, '/sync', at(code), { method: 'PUT', cookie: owner, body: tdf });
  assert.equal(bare.status, 400);
});

test('a sync that would leave a TOM event with nobody in it is refused', async () => {
  const owner = await signIn('Organizer');
  const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  const created = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    { method: 'POST', cookie: owner, body: { mode: 'tom', tournament: tdf } }
  );
  const { code } = created.json;
  const emptied = await hit(sync.onRequestPut as Handler, '/sync', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { tournament: { ...tdf, players: [], pods: [] }, base: await revisionNow(code, owner) }
  });
  assert.equal(emptied.status, 400);
  const kept = await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner });
  assert.equal(kept.json.tournament.players.length, tdf.players.length);
});

test('an idle console poll answers 204 to staff only, and a change or a due report sends the document', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  const poll = (since: number, cookie?: string) =>
    hit(manage.onRequestGet as Handler, `/manage?since=${since}`, at(code), { cookie });
  const { version } = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json;
  const seen = recordSql();
  const idle = await poll(version, owner);
  assert.deepEqual([idle.status, idle.json], [204, null]);
  assert.ok(!seen.some(sql => sql.startsWith('SELECT * FROM tournaments')), 'the document is not read');
  assert.equal((await poll(version)).status, 401, 'a stranger learns nothing from the short answer');
  assert.equal((await poll(version, await signIn('Stranger'))).status, 403);
  await addPlayers(code, owner, 1);
  const changed = await poll(version, owner);
  assert.equal(changed.status, 200);
  assert.equal(changed.json.tournament.players.length, 1);
});

test('a field sending lists from one venue address is not turned away', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open', sanctioned: false });
  for (let i = 0; i < 40; i += 1) {
    const sent = await submitAs(code, { firstName: 'Player', lastName: `Number ${i}` });
    assert.equal(sent.status, 200, `player ${i + 1} of 40`);
  }
});

test('the answer to a change does not wait for its publish where the runtime keeps the function alive', async () => {
  const objects = memoryBucket();
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  const key = `tournaments/v1/${code}.json`;
  const before = objects.get(key);
  const bucket = env.REPORTS as NonNullable<TournamentEnv['REPORTS']>;
  let release = () => undefined as void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  env.REPORTS = { ...bucket, put: (...args) => held.then(() => bucket.put(...args)) };
  const kept: Promise<unknown>[] = [];
  const response = await commands.onRequestPost({
    request: request(`/api/tournaments/${code}/commands`, {
      method: 'POST',
      cookie: owner,
      body: { command: { type: 'addPlayer', player: { firstName: 'Ash', lastName: 'Ketchum' } } }
    }),
    env,
    params: at(code),
    waitUntil: (promise: Promise<unknown>) => void kept.push(promise)
  });
  assert.equal(response.status, 200, 'answered while the publish is still held');
  assert.equal(objects.get(key), before);
  assert.equal(kept.length, 1, 'the publish is handed to the runtime to finish');
  release();
  await Promise.all(kept);
  assert.equal(JSON.parse(objects.get(key) ?? '{}').tournament.players.length, 1);
});

/** Counts the database round trips the functions make from here on. */
function countTrips(): () => number {
  const counting = countingTrips(env.TOURNAMENT_DB as NonNullable<TournamentEnv['TOURNAMENT_DB']>);
  env.TOURNAMENT_DB = counting.db;
  return counting.trips;
}

test('a staff action waits on the database twice, and an idle console poll once', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  const console = (cookie: string, since = '') =>
    hit(manage.onRequestGet as Handler, `/manage${since}`, at(code), { cookie });
  const helper = await signIn('Helper');
  await hit(staff.onRequestPost as Handler, '/staff', at(code), {
    method: 'POST',
    cookie: helper,
    body: { token: (await console(owner)).json.staffToken }
  });
  for (const cookie of [owner, helper]) {
    const { version } = (await console(cookie)).json;
    const trips = countTrips();
    const before = trips();
    assert.equal((await console(cookie, `?since=${version}`)).status, 204);
    assert.equal(trips() - before, 1, 'the poll is one read');
    const added = await send(code, cookie, { type: 'addPlayer', player: { firstName: 'Late', lastName: cookie } });
    assert.equal(added.status, 200);
    assert.equal(trips() - before, 3, 'the action is one read of the event and who asks, and one write');
  }
  const strangers = countTrips();
  assert.equal((await hit(event.onRequestGet as Handler, '/', at(code))).status, 200);
  assert.equal(strangers(), 1, 'a player with no session reads only the event');
});

test('the account page names the providers an account signs in with; an event request does not read them', async () => {
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  const seen = recordSql();
  const trips = countTrips();
  const account = await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: owner });
  assert.deepEqual(account.json.user.providers, ['dev']);
  assert.equal(trips(), 1, 'the user and their providers come in one round trip');
  const saved = await hit(
    me.onRequestPatch as Handler,
    '/api/me',
    {},
    {
      method: 'PATCH',
      cookie: owner,
      body: { name: 'Renamed' }
    }
  );
  assert.deepEqual([saved.json.user.name, saved.json.user.providers], ['Renamed', ['dev']]);
  seen.length = 0;
  assert.equal((await view(code, owner)).viewer.role, 'owner');
  assert.ok(!seen.some(sql => sql.includes('identities')), 'providers are not read to open an event');
});

test('nothing the functions ask of the database scans a table', async () => {
  const { raw } = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  const seen = recordSql();
  const owner = await signIn('Organizer');
  const code = await newSwiss(owner);
  await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: owner });
  await hit(tournaments.onRequestGet as Handler, '/api/tournaments', {}, { cookie: owner });
  const { staffToken, version } = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner }))
    .json;
  const helper = await signIn('Helper');
  await hit(staff.onRequestPost as Handler, '/staff', at(code), {
    method: 'POST',
    cookie: helper,
    body: { token: staffToken }
  });
  await hit(staff.onRequestGet as Handler, '/staff', at(code), { cookie: owner });
  await hit(manage.onRequestGet as Handler, `/manage?since=${version}`, at(code), { cookie: helper });
  await settle(code, owner, { decklists: 'open', playerReporting: true });
  await addPlayers(code, owner, 2);
  const sent = await submitAs(code, { popId: '900', firstName: 'Player', lastName: '0', birthDate: '02/27/1990' });
  await hit(decklists.onRequestGet as Handler, '/decklists', at(code), { cookie: owner });
  await hit(decklists.onRequestGet as Handler, `/decklists?popId=900&token=${sent.json.token}`, at(code));
  await hit(decklists.onRequestPatch as Handler, '/decklists?popId=900', at(code), { method: 'PATCH', cookie: owner });
  await hit(decklists.onRequestDelete as Handler, '/decklists?popId=900', at(code), { method: 'DELETE' });
  await send(code, owner, { type: 'pairRound', pod: 'mixed' });
  await playerSays(code, { popId: '900', result: 'win' });
  await hit(report.onRequestDelete as Handler, '/report?player=900', at(code), { method: 'DELETE', cookie: owner });
  await hit(staff.onRequestPost as Handler, '/staff', at(code), {
    method: 'POST',
    cookie: owner,
    body: { rotate: true }
  });
  await hit(logout.onRequestPost as Handler, '/api/auth/logout', {}, { method: 'POST', cookie: helper });
  await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: owner });
  const statements = [...new Set(seen)];
  assert.ok(statements.length > 25, 'the flow reached the functions');
  for (const sql of statements) {
    const plan = raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[];
    const scans = plan.map(step => step.detail).filter(detail => detail.startsWith('SCAN'));
    assert.deepEqual(scans, [], sql);
  }
});

test('an event made on a code already taken gets another, and the first is untouched', async () => {
  const owner = await signIn('Organizer');
  // Every draw the same: the second event's first code is the first event's.
  const random = mock.method(Math, 'random', () => 0);
  const first = await newSwiss(owner);
  let draws = 0;
  random.mock.mockImplementation(() => {
    draws += 1;
    return draws <= first.length ? 0 : 0.5;
  });
  const second = await newSwiss(owner);
  random.mock.restore();
  assert.notEqual(second, first);
  await addPlayers(second, owner, 1);
  assert.equal((await view(first)).tournament.players.length, 0);
  assert.equal((await view(second)).tournament.players.length, 1);
});

test('the index migration brings an older database in line with the schema', () => {
  const indexes = (db: ReturnType<typeof sqliteD1>['raw']) =>
    db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name").all();
  const fresh = sqliteD1('tournaments.sql').raw;
  const older = sqliteD1('tournaments.sql').raw;
  older.exec('DROP INDEX identities_by_user; DROP INDEX tournaments_of_owner');
  older.exec('CREATE INDEX tournaments_by_owner ON tournaments (owner_id, updated_at)');
  const migration = readFileSync(
    new URL('../../config/d1/migrations/tournaments-0004-indexes.sql', import.meta.url),
    'utf8'
  );
  older.exec(migration);
  older.exec(migration);
  assert.deepEqual(indexes(older), indexes(fresh));
});
