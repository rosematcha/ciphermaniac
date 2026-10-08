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

import * as adminAccounts from '../../functions/api/admin/accounts.ts';
import * as adminApplications from '../../functions/api/admin/applications/index.ts';
import * as adminDecide from '../../functions/api/admin/applications/[id].ts';
import * as adminProof from '../../functions/api/admin/applications/[id]/proof.ts';
import * as adminOrganizers from '../../functions/api/admin/organizers/index.ts';
import * as adminOrganizer from '../../functions/api/admin/organizers/[id].ts';
import * as adminPopIds from '../../functions/api/admin/pop-ids.ts';
import * as applications from '../../functions/api/applications/index.ts';
import * as myApplication from '../../functions/api/applications/mine.ts';
import * as proof from '../../functions/api/applications/proof.ts';
import * as ageCheck from '../../functions/api/auth/age.ts';
import * as callback from '../../functions/api/auth/callback/[provider].ts';
import * as login from '../../functions/api/auth/login/[provider].ts';
import * as logout from '../../functions/api/auth/logout.ts';
import * as history from '../../functions/api/history.ts';
import * as community from '../../functions/api/community.ts';
import * as storeRoute from '../../functions/api/stores/[id]/index.ts';
import * as storeNights from '../../functions/api/stores/[id]/nights.ts';
import * as storeMembers from '../../functions/api/stores/[id]/members.ts';
import * as storeListings from '../../functions/api/stores/[id]/listings.ts';
import * as storeJoin from '../../functions/api/stores/join.ts';
import * as leagues from '../../functions/api/leagues/[id].ts';
import * as adminStores from '../../functions/api/admin/stores/index.ts';
import * as adminStore from '../../functions/api/admin/stores/[id].ts';
import * as organizerOfRecord from '../../functions/api/tournaments/[code]/organizer.ts';
import * as me from '../../functions/api/me.ts';
import * as profiles from '../../functions/api/profiles/[handle].ts';
import * as claim from '../../functions/api/tournaments/[code]/claim.ts';
import * as commands from '../../functions/api/tournaments/[code]/commands.ts';
import { FREE_TRIES } from '../../functions/lib/tournaments/attempts.ts';
import * as decklists from '../../functions/api/tournaments/[code]/decklists.ts';
import * as decks from '../../functions/api/tournaments/[code]/decks.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as idle from '../../functions/api/tournaments/idle.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as pairing from '../../functions/api/tournaments/[code]/pairing.ts';
import * as report from '../../functions/api/tournaments/[code]/report.ts';
import * as settings from '../../functions/api/tournaments/[code]/settings.ts';
import * as staff from '../../functions/api/tournaments/[code]/staff.ts';
import * as sync from '../../functions/api/tournaments/[code]/sync.ts';
import * as tournaments from '../../functions/api/tournaments/index.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { REPORT_WINDOW_MS } from '../../shared/tournament/reports.ts';
import { revisionOf } from '../../shared/tournament/revision.ts';
import { parseTdf, writeTdf } from '../../shared/tournament/tdf.ts';
import { DIVISIONS, type Match, type Round, type Tournament } from '../../shared/tournament/types.ts';
import type { TournamentView } from '../../shared/tournament/view.ts';
import { publishView } from '../../functions/lib/tournaments/publish.ts';
import { loadIdle, loadTournament, rotateStaff } from '../../functions/lib/tournaments/store.ts';
import { juniorsCutApart } from '../__utils__/divisionCuts.ts';
import { apiCalls, type Handler, ORIGIN, request } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { memoryProofs } from '../__utils__/proofBucket.ts';
import { storeApplication } from '../__utils__/storeApplication.ts';
import { countingTrips, racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { newEvent, newSwiss, send, addPlayers, settle, playerSays, view, storeOf } = eventCalls(hit);

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
  decklists._resetRateLimitStore();
  report._resetRateLimitStore();
  event._resetRateLimitStore();
});

/** The revision of the event's document as the console loads it, as the browser following the .tdf sends it. */
async function revisionNow(code: string, cookie: string): Promise<string> {
  return revisionOf((await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie })).json.tournament);
}

test('dev sign-in starts a session that /api/me reads, and sign-out ends it', async () => {
  const cookie = await signIn('Organizer');
  const signedIn = await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie });
  assert.equal(signedIn.json.user.name, 'organizer');
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

test('a username is chosen independently of the player profile, whose name the site calls the account by', async () => {
  const cookie = await signIn('Organizer');
  const patch = (body: unknown, extra = {}) =>
    hit(me.onRequestPatch as Handler, '/api/me', {}, { method: 'PATCH', cookie, body, ...extra });
  const renamed = await patch({ handle: 'reese' });
  assert.deepEqual([renamed.json.user.handle, renamed.json.user.name], ['reese', 'reese']);
  assert.equal((await patch({ handle: '' })).status, 400);
  assert.equal((await patch({})).status, 400);
  const anonymous = await hit(me.onRequestPatch as Handler, '/api/me', {}, { method: 'PATCH', body: { handle: 'x1' } });
  assert.equal(anonymous.status, 401);
  assert.equal((await patch({ handle: 'x1' }, { origin: 'https://evil.test' })).status, 403);
  const profile = { popId: '1234567', firstName: 'Reese', lastName: 'Lundquist', birthDate: '02/27/2001' };
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie, body: profile });
  const reread = await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie });
  assert.deepEqual([reread.json.user.handle, reread.json.user.name], ['reese', 'Reese Lundquist']);
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

test('Google sign-in: state round-trips, the code is exchanged, the age check makes the account, a session begins', async () => {
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
    assert.equal(done.headers.get('location'), '/welcome', 'a new sign-up waits for its age check');
    assert.ok(!done.headers.getSetCookie().some(value => value.startsWith('cm_session=')), 'with no session yet');
    const waiting = done.headers.getSetCookie().find(value => value.startsWith('cm_signup=')) ?? '';
    const checked = await hit(
      ageCheck.onRequestPost as Handler,
      '/api/auth/age',
      {},
      {
        method: 'POST',
        cookie: waiting.split(';')[0],
        body: { birthDate: '1990-06-15' }
      }
    );
    assert.equal(checked.status, 200);
    assert.deepEqual(checked.json, { next: '/host' }, 'then goes where sign-in started');
    const session = checked.headers.getSetCookie().find(value => value.startsWith('cm_session=')) ?? '';
    const who = await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: session.split(';')[0] });
    assert.equal(who.json.user.email, 'gia@example.com');
    assert.match(who.json.user.name, /^player-[a-z0-9]{8}$/, 'a new account is called by its random username');
    assert.deepEqual(who.json.user.providers, ['google']);
    assert.equal(who.json.user.birthDate, '02/27/1990', 'the year alone is kept');
    const again = await callback.onRequestGet({
      request: request(`/api/auth/callback/google?code=c&state=${state}`, { cookie: oauthCookie }),
      env,
      params: { provider: 'google' }
    } as never);
    assert.equal(again.headers.get('location'), '/host', 'an account that passed signs straight in');
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
    assert.equal(who.json.user.name, 'organizer');
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
  const cookie = await signIn('Organizer', 'organizer');
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

test('the event list counts an event as paired once any of its pods has paired, not only its first', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  for (let i = 0; i < 6; i += 1) {
    await send(code, owner, {
      type: 'addPlayer',
      player: { firstName: 'Junior', lastName: `${i}`, id: `${800 + i}`, birthDate: '02/27/2016' }
    });
  }
  await addPlayers(code, owner, 6);
  await send(code, owner, { type: 'pairRound', pod: 'senior-masters' });
  const db = env.TOURNAMENT_DB as NonNullable<TournamentEnv['TOURNAMENT_DB']>;
  const pods = (await loadTournament(db, code))?.tournament.pods.map(pod => [pod.category, pod.rounds.length]);
  assert.deepEqual(pods, [
    ['junior', 0],
    ['senior-masters', 1]
  ]);
  const list = await hit(tournaments.onRequestGet as Handler, '/api/tournaments', {}, { cookie: owner });
  assert.equal(list.json.tournaments[0].rounds, 1);
});

test('who starts an event of their own: a Community organizer or an Admin; a revoked one still runs its own', async () => {
  const create = (cookie: string) =>
    hit(
      tournaments.onRequestPost as Handler,
      '/api/tournaments',
      {},
      {
        method: 'POST',
        cookie,
        body: { mode: 'swiss', name: 'Test Cup' }
      }
    );
  const player = await create(await signIn('Player'));
  assert.deepEqual(
    [player.status, player.json.error, player.json.apply],
    [403, 'Only organizers can start events', true],
    'a player is offered a way in'
  );
  assert.equal((await create(await signIn('Admin', 'admin'))).status, 201);
  assert.equal(
    (await create(await signIn('Store Owner', 'organizer'))).status,
    403,
    'a store’s Manager starts the store’s events, not their own'
  );
  const community = await signIn('Casual', 'community');
  const code = await newEvent(community, { settings: { startsAt: '2026-11-01T18:00' } });
  // The same account, its role taken away.
  const revoked = await signIn('Casual', 'revoked');
  assert.equal((await create(revoked)).status, 403);
  await addPlayers(code, revoked, 2);
  assert.equal((await settle(code, revoked, { decklists: 'open' })).status, 200);
  assert.equal(
    (await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: revoked })).status,
    204
  );
});

test('only staff change an event, and bad commands are refused', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  const stranger = await signIn('Stranger');
  assert.equal((await send(code, stranger, { type: 'pairRound', pod: 'masters' })).status, 403);
  assert.equal((await send(code, owner, { type: 'launchMissiles' })).status, 400);
  assert.equal(
    (await send(code, owner, { type: 'pairRound', pod: 'masters' })).json.error,
    'Add at least two players first'
  );
  assert.equal((await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: stranger })).status, 403);
});

