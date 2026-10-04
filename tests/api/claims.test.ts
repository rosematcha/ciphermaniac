/**
 * An account as a player at an event, end to end against the real schema in
 * SQLite. What must hold: at an unsanctioned event, saying who you are while
 * signed in is a Claim, on the same first-come terms as a device; at a
 * sanctioned one, an account is the player whose POP ID it holds and no
 * other; the account then reports from any of its devices; an account is one
 * player per event; a finished event takes no new Claims; and the account,
 * staff, or the player leaving the list undoes one.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as me from '../../functions/api/me.ts';
import * as claim from '../../functions/api/tournaments/[code]/claim.ts';
import * as decklists from '../../functions/api/tournaments/[code]/decklists.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as report from '../../functions/api/tournaments/[code]/report.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import type { Viewer } from '../../shared/tournament/view.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { countingTrips, racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, send, addPlayers, settle, playerSays, view } = eventCalls(hit);

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
  decklists._resetRateLimitStore();
  report._resetRateLimitStore();
  event._resetRateLimitStore();
});

const raw = () => (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw;

/** Which account, if any, holds each reporter row at `code`, by player ID. */
const holders = (code: string) =>
  Object.fromEntries(
    (
      raw().prepare('SELECT player_id, user_id FROM report_devices WHERE code = ? ORDER BY player_id').all(code) as {
        player_id: string;
        user_id: string | null;
      }[]
    ).map(row => [row.player_id, row.user_id])
  );

const accountId = async (cookie: string) =>
  (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie })).json.user.id as string;

/** An unsanctioned event with Ash Ketchum, Gary Oak, Misty Waterflower and Brock Harrison, players reporting. */
async function casualEvent() {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { sanctioned: false, playerReporting: true });
  for (const [firstName, lastName] of [
    ['Ash', 'Ketchum'],
    ['Gary', 'Oak'],
    ['Misty', 'Waterflower'],
    ['Brock', 'Harrison']
  ]) {
    await send(code, owner, { type: 'addPlayer', player: { firstName, lastName } });
  }
  const roster = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json;
  const idOf = (lastName: string) =>
    roster.tournament.players.find((p: { lastName: string }) => p.lastName === lastName).id as string;
  return { owner, code, idOf };
}

/** Pairs round 1, and the match `id` plays in it. */
async function pair(code: string, owner: string, id: string) {
  const paired = await send(code, owner, { type: 'pairRound', pod: 'masters' });
  return paired.json.tournament.pods[0].rounds[0].matches.find(
    (m: { p1: string; p2: string }) => m.p1 === id || m.p2 === id
  ) as { p1: string; p2: string; table: number };
}

test('saying who you are while signed in at an unsanctioned event is a Claim', async () => {
  const { code, idOf } = await casualEvent();
  const ash = await signIn('Ash');
  const said = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  assert.equal(said.status, 200);
  assert.deepEqual([said.json.reporter, said.json.linked, typeof said.json.reportToken], [true, true, 'string']);
  assert.deepEqual(holders(code), { [idOf('Ketchum')]: await accountId(ash) });

  const gary = await signIn('Gary');
  const imposter = await playerSays(code, { lastName: 'Ketchum', device: 'gary-phone' }, { cookie: gary });
  assert.deepEqual([imposter.json.reporter, imposter.json.linked], [false, false], 'first come');
  const anonymous = await playerSays(code, { lastName: 'Oak', device: 'gary-phone' });
  assert.deepEqual([anonymous.json.reporter, anonymous.json.linked], [true, false], 'signed out is a device only');
});

