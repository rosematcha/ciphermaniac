/**
 * Stores and Community organizers through the functions, against the real
 * schema in SQLite. What must hold: any account may become a Community
 * organizer, and one runs only unsanctioned Swiss events of its own, one per
 * date and three a day, deleted ones counting; a store's Managers and Staff
 * start its events, sanctioned or not, and run every one of them; a store's
 * people come in once through a link, and it keeps one Owner, who alone
 * hands it over; a Community organizer may resign and join again;
 * its league nights publish to the locator's index; its listings and its
 * league come from the locator's files; and its organizer of record is one
 * of its people with a POP ID.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, mock, test } from 'node:test';

import * as community from '../../functions/api/community.ts';
import * as leagues from '../../functions/api/leagues/[id].ts';
import * as me from '../../functions/api/me.ts';
import * as storeRoute from '../../functions/api/stores/[id]/index.ts';
import * as listings from '../../functions/api/stores/[id]/listings.ts';
import * as members from '../../functions/api/stores/[id]/members.ts';
import * as nights from '../../functions/api/stores/[id]/nights.ts';
import * as join from '../../functions/api/stores/join.ts';
import * as commands from '../../functions/api/tournaments/[code]/commands.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as organizer from '../../functions/api/tournaments/[code]/organizer.ts';
import * as tournaments from '../../functions/api/tournaments/index.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import type { PublishBucket } from '../../functions/lib/types.ts';
import { leagueShardPath } from '../../shared/events/leagues.ts';
import { STORES_INDEX_KEY } from '../../shared/events/stores.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';
import { publishStores } from '../../functions/lib/stores/publish.ts';
import { storeApplication } from '../__utils__/storeApplication.ts';

let env: TournamentEnv;
let objects: Map<string, string>;
const { hit, signIn } = apiCalls(() => env);
const { newEvent, settle, storeOf } = eventCalls(hit);

/** A data bucket in memory: what the functions publish, and the locator's files a test puts there. */
function memoryBucket(): PublishBucket {
  return {
    head: async () => null,
    put: async (key, value) => {
      objects.set(key, value);
      return { etag: 'e' };
    },
    delete: async key => objects.delete(key),
    get: async key => {
      const value = objects.get(key);
      return value === undefined ? null : { text: async () => value };
    }
  };
}

beforeEach(() => {
  objects = new Map();
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true', REPORTS: memoryBucket() };
});

const raw = () => (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw;

const idOf = async (cookie: string) =>
  (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie })).json.user.id as string;

function create(cookie: string, body: Record<string, unknown>) {
  return hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    {
      method: 'POST',
      cookie,
      body: { mode: 'swiss', name: 'Friday Night', ...body }
    }
  );
}

const onDay = (day: number) => ({ settings: { startsAt: `2026-11-${String(day).padStart(2, '0')}T18:00` } });

const remove = (code: string, cookie: string) =>
  hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie });

test('any adult account becomes a Community organizer by asking; a removed one cannot, and a role stays', async () => {
  const player = await signIn('Player');
  const joined = await hit(
    community.onRequestPost as Handler,
    '/api/community',
    {},
    { method: 'POST', cookie: player }
  );
  assert.deepEqual([joined.status, joined.json.user.role], [200, 'community']);
  assert.equal((await create(player, onDay(1))).status, 201);
  const again = await hit(community.onRequestPost as Handler, '/api/community', {}, { method: 'POST', cookie: player });
  assert.equal(again.status, 409);
  const revoked = await signIn('Revoked', 'revoked');
  const refused = await hit(
    community.onRequestPost as Handler,
    '/api/community',
    {},
    { method: 'POST', cookie: revoked }
  );
  assert.deepEqual([refused.status, refused.json.error], [409, 'An admin removed your access']);
  assert.equal((await hit(community.onRequestPost as Handler, '/api/community', {}, { method: 'POST' })).status, 401);
  const foreign = await hit(
    community.onRequestPost as Handler,
    '/api/community',
    {},
    {
      method: 'POST',
      cookie: await signIn('Other'),
      origin: 'https://elsewhere.test'
    }
  );
  assert.equal(foreign.status, 403);
});

test('a Community organizer resigns: it starts no more events, keeps running its own, and may join again', async () => {
  const player = await signIn('Player', 'community');
  const resign = (cookie: string) =>
    hit(community.onRequestDelete as Handler, '/api/community', {}, { method: 'DELETE', cookie });
  const code = (await create(player, onDay(2))).json.code as string;
  const resigned = await resign(player);
  assert.deepEqual([resigned.status, resigned.json.user.role], [200, null]);
  assert.equal((await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: player })).json.user.role, null);
  assert.equal((await create(player, onDay(3))).status, 403, 'no new events under its own name');
  const own = await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: player });
  assert.deepEqual([own.status, own.json.role], [200, 'owner'], 'its event stays its own');
  assert.deepEqual(
    [(await resign(player)).status, (await resign(player)).json.error],
    [409, 'You are not a community organizer']
  );
  assert.equal((await resign(await signIn('Revoked', 'revoked'))).status, 409, 'removed access is not resigned away');
  assert.equal((await resign(await signIn('Boss', 'admin'))).status, 409, 'an Admin is not one');
  const back = await hit(community.onRequestPost as Handler, '/api/community', {}, { method: 'POST', cookie: player });
  assert.deepEqual([back.status, back.json.user.role], [200, 'community']);
  assert.equal(
    (await hit(community.onRequestDelete as Handler, '/api/community', {}, { method: 'DELETE' })).status,
    401
  );
});