test('a Swiss event pairs, reports, seats a late arrival and hides private fields publicly', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 5);
  const paired = await send(code, owner, { type: 'pairRound', pod: 'masters' });
  const table = paired.json.tournament.pods[0].rounds[0].matches.find((m: Match) => m.p2 !== null);
  await send(code, owner, {
    type: 'reportResult',
    pod: 'masters',
    round: 1,
    table: table.table,
    p1: table.p1,
    p2: table.p2,
    outcome: 'p1'
  });
  await send(code, owner, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'Arrival', id: '999' } });
  const repaired = await send(code, owner, { type: 'repairRound', pod: 'masters', keepReported: true });
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
  assert.deepEqual(publicView.viewer, { role: null, me: null, via: null, signedIn: false });

  const unchanged = await event.onRequestGet({
    request: request(`/api/tournaments/${code}?since=${publicView.version}`),
    env,
    params: at(code)
  } as never);
  assert.equal(unchanged.status, 204);
});

test('staff join by invite link, and a new link retires the old one', async () => {
  const owner = await signIn('Organizer', 'organizer');
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
  const owner = await signIn('Organizer', 'organizer');
  const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  const created = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    {
      method: 'POST',
      cookie: owner,
      body: { mode: 'tom', tournament: tdf, store: await storeOf(owner) }
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

test('a TOM event runs the site’s clock, which a synced file’s timer does not touch', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  const created = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    { method: 'POST', cookie: owner, body: { mode: 'tom', tournament: tdf, store: await storeOf(owner) } }
  );
  const { code } = created.json;
  const base = await revisionNow(code, owner);
  const fresh = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json.tournament;
  assert.equal(fresh.pods[0].rounds[0].timeLeft, 30 * 60, 'TOM’s timer is set aside from the start');

  const started = await send(code, owner, { type: 'startClock', pod: 'mixed' });
  assert.equal(started.status, 200);
  assert.notEqual(started.json.tournament.pods[0].rounds[1].clockStartedAt, null);
  assert.equal((await send(code, owner, { type: 'adjustClock', pod: 'mixed', seconds: -60 })).status, 200);

  // TOM saved with its own timer at 42 seconds; the file was followed on from the copy before the clock started.
  const saved = {
    ...tdf,
    pods: tdf.pods.map(pod => ({ ...pod, rounds: pod.rounds.map(round => ({ ...round, timeLeft: 42 })) }))
  };
  const settled = {
    ...saved,
    pods: saved.pods.map(pod => ({
      ...pod,
      rounds: pod.rounds.map(round =>
        round.number === 2
          ? { ...round, matches: round.matches.map((m, i) => (i === 0 ? { ...m, outcome: 'p1' as const } : m)) }
          : round
      )
    }))
  };
  const synced = await hit(sync.onRequestPut as Handler, '/sync', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { tournament: settled, base }
  });
  assert.equal(synced.status, 200, 'starting the clock is not a different copy of the event');
  const round = synced.json.tournament.pods[0].rounds[1];
  assert.equal(round.matches[0].outcome, 'p1', 'the file’s results land');
  assert.equal(round.timeLeft, 30 * 60 - 60, 'the site’s clock stands');
  assert.equal(round.clockStartedAt, started.json.tournament.pods[0].rounds[1].clockStartedAt);
});

async function newTom(cookie: string, tournament: Tournament): Promise<string> {
  const created = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    { method: 'POST', cookie, body: { mode: 'tom', tournament, store: await storeOf(cookie) } }
  );
  return created.json.code as string;
}

function pairNext(code: string, cookie: string, base: string) {
  return hit(pairing.onRequestPost as Handler, '/pairing', at(code), {
    method: 'POST',
    cookie,
    body: { pod: 'mixed', base, localTime: '10/10/2026 13:00:00' }
  });
}

test('a TOM event’s next round is paired over the site’s results and lands only with the file', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  const code = await newTom(owner, tdf);
  const base = await revisionNow(code, owner);
  assert.match((await pairNext(code, owner, base)).json.error, /Report every match/);
  const open = tdf.pods[0]!.rounds[1]!.matches.filter(m => m.p2 !== null && m.outcome === 'pending');
  for (const { table, p1, p2 } of open) {
    await send(code, owner, { type: 'reportResult', pod: 'mixed', round: 2, table, p1, p2, outcome: 'p1' });
  }
  assert.equal((await pairNext(code, owner, 'another copy')).status, 409, 'only over the file the browser sent');
  const paired = await pairNext(code, owner, base);
  assert.equal(paired.status, 200);
  const [, second, third] = paired.json.tournament.pods[0].rounds as Round[];
  assert.ok(
    second?.matches.every(m => m.outcome !== 'pending'),
    'the site’s results are in the round'
  );
  assert.equal(third?.number, 3);
  assert.equal(third?.pairTime, '10/10/2026 13:00:00', 'stamped with the venue clock');
  const held = await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner });
  assert.equal(held.json.tournament.pods[0].rounds.length, 2, 'nothing is stored until the file has it');
  assert.equal(held.json.pending.length, open.length, 'so the results still wait on TOM');
  const synced = await hit(sync.onRequestPut as Handler, '/sync', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { tournament: parseTdf(writeTdf(paired.json.tournament)), base }
  });
  assert.equal(synced.status, 200, 'the file the round was written into syncs as any save of TOM’s');
  assert.equal(synced.json.tournament.pods[0].rounds.length, 3);
  assert.deepEqual(synced.json.pending, []);
});

test('a TOM event’s first round and a Swiss event are not paired through the file', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  const fresh = await newTom(owner, { ...tdf, pods: tdf.pods.map(pod => ({ ...pod, rounds: [] })) });
  assert.match((await pairNext(fresh, owner, await revisionNow(fresh, owner))).json.error, /Pair round 1 in TOM/);
  const swiss = await newSwiss(owner);
  assert.equal((await pairNext(swiss, owner, await revisionNow(swiss, owner))).status, 400);
  const tom = await newTom(owner, tdf);
  const junk = await hit(pairing.onRequestPost as Handler, '/pairing', at(tom), {
    method: 'POST',
    cookie: owner,
    body: { pod: 'nonsense', base: await revisionNow(tom, owner) }
  });
  assert.equal(junk.status, 400);
});

test('a Swiss event cannot be synced from a file', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  const refused = await hit(sync.onRequestPut as Handler, '/sync', at(code), {
    method: 'PUT',
    cookie: owner,
    body: {}
  });
  assert.equal(refused.status, 400);
});

test('decklists come in only while open, and decks show as the visibility setting allows', async () => {
  const owner = await signIn('Organizer', 'organizer');
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
  // The account page saves a Player ID; the list did not.
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: player, body: submission.profile });
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
  const owner = await signIn('Organizer', 'organizer');
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
      body: { mode: 'tom', tournament: huge, store: await storeOf(owner) }
    }
  );
  assert.deepEqual([refused.status, refused.json.error], [413, 'This event is too large to store']);
});

test('every change publishes the public view to R2, and deleting the event removes it', async () => {
  const objects = memoryBucket();
  const owner = await signIn('Organizer', 'organizer');
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
  const published = bodyOf(objects.get(key));
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
  assert.deepEqual(Object.values(bodyOf(objects.get(key)).decks), ['Gardevoir']);
  await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: owner });
  assert.ok(!objects.has(key), 'deleting the event unpublishes it');
});

test('a failed publish does not fail the change', async () => {
  env.REPORTS = {
    head: async () => null,
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
    const owner = await signIn('Organizer', 'organizer');
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
  const owner = await signIn('Organizer', 'organizer');
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

/** A player's phone: it says who they are once, keeps the token it is given, and reports with it. */
async function phoneOf(code: string, popId: string, device = `phone-${popId}`) {
  const said = await playerSays(code, { popId, device });
  const token = said.json.reportToken as string | undefined;
  return { said, report: (result: string) => playerSays(code, { popId, result, device, reportToken: token }) };
}

test('a device recovers a reporting seat after its identify response is lost', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  const paired = await send(code, owner, { type: 'pairRound', pod: 'masters' });
  const match = paired.json.tournament.pods[0].rounds[0].matches[0];
  await settle(code, owner, { playerReporting: true });
  const device = crypto.randomUUID();
  const lost = await playerSays(code, { popId: match.p1, device });
  assert.equal(lost.json.reporter, true);
  // The phone never received the token. Neither knowing the player nor a
  // different device's ID recovers the reserved seat.
  for (const stranger of [{}, { device: crypto.randomUUID() }]) {
    const refused = await playerSays(code, { popId: match.p1, ...stranger });
    assert.equal(refused.json.reporter, false);
    assert.equal(refused.json.reportToken, undefined);
  }
  const recovered = await playerSays(code, { popId: match.p1, device });
  assert.equal(recovered.json.reporter, true);
  assert.ok(recovered.json.reportToken);
  assert.equal((await playerSays(code, { popId: match.p1, device })).json.reportToken, recovered.json.reportToken);
  const reported = await playerSays(code, {
    popId: match.p1,
    device,
    reportToken: recovered.json.reportToken,
    result: 'win'
  });
  assert.equal(reported.status, 200);
  assert.equal(reported.json.view.reports.length, 1);
  const original = await playerSays(code, { popId: match.p1, device, reportToken: lost.json.reportToken });
  assert.equal(original.json.reporter, true, 'recovery does not invalidate a delayed original response');
  await hit(report.onRequestDelete as Handler, `/?player=${match.p1}`, at(code), { method: 'DELETE', cookie: owner });
  await playerSays(code, { popId: match.p1, device: crypto.randomUUID() });
  const released = await playerSays(code, { popId: match.p1, device, reportToken: recovered.json.reportToken });
  assert.equal(released.json.reporter, false, 'the old device cannot recover a seat staff gave to another phone');
});

test('an event starts with the settings its setup chose', async () => {
  const owner = await signIn('Organizer', 'organizer');
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
        store: await storeOf(owner),
        roundTime: 25,
        settings: {
          sanctioned: false,
          playerReporting: true,
          format: 'Expanded',
          finished: true,
          idle: true,
          roundCap: 3
        }
      }
    }
  );
  assert.equal(created.status, 201);
  const code = created.json.code as string;
  const made = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json;
  assert.equal(made.tournament.info.roundTime, 25);
  assert.equal(made.settings.sanctioned, false);
  assert.equal(made.settings.playerReporting, true);
  assert.equal(made.settings.format, 'Expanded');
  assert.equal(made.settings.finished, false, 'an event does not start closed');
  assert.equal(made.settings.idle, false, 'an event does not start idle');
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
  const owner = await signIn('Organizer', 'organizer');
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

test('a decklist never gives an account a Player ID or birth year, and refreshes the name of the account that holds it', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open' });
  const player = await signIn('Player');
  const lin = { popId: '6161', firstName: 'Lin', lastName: 'Park', birthDate: '02/27/2001' };
  const sendList = (profile: typeof lin, token?: string) =>
    hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
      method: 'PUT',
      cookie: player,
      body: { deck: '60 Basic {P} Energy SVE 5', profile, token }
    });
  const accountNow = async () => (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: player })).json.user;
  const first = await sendList(lin);
  assert.equal(first.status, 200);
  assert.deepEqual([(await accountNow()).popId, (await accountNow()).firstName], [null, null]);
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: player, body: lin });
  // Sent for a friend from this phone: the account stays who it is.
  assert.equal((await sendList({ ...lin, popId: '7171', firstName: 'Kai' })).status, 200);
  assert.deepEqual([(await accountNow()).popId, (await accountNow()).firstName], ['6161', 'Lin']);
  assert.equal((await sendList({ ...lin, firstName: 'Linda', birthDate: '03/01/2001' }, first.json.token)).status, 200);
  const refreshed = await accountNow();
  assert.deepEqual([refreshed.popId, refreshed.firstName, refreshed.birthDate], ['6161', 'Linda', '02/27/2001']);
});