test('the linked account reports from a device with no token', async () => {
  const { owner, code, idOf } = await casualEvent();
  const ash = await signIn('Ash');
  await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  await pair(code, owner, idOf('Ketchum'));
  const fromLaptop = await playerSays(
    code,
    { lastName: 'Ketchum', result: 'win', device: 'ash-laptop', reportToken: null },
    { cookie: ash }
  );
  assert.equal(fromLaptop.status, 200);
  assert.deepEqual([fromLaptop.json.reporter, fromLaptop.json.linked], [true, true]);
  assert.equal(fromLaptop.json.reportToken, undefined, 'no new token: the account is the reporter');
  const signedOut = await playerSays(code, { lastName: 'Ketchum', result: 'loss', device: 'ash-laptop' });
  assert.equal(signedOut.status, 403, 'the same laptop signed out is no one');
});

test('an account is one player per event', async () => {
  const { code, idOf } = await casualEvent();
  const ash = await signIn('Ash');
  const first = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  const second = await playerSays(code, { lastName: 'Oak', device: 'ash-phone' }, { cookie: ash });
  assert.equal(second.status, 409);
  assert.equal(second.json.error, 'You’re linked to another player here');
  assert.equal(second.json.linkedKey, first.json.key, 'naming the player it is linked to');
  assert.deepEqual(Object.keys(holders(code)), [idOf('Ketchum')], 'Gary is still free');
  const again = await playerSays(code, { lastName: 'Ketchum', device: 'ash-tablet' }, { cookie: ash });
  assert.deepEqual([again.status, again.json.linked], [200, true], 'its own player again is fine');
});

test('a device that came first keeps the player from a signed-in account', async () => {
  const { code, idOf } = await casualEvent();
  await playerSays(code, { lastName: 'Ketchum', device: 'someone' });
  const ash = await signIn('Ash');
  const said = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  assert.deepEqual([said.json.reporter, said.json.linked], [false, false]);
  assert.deepEqual(holders(code), { [idOf('Ketchum')]: null });
});

test('a device that said who it was before signing in becomes the account’s Claim when it asks again', async () => {
  const { code, idOf } = await casualEvent();
  const before = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' });
  assert.equal(before.json.linked, false);
  const ash = await signIn('Ash');
  const token = before.json.reportToken as string;
  const without = await playerSays(code, { lastName: 'Ketchum', device: 'ash-laptop' }, { cookie: ash });
  assert.equal(without.json.linked, false, 'another device of the account, without the token, is not the claimer');
  const upgraded = await playerSays(
    code,
    { lastName: 'Ketchum', device: 'ash-phone', reportToken: token },
    { cookie: ash }
  );
  assert.deepEqual([upgraded.json.reporter, upgraded.json.linked], [true, true]);
  assert.deepEqual(holders(code), { [idOf('Ketchum')]: await accountId(ash) });
});

test('a device’s claim is not upgraded into a second player for an account linked elsewhere', async () => {
  const { code, idOf } = await casualEvent();
  const oak = await playerSays(code, { lastName: 'Oak', device: 'shared-phone' });
  const ash = await signIn('Ash');
  await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  const refused = await playerSays(
    code,
    { lastName: 'Oak', device: 'shared-phone', reportToken: oak.json.reportToken },
    { cookie: ash }
  );
  assert.equal(refused.status, 409);
  assert.equal(holders(code)[idOf('Oak')], null);
});

test('staff releasing a player, or taking them off the list, undoes the Claim', async () => {
  const { owner, code, idOf } = await casualEvent();
  const ash = await signIn('Ash');
  await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  const released = await hit(report.onRequestDelete as Handler, `/report?player=${idOf('Ketchum')}`, at(code), {
    method: 'DELETE',
    cookie: owner
  });
  assert.equal(released.status, 204);
  assert.deepEqual(holders(code), {});
  await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  assert.equal((await send(code, owner, { type: 'removePlayer', id: idOf('Ketchum') })).status, 200);
  assert.deepEqual(holders(code), {});
  const freed = await playerSays(code, { lastName: 'Oak', device: 'ash-phone' }, { cookie: ash });
  assert.equal(freed.json.linked, true, 'the account may be someone else here now');
});