test('a Community organizer’s events are unsanctioned Swiss events of no Play! Pokémon kind', async () => {
  const cookie = await signIn('Casual', 'community');
  const made = await create(cookie, { eventType: 'cup', ...onDay(1) });
  assert.equal(made.status, 201);
  const stored = raw().prepare('SELECT state, settings, store_id, community_day FROM tournaments').get() as Record<
    string,
    string
  >;
  assert.equal(JSON.parse(stored.settings).sanctioned, false, 'the default reads sanctioned; theirs never is');
  assert.equal(JSON.parse(stored.state).info.eventType, undefined);
  assert.deepEqual([stored.store_id, stored.community_day], [null, '2026-11-01']);
  const asked = await create(cookie, { ...onDay(2), settings: { sanctioned: true, startsAt: '2026-11-02T18:00' } });
  assert.deepEqual([asked.status, asked.json.error], [403, 'Only a store runs sanctioned events']);
  const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  assert.equal((await create(cookie, { mode: 'tom', tournament: tdf })).status, 403);
  const code = made.json.code as string;
  const turnedOn = await settle(code, cookie, { sanctioned: true });
  assert.deepEqual([turnedOn.status, turnedOn.json.error], [400, 'Only a store runs sanctioned events']);
});

test('a Community organizer holds one event a date: another date is free, and deleting frees the date', async () => {
  const cookie = await signIn('Casual', 'community');
  const first = await create(cookie, onDay(9));
  assert.equal(first.status, 201);
  const clash = await create(cookie, onDay(9));
  assert.deepEqual([clash.status, clash.json.error], [409, 'You already have an event that day']);
  assert.equal((await create(cookie, onDay(8))).status, 201);
  const tenth = await create(cookie, onDay(10));
  assert.equal(tenth.status, 201);
  const moved = await settle(tenth.json.code, cookie, { startsAt: '2026-11-09T12:00' });
  assert.deepEqual([moved.status, moved.json.error], [409, 'You already have an event that day']);
  assert.equal((await remove(first.json.code, cookie)).status, 204);
  assert.equal(
    (await settle(tenth.json.code, cookie, { startsAt: '2026-11-09T12:00' })).status,
    200,
    'the date is free'
  );
  const days = raw().prepare('SELECT community_day AS day FROM tournaments ORDER BY day').all() as { day: string }[];
  assert.deepEqual(
    days.map(row => row.day),
    ['2026-11-08', '2026-11-09']
  );
  const other = await signIn('Another', 'community');
  assert.equal((await create(other, onDay(9))).status, 201, 'the date is one owner’s, not everyone’s');
});

test('an event with no start time is on the organizer’s own today, as their browser says', async () => {
  const cookie = await signIn('Casual', 'community');
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await create(cookie, { today })).status, 201);
  assert.equal((await create(cookie, { today })).status, 409, 'today is held');
  const far = await create(cookie, { today: '1999-01-01', ...onDay(3) });
  assert.equal(far.status, 201);
  const days = raw().prepare('SELECT community_day AS day FROM tournaments ORDER BY day').all() as { day: string }[];
  assert.ok(days.some(row => row.day === today));
});

test('a Community organizer starts three events a day, deleted ones counting; an Admin has no limits', async () => {
  const cookie = await signIn('Casual', 'community');
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    const codes: string[] = [];
    for (const day of [1, 2, 3]) {
      const made = await create(cookie, onDay(day));
      assert.equal(made.status, 201);
      codes.push(made.json.code);
    }
    await remove(codes[0]!, cookie);
    const fourth = await create(cookie, onDay(4));
    assert.deepEqual(
      [fourth.status, fourth.json.error],
      [429, 'You’ve started as many events as you can today; try again tomorrow']
    );
    mock.timers.tick(24 * 60 * 60 * 1000 + 1);
    assert.equal((await create(cookie, onDay(4))).status, 201, 'a day later');
  } finally {
    mock.timers.reset();
  }
  const admin = await signIn('Admin', 'admin');
  for (const day of [1, 1, 1, 1]) {
    assert.equal((await create(admin, onDay(day))).status, 201);
  }
});

test('creations landing at once are let in three at most', async () => {
  const cookie = await signIn('Casual', 'community');
  const answers = await Promise.all([1, 2, 3, 4, 5, 6].map(day => create(cookie, onDay(day))));
  assert.equal(answers.filter(answer => answer.status === 201).length, 3);
  assert.equal(raw().prepare('SELECT COUNT(*) AS n FROM tournaments').get()?.n, 3);
});