test('players report their own results: agreement stands once locked, disagreement waits for staff', async () => {
  const owner = await signIn('Organizer', 'organizer');
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  const paired = await send(code, owner, { type: 'pairRound', pod: 'masters' });
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
  const named = one.json.view.reports.flatMap((r: { p1: string; p2: string; by: string }) => [r.p1, r.p2, r.by]);
  assert.ok(!named.includes(first.p1), 'reports go out under public keys');
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
    pod: 'masters',
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
    pod: 'masters',
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

test('a result the console poll settles is stamped with the venue clock the poll sent', async () => {
  const owner = await signIn('Organizer', 'organizer');
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  const paired = await send(code, owner, { type: 'pairRound', pod: 'masters' });
  const [match] = paired.json.tournament.pods[0].rounds[0].matches;
  await settle(code, owner, { playerReporting: true });
  const { version } = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json;
  await (await phoneOf(code, match.p1)).report('win');
  await (await phoneOf(code, match.p2)).report('loss');
  mock.timers.tick(REPORT_WINDOW_MS);
  const polled = await hit(
    manage.onRequestGet as Handler,
    `/manage?since=${version}&localTime=${encodeURIComponent('10/10/2026 18:30:00')}`,
    at(code),
    { cookie: owner }
  );
  const settledMatch = polled.json.tournament.pods[0].rounds[0].matches[0];
  assert.deepEqual([settledMatch.outcome, settledMatch.timestamp], ['p1', '10/10/2026 18:30:00']);
});

test('players cannot report once the event has ended', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  const paired = await send(code, owner, { type: 'pairRound', pod: 'masters' });
  const [match] = paired.json.tournament.pods[0].rounds[0].matches;
  await settle(code, owner, { playerReporting: true });
  const phone = await phoneOf(code, match.p1);
  await settle(code, owner, { finished: true });
  const refused = await phone.report('win');
  assert.deepEqual([refused.status, refused.json.error], [403, 'This event is over']);
  assert.equal((await playerSays(code, { popId: match.p1 })).status, 200, 'a player can still find their table');
});

test('a sanctioned event cannot start with rounds under 30 minutes', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const store = await storeOf(owner);
  const create = (settings: Record<string, unknown>) =>
    hit(
      tournaments.onRequestPost as Handler,
      '/api/tournaments',
      {},
      { method: 'POST', cookie: owner, body: { mode: 'swiss', name: 'Quick Cup', roundTime: 20, settings, store } }
    );
  const refused = await create({ sanctioned: true });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /at least 30 minutes/);
  assert.equal((await create({ sanctioned: false })).status, 201);
});

test('a sanctioned event cannot cap its Swiss rounds under three, and says why', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  const put = (body: Record<string, unknown>) =>
    hit(settings.onRequestPut as Handler, '/settings', at(code), { method: 'PUT', cookie: owner, body });
  const refused = await put({ roundCap: 2 });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /at least 3 Swiss rounds/);
  assert.equal((await put({ roundCap: 3 })).status, 200);
});

test('a report for the match a stale page showed does not land on the next round', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  await settle(code, owner, { playerReporting: true });
  const [first, second] = (await send(code, owner, { type: 'pairRound', pod: 'masters' })).json.tournament.pods[0]
    .rounds[0].matches;
  const phone = await phoneOf(code, first.p1);
  const token = phone.said.json.reportToken as string;
  const shownFirst = { pod: 'masters', round: 1, table: first.table };
  const says = (match: unknown) =>
    playerSays(code, { popId: first.p1, result: 'win', match, device: `phone-${first.p1}`, reportToken: token });
  assert.equal((await says(shownFirst)).status, 200, 'the match the page showed takes the report');
  await send(code, owner, { type: 'reportResult', ...shownFirst, p1: first.p1, p2: first.p2, outcome: 'p1' });
  const shownSecond = { pod: 'masters', round: 1, table: second.table, p1: second.p1, p2: second.p2 };
  await send(code, owner, { type: 'reportResult', ...shownSecond, outcome: 'p1' });
  await send(code, owner, { type: 'pairRound', pod: 'masters' });
  const stale = await says(shownFirst);
  assert.equal(stale.status, 400);
  assert.match(stale.json.error, /pairing has changed/);
  assert.deepEqual((await view(code)).reports, [], 'nothing was filed against round 2');
});

test('an unsanctioned event finds players by last name, asking for a first name when two share it', async () => {
  const owner = await signIn('Organizer', 'organizer');
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
  const owner = await signIn('Organizer', 'organizer');
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  const created = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    {
      method: 'POST',
      cookie: owner,
      body: { mode: 'tom', tournament: tdf, settings: { sanctioned: false }, store: await storeOf(owner) }
    }
  );
  const { code } = created.json;
  await settle(code, owner, { playerReporting: true });
  await playerSays(code, { popId: '7200001', birthYear: '1995', result: 'tie' });
  const both = await playerSays(code, { popId: '7200004', birthYear: '1988', result: 'tie' });
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
  const owner = await signIn('Organizer', 'organizer');
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
  const owner = await signIn('Organizer', 'organizer');
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
  const owner = await signIn('Organizer', 'organizer');
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
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open', sanctioned: false });
  await submitAs(code, { firstName: 'Mary Ann', lastName: 'Smith' });
  await submitAs(code, { firstName: 'Mary', lastName: 'Ann Smith' });
  const staffLists = await hit(decklists.onRequestGet as Handler, '/decklists', at(code), { cookie: owner });
  assert.equal(staffLists.json.decklists.length, 2);
});

test('staff unlock a list for a player on a new device, who then takes it over', async () => {
  const owner = await signIn('Organizer', 'organizer');
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

test('a list for a player on the event’s list takes their birth year, and an unlocked one only its own', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 1);
  await settle(code, owner, { decklists: 'open' });
  const listed = { popId: '900', firstName: 'Player', lastName: '0', birthDate: '02/27/1991' };
  const spoofed = await submitAs(code, listed);
  assert.deepEqual(
    [spoofed.status, spoofed.json.error],
    [403, 'That birth year doesn’t match this event’s record for that Player ID. Ask staff if yours is right.']
  );
  const own = await submitAs(code, { ...listed, birthDate: '06/01/1990' });
  assert.deepEqual([own.status, own.json.registration], [200, 'matched'], 'the year is what counts, not the day');

  const unlisted = { popId: '8080', firstName: 'Ira', lastName: 'Vance', birthDate: '02/27/2003' };
  await settle(code, owner, { finished: true });
  assert.equal((await submitAs(code, unlisted)).json.registration, 'not-added', 'so only the list knows the year');
  await hit(decklists.onRequestPatch as Handler, '/decklists?popId=8080', at(code), { method: 'PATCH', cookie: owner });
  const takeover = await submitAs(code, { ...unlisted, birthDate: '02/27/2004' });
  assert.equal(takeover.status, 409, 'an unlocked list is not taken over under another birth year');
  assert.equal((await submitAs(code, { ...unlisted, firstName: 'Ira J.' })).status, 200, 'its own year takes it over');
});

test('at a sanctioned event a player says who they are with the birth year the event has for them', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 2);
  await send(code, owner, { type: 'pairRound', pod: 'masters' });
  await settle(code, owner, { playerReporting: true });
  const wrongYear = await playerSays(code, { popId: '900', birthYear: '1991', device: 'thief' });
  const wrongId = await playerSays(code, { popId: '999', device: 'thief' });
  assert.deepEqual([wrongYear.status, wrongYear.json.error], [404, wrongId.json.error], 'one answer for either miss');
  assert.equal((await playerSays(code, { popId: '900', birthYear: '', device: 'thief' })).status, 404);
  const spoofed = await playerSays(code, { popId: '900', birthYear: '1991', result: 'win', device: 'thief' });
  assert.equal(spoofed.status, 404, 'nor reports for them');

  const own = await playerSays(code, { popId: '900', device: 'phone-900' });
  assert.deepEqual([own.status, own.json.reporter], [200, true], 'the thief’s tries claimed no seat');
  await send(code, owner, { type: 'editPlayer', id: '901', firstName: 'Player', lastName: '1', birthDate: '' });
  for (const birthYear of ['', '1990', '2001']) {
    assert.equal((await playerSays(code, { popId: '901', birthYear })).status, 404, 'no year on record fits none');
  }
  await settle(code, owner, { decklists: 'open' });
  const unrecorded = { popId: '901', firstName: 'Player', lastName: '1', birthDate: '02/27/1990' };
  assert.equal((await submitAs(code, unrecorded)).status, 403, 'nor sends their list');
  await send(code, owner, {
    type: 'editPlayer',
    id: '901',
    firstName: 'Player',
    lastName: '1',
    birthDate: '02/27/1990'
  });
  assert.equal((await playerSays(code, { popId: '901', device: 'phone-901' })).status, 200, 'once staff add it');
});