test('a finished event takes no new Claim', async () => {
  const { owner, code, idOf } = await casualEvent();
  await settle(code, owner, { finished: true });
  const ash = await signIn('Ash');
  const said = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  assert.equal(said.status, 200, 'the page still follows the player');
  assert.equal(said.json.linked, false);
  assert.deepEqual(holders(code), { [idOf('Ketchum')]: null });
});

const profileOf = (popId: string) => ({ popId, firstName: 'Player', lastName: '0', birthDate: '02/27/1990' });

test('at a sanctioned event an account is the player whose POP ID it holds, and only while it holds it', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { playerReporting: true });
  await addPlayers(code, owner, 4);
  const player = await signIn('Player');
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: player, body: profileOf('900') });
  const other = await playerSays(code, { popId: '901', device: 'phone' }, { cookie: player });
  assert.deepEqual([other.json.reporter, other.json.linked], [true, false], 'someone else’s Player ID links nothing');
  const own = await playerSays(code, { popId: '900', device: 'phone' }, { cookie: player });
  assert.deepEqual([own.json.reporter, own.json.linked], [true, true]);
  await pair(code, owner, '900');
  const elsewhere = await playerSays(code, { popId: '900', result: 'win', device: 'laptop' }, { cookie: player });
  assert.equal(elsewhere.status, 200, 'it reports from any device');

  // The POP ID taken off the account by hand, leaving its row: the row no longer makes it the player.
  raw().exec("UPDATE users SET pop_id = '777' WHERE name = 'Player'");
  const stale = await playerSays(code, { popId: '900', result: 'loss', device: 'laptop' }, { cookie: player });
  assert.equal(stale.status, 403);
  raw().exec("UPDATE users SET pop_id = '900' WHERE name = 'Player'");
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: player, body: profileOf('778') });
  assert.equal(holders(code)['900'], undefined, 'saving another POP ID lets the row go');
});

const unclaim = (code: string, cookie?: string, origin?: string) =>
  hit(claim.onRequestDelete as Handler, '/claim', at(code), { method: 'DELETE', cookie, origin });

test('the account undoes its own Claim, even once the event is over, and nobody else’s', async () => {
  const { owner, code, idOf } = await casualEvent();
  const ash = await signIn('Ash');
  const gary = await signIn('Gary');
  await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  await playerSays(code, { lastName: 'Oak', device: 'gary-phone' }, { cookie: gary });
  assert.equal((await unclaim(code)).status, 401);
  assert.equal((await unclaim(code, ash, 'https://evil.test')).status, 403);
  assert.equal((await unclaim('ZZZZZZ', ash)).status, 404);
  await settle(code, owner, { finished: true });
  assert.equal((await unclaim(code, ash)).status, 204);
  assert.deepEqual(holders(code), { [idOf('Oak')]: await accountId(gary) }, 'Gary’s Claim stands');
  assert.equal((await unclaim(code, ash)).status, 204, 'nothing left to undo is no error');
  const again = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  assert.equal(again.json.linked, false, 'a finished event takes no new Claim');
});

test('undoing a Claim takes away the account’s reporting', async () => {
  const { owner, code, idOf } = await casualEvent();
  const ash = await signIn('Ash');
  await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  await pair(code, owner, idOf('Ketchum'));
  await unclaim(code, ash);
  const fromLaptop = await playerSays(
    code,
    { lastName: 'Ketchum', result: 'win', device: 'ash-laptop' },
    { cookie: ash }
  );
  assert.deepEqual([fromLaptop.status, fromLaptop.json.linked], [200, true], 'free again, so the account claims anew');
  await unclaim(code, ash);
  await playerSays(code, { lastName: 'Ketchum', device: 'someone' });
  const blocked = await playerSays(code, { lastName: 'Ketchum', result: 'win', device: 'ash-laptop' }, { cookie: ash });
  assert.equal(blocked.status, 403, 'once someone else holds the player');
});

/** Who the event page says the viewer is. */
const pick = ({ me, via, signedIn }: Viewer) => ({ me, via, signedIn });