test('a store’s people start its events, sanctioned or not, from TOM or not; others and a revoked store do not', async () => {
  const manager = await signIn('Manager', 'organizer');
  const store = (await storeOf(manager))!;
  raw()
    .prepare(
      "UPDATE stores SET city = 'San Antonio', region = 'TX', country = 'US', league_id = '6238620' WHERE id = ?"
    )
    .run(store);
  const listing = { sanctionId: '26-11-000123', kind: 'cup', name: 'Cup', date: '2026-11-15', time: '15:00' };
  objects.set(
    leagueShardPath('sanctioned', '20'),
    JSON.stringify({ version: 1, leagues: { 6238620: { listings: [listing] } } })
  );
  raw()
    .prepare("UPDATE users SET pop_id = '555', first_name = 'Mia', last_name = 'Lee' WHERE handle = 'manager'")
    .run();
  const elsewhere = await create(manager, { store, sanctionId: '26-11-000999' });
  assert.deepEqual(
    [elsewhere.status, elsewhere.json.error],
    [400, 'That sanction ID is not one pokemon.com lists for your league']
  );
  const made = await create(manager, { store, sanctionId: '26-11-000123', settings: { startsAt: '2026-11-15T15:00' } });
  assert.equal(made.status, 201);
  const row = raw().prepare('SELECT state, settings, store_id, community_day FROM tournaments').get() as Record<
    string,
    string
  >;
  const { info } = JSON.parse(row.state);
  assert.deepEqual(
    [info.city, info.state, info.country, info.startDate, info.sanctionId, info.organizerPopId, info.organizerName],
    ['San Antonio', 'TX', 'US', '11/15/2026', '26-11-000123', '555', 'Mia Lee']
  );
  assert.equal(JSON.parse(row.settings).sanctioned, true);
  assert.deepEqual([row.store_id, row.community_day], [store, null], 'a store’s events hold no date');
  assert.equal((await create(manager, { store, settings: { startsAt: '2026-11-15T19:00' } })).status, 201);
  const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
  assert.equal((await create(manager, { store, mode: 'tom', tournament: tdf })).status, 201);
  const stranger = await signIn('Stranger', 'community');
  const notIn = await create(stranger, { store, ...onDay(1) });
  assert.deepEqual([notIn.status, notIn.json.error], [403, 'You are not part of that store']);
  raw().prepare("UPDATE stores SET status = 'revoked' WHERE id = ?").run(store);
  assert.equal((await create(manager, { store })).status, 403);
});

test('a store starts twenty events a day', async () => {
  const manager = await signIn('Manager', 'organizer');
  const store = (await storeOf(manager))!;
  for (let i = 0; i < 20; i += 1) {
    assert.equal((await create(manager, { store })).status, 201);
  }
  assert.equal((await create(manager, { store })).status, 429);
});

/** A store with a Manager and a Staff member, through an invite as a store would. */
async function staffedStore() {
  const manager = await signIn('Manager', 'organizer');
  const store = (await storeOf(manager))!;
  const invite = await hit(
    members.onRequestPost as Handler,
    '/members',
    { id: store },
    {
      method: 'POST',
      cookie: manager,
      body: { invite: 'staff' }
    }
  );
  assert.equal(invite.status, 201);
  const helper = await signIn('Helper');
  const joined = await hit(
    join.onRequestPost as Handler,
    '/api/stores/join',
    {},
    {
      method: 'POST',
      cookie: helper,
      body: { token: invite.json.token }
    }
  );
  assert.deepEqual(joined.json, { storeId: store });
  return { manager, helper, store, token: invite.json.token as string };
}

test('a store’s Staff run every event the store runs; its Managers are as its organizer', async () => {
  const { manager, helper, store } = await staffedStore();
  const code = await newEvent(manager, { store });
  const asHelper = await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: helper });
  assert.equal(asHelper.status, 200, 'Staff see the console');
  assert.equal(asHelper.json.role, 'staff');
  assert.equal((await remove(code, helper)).status, 403, 'deleting is the organizer’s');
  const second = await signIn('Second');
  raw()
    .prepare("INSERT INTO store_members (store_id, user_id, role, added_at) VALUES (?, ?, 'manager', 1)")
    .run(store, await idOf(second));
  const listed = await hit(tournaments.onRequestGet as Handler, '/api/tournaments', {}, { cookie: second });
  assert.deepEqual(
    listed.json.tournaments.map((one: { code: string; role: string }) => [one.code, one.role]),
    [[code, 'owner']],
    'another Manager lists it as theirs'
  );
  assert.equal((await remove(code, second)).status, 204);
  const outsider = await signIn('Outsider');
  const other = await newEvent(manager, { store });
  assert.equal((await hit(manage.onRequestGet as Handler, '/manage', at(other), { cookie: outsider })).status, 403);
});