/** Seventy-one birth years, every year from 1950 to 2020 but `right`, then `right` last. */
const burstOf = (right: string) => [
  // Years only adults were born in: a minor's year is refused before it counts as a try (at an
  // event that is over, or under 13 at any).
  ...Array.from({ length: 71 }, (_, i) => String(1930 + i)).filter(year => year !== right),
  right
];

test('guesses landing all at once are admitted five at most, so a burst cannot outrun the lockout', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 1);
  await settle(code, owner, { playerReporting: true });
  const answers = await Promise.all(
    burstOf('1990').map(birthYear => playerSays(code, { popId: '900', birthYear, device: crypto.randomUUID() }))
  );
  const admitted = answers.filter(answer => answer.status !== 429);
  assert.ok(admitted.length <= FREE_TRIES, `${admitted.length} guesses were answered`);
  assert.ok(
    answers.every(answer => answer.status !== 200 && answer.json.reportToken === undefined),
    'the right year, last in the burst, is refused with the rest'
  );
});

test('a burst of lists cannot outrun the lockout to take over an unlocked list by its year', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open', finished: true });
  const unlisted = { popId: '8080', firstName: 'Ira', lastName: 'Vance', birthDate: '02/27/2003' };
  assert.equal((await submitAs(code, unlisted)).json.registration, 'not-added');
  await hit(decklists.onRequestPatch as Handler, '/decklists?popId=8080', at(code), { method: 'PATCH', cookie: owner });
  const answers = await Promise.all(
    burstOf('2003').map(year => submitAs(code, { ...unlisted, birthDate: `02/27/${year}` }))
  );
  const admitted = answers.filter(answer => answer.status !== 429);
  assert.ok(admitted.length <= FREE_TRIES, `${admitted.length} lists were tried`);
  assert.ok(
    answers.every(answer => answer.status !== 200),
    'the right year, last in the burst, takes nothing over'
  );
});

test('five wrong birth years refuse a Player ID a while, doubling, until the right year or staff', async () => {
  const owner = await signIn('Organizer', 'organizer');
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 2);
  await send(code, owner, { type: 'pairRound', pod: 'masters' });
  await settle(code, owner, { playerReporting: true, decklists: 'open' });
  const guess = (birthYear: string, device = crypto.randomUUID()) =>
    playerSays(code, { popId: '900', birthYear, device });
  for (const year of ['1985', '1986', '1987', '1988']) {
    assert.equal((await guess(year)).status, 404);
  }
  const fifth = await guess('1989');
  assert.equal(fifth.status, 404, 'the fifth wrong year is still answered');
  const locked = await guess('1990');
  assert.deepEqual(
    [locked.status, locked.json.error],
    [429, 'Too many wrong birth years for this Player ID. Try again later, or ask staff.'],
    'then even the right year is refused, from any device'
  );
  assert.equal((await guess('1990')).status, 429);
  const list = { popId: '900', firstName: 'Player', lastName: '0', birthDate: '02/27/1990' };
  assert.equal((await submitAs(code, list)).status, 429, 'decklists count and refuse the same');
  assert.equal((await playerSays(code, { popId: '901', device: 'phone-901' })).status, 200, 'other players are not');

  mock.timers.tick(60_000);
  assert.equal((await guess('1991')).status, 404, 'a minute later one more try');
  assert.equal((await guess('1990')).status, 429, 'and a wrong one doubles the wait');
  mock.timers.tick(60_000);
  assert.equal((await guess('1990')).status, 429);
  mock.timers.tick(60_000);
  assert.equal((await guess('1990')).status, 200, 'the right year once the wait is over');
  for (const year of ['1981', '1982', '1983', '1984']) {
    assert.equal((await guess(year)).status, 404, 'and it starts the count over');
  }

  for (const year of ['1971', '1972']) {
    await submitAs(code, { ...list, birthDate: `02/27/${year}` });
  }
  assert.equal((await guess('1990')).status, 429, 'wrong years for a list count too');
  const released = await hit(report.onRequestDelete as Handler, '/report?player=900', at(code), {
    method: 'DELETE',
    cookie: owner
  });
  assert.equal(released.status, 204);
  assert.equal((await guess('1990')).status, 200, 'staff freeing the player forgives the wrong years');
});

test('two agreeing reports from one device wait for staff, and staff can free a player’s device', async () => {
  const owner = await signIn('Organizer', 'organizer');
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  const paired = await send(code, owner, { type: 'pairRound', pod: 'masters' });
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
  const owner = await signIn('Organizer', 'organizer');
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
  assert.equal(listed.json.staff[0].name, 'helper');
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
  const cookie = await signIn('Organizer', 'organizer');
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
  const owner = await signIn('Organizer', 'organizer');
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
  const owner = await signIn('Organizer', 'organizer');
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

interface Stored {
  body: string;
  cacheControl: string;
  etag: string;
  version: string;
}

/** An R2 bucket in memory, conditional writes included: a write whose condition fails changes nothing. */
function memoryBucket() {
  const objects = new Map<string, Stored>();
  let uploads = 0;
  const holds = (held: Stored | undefined, onlyIf: { etagMatches: string } | Headers | undefined) => {
    if (!onlyIf) {
      return true;
    }
    return onlyIf instanceof Headers ? onlyIf.get('If-None-Match') === '*' && !held : held?.etag === onlyIf.etagMatches;
  };
  env.REPORTS = {
    head: async key => {
      const held = objects.get(key);
      return held ? { etag: held.etag, customMetadata: { version: held.version } } : null;
    },
    put: async (key, body, options) => {
      if (!holds(objects.get(key), options.onlyIf)) {
        return null;
      }
      uploads += 1;
      const etag = `etag-${uploads}`;
      const { version = '' } = options.customMetadata;
      objects.set(key, { body, cacheControl: options.httpMetadata.cacheControl ?? '', etag, version });
      return { etag, customMetadata: options.customMetadata };
    },
    delete: async key => {
      objects.delete(key);
    },
    get: async key => {
      const held = objects.get(key);
      return held ? { text: async () => held.body } : null;
    }
  };
  return objects;
}

const bodyOf = (stored: Stored | undefined) => JSON.parse(stored?.body ?? '{}');

test('a publish that lands late leaves the newer copy up, and cannot bring back a deleted event', async () => {
  const objects = memoryBucket();
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  const key = `tournaments/v1/${code}.json`;
  const db = env.TOURNAMENT_DB as NonNullable<TournamentEnv['TOURNAMENT_DB']>;
  const older = await loadTournament(db, code);
  await addPlayers(code, owner, 1);
  const newest = await loadTournament(db, code);
  assert.ok(older && newest && newest.version > older.version);
  assert.equal(bodyOf(objects.get(key)).version, newest.version);
  const trips = countTrips();
  await publishView(env, older);
  assert.equal(bodyOf(objects.get(key)).version, newest.version, 'the late copy does not replace the newer one');

  // Another publish lands between this one's look and its write.
  const bucket = env.REPORTS as NonNullable<TournamentEnv['REPORTS']>;
  env.REPORTS = {
    ...bucket,
    put: async (...args) => {
      env.REPORTS = bucket;
      objects.set(key, { ...(objects.get(key) as Stored), etag: 'crossed', version: String(newest.version + 5) });
      return bucket.put(...args);
    }
  };
  await publishView(env, { ...newest, version: newest.version + 1 });
  assert.equal(objects.get(key)?.etag, 'crossed', 'a write that crossed a newer one yields to it');
  assert.equal(trips(), 0, 'publishing over a copy asks the database nothing');

  env.TOURNAMENT_DB = db;
  await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: owner });
  await publishView(env, newest);
  assert.ok(!objects.has(key), 'a publish after the delete takes its copy down again');
});

test('a publish that never gets a write in takes the copy down rather than leave it behind', async () => {
  const objects = memoryBucket();
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  const bucket = env.REPORTS as NonNullable<TournamentEnv['REPORTS']>;
  let refused = 0;
  env.REPORTS = {
    ...bucket,
    put: async () => {
      refused += 1;
      return null;
    }
  };
  const log = console.error;
  console.error = () => undefined;
  try {
    await addPlayers(code, owner, 1);
  } finally {
    console.error = log;
  }
  assert.ok(refused > 1, 'it tries again after a refused write');
  assert.ok(!objects.has(`tournaments/v1/${code}.json`));
});

test('a publish R2 refuses takes the stale copy down, so the page asks the API', async () => {
  const objects = memoryBucket();
  const owner = await signIn('Organizer', 'organizer');
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

test('a .tdf sent from a copy the site no longer holds is refused, not synced over newer rounds', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  const created = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    { method: 'POST', cookie: owner, body: { mode: 'tom', tournament: tdf, store: await storeOf(owner) } }
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
  assert.deepEqual(
    [first.json.role, first.json.tournament.players.length],
    ['owner', tdf.players.length],
    'and is the console’s new copy, so the console need not ask for it'
  );
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
  const owner = await signIn('Organizer', 'organizer');
  const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  const created = await hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    { method: 'POST', cookie: owner, body: { mode: 'tom', tournament: tdf, store: await storeOf(owner) } }
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
  const owner = await signIn('Organizer', 'organizer');
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
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open', sanctioned: false });
  for (let i = 0; i < 40; i += 1) {
    const sent = await submitAs(code, { firstName: 'Player', lastName: `Number ${i}` });
    assert.equal(sent.status, 200, `player ${i + 1} of 40`);
  }
});

test('the answer to a change does not wait for its publish where the runtime keeps the function alive', async () => {
  const objects = memoryBucket();
  const owner = await signIn('Organizer', 'organizer');
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
  assert.equal(bodyOf(objects.get(key)).tournament.players.length, 1);
});

/** Counts the database round trips the functions make from here on. */
function countTrips(): () => number {
  const counting = countingTrips(env.TOURNAMENT_DB as NonNullable<TournamentEnv['TOURNAMENT_DB']>);
  env.TOURNAMENT_DB = counting.db;
  return counting.trips;
}

test('a staff action waits on the database twice, and an idle console poll once', async () => {
  const owner = await signIn('Organizer', 'organizer');
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
  const owner = await signIn('Organizer', 'organizer');
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
      body: { handle: 'renamed' }
    }
  );
  assert.deepEqual([saved.json.user.handle, saved.json.user.providers], ['renamed', ['dev']]);
  seen.length = 0;
  assert.equal((await view(code, owner)).viewer.role, 'owner');
  assert.ok(!seen.some(sql => sql.includes('identities')), 'providers are not read to open an event');
});