test('the event page knows which player a signed-in account is, and how', async () => {
  const { owner, code } = await casualEvent();
  const ash = await signIn('Ash');
  assert.deepEqual(pick((await view(code, ash)).viewer), { me: null, via: null, signedIn: true });
  const said = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  assert.deepEqual(pick((await view(code, ash)).viewer), { me: said.json.key, via: 'claim', signedIn: true });
  assert.deepEqual(pick((await view(code)).viewer), { me: null, via: null, signedIn: false });
  await hit(claim.onRequestDelete as Handler, '/claim', at(code), { method: 'DELETE', cookie: ash });
  assert.deepEqual(pick((await view(code, ash)).viewer), { me: null, via: null, signedIn: true });
  // A POP ID means nothing at an unsanctioned event, where IDs are the site's own.
  const ids = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json.tournament
    .players as { id: string }[];
  raw().prepare("UPDATE users SET pop_id = ? WHERE name = 'Ash'").run(ids[0]!.id);
  assert.equal((await view(code, ash)).viewer.via, null);
});

test('at a sanctioned event the account is the player whose POP ID it holds, without saying so', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 2);
  const player = await signIn('Player');
  assert.equal((await view(code, player)).viewer.via, null);
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: player, body: profileOf('901') });
  const listed = (await view(code, player)).viewer;
  assert.equal(listed.via, 'pop');
  assert.equal(listed.me, (await playerSays(code, { popId: '901' })).json.key);
  await send(code, owner, { type: 'removePlayer', id: '901' });
  assert.deepEqual(pick((await view(code, player)).viewer), { me: null, via: null, signedIn: true }, 'off the list');
});

test('the event page tells an account what its player answers with, so a device that never asked can report', async () => {
  const { owner, code, idOf } = await casualEvent();
  const ash = await signIn('Ash');
  assert.equal((await view(code, ash)).viewer.claim, undefined, 'not a player here');
  await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  // The public copy shortens the name; the account's own answer is the whole of it.
  const { claim: said } = (await view(code, ash)).viewer;
  assert.deepEqual(said, { firstName: 'Ash', lastName: 'Ketchum' });
  assert.equal((await view(code)).viewer.claim, undefined, 'nobody else is told');
  await pair(code, owner, idOf('Ketchum'));
  const fromLaptop = await playerSays(code, { ...said, result: 'win', device: 'ash-laptop' }, { cookie: ash });
  assert.deepEqual([fromLaptop.status, fromLaptop.json.reporter], [200, true]);
  const sanctioned = await newSwiss(owner);
  await addPlayers(sanctioned, owner, 2);
  const player = await signIn('Player');
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: player, body: profileOf('901') });
  assert.deepEqual((await view(sanctioned, player)).viewer.claim, { popId: '901', birthYear: '1990' });
});

test('the event page reads the account’s Claim in the batch that opens the event; the console, commands and asks do not', async () => {
  const { owner, code } = await casualEvent();
  const ash = await signIn('Ash');
  await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  const counting = countingTrips(env.TOURNAMENT_DB as NonNullable<TournamentEnv['TOURNAMENT_DB']>);
  const seen: string[] = [];
  env.TOURNAMENT_DB = {
    ...counting.db,
    prepare: sql => {
      seen.push(sql);
      return counting.db.prepare(sql);
    }
  };
  const readsClaim = () => seen.some(sql => sql.startsWith('SELECT player_id FROM report_devices JOIN sessions'));
  await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner });
  await send(code, owner, { type: 'startClock', pod: 'masters' });
  await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  assert.ok(!readsClaim(), 'the console, a command and a player’s ask do not');
  const before = counting.trips();
  assert.equal((await view(code, ash)).viewer.via, 'claim');
  assert.ok(readsClaim());
  assert.equal(counting.trips() - before, 1, 'one wait on the database');
});

const DECK = '60 Basic {P} Energy SVE 5';