test('a store’s event is the store’s: Staff who started it are its staff, and leave it as they leave the store', async () => {
  const { manager, helper, store } = await staffedStore();
  const code = await newEvent(helper, { store });
  const asHelper = await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: helper });
  assert.equal(asHelper.json.role, 'staff', 'starting it makes no one its organizer');
  assert.equal((await remove(code, helper)).status, 403);
  const asManager = await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: manager });
  assert.equal(asManager.json.role, 'owner');
  await hit(
    members.onRequestDelete as Handler,
    `/members?user=${await idOf(helper)}`,
    { id: store },
    {
      method: 'DELETE',
      cookie: manager
    }
  );
  assert.equal((await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: helper })).status, 403);
  const listed = await hit(tournaments.onRequestGet as Handler, '/api/tournaments', {}, { cookie: helper });
  assert.deepEqual(listed.json.tournaments, [], 'gone from their list too');
});

test('an invite lets one person in, once and for a week, as what it was made for', async () => {
  const { manager, store, token } = await staffedStore();
  const late = await signIn('Late');
  const reused = await hit(
    join.onRequestPost as Handler,
    '/api/stores/join',
    {},
    {
      method: 'POST',
      cookie: late,
      body: { token }
    }
  );
  assert.equal(reused.status, 410, 'used up');
  const fresh = await hit(
    members.onRequestPost as Handler,
    '/members',
    { id: store },
    {
      method: 'POST',
      cookie: manager,
      body: { invite: 'manager' }
    }
  );
  const listed = await hit(members.onRequestGet as Handler, '/members', { id: store }, { cookie: manager });
  assert.equal(listed.json.invites.length, 1);
  await hit(
    members.onRequestDelete as Handler,
    `/members?invite=${listed.json.invites[0].id}`,
    { id: store },
    {
      method: 'DELETE',
      cookie: manager
    }
  );
  const withdrawn = await hit(
    join.onRequestPost as Handler,
    '/api/stores/join',
    {},
    {
      method: 'POST',
      cookie: late,
      body: { token: fresh.json.token }
    }
  );
  assert.equal(withdrawn.status, 410, 'withdrawn');
  const bad = await hit(
    members.onRequestPost as Handler,
    '/members',
    { id: store },
    {
      method: 'POST',
      cookie: manager,
      body: { invite: 'owner' }
    }
  );
  assert.equal(bad.status, 400);
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    const made = await hit(
      members.onRequestPost as Handler,
      '/members',
      { id: store },
      {
        method: 'POST',
        cookie: manager,
        body: { invite: 'manager' }
      }
    );
    mock.timers.tick(7 * 24 * 60 * 60 * 1000 + 1);
    const expired = await hit(
      join.onRequestPost as Handler,
      '/api/stores/join',
      {},
      {
        method: 'POST',
        cookie: late,
        body: { token: made.json.token }
      }
    );
    assert.equal(expired.status, 410, 'ran out');
  } finally {
    mock.timers.reset();
  }
});

const OWNER_STAYS = 'The owner stays until they hand the store to someone else';

/** The members route as `cookie`, at the store. */
function memberCalls(store: string) {
  const at = { id: store };
  return {
    patch: (cookie: string, body: Record<string, unknown>) =>
      hit(members.onRequestPatch as Handler, '/members', at, { method: 'PATCH', cookie, body }),
    remove: (cookie: string, user: string) =>
      hit(members.onRequestDelete as Handler, `/members?user=${user}`, at, { method: 'DELETE', cookie }),
    invite: async (cookie: string, role: string) =>
      (await hit(members.onRequestPost as Handler, '/members', at, { method: 'POST', cookie, body: { invite: role } }))
        .json.token as string,
    roles: async (cookie: string) =>
      (await hit(members.onRequestGet as Handler, '/members', at, { cookie })).json.members.map(
        (one: { name: string; role: string }) => [one.name, one.role]
      )
  };
}

const joinWith = async (cookie: string, token: string) =>
  hit(join.onRequestPost as Handler, '/api/stores/join', {}, { method: 'POST', cookie, body: { token } });