const SWEEP_TOKEN = 'sweep-token';

/** The scheduled sweep that ends idle events, as its workflow calls it. */
function sweep(authorization = `Bearer ${SWEEP_TOKEN}`) {
  env.IDLE_SWEEP_TOKEN = SWEEP_TOKEN;
  const call = new Request(`${ORIGIN}/api/tournaments/idle`, { method: 'POST', headers: { authorization } });
  return idle.onRequestPost({ request: call, env, params: {} }).then(async response => ({
    status: response.status,
    json: (await response.json()) as { ended: string[]; idle: string[] }
  }));
}

/** Leaves the event as if nobody had changed it for `ms`. */
function age(code: string, ms: number) {
  const { raw } = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  raw.prepare('UPDATE tournaments SET updated_at = ? WHERE code = ?').run(Date.now() - ms, code);
}

const HOUR = 60 * 60 * 1000;

/** An event with round 1 paired. */
async function underWay(cookie: string): Promise<string> {
  const code = await newSwiss(cookie);
  await addPlayers(code, cookie, 4);
  assert.equal((await send(code, cookie, { type: 'pairRound', pod: 'masters' })).status, 200);
  return code;
}

/** A separate pod per division, with only `pairedPod` under way. */
function divisionPods(tournament: Tournament, pairedPod: number): Tournament {
  const paired = tournament.pods.find(pod => pod.rounds.length > 0);
  assert.ok(paired);
  return {
    ...tournament,
    pods: DIVISIONS.map((category, index) => ({
      ...paired,
      category,
      playerIds: index === pairedPod ? paired.playerIds : [],
      rounds: index === pairedPod ? paired.rounds : []
    }))
  };
}

[1, 2].forEach(pairedPod => {
  test(`the sweep marks an unresolved event idle with rounds only in pod ${pairedPod} without changing its document`, async () => {
    const owner = await signIn('Organizer', 'organizer');
    const code = await underWay(owner);
    const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
    const row = await loadTournament(db, code);
    assert.ok(row);
    db.raw
      .prepare('UPDATE tournaments SET state = ? WHERE code = ?')
      .run(JSON.stringify(divisionPods(row.tournament, pairedPod)), code);
    age(code, 3 * HOUR);
    const before = await loadTournament(db, code);
    assert.ok(before);
    assert.deepEqual((await sweep()).json.idle, [code]);
    const after = await loadTournament(db, code);
    assert.ok(after);
    assert.equal(after.updatedAt, before.updatedAt, 'bookkeeping preserves the last activity time');
    assert.deepEqual(after, {
      ...before,
      settings: { ...before.settings, idle: true },
      version: before.version + 1,
      updatedAt: after.updatedAt
    });
  });
});

test('idle candidates exclude empty pods, unpaired divisions and updates at the cutoff', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const owner = await signIn('Organizer', 'organizer');
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  const before = Date.now() - 2 * HOUR;
  for (const pods of [[], DIVISIONS.map(category => ({ category, playerIds: [], rounds: [] }))]) {
    const code = await newSwiss(owner);
    const row = await loadTournament(db, code);
    assert.ok(row);
    db.raw
      .prepare('UPDATE tournaments SET state = ?, updated_at = ? WHERE code = ?')
      .run(JSON.stringify({ ...row.tournament, pods }), before - 1, code);
  }
  const atCutoff = await underWay(owner);
  db.raw.prepare('UPDATE tournaments SET updated_at = ? WHERE code = ?').run(before, atCutoff);
  assert.deepEqual(await loadIdle(db, before, 10), []);
  assert.deepEqual((await sweep()).json.ended, [], 'no unpaired event is finished');
});

test('capped sweeps process oldest events first, break ties by code and drain remaining candidates', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  const before = Date.now() - 2 * HOUR;
  const candidates: { code: string; updatedAt: number }[] = [];
  for (let index = 0; index < 12; index += 1) {
    const code = await underWay(owner);
    const updatedAt = before - Math.floor(index / 2) * HOUR - 1000;
    db.raw.prepare('UPDATE tournaments SET updated_at = ? WHERE code = ?').run(updatedAt, code);
    candidates.push({ code, updatedAt });
  }
  const ordered = candidates
    .sort((a, b) => a.updatedAt - b.updatedAt || a.code.localeCompare(b.code))
    .map(row => row.code);
  assert.deepEqual(
    (await loadIdle(db, before, 10)).map(row => row.code),
    ordered.slice(0, 10)
  );
  assert.deepEqual(
    (await loadIdle(db, before, 10)).map(row => row.code),
    ordered.slice(0, 10)
  );
  assert.deepEqual((await sweep()).json.idle, ordered.slice(0, 10));
  assert.deepEqual((await sweep()).json.idle, ordered.slice(10));
  assert.deepEqual((await sweep()).json.ended, []);
});

[-1, 2].forEach(pairedPod => {
  test(`the sweep rechecks every pod after a concurrent write leaves rounds in pod ${pairedPod}`, async () => {
    const owner = await signIn('Organizer', 'organizer');
    const code = await underWay(owner);
    age(code, 3 * HOUR);
    const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
    const row = await loadTournament(db, code);
    assert.ok(row);
    const tournament = divisionPods(row.tournament, pairedPod);
    env.TOURNAMENT_DB = racing(db, 'UPDATE tournaments SET', () => {
      db.raw
        .prepare('UPDATE tournaments SET state = ?, version = version + 1 WHERE code = ?')
        .run(JSON.stringify(tournament), code);
    });
    assert.deepEqual((await sweep()).json.idle, pairedPod < 0 ? [] : [code]);
    const after = await loadTournament(db, code);
    assert.ok(after);
    assert.deepEqual(after.tournament, tournament, 'the concurrent document is preserved');
    assert.equal(after.settings.finished, false);
    assert.equal(after.settings.idle, pairedPod >= 0);
    assert.equal(after.version, row.version + (pairedPod < 0 ? 1 : 2));
  });
});

test('the sweep marks an unresolved event idle that has gone two hours without a change, and publishes it', async () => {
  const objects = memoryBucket();
  const owner = await signIn('Organizer', 'organizer');
  const idleOne = await underWay(owner);
  const busy = await underWay(owner);
  const unstarted = await newSwiss(owner);
  age(idleOne, 2 * HOUR + 1000);
  age(busy, 2 * HOUR - 60_000);
  age(unstarted, 48 * HOUR);
  const swept = await sweep();
  assert.equal(swept.status, 200);
  assert.deepEqual(swept.json.idle, [idleOne]);
  assert.equal((await loadTournament(env.TOURNAMENT_DB!, idleOne))?.settings.finished, false);
  assert.equal((await loadTournament(env.TOURNAMENT_DB!, busy))?.settings.finished, false);
  assert.equal(
    (await loadTournament(env.TOURNAMENT_DB!, unstarted))?.settings.finished,
    false,
    'set up ahead of its day'
  );
  const published = JSON.parse(objects.get(`tournaments/v1/${idleOne}.json`)?.body ?? '{}') as TournamentView;
  assert.equal(published.settings.finished, false);
  assert.equal(published.settings.idle, true, 'players see inactivity separately');
  assert.deepEqual((await sweep()).json.ended, [], 'an ended event is left alone');
});

test('a settings change clears idle status and gives the event another two hours', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await underWay(owner);
  age(code, 3 * HOUR);
  await sweep();
  const reopened = await hit(settings.onRequestPut as Handler, '/settings', at(code), {
    method: 'PUT',
    cookie: owner,
    body: { finished: false }
  });
  assert.equal(reopened.status, 200);
  assert.deepEqual((await sweep()).json.ended, []);
  assert.equal((await loadTournament(env.TOURNAMENT_DB!, code))?.settings.finished, false);
});

test('a change that lands while the sweep runs keeps the event going', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await underWay(owner);
  age(code, 3 * HOUR);
  const db = env.TOURNAMENT_DB!;
  const { raw } = db as ReturnType<typeof sqliteD1>;
  env.TOURNAMENT_DB = {
    ...db,
    prepare: sql => {
      const statement = db.prepare(sql);
      if (!sql.includes('updated_at < ?')) {
        return statement;
      }
      // The sweep has read the event; a result comes in before it writes.
      return {
        ...statement,
        bind: (...args: unknown[]) => {
          const bound = statement.bind(...args);
          return {
            ...bound,
            all: async <T>() => {
              const read = await bound.all<T>();
              raw
                .prepare('UPDATE tournaments SET version = version + 1, updated_at = ? WHERE code = ?')
                .run(Date.now(), code);
              return read;
            }
          };
        }
      };
    }
  };
  assert.deepEqual((await sweep()).json.ended, []);
  assert.equal((await loadTournament(db, code))?.settings.finished, false);
});

test('idle events keep player reporting open and post-event decks hidden, and activity clears idle', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await underWay(owner);
  await settle(code, owner, { playerReporting: true, deckVisibility: 'after' });
  const row = await loadTournament(env.TOURNAMENT_DB!, code);
  assert.ok(row);
  const match = row.tournament.pods[0]!.rounds[0]!.matches[0]!;
  const phone = await phoneOf(code, match.p1);
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  db.raw
    .prepare('UPDATE tournaments SET decks = ? WHERE code = ?')
    .run(JSON.stringify({ [match.p1]: 'Dragapult' }), code);
  age(code, 3 * HOUR);
  assert.deepEqual((await sweep()).json.idle, [code]);
  assert.equal((await view(code)).settings.finished, false);
  assert.deepEqual((await view(code)).decks, {});
  assert.equal((await phone.report('win')).status, 200);
  assert.equal((await loadTournament(env.TOURNAMENT_DB!, code))?.settings.idle, false);
});