/** A decklist request from a device: `query` says whose list, `call` adds a session or a body. */
function listCall(code: string, method: string, query: string, call: { cookie?: string; body?: unknown } = {}) {
  const handler = { GET: decklists.onRequestGet, PUT: decklists.onRequestPut, DELETE: decklists.onRequestDelete }[
    method as 'GET'
  ];
  return hit(handler as Handler, `/decklists?${query}`, at(code), { method, ...call });
}

const listAccount = (code: string) =>
  (
    raw().prepare('SELECT user_id AS who, account FROM decklists WHERE code = ?').all(code) as {
      who: string;
      account: string | null;
    }[]
  ).map(row => ({ ...row }));

test('a list sent by the account that is its player is the account’s, from any of its devices', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open' });
  const player = await signIn('Player');
  const lin = { ...profileOf('6161'), firstName: 'Lin' };
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: player, body: lin });
  const sent = await listCall(code, 'PUT', '', { cookie: player, body: { deck: DECK, profile: lin } });
  assert.equal(sent.status, 200);
  assert.deepEqual(listAccount(code), [{ who: 'pop:6161', account: await accountId(player) }]);

  const mine = await listCall(code, 'GET', 'popId=6161', { cookie: player });
  assert.equal(mine.json.mine?.firstName, 'Lin', 'read back with no token');
  assert.equal((await listCall(code, 'GET', 'popId=6161')).json.mine, null, 'not signed out');
  const replaced = await listCall(code, 'PUT', '', {
    cookie: player,
    body: { deck: '60 Basic {G} Energy SVE 1', profile: lin }
  });
  assert.equal(replaced.status, 200, 'replaced from a device with no token');
  assert.notEqual(replaced.json.token, sent.json.token);
  assert.equal(
    (await listCall(code, 'PUT', '', { body: { deck: DECK, profile: lin } })).status,
    409,
    'signed out, it is locked'
  );

  const stranger = await signIn('Stranger');
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: stranger, body: profileOf('7171') });
  assert.equal((await listCall(code, 'GET', 'popId=6161', { cookie: stranger })).json.mine, null);
  assert.equal((await listCall(code, 'DELETE', 'popId=6161', { cookie: stranger })).status, 409);
  assert.equal(
    (await listCall(code, 'DELETE', 'popId=6161', { cookie: player })).status,
    204,
    'withdrawn with no token'
  );
  assert.deepEqual(listAccount(code), []);
});

test('a list a device sent first stays that device’s, against the account that is its player', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open' });
  const lin = profileOf('6161');
  const device = await listCall(code, 'PUT', '', { body: { deck: DECK, profile: lin } });
  const player = await signIn('Player');
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: player, body: lin });
  assert.equal((await listCall(code, 'PUT', '', { cookie: player, body: { deck: DECK, profile: lin } })).status, 409);
  assert.equal((await listCall(code, 'GET', 'popId=6161', { cookie: player })).json.mine, null);
  assert.equal((await listCall(code, 'DELETE', 'popId=6161', { cookie: player })).status, 409);
  // The device that sent it, signed in now as the player, makes it the account's.
  const taken = await listCall(code, 'PUT', '', {
    cookie: player,
    body: { deck: DECK, profile: lin, token: device.json.token }
  });
  assert.equal(taken.status, 200);
  assert.equal(listAccount(code)[0]?.account, await accountId(player));
  const signedOut = await listCall(code, 'PUT', '', { body: { deck: DECK, profile: lin, token: device.json.token } });
  assert.equal(signedOut.status, 200, 'the device keeps its list signed out');
  assert.equal(listAccount(code)[0]?.account, await accountId(player), 'and the list stays the account’s');
});