test('a store keeps its Owner, never demoted or removed; Staff leave by themselves and manage nothing', async () => {
  const { manager: owner, helper, store } = await staffedStore();
  const ownerId = await idOf(owner);
  const helperId = await idOf(helper);
  const at = { id: store };
  const { patch, remove: out, invite } = memberCalls(store);
  const demote = await patch(owner, { user: ownerId, role: 'staff' });
  assert.deepEqual([demote.status, demote.json.error], [409, OWNER_STAYS]);
  assert.equal((await out(owner, ownerId)).status, 409, 'the Owner does not leave without handing over');
  assert.equal((await hit(members.onRequestGet as Handler, '/members', at, { cookie: helper })).status, 403);
  assert.equal((await out(helper, ownerId)).status, 403, 'Staff take no one else out');
  const token = await invite(owner, 'staff');
  const [open] = (await hit(members.onRequestGet as Handler, '/members', at, { cookie: owner })).json.invites;
  const sneaky = await hit(members.onRequestDelete as Handler, `/members?user=${helperId}&invite=${open.id}`, at, {
    method: 'DELETE',
    cookie: helper
  });
  assert.equal(sneaky.status, 403, 'leaving does not cover withdrawing a Manager’s link');
  assert.equal((await joinWith(await signIn('Newcomer'), token)).status, 200);
  const stranger = await patch(owner, { user: 'nobody', role: 'manager' });
  assert.deepEqual([stranger.status, stranger.json.error], [404, 'No one by that ID is in this store']);
  const promoted = await patch(owner, { user: helperId, role: 'manager' });
  assert.deepEqual(
    promoted.json.members.map((one: { name: string; role: string }) => [one.name, one.role]),
    [
      ['manager', 'owner'],
      ['helper', 'manager'],
      ['newcomer', 'staff']
    ],
    'the Owner first, then Managers, then Staff'
  );
  assert.equal((await patch(helper, { user: ownerId, role: 'staff' })).status, 409, 'a Manager demotes no Owner');
  assert.equal((await out(helper, ownerId)).status, 409, 'a Manager removes no Owner');
  assert.equal((await patch(owner, { user: ownerId, role: 'manager' })).status, 409, 'nor does the Owner, in place');
  assert.equal((await out(helper, helperId)).status, 204, 'a Manager who is not the Owner may go');
});

test('only the Owner hands the store over, to someone in it, who becomes the Owner as the Owner becomes a Manager', async () => {
  const { manager: owner, helper, store } = await staffedStore();
  const ownerId = await idOf(owner);
  const helperId = await idOf(helper);
  const { patch, remove: out, roles } = memberCalls(store);
  assert.equal((await patch(owner, { user: helperId, role: 'manager' })).status, 200);
  const refused = await patch(helper, { user: helperId, role: 'owner' });
  assert.deepEqual(
    [refused.status, refused.json.error],
    [403, 'Only this store’s owner can hand it over'],
    'a Manager takes no store'
  );
  assert.equal((await patch(owner, { user: 'nobody', role: 'owner' })).status, 404);
  const handed = await patch(owner, { user: helperId, role: 'owner' });
  assert.equal(handed.status, 200);
  assert.deepEqual(await roles(helper), [
    ['helper', 'owner'],
    ['manager', 'manager']
  ]);
  const [mine] = (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie: owner })).json.user.stores;
  assert.equal(mine.role, 'manager', 'the session says so');
  const code = await newEvent(helper, { store });
  const asNew = await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: helper });
  assert.equal(asNew.json.role, 'owner', 'the new Owner is as the store’s organizer');
  assert.equal(
    (await patch(owner, { user: ownerId, role: 'owner' })).status,
    403,
    'nor can the Owner before take it back'
  );
  assert.equal((await out(helper, helperId)).status, 409, 'the new Owner stays');
  assert.equal((await out(owner, ownerId)).status, 204, 'the Owner before may now go');
  assert.equal(
    raw().prepare("SELECT COUNT(*) AS n FROM store_members WHERE store_id = ? AND role = 'owner'").get(store)?.n,
    1
  );
});

test('a hand-over that lands after another leaves the store one Owner', async () => {
  const { manager: owner, helper, store } = await staffedStore();
  const { patch, invite } = memberCalls(store);
  const other = await signIn('Other');
  assert.equal((await joinWith(other, await invite(owner, 'staff'))).status, 200);
  const [ownerId, helperId, otherId] = [await idOf(owner), await idOf(helper), await idOf(other)];
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  // The Owner's other tab hands the store to Other after this request read the Owner as the Owner.
  env.TOURNAMENT_DB = racing(db, "UPDATE store_members SET role = 'manager'", () => {
    db.raw.prepare("UPDATE store_members SET role = 'manager' WHERE user_id = ?").run(ownerId);
    db.raw.prepare("UPDATE store_members SET role = 'owner' WHERE user_id = ?").run(otherId);
  });
  const late = await patch(owner, { user: helperId, role: 'owner' });
  assert.deepEqual([late.status, late.json.error], [409, 'The store was not handed over']);
  const owners = raw()
    .prepare("SELECT user_id FROM store_members WHERE store_id = ? AND role = 'owner'")
    .all(store)
    .map(row => row.user_id);
  assert.deepEqual(owners, [otherId]);
});

test('an Owner who opens a manager invite stays the Owner; Staff who open one become Managers', async () => {
  const { manager: owner, helper, store } = await staffedStore();
  const { invite, roles } = memberCalls(store);
  assert.equal((await joinWith(owner, await invite(owner, 'manager'))).status, 200);
  assert.equal((await joinWith(helper, await invite(owner, 'manager'))).status, 200);
  assert.equal((await joinWith(helper, await invite(owner, 'staff'))).status, 200);
  assert.deepEqual(await roles(owner), [
    ['manager', 'owner'],
    ['helper', 'manager']
  ]);
});