/** A complete three-round Swiss event, written as a synced document. */
async function completedSwiss(owner: string): Promise<string> {
  const code = await underWay(owner);
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  const row = await loadTournament(db, code);
  assert.ok(row);
  const pod = row.tournament.pods[0]!;
  const first = pod.rounds[0]!;
  const rounds: Round[] = [1, 2, 3].map(number => ({
    ...first,
    number,
    status: 'finished',
    matches: first.matches.map(match => ({ ...match, outcome: 'p1' }))
  }));
  db.raw
    .prepare('UPDATE tournaments SET state = ? WHERE code = ?')
    .run(JSON.stringify({ ...row.tournament, pods: [{ ...pod, rounds }] }), code);
  age(code, 3 * HOUR);
  return code;
}

test('the sweep finishes genuinely completed Swiss events and reveals post-event decks', async () => {
  const objects = memoryBucket();
  const owner = await signIn('Organizer', 'organizer');
  const code = await completedSwiss(owner);
  await settle(code, owner, { deckVisibility: 'after' });
  age(code, 3 * HOUR);
  assert.deepEqual((await sweep()).json.ended, [code]);
  const published = JSON.parse(objects.get(`tournaments/v1/${code}.json`)?.body ?? '{}') as TournamentView;
  assert.equal(published.settings.finished, true);
});

test('the sweep finishes a resolved final but waits for a pending third-place match', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await completedSwiss(owner);
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  const row = await loadTournament(db, code);
  assert.ok(row);
  const pod = row.tournament.pods[0]!;
  const last = pod.rounds.at(-1)!;
  pod.cut = 4;
  pod.playoff3rd4th = true;
  const [a, b] = last.matches;
  assert.ok(a && b && a.p2 && b.p2);
  pod.rounds.push({ ...last, number: 4, kind: 'elimination' });
  const final: Round = {
    ...last,
    number: 5,
    kind: 'elimination',
    matches: [
      { ...a, p1: a.p1, p2: b.p1, outcome: 'p1' },
      { ...b, p1: a.p2, p2: b.p2, outcome: 'pending' }
    ]
  };
  pod.rounds.push(final);
  db.raw.prepare('UPDATE tournaments SET state = ? WHERE code = ?').run(JSON.stringify(row.tournament), code);
  assert.deepEqual((await sweep()).json.idle, [code]);
  final.matches[1]!.outcome = 'p2';
  db.raw
    .prepare("UPDATE tournaments SET state = ?, settings = json_set(settings, '$.idle', 0) WHERE code = ?")
    .run(JSON.stringify(row.tournament), code);
  age(code, 3 * HOUR);
  assert.deepEqual((await sweep()).json.ended, [code]);
});

(
  [
    'unpaired division',
    'unfinished round',
    'pending match',
    'missing Swiss rounds',
    'unpaired cut',
    'semifinals',
    'pending TOM result'
  ] as const
).forEach(defect => {
  test(`the sweep leaves an event idle with ${defect}`, async () => {
    const owner = await signIn('Organizer', 'organizer');
    const code = await completedSwiss(owner);
    const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
    const row = await loadTournament(db, code);
    assert.ok(row);
    const pod = row.tournament.pods[0]!;
    const last = pod.rounds.at(-1)!;
    switch (defect) {
      case 'unpaired division':
        row.tournament.pods.push({ ...pod, category: 'senior', rounds: [] });
        break;
      case 'unfinished round':
        last.status = 'started';
        break;
      case 'pending match':
        last.matches[0]!.outcome = 'pending';
        break;
      case 'missing Swiss rounds':
        pod.rounds.pop();
        break;
      case 'unpaired cut':
        pod.cut = 4;
        break;
      case 'semifinals':
        pod.cut = 4;
        pod.rounds.push({ ...last, number: 4, kind: 'elimination' });
        break;
      case 'pending TOM result':
        row.pending.push({ pod: pod.category, round: last.number, ...last.matches[0]!, at: Date.now() });
        break;
    }
    db.raw
      .prepare('UPDATE tournaments SET state = ?, pending = ? WHERE code = ?')
      .run(JSON.stringify(row.tournament), JSON.stringify(row.pending), code);
    assert.deepEqual((await sweep()).json.idle, [code]);
    assert.equal((await loadTournament(db, code))?.settings.finished, false);
  });
});

test('an unresolved idle event expires at seven days from its last activity', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const objects = memoryBucket();
  const owner = await signIn('Organizer', 'organizer');
  const code = await underWay(owner);
  const db = env.TOURNAMENT_DB!;
  age(code, 3 * HOUR);
  const lastActivity = (await loadTournament(db, code))!.updatedAt;
  assert.deepEqual((await sweep()).json.idle, [code]);
  assert.equal((await loadTournament(db, code))?.updatedAt, lastActivity);
  mock.timers.tick(7 * 24 * HOUR - 3 * HOUR - 1);
  assert.deepEqual((await sweep()).json.ended, [], 'idle events do not end before seven days');
  mock.timers.tick(1);
  assert.deepEqual((await sweep()).json.ended, [code]);
  const after = await loadTournament(db, code);
  assert.equal(after?.settings.finished, true);
  assert.ok(after?.tournament.pods[0]!.rounds[0]!.matches.some(match => match.outcome === 'pending'));
  const published = JSON.parse(objects.get(`tournaments/v1/${code}.json`)?.body ?? '{}') as TournamentView;
  assert.equal(published.settings.finished, true);
  assert.deepEqual((await sweep()).json.ended, [], 'finished events are not processed again');
});

test('seven-day events end even if no earlier idle sweep ran', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await underWay(owner);
  age(code, 8 * 24 * HOUR);
  assert.deepEqual((await sweep()).json.ended, [code]);
});

test('new activity during an expired idle sweep prevents closure', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await underWay(owner);
  age(code, 3 * HOUR);
  await sweep();
  age(code, 8 * 24 * HOUR);
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  env.TOURNAMENT_DB = racing(db, 'UPDATE tournaments SET', () => {
    db.raw.prepare('UPDATE tournaments SET updated_at = ?, version = version + 1 WHERE code = ?').run(Date.now(), code);
  });
  assert.deepEqual((await sweep()).json.ended, []);
  assert.equal((await loadTournament(db, code))?.settings.finished, false);
});

test('only the sweep’s token runs the sweep', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await underWay(owner);
  age(code, 3 * HOUR);
  assert.equal((await sweep('')).status, 403);
  assert.equal((await sweep('Bearer wrong')).status, 403);
  assert.equal((await sweep(SWEEP_TOKEN)).status, 403, 'the scheme is part of it');
  delete env.IDLE_SWEEP_TOKEN;
  const unset = await idle.onRequestPost({
    request: new Request(`${ORIGIN}/api/tournaments/idle`, { method: 'POST', headers: { authorization: 'Bearer ' } }),
    env,
    params: {}
  });
  assert.equal(unset.status, 403, 'no token configured runs nothing');
  assert.equal((await loadTournament(env.TOURNAMENT_DB!, code))?.settings.finished, false);
});

/**
 * What player accounts add to an event's life, for the scan check below: a
 * TOM file and its sync, an account's Claim at an unsanctioned event, the
 * page that shows it, its decklist, its History and public profile, and the
 * Claim undone. `player` is signed in with a POP ID.
 */
async function accountsFlow(owner: string, player: string) {
  const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  const tom = await newEvent(owner, { mode: 'tom', tournament: tdf });
  const extra = { ...tdf.players[0]!, id: '7200099', lastName: 'Extra' };
  await hit(sync.onRequestPut as Handler, '/sync', at(tom), {
    method: 'PUT',
    cookie: owner,
    body: { tournament: { ...tdf, players: [...tdf.players, extra] }, base: await revisionNow(tom, owner) }
  });
  await view(tom, player);
  const casual = await newSwiss(owner);
  await settle(casual, owner, { sanctioned: false, decklists: 'open' });
  await send(casual, owner, { type: 'addPlayer', player: { firstName: 'Ash', lastName: 'Ketchum' } });
  await send(casual, owner, { type: 'addPlayer', player: { firstName: 'Gary', lastName: 'Oak' } });
  const gary = await playerSays(casual, { lastName: 'Oak', device: 'gary' });
  await playerSays(casual, { lastName: 'Ketchum', device: 'ash' }, { cookie: player });
  await view(casual, player);
  const ash = { firstName: 'Ash', lastName: 'Ketchum' };
  await hit(decklists.onRequestPut as Handler, '/decklists', at(casual), {
    method: 'PUT',
    cookie: player,
    body: { ...LIST, profile: ash }
  });
  const query = 'firstName=Ash&lastName=Ketchum';
  await hit(decklists.onRequestGet as Handler, `/decklists?${query}`, at(casual), { cookie: player });
  await hit(decklists.onRequestDelete as Handler, `/decklists?${query}`, at(casual), {
    method: 'DELETE',
    cookie: player
  });
  await hit(history.onRequestGet as Handler, '/api/history', {}, { cookie: player });
  const patch = (body: Record<string, unknown>) =>
    hit(me.onRequestPatch as Handler, '/api/me', {}, { method: 'PATCH', cookie: player, body });
  await patch({ handle: 'ash.k' });
  // Taken by the owner's account, then the day's changes used up: both refusals read their reason.
  await patch({ handle: 'organizer' });
  await patch({ handle: 'ash-k' });
  await patch({ handle: 'ash_k' });
  await patch({ handle: 'ashk' });
  await patch({ publicProfile: true });
  await patch({ profileName: 'handle' });
  await hit(profiles.onRequestGet as Handler, '/api/profiles/ashk', { handle: 'ashk' });
  await hit(claim.onRequestDelete as Handler, '/claim', at(casual), { method: 'DELETE', cookie: player });
  // Gary's phone, signed in now, makes its claim the account's.
  await playerSays(casual, { lastName: 'Oak', device: 'gary', reportToken: gary.json.reportToken }, { cookie: player });
  await hit(event.onRequestDelete as Handler, '/', at(tom), { method: 'DELETE', cookie: owner });
}