test('staff unlocking a list frees it from its account too', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open' });
  const player = await signIn('Player');
  const lin = profileOf('6161');
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: player, body: lin });
  await listCall(code, 'PUT', '', { cookie: player, body: { deck: DECK, profile: lin } });
  const unlocked = await hit(decklists.onRequestPatch as Handler, '/decklists?popId=6161', at(code), {
    method: 'PATCH',
    cookie: owner
  });
  assert.equal(unlocked.status, 204);
  assert.deepEqual(listAccount(code), [{ who: 'pop:6161', account: null }]);
  assert.equal(
    (await listCall(code, 'PUT', '', { body: { deck: DECK, profile: lin } })).status,
    200,
    'a new device takes it'
  );
  assert.equal(listAccount(code)[0]?.account, null);
  assert.equal(
    (await listCall(code, 'GET', 'popId=6161', { cookie: player })).json.mine,
    null,
    'no longer the account’s'
  );
});

test('at an unsanctioned event a list is the account’s through its Claim, when the names agree', async () => {
  const { owner, code } = await casualEvent();
  await settle(code, owner, { decklists: 'open' });
  const ash = await signIn('Ash');
  const named = (firstName: string, lastName: string) => ({ deck: DECK, profile: { firstName, lastName } });
  await listCall(code, 'PUT', '', { cookie: ash, body: named('Ash', 'Ketchum') });
  assert.equal(listAccount(code)[0]?.account, null, 'before its Claim, a list is a device’s only');
  await hit(decklists.onRequestPatch as Handler, '/decklists?firstName=Ash&lastName=Ketchum', at(code), {
    method: 'PATCH',
    cookie: owner
  });
  await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  await listCall(code, 'PUT', '', { cookie: ash, body: named('ash', 'KETCHUM') });
  await listCall(code, 'PUT', '', { cookie: ash, body: named('Gary', 'Oak') });
  assert.deepEqual(
    listAccount(code).map(row => row.account !== null),
    [true, false],
    'Ash’s own list is the account’s; one sent for Gary is not'
  );
  const mine = await listCall(code, 'GET', 'firstName=Ash&lastName=Ketchum', { cookie: ash });
  assert.equal(mine.json.mine?.lastName, 'KETCHUM');
});

test('a device’s claim becomes the account’s only while that device still holds the player', async () => {
  const { code, idOf } = await casualEvent();
  const before = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' });
  const ash = await signIn('Ash');
  // Staff let another device claim Ash between this request's read and its write.
  ahead('UPDATE OR IGNORE report_devices', () => {
    raw().prepare('DELETE FROM report_devices WHERE code = ?').run(code);
    holdAs(code, idOf('Ketchum'), null);
  });
  const said = await playerSays(
    code,
    { lastName: 'Ketchum', device: 'ash-phone', reportToken: before.json.reportToken },
    { cookie: ash }
  );
  assert.equal(said.json.linked, false);
  assert.deepEqual(holders(code), { [idOf('Ketchum')]: null }, 'the other device’s claim stays its own');
});

/** Has `meanwhile` land between the request's read and its next `times` writes that start with `prefix`. */
const ahead = (prefix: string, meanwhile: () => void, times = 1) => {
  env.TOURNAMENT_DB = racing(env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>, prefix, meanwhile, times);
};

/** Another device's reporter row for `playerId`, the account `userId`'s when one is named. */
function holdAs(code: string, playerId: string, userId: string | null) {
  raw()
    .prepare(
      'INSERT INTO report_devices (code, player_id, token_hash, device, claimed_at, user_id) ' +
        "VALUES (?, ?, 'another', 'another', 1, ?)"
    )
    .run(code, playerId, userId);
}

const CLAIM_WRITE = 'INSERT OR IGNORE INTO report_devices';
const UPGRADE_WRITE = 'UPDATE OR IGNORE report_devices';

test('an account whose other request claimed another player first is told so, not answered as a stranger', async () => {
  const { code, idOf } = await casualEvent();
  const ash = await signIn('Ash');
  const id = await accountId(ash);
  ahead(CLAIM_WRITE, () => holdAs(code, idOf('Oak'), id));
  const lost = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  assert.equal(lost.status, 409);
  assert.equal(lost.json.linkedKey, (await playerSays(code, { lastName: 'Oak' })).json.key);
  assert.deepEqual(holders(code), { [idOf('Oak')]: id }, 'Ash is still free');
});