test('a store says what it is to anyone, its contact details to its people, and changes only by a Manager', async () => {
  const { manager, helper, store } = await staffedStore();
  const at = { id: store };
  const app = storeApplication();
  const changed = await hit(storeRoute.onRequestPatch as Handler, `/api/stores/${store}`, at, {
    method: 'PATCH',
    cookie: manager,
    body: { details: app.details, timeZone: 'America/Chicago' }
  });
  assert.equal(changed.json.store.name, 'Combat Power Gaming');
  const refused = await hit(storeRoute.onRequestPatch as Handler, `/api/stores/${store}`, at, {
    method: 'PATCH',
    cookie: helper,
    body: { details: app.details, timeZone: 'America/Chicago' }
  });
  assert.equal(refused.status, 403);
  const placed = await hit(storeRoute.onRequestPatch as Handler, `/api/stores/${store}`, at, {
    method: 'PATCH',
    cookie: manager,
    body: {
      details: app.details,
      timeZone: 'America/Chicago',
      place: { lat: 29.49, lon: -98.55, timeZone: 'America/Chicago' }
    }
  });
  assert.deepEqual(
    [placed.json.store.lat, placed.json.store.lon],
    [29.49, -98.55],
    'a Manager sets where it is on the map'
  );
  const kept = await hit(storeRoute.onRequestPatch as Handler, `/api/stores/${store}`, at, {
    method: 'PATCH',
    cookie: manager,
    body: { details: app.details, timeZone: 'America/Chicago' }
  });
  assert.equal(kept.json.store.lat, 29.49, 'and it stays when a change does not say');
  const badZone = await hit(storeRoute.onRequestPatch as Handler, `/api/stores/${store}`, at, {
    method: 'PATCH',
    cookie: manager,
    body: { details: app.details, timeZone: 'Nowhere/Land' }
  });
  assert.equal(badZone.status, 400);
  const open = await hit(storeRoute.onRequestGet as Handler, `/api/stores/${store}`, at);
  assert.equal(open.json.store.name, 'Combat Power Gaming');
  assert.equal(open.json.contact, undefined, 'no phone or email for the public');
  assert.equal(open.json.store.phone, undefined);
  const inside = await hit(storeRoute.onRequestGet as Handler, `/api/stores/${store}`, at, { cookie: helper });
  assert.deepEqual([inside.json.role, inside.json.contact.phone], ['staff', '210-555-0100']);
  assert.equal((await hit(storeRoute.onRequestGet as Handler, '/api/stores/nope', { id: 'nope' })).status, 404);
});