/**
 * What applications and the admin routes add, for the scan check below: an
 * account uploads a proof, applies, withdraws and applies again; an Admin
 * lists the queue, sees the proof and approves it, lists the Organizers,
 * revokes and reinstates one, looks accounts up every way, and moves and
 * clears a POP ID. `owner` is an Organizer.
 */
/** A store's life after its Application is approved, as its Manager, its Staff and an Admin go through it. */
async function storesFlow(admin: string, manager: string) {
  // Bound, so the stores index publishes and its read is seen too.
  memoryBucket();
  const { stores } = (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: manager })).json.user;
  const storeId = stores[0].id as string;
  const at = { id: storeId };
  const app = storeApplication();
  await hit(storeRoute.onRequestGet as Handler, `/api/stores/${storeId}`, at, { cookie: manager });
  await hit(storeRoute.onRequestPatch as Handler, `/api/stores/${storeId}`, at, {
    method: 'PATCH',
    cookie: manager,
    body: { details: app.details, timeZone: app.timeZone }
  });
  await hit(storeNights.onRequestPut as Handler, `/api/stores/${storeId}/nights`, at, {
    method: 'PUT',
    cookie: manager,
    body: { nights: app.nights, exceptions: [{ date: '2099-01-04', nightId: 'sun', time: null, note: 'Cup' }] }
  });
  const invited = await hit(storeMembers.onRequestPost as Handler, '/members', at, {
    method: 'POST',
    cookie: manager,
    body: { invite: 'staff' }
  });
  const helper = await signIn('Store Helper');
  await hit(
    storeJoin.onRequestPost as Handler,
    '/api/stores/join',
    {},
    {
      method: 'POST',
      cookie: helper,
      body: { token: invited.json.token }
    }
  );
  await hit(storeMembers.onRequestGet as Handler, '/members', at, { cookie: manager });
  const helperId = (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: helper })).json.user.id;
  await hit(storeMembers.onRequestPatch as Handler, '/members', at, {
    method: 'PATCH',
    cookie: manager,
    body: { user: helperId, role: 'manager' }
  });
  await hit(storeListings.onRequestGet as Handler, '/listings', at, { cookie: helper });
  await hit(leagues.onRequestGet as Handler, '/api/leagues/6238620', { id: '6238620' }, { cookie: helper });
  const code = await newEvent(manager, { store: storeId, settings: { startsAt: '2026-11-01T15:00' } });
  await hit(
    organizerOfRecord.onRequestPut as Handler,
    '/organizer',
    { code },
    {
      method: 'PUT',
      cookie: helper,
      body: { user: helperId }
    }
  );
  await hit(tournaments.onRequestGet as Handler, '/api/tournaments', {}, { cookie: helper });
  const own = await newEvent(manager, { store: null, settings: { startsAt: '2026-11-02T15:00' } });
  await settle(own, manager, { startsAt: '2026-11-03T15:00' });
  await hit(storeMembers.onRequestDelete as Handler, `/members?user=${helperId}`, at, {
    method: 'DELETE',
    cookie: manager
  });
  await hit(adminStores.onRequestGet as Handler, '/api/admin/stores', {}, { cookie: admin });
  for (const body of [{ status: 'revoked' }, { status: 'active' }, { manager: helperId }]) {
    await hit(adminStore.onRequestPost as Handler, `/api/admin/stores/${storeId}`, at, {
      method: 'POST',
      cookie: admin,
      body
    });
  }
}

async function applicationsFlow(owner: string) {
  env.PROOFS = memoryProofs();
  const applicant = await signIn('Applicant');
  const profile = { popId: '980', firstName: 'Apply', lastName: 'Ing', birthDate: '02/27/1990' };
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: applicant, body: profile });
  const uploaded = await proof.onRequestPut({
    request: new Request(`${ORIGIN}/api/applications/proof`, {
      method: 'PUT',
      headers: { origin: ORIGIN, cookie: applicant },
      body: new TextEncoder().encode('%PDF-1.7\n')
    }),
    env,
    params: {}
  } as never);
  assert.equal(uploaded.status, 200);
  await hit(myApplication.onRequestGet as Handler, '/api/applications/mine', {}, { cookie: applicant });
  const apply = (body: unknown) =>
    hit(applications.onRequestPost as Handler, '/api/applications', {}, { method: 'POST', cookie: applicant, body });
  await apply({ store: storeApplication(), explanation: 'First try', proof: true });
  await hit(
    myApplication.onRequestDelete as Handler,
    '/api/applications/mine',
    {},
    {
      method: 'DELETE',
      cookie: applicant
    }
  );
  await hit(proof.onRequestDelete as Handler, '/api/applications/proof', {}, { method: 'DELETE', cookie: applicant });
  const { id } = (await apply({ store: storeApplication(), explanation: 'Second try', proof: false })).json.application;
  const admin = await signIn('Admin', 'admin');
  await hit(adminApplications.onRequestGet as Handler, '/api/admin/applications', {}, { cookie: admin });
  await adminProof.onRequestGet({
    request: new Request(`${ORIGIN}/api/admin/applications/${id}/proof`, { headers: { cookie: admin } }),
    env,
    params: { id }
  } as never);
  await hit(
    adminDecide.onRequestPost as Handler,
    `/api/admin/applications/${id}`,
    { id },
    {
      method: 'POST',
      cookie: admin,
      body: { decision: 'approve' }
    }
  );
  await hit(
    adminApplications.onRequestGet as Handler,
    '/api/admin/applications?status=approved',
    {},
    { cookie: admin }
  );
  await hit(adminOrganizers.onRequestGet as Handler, '/api/admin/organizers', {}, { cookie: admin });
  const applicantId = (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: applicant })).json.user.id;
  await hit(community.onRequestPost as Handler, '/api/community', {}, { method: 'POST', cookie: applicant });
  await storesFlow(admin, applicant);
  for (const role of ['revoked', 'community']) {
    await hit(
      adminOrganizer.onRequestPost as Handler,
      `/api/admin/organizers/${applicantId}`,
      { id: applicantId },
      {
        method: 'POST',
        cookie: admin,
        body: { role }
      }
    );
  }
  for (const query of ['popId=980', 'email=nobody%40example.com', `id=${applicantId}`]) {
    await hit(adminAccounts.onRequestGet as Handler, `/api/admin/accounts?${query}`, {}, { cookie: admin });
  }
  const ownerId = (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: owner })).json.user.id;
  for (const accountId of [ownerId, null]) {
    await hit(
      adminPopIds.onRequestPost as Handler,
      '/api/admin/pop-ids',
      {},
      {
        method: 'POST',
        cookie: admin,
        body: { popId: '980', accountId }
      }
    );
  }
}

/** A piece of each statement player accounts added, which the scan check must have seen. */
const ACCOUNT_STATEMENTS = [
  'INSERT OR IGNORE INTO pop_history',
  'DELETE FROM pop_history WHERE code = ?1',
  'DELETE FROM report_devices WHERE code = ?1',
  'UPDATE report_devices SET user_id = NULL',
  'SELECT player_id FROM report_devices WHERE user_id = ?',
  'UPDATE OR IGNORE report_devices SET user_id',
  'SELECT player_id FROM report_devices JOIN sessions',
  'DELETE FROM report_devices WHERE code = ? AND user_id = ?',
  'decklists.account = excluded.account',
  'OR account = (SELECT user_id FROM report_devices',
  '(SELECT id FROM users WHERE id = ? AND pop_id = ?)',
  'JOIN pop_history h',
  'JOIN report_devices d',
  'u.handle = ? AND u.public_profile = 1',
  'INSERT OR IGNORE INTO handle_changes',
  'DELETE FROM handle_changes WHERE user_id = ?',
  'SELECT COUNT(*) AS n FROM handle_changes',
  'FROM sessions s JOIN applications a',
  'INSERT OR IGNORE INTO applications',
  "DELETE FROM applications WHERE user_id = ? AND status = 'pending'",
  'WHERE a.status = ? ORDER BY a.created_at ASC',
  'WHERE a.status = ? ORDER BY a.created_at DESC',
  'SELECT proof_key FROM applications WHERE id = ?',
  "SELECT proof_key FROM applications WHERE id = ? AND status = 'pending'",
  "SELECT proof_key FROM applications WHERE user_id = ? AND status = 'pending'",
  'JOIN proof_uploads p ON p.user_id = s.user_id',
  'SELECT key FROM proof_uploads WHERE user_id = ?',
  'INSERT INTO proof_uploads',
  'LEFT JOIN proof_uploads p ON p.user_id = u.id',
  'DELETE FROM proof_uploads WHERE EXISTS',
  'DELETE FROM proof_uploads WHERE user_id = ?',
  'INSERT INTO stores (id, league_id',
  'INSERT INTO store_members (store_id, user_id, role, added_at) SELECT',
  "UPDATE users SET role = 'community'",
  'INSERT INTO store_invites',
  'DELETE FROM store_invites WHERE token_hash = ?',
  'SELECT store_id, ?, role, ? FROM store_invites',
  'UPDATE store_members SET role = ?',
  'DELETE FROM store_members WHERE store_id = ? AND user_id = ?',
  'UPDATE stores SET name = ?',
  'UPDATE stores SET nights = ?',
  'UPDATE stores SET status = ?',
  "FROM stores WHERE status = 'active'",
  'SELECT s.status, s.league_id, s.city, s.region, s.country, s.time_zone FROM store_members m',
  'INDEXED BY tournaments_of_store',
  'INSERT OR IGNORE INTO event_creations',
  'DELETE FROM event_creations WHERE owner = ? AND at <= ?',
  'store_role FROM sessions',
  'SELECT u.pop_id, u.first_name, u.last_name FROM store_members m',
  "FROM stores s WHERE s.status IN ('active', 'revoked')",
  "SET role = 'manager'",
  'UPDATE applications SET status = ?2',
  'WHERE a.id = ?',
  "WHERE u.role IN ('community', 'revoked', 'admin')",
  'FROM users u WHERE u.id = ?',
  "UPDATE users SET role = ?, role_at = ?, role_by = ? WHERE id = ? AND role IN ('community', 'revoked')",
  'FROM users WHERE pop_id = ? LIMIT',
  'FROM users WHERE email = ? LIMIT',
  'FROM users WHERE id = ? LIMIT',
  'DELETE FROM report_devices WHERE player_id = ?1',
  'UPDATE users SET pop_id = NULL WHERE pop_id = ?1',
  'DELETE FROM report_devices WHERE user_id = ?2',
  'UPDATE users SET pop_id = ?1 WHERE id = ?2',
  'player_id = (SELECT pop_id FROM users WHERE id = ?1)',
  'UPDATE users SET handle = ?3 WHERE id = ?1',
  'FROM tournaments WHERE code = ?3 AND version = ?8',
  'DELETE FROM decklists WHERE code = ?1 AND EXISTS',
  'DELETE FROM tournaments WHERE code = ? AND version = ?',
  'SELECT age_checked_at FROM users WHERE id = COALESCE',
  'INSERT INTO pending_signups',
  'DELETE FROM pending_signups WHERE token_hash = ?',
  'DELETE FROM pending_signups WHERE expires_at <= ?',
  "UPDATE decklists SET deck = ''"
];