test('a device’s claim the account would take is refused when the account took another player meanwhile', async () => {
  const { code, idOf } = await casualEvent();
  const before = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' });
  const ash = await signIn('Ash');
  const id = await accountId(ash);
  ahead(UPGRADE_WRITE, () => holdAs(code, idOf('Oak'), id));
  const lost = await playerSays(
    code,
    { lastName: 'Ketchum', device: 'ash-phone', reportToken: before.json.reportToken },
    { cookie: ash }
  );
  assert.equal(lost.status, 409);
  assert.equal(lost.json.linkedKey, (await playerSays(code, { lastName: 'Oak' })).json.key);
  assert.equal(holders(code)[idOf('Ketchum')], null);
});

/** Ends the event in the database, as a save from staff would: a new version. */
const finishNow = (code: string) =>
  raw()
    .prepare(
      "UPDATE tournaments SET settings = json_set(settings, '$.finished', json('true')), version = version + 1 " +
        'WHERE code = ?'
    )
    .run(code);

/** Takes `playerId` off the event's list in the database, as a save from staff would. */
function removeNow(code: string, playerId: string) {
  const { state } = raw().prepare('SELECT state FROM tournaments WHERE code = ?').get(code) as { state: string };
  const tournament = JSON.parse(state) as { players: { id: string }[] };
  tournament.players = tournament.players.filter(player => player.id !== playerId);
  raw()
    .prepare('UPDATE tournaments SET state = ?, version = version + 1 WHERE code = ?')
    .run(JSON.stringify(tournament), code);
}

test('a Claim does not land once the event has ended since the request read it', async () => {
  const { code, idOf } = await casualEvent();
  const ash = await signIn('Ash');
  ahead(CLAIM_WRITE, () => finishNow(code));
  const said = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  assert.deepEqual([said.status, said.json.reporter, said.json.linked], [200, true, false]);
  assert.deepEqual(holders(code), { [idOf('Ketchum')]: null }, 'the device follows the player, unlinked');
});

test('a device’s claim does not become the account’s once the event has ended since the request read it', async () => {
  const { code, idOf } = await casualEvent();
  const before = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' });
  const ash = await signIn('Ash');
  ahead(UPGRADE_WRITE, () => finishNow(code));
  const said = await playerSays(
    code,
    { lastName: 'Ketchum', device: 'ash-phone', reportToken: before.json.reportToken },
    { cookie: ash }
  );
  assert.deepEqual([said.status, said.json.reporter, said.json.linked], [200, true, false]);
  assert.deepEqual(holders(code), { [idOf('Ketchum')]: null });
});

test('nobody claims a player staff took off the list since the request read it', async () => {
  const { code, idOf } = await casualEvent();
  const ash = await signIn('Ash');
  const ketchum = idOf('Ketchum');
  ahead(CLAIM_WRITE, () => removeNow(code, ketchum));
  const said = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  assert.equal(said.status, 404);
  assert.deepEqual(holders(code), {}, 'no row, so nothing in History');
});

test('a claim beaten to the event by other writes lands on what they left, and gives up after five tries', async () => {
  const { code, idOf } = await casualEvent();
  const ash = await signIn('Ash');
  const bump = () => raw().prepare('UPDATE tournaments SET version = version + 1 WHERE code = ?').run(code);
  ahead(CLAIM_WRITE, bump, 4);
  const said = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  assert.deepEqual([said.status, said.json.linked], [200, true]);
  ahead(CLAIM_WRITE, bump, 5);
  const busy = await playerSays(code, { lastName: 'Oak', device: 'gary-phone' });
  assert.deepEqual([busy.status, busy.json.error], [409, 'Busy; try again']);
  assert.deepEqual(Object.keys(holders(code)), [idOf('Ketchum')]);
});