test('league nights are a Manager’s to set; past exceptions drop and the locator’s index follows', async () => {
  const { manager, helper, store } = await staffedStore();
  const at = { id: store };
  const app = storeApplication();
  const put = (cookie: string, body: unknown) =>
    hit(nights.onRequestPut as Handler, '/nights', at, { method: 'PUT', cookie, body });
  const saved = await put(manager, {
    nights: app.nights,
    exceptions: [
      { date: '2000-01-02', nightId: 'sun', time: null, note: 'Long ago' },
      { date: '2099-01-04', nightId: 'sun', time: null, note: 'League Cup' },
      { date: '2099-01-07', nightId: null, time: '18:00', note: '' }
    ]
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(
    saved.json.exceptions.map((one: { date: string }) => one.date),
    ['2099-01-04', '2099-01-07']
  );
  assert.equal((await put(helper, { nights: app.nights })).status, 403);
  assert.equal(
    (await put(manager, { nights: [{ id: 'x', weekday: 7, time: '19:00', name: '', fee: '' }] })).status,
    400
  );
  const unknownNight = await put(manager, {
    nights: app.nights,
    exceptions: [{ date: '2099-01-04', nightId: 'fri', time: null, note: '' }]
  });
  assert.equal(unknownNight.status, 400);
  const index = JSON.parse(objects.get(STORES_INDEX_KEY) ?? '{}');
  assert.deepEqual(
    index.stores.map((one: { id: string; nights: unknown[]; exceptions: unknown[] }) => [
      one.id,
      one.nights.length,
      one.exceptions.length
    ]),
    [[store, 2, 2]]
  );
  raw().prepare("UPDATE stores SET status = 'revoked'").run();
  await put(manager, { nights: app.nights });
  assert.deepEqual(JSON.parse(objects.get(STORES_INDEX_KEY) ?? '{}').stores, [], 'a revoked store leaves the locator');
});

test('a store’s listings and its league come from the locator’s files', async () => {
  const { helper, store } = await staffedStore();
  raw().prepare("UPDATE stores SET league_id = '6238620' WHERE id = ?").run(store);
  const entry = (listings: unknown[]) => ({
    version: 1,
    generatedAt: '',
    leagues: {
      6238620: {
        shop: 'COMBAT POWER GAMING',
        address: '4522 FREDERICKSBURG RD',
        city: 'San Antonio',
        region: 'Texas',
        cc: 'US',
        lat: 29.49,
        lon: -98.55,
        timeZone: 'America/Chicago',
        listings
      }
    }
  });
  const cup = { sanctionId: '26-12-000001', kind: 'cup', name: 'Combat Power Cup', date: '2099-12-06', time: '11:00' };
  const local = {
    sanctionId: '26-12-000002',
    kind: 'local',
    name: 'Combat Power Locals',
    date: '2099-12-03',
    time: '19:30'
  };
  const past = { sanctionId: '26-01-000003', kind: 'local', name: 'Old', date: '2000-01-01', time: '19:30' };
  objects.set(leagueShardPath('sanctioned', '20'), JSON.stringify(entry([cup])));
  objects.set(leagueShardPath('locals', '20'), JSON.stringify(entry([local, past, cup])));
  const listed = await hit(listings.onRequestGet as Handler, '/listings', { id: store }, { cookie: helper });
  assert.deepEqual(
    listed.json.listings.map((one: { sanctionId: string }) => one.sanctionId),
    ['26-12-000002', '26-12-000001'],
    'from today, soonest first, each once'
  );
  assert.equal((await hit(listings.onRequestGet as Handler, '/listings', { id: store })).status, 401);
  const url = encodeURIComponent('https://www.pokemon.com/us/play-pokemon/pokemon-events/leagues/6238620/');
  const found = await hit(leagues.onRequestGet as Handler, `/api/leagues/${url}`, { id: url }, { cookie: helper });
  assert.deepEqual(
    [found.json.leagueId, found.json.league.shop, found.json.league.timeZone, found.json.taken],
    ['6238620', 'COMBAT POWER GAMING', 'America/Chicago', true]
  );
  const unknown = await hit(
    leagues.onRequestGet as Handler,
    '/api/leagues/1234567',
    { id: '1234567' },
    { cookie: helper }
  );
  assert.deepEqual([unknown.json.league, unknown.json.taken], [null, false]);
  assert.equal(
    (await hit(leagues.onRequestGet as Handler, '/api/leagues/abc', { id: 'abc' }, { cookie: helper })).status,
    400
  );
  assert.equal((await hit(leagues.onRequestGet as Handler, '/api/leagues/1234567', { id: '1234567' })).status, 401);
  delete env.REPORTS;
  const unbound = await hit(listings.onRequestGet as Handler, '/listings', { id: store }, { cookie: helper });
  assert.deepEqual(unbound.json.listings, [], 'without the bucket, none');
});

test('a store’s organizer of record is one of its people with a POP ID', async () => {
  const { manager, helper, store } = await staffedStore();
  const helperId = await idOf(helper);
  const code = await newEvent(manager, { store });
  const name = (user: string) =>
    hit(organizer.onRequestPut as Handler, '/organizer', at(code), { method: 'PUT', cookie: manager, body: { user } });
  const noPop = await name(helperId);
  assert.deepEqual([noPop.status, noPop.json.error], [400, 'Pick someone from the store with a POP ID on file']);
  raw().prepare("UPDATE users SET pop_id = '777', first_name = 'Hal', last_name = 'Per' WHERE id = ?").run(helperId);
  assert.equal((await name(helperId)).status, 200);
  const { info } = JSON.parse(
    (raw().prepare('SELECT state FROM tournaments WHERE code = ?').get(code) as { state: string }).state
  );
  assert.deepEqual([info.organizerPopId, info.organizerName], ['777', 'Hal Per']);
  const outsider = await signIn('Outsider');
  raw().prepare("UPDATE users SET pop_id = '778' WHERE handle = 'outsider'").run();
  assert.equal((await name(await idOf(outsider))).status, 400, 'not one of the store’s');
  const casual = await signIn('Casual', 'community');
  const own = await newEvent(casual, onDay(1));
  const refused = await hit(organizer.onRequestPut as Handler, '/organizer', at(own), {
    method: 'PUT',
    cookie: casual,
    body: { user: await idOf(casual) }
  });
  assert.equal(refused.status, 400);
});

test('a Community organizer’s event takes no Play! Pokémon kind or other date from an edit; the public copy has no organizer name', async () => {
  const cookie = await signIn('Casual', 'community');
  const code = await newEvent(cookie, onDay(5));
  const edited = await hit(commands.onRequestPost as Handler, '/commands', at(code), {
    method: 'POST',
    cookie,
    body: { command: { type: 'updateInfo', info: { name: 'Renamed', eventType: 'cup', startDate: '01/01/2030' } } }
  });
  assert.equal(edited.status, 200);
  const { info } = JSON.parse(
    (raw().prepare('SELECT state FROM tournaments WHERE code = ?').get(code) as { state: string }).state
  );
  assert.deepEqual([info.name, info.eventType, info.startDate === '01/01/2030'], ['Renamed', undefined, false]);
  const manager = await signIn('Manager', 'organizer');
  raw()
    .prepare("UPDATE users SET first_name = 'Mia', last_name = 'Lee', pop_id = '555' WHERE handle = 'manager'")
    .run();
  const storeEvent = await newEvent(manager, { store: (await storeOf(manager))! });
  const shown = await hit(event.onRequestGet as Handler, `/api/tournaments/${storeEvent}`, at(storeEvent));
  assert.deepEqual(
    [shown.json.tournament.info.organizerName, shown.json.tournament.info.organizerPopId],
    ['', ''],
    'the organizer of record stays in the staff copy'
  );
});

const managerRaces = [
  {
    name: 'invite creation',
    prefix: 'INSERT INTO store_invites',
    handler: members.onRequestPost,
    method: 'POST',
    body: { invite: 'manager' }
  },
  {
    name: 'self promotion',
    prefix: 'UPDATE store_members SET role',
    handler: members.onRequestPatch,
    method: 'PATCH',
    body: {}
  },
  {
    name: 'details update',
    prefix: 'UPDATE stores SET name',
    handler: storeRoute.onRequestPatch,
    method: 'PATCH',
    body: { details: storeApplication().details, timeZone: 'America/Chicago' }
  },
  {
    name: 'nights update',
    prefix: 'UPDATE stores SET nights',
    handler: nights.onRequestPut,
    method: 'PUT',
    body: { nights: storeApplication().nights }
  }
];

managerRaces.forEach(scenario => {
  test(`a demoted Manager cannot finish a delayed ${scenario.name}`, async () => {
    const { manager, store } = await staffedStore();
    const managerId = await idOf(manager);
    const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
    env.TOURNAMENT_DB = racing(db, scenario.prefix, () => {
      db.raw.prepare("UPDATE store_members SET role = 'staff' WHERE user_id = ?").run(managerId);
    });
    const response = await hit(
      scenario.handler as Handler,
      '/members',
      { id: store },
      {
        method: scenario.method,
        cookie: manager,
        body: scenario.name === 'self promotion' ? { user: managerId, role: 'manager' } : scenario.body
      }
    );
    assert.ok(response.status >= 400);
    assert.equal(db.raw.prepare('SELECT role FROM store_members WHERE user_id = ?').get(managerId)?.role, 'staff');
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM store_invites').get()?.n, 0);
    assert.equal(db.raw.prepare('SELECT name FROM stores WHERE id = ?').get(store)?.name, 'Manager Games');
  });
});

test('a removed Manager cannot remove staff with a request authorized before removal', async () => {
  const { manager, helper, store } = await staffedStore();
  const managerId = await idOf(manager);
  const helperId = await idOf(helper);
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  env.TOURNAMENT_DB = racing(db, 'DELETE FROM store_members', () => {
    db.raw.prepare('DELETE FROM store_members WHERE user_id = ?').run(managerId);
  });
  const response = await hit(
    members.onRequestDelete as Handler,
    `/members?user=${helperId}`,
    { id: store },
    {
      method: 'DELETE',
      cookie: manager
    }
  );
  assert.equal(response.status, 409);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM store_members WHERE user_id = ?').get(helperId)?.n, 1);
});

test('a stores publisher retries a failed conditional write after an older snapshot wins', async () => {
  const manager = await signIn('Manager', 'organizer');
  const store = await storeOf(manager);
  let puts = 0;
  let heads = 0;
  let written = '';
  env.REPORTS = {
    head: async () => {
      heads += 1;
      return { etag: heads === 1 ? 'initial' : 'older', customMetadata: { updatedAt: '2000-01-01T00:00:00.000Z' } };
    },
    put: async (_key, value, options) => {
      puts += 1;
      if (puts === 1) {
        raw().prepare('UPDATE stores SET name = ? WHERE id = ?').run('Latest Games', store);
        return null;
      }
      assert.deepEqual(options.onlyIf, { etagMatches: 'older' });
      written = value;
      return { etag: 'newer' };
    },
    delete: async () => undefined
  };
  await publishStores({ env });
  assert.equal(puts, 2);
  assert.ok(JSON.parse(written).updatedAt > '2000-01-01T00:00:00.000Z');
  assert.equal(JSON.parse(written).stores[0].name, 'Latest Games');
});

test('same-millisecond publication reads the current database after acquiring its conditional-write ETag', async () => {
  const manager = await signIn('Manager', 'organizer');
  const store = await storeOf(manager);
  const now = new Date().toISOString();
  let written = '';
  env.REPORTS = {
    head: async () => {
      raw().prepare('UPDATE stores SET name = ? WHERE id = ?').run('Latest Games', store);
      return { etag: 'latest', customMetadata: { updatedAt: now } };
    },
    put: async (_key, value) => {
      written = value;
      return { etag: 'next' };
    },
    delete: async () => undefined
  };
  mock.timers.enable({ apis: ['Date'], now: Date.parse(now) });
  try {
    await publishStores({ env });
    assert.equal(JSON.parse(written).stores[0].name, 'Latest Games');
  } finally {
    mock.timers.reset();
  }
});
