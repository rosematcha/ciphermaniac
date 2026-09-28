/**
 * The tournament and account functions end to end, against the real schema in
 * SQLite. What must hold: sign-in makes a session and only a local server
 * allows the dev provider; only an event's staff change it; the public copy
 * never carries Player IDs or birth dates; a TOM event takes results as
 * pending until its synced file settles them; decklists come in only while
 * submission is open.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';

import * as callback from '../../functions/api/auth/callback/[provider].ts';
import * as login from '../../functions/api/auth/login/[provider].ts';
import * as logout from '../../functions/api/auth/logout.ts';
import * as me from '../../functions/api/me.ts';
import * as commands from '../../functions/api/tournaments/[code]/commands.ts';
import * as decklists from '../../functions/api/tournaments/[code]/decklists.ts';
import * as decks from '../../functions/api/tournaments/[code]/decks.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as settings from '../../functions/api/tournaments/[code]/settings.ts';
import * as staff from '../../functions/api/tournaments/[code]/staff.ts';
import * as sync from '../../functions/api/tournaments/[code]/sync.ts';
import * as tournaments from '../../functions/api/tournaments/index.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import type { TournamentView } from '../../shared/tournament/view.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

const ORIGIN = 'https://cm.test';
let env: TournamentEnv;

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
  decklists._resetRateLimitStore();
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

test('the dev provider is refused in production', async () => {
  env.ENVIRONMENT = 'production';
  const refused = await hit(login.onRequestGet as Handler, '/api/auth/login/dev?name=x', { provider: 'dev' });
  assert.equal(refused.status, 404);
});

test('an unconfigured provider says so rather than redirecting', async () => {
  const google = await hit(login.onRequestGet as Handler, '/api/auth/login/google', { provider: 'google' });
  assert.equal(google.status, 503);
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
  const text = JSON.stringify(publicView);
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
    body: settled
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
  const closed = await hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    cookie: player,
    body: submission
  });
  assert.equal(closed.status, 403);
  await hit(settings.onRequestPut as Handler, '/settings', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { decklistsOpen: true }
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
  assert.equal(sent.json.decklist.registered, false);

  const mine = await hit(decklists.onRequestGet as Handler, '/decklists', at(code), { cookie: player });
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
  delete env.ENVIRONMENT;
});