/** A new sign-up through Google and the age check, as the sign-up's queries run. */
async function ageCheckFlow() {
  env.GOOGLE_CLIENT_ID = 'id';
  env.GOOGLE_CLIENT_SECRET = 'secret';
  const fetch = mock.method(
    globalThis,
    'fetch',
    async (url: string | URL) =>
      String(url).includes('token')
        ? Response.json({ access_token: 'token' }) // eslint-disable-line camelcase
        : Response.json({ sub: 'g-new', email: 'new@example.com', email_verified: true }) // eslint-disable-line camelcase
  );
  try {
    const waiting = await callback.onRequestGet({
      request: request('/api/auth/callback/google?code=c&state=state', { cookie: 'cm_oauth=state%20%2Fhost' }),
      env,
      params: { provider: 'google' }
    } as never);
    const cookie = (waiting.headers.getSetCookie().find(value => value.startsWith('cm_signup=')) ?? '').split(';')[0];
    await hit(
      ageCheck.onRequestPost as Handler,
      '/api/auth/age',
      {},
      {
        method: 'POST',
        cookie,
        body: { birthDate: '1990-01-01' }
      }
    );
  } finally {
    fetch.mock.restore();
  }
}

test('nothing the functions ask of the database scans a table', async () => {
  const { raw } = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  const seen = recordSql();
  const owner = await signIn('Organizer', 'organizer');
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
  const profile = { popId: '901', firstName: 'Player', lastName: '1', birthDate: '02/27/1990' };
  await hit(
    me.onRequestPut as Handler,
    '/api/me',
    {},
    { method: 'PUT', cookie: helper, body: { ...profile, popId: '950' } }
  );
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: helper, body: profile });
  await hit(
    me.onRequestPatch as Handler,
    '/api/me',
    {},
    { method: 'PATCH', cookie: helper, body: { publicProfile: true } }
  );
  await hit(
    me.onRequestPatch as Handler,
    '/api/me',
    {},
    { method: 'PATCH', cookie: helper, body: { publicProfile: false } }
  );
  await hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    cookie: helper,
    body: { ...LIST, profile }
  });
  await hit(decklists.onRequestGet as Handler, '/decklists', at(code), { cookie: owner });
  await hit(decklists.onRequestGet as Handler, `/decklists?popId=900&token=${sent.json.token}`, at(code));
  await hit(decklists.onRequestPatch as Handler, '/decklists?popId=900', at(code), { method: 'PATCH', cookie: owner });
  await hit(decklists.onRequestDelete as Handler, '/decklists?popId=900', at(code), { method: 'DELETE' });
  // The history index: a player in and out of a sanctioned event, and the event out of the index and back.
  await send(code, owner, { type: 'addPlayer', player: { firstName: 'Gone', lastName: 'Soon', id: '960' } });
  await send(code, owner, { type: 'removePlayer', id: '960' });
  await settle(code, owner, { sanctioned: false });
  await settle(code, owner, { sanctioned: true });
  await send(code, owner, { type: 'pairRound', pod: 'masters' });
  await playerSays(code, { popId: '900', result: 'win' });
  await hit(report.onRequestDelete as Handler, '/report?player=900', at(code), { method: 'DELETE', cookie: owner });
  await hit(staff.onRequestPost as Handler, '/staff', at(code), {
    method: 'POST',
    cookie: owner,
    body: { rotate: true }
  });
  await sweep();
  await ageCheckFlow();
  await accountsFlow(owner, helper);
  await applicationsFlow(owner);
  await hit(logout.onRequestPost as Handler, '/api/auth/logout', {}, { method: 'POST', cookie: helper });
  await settle(code, owner, { finished: true });
  await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: owner });
  const statements = [...new Set(seen)];
  assert.ok(statements.length > 25, 'the flow reached the functions');
  for (const part of ACCOUNT_STATEMENTS) {
    assert.ok(
      statements.some(sql => sql.includes(part)),
      `the flow reached ${part}`
    );
  }
  for (const sql of statements) {
    const plan = raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[];
    // A constant row is the values an INSERT ... SELECT writes, and json_each walks a bound array: neither is a table.
    const scans = plan
      .map(step => step.detail)
      .filter(
        detail =>
          detail.startsWith('SCAN') && detail !== 'SCAN CONSTANT ROW' && !/^SCAN ids VIRTUAL TABLE\b/.test(detail)
      );
    assert.deepEqual(scans, [], sql);
  }
});

test('an event made on a code already taken gets another, and the first is untouched', async () => {
  const owner = await signIn('Organizer', 'organizer');
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
    new URL('../../config/d1/migrations/tournaments/0004-indexes.sql', import.meta.url),
    'utf8'
  );
  older.exec(migration);
  older.exec(migration);
  assert.deepEqual(indexes(older), indexes(fresh));
});

/** Has another write land just ahead of each of the functions' next `times` writes to the event. */
function raceWrites(times: number) {
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  let left = times;
  env.TOURNAMENT_DB = {
    ...db,
    prepare: sql => {
      if (left > 0 && sql.startsWith('UPDATE tournaments SET')) {
        left -= 1;
        db.raw.exec('UPDATE tournaments SET version = version + 1');
      }
      return db.prepare(sql);
    }
  };
}

test('a change beaten to the row by other writes lands on what they left, and gives up only after five tries', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  const add = (lastName: string) => send(code, owner, { type: 'addPlayer', player: { firstName: 'Ash', lastName } });
  raceWrites(4);
  const landed = await add('Ketchum');
  assert.equal(landed.status, 200);
  assert.equal(landed.json.tournament.players.length, 1);
  assert.equal(landed.json.version, 6, 'four writes ahead of it, then its own');
  raceWrites(5);
  const busy = await add('Oak');
  assert.deepEqual([busy.status, busy.json.error], [409, 'Busy; try again']);
  assert.equal((await view(code)).tournament.players.length, 1, 'nothing half-written');
});

test('the idle sweep waits for combined semifinals and ends only after the final', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await underWay(owner);
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  const tournament = juniorsCutApart();
  const pod = tournament.pods[0]!;
  pod.rounds.pop();
  db.raw
    .prepare('UPDATE tournaments SET state = ?, settings = ? WHERE code = ?')
    .run(JSON.stringify(tournament), JSON.stringify({ roundCap: 1 }), code);
  age(code, 3 * HOUR);
  assert.deepEqual((await sweep()).json.idle, [code]);
  assert.equal((await loadTournament(db, code))?.settings.finished, false);
  db.raw
    .prepare('UPDATE tournaments SET state = ?, settings = ? WHERE code = ?')
    .run(JSON.stringify(juniorsCutApart()), JSON.stringify({ roundCap: 1 }), code);
  age(code, 3 * HOUR);
  assert.deepEqual((await sweep()).json.ended, [code]);
});

test('loading older separate cut pods migrates their pending results and player reports', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await underWay(owner);
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  const tournament = juniorsCutApart();
  const pod = tournament.pods[0]!;
  const ids = pod.divisionCuts!.junior!.playerIds!;
  const cut = {
    ...pod,
    category: 'junior' as const,
    cutOf: pod.category,
    playerIds: ids,
    cut: 4,
    rounds: pod.rounds.filter(r => r.kind === 'elimination')
  };
  const final = cut.rounds.at(-1)!;
  const match = final.matches[0]!;
  match.outcome = 'pending';
  const key = { pod: cut.category, round: final.number, ...match, outcome: 'p1', at: Date.now() };
  tournament.pods = [{ ...pod, divisionCuts: undefined, rounds: pod.rounds.filter(r => r.kind === 'swiss') }, cut];
  db.raw
    .prepare('UPDATE tournaments SET state = ?, pending = ?, reports = ? WHERE code = ?')
    .run(JSON.stringify(tournament), JSON.stringify([key]), JSON.stringify([{ ...key, by: match.p1 }]), code);
  const loaded = await loadTournament(db, code);
  assert.ok(loaded);
  assert.equal(loaded.tournament.pods.length, 1);
  assert.equal(loaded.tournament.pods[0]!.rounds.at(-1)!.matches[0]!.outcome, 'pending');
  assert.equal(loaded.pending[0]!.pod, 'mixed');
  assert.equal(loaded.reports[0]!.pod, 'mixed');
  const written = parseTdf(writeTdf(loaded.tournament));
  assert.equal(written.pods.length, 1);
});

test('a stored copy of the imported file is dropped when the event is read', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await underWay(owner);
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  const row = await loadTournament(db, code);
  assert.ok(row);
  const passthrough = { ...defaultPassthrough(), original: { xml: '<tournament/>', state: '{}' } };
  db.raw
    .prepare('UPDATE tournaments SET state = ? WHERE code = ?')
    .run(JSON.stringify({ ...row.tournament, passthrough }), code);
  const read = await loadTournament(db, code);
  assert.deepEqual(read?.tournament.passthrough, defaultPassthrough());
});

function defaultPassthrough() {
  return {
    rootAttrs: [],
    extraData: [],
    timeElapsed: '0',
    playerExtras: {},
    podExtras: {},
    roundCodes: {},
    finalsOptions: ''
  };
}