test('an account is not the player as a POP ID it gave up since the request read it', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 2);
  const player = await signIn('Player');
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: player, body: profileOf('900') });
  // The account's profile moves to 901 between this request's read and its claim.
  ahead(CLAIM_WRITE, () => raw().exec("UPDATE users SET pop_id = '901' WHERE name = 'Player'"));
  const stale = await playerSays(code, { popId: '900', device: 'phone' }, { cookie: player });
  assert.deepEqual([stale.status, stale.json.linked], [200, false]);
  assert.deepEqual(holders(code), { '900': null }, 'the device follows 900, unlinked');
  const own = await playerSays(code, { popId: '901', device: 'phone' }, { cookie: player });
  assert.deepEqual([own.status, own.json.linked], [200, true], 'and the account is 901 here');
});

test('a device’s claim does not become the account’s as a POP ID it gave up since the request read it', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 2);
  const before = await playerSays(code, { popId: '900', device: 'phone' });
  const player = await signIn('Player');
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: player, body: profileOf('900') });
  ahead(UPGRADE_WRITE, () => raw().exec("UPDATE users SET pop_id = '901' WHERE name = 'Player'"));
  const stale = await playerSays(
    code,
    { popId: '900', device: 'phone', reportToken: before.json.reportToken },
    { cookie: player }
  );
  assert.deepEqual([stale.status, stale.json.reporter, stale.json.linked], [200, true, false]);
  assert.deepEqual(holders(code), { '900': null });
});

test('a device that claims the player between the read and the write keeps them', async () => {
  const { code, idOf } = await casualEvent();
  const ash = await signIn('Ash');
  ahead(CLAIM_WRITE, () => holdAs(code, idOf('Ketchum'), null));
  const said = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  assert.deepEqual([said.status, said.json.reporter, said.json.linked], [200, false, false]);
  assert.deepEqual(holders(code), { [idOf('Ketchum')]: null });
});

test('a list is not the account’s to withdraw once its Claim was undone since the request read it', async () => {
  const { owner, code } = await casualEvent();
  await settle(code, owner, { decklists: 'open' });
  const ash = await signIn('Ash');
  await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  await listCall(code, 'PUT', '', {
    cookie: ash,
    body: { deck: DECK, profile: { firstName: 'Ash', lastName: 'Ketchum' } }
  });
  ahead('DELETE FROM decklists', () => raw().prepare('DELETE FROM report_devices WHERE code = ?').run(code));
  const withdrawn = await listCall(code, 'DELETE', 'firstName=Ash&lastName=Ketchum', { cookie: ash });
  assert.equal(withdrawn.status, 409);
  assert.equal(listAccount(code).length, 1);
});

test('a list is not the account’s to replace once it gave up the POP ID since the request read it', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { decklists: 'open' });
  const player = await signIn('Player');
  const lin = profileOf('6161');
  await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie: player, body: lin });
  await listCall(code, 'PUT', '', { cookie: player, body: { deck: DECK, profile: lin } });
  ahead('INSERT INTO decklists', () => raw().exec("UPDATE users SET pop_id = '7171' WHERE name = 'Player'"));
  const replaced = await listCall(code, 'PUT', '', {
    cookie: player,
    body: { deck: '60 Basic {G} Energy SVE 1', profile: lin }
  });
  assert.equal(replaced.status, 409);
  assert.equal((raw().prepare('SELECT deck FROM decklists WHERE code = ?').get(code) as { deck: string }).deck, DECK);
});

test('a first list is the device’s alone when the account stopped being its player since the request read it', async () => {
  const { owner, code } = await casualEvent();
  await settle(code, owner, { decklists: 'open' });
  const ash = await signIn('Ash');
  await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  ahead('INSERT INTO decklists', () => raw().prepare('DELETE FROM report_devices WHERE code = ?').run(code));
  const sent = await listCall(code, 'PUT', '', {
    cookie: ash,
    body: { deck: DECK, profile: { firstName: 'Ash', lastName: 'Ketchum' } }
  });
  assert.equal(sent.status, 200);
  assert.deepEqual(
    listAccount(code).map(row => row.account),
    [null]
  );
});
