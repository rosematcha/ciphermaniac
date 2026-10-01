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
import * as decklists from '../../functions/api/tournaments/[code]/decklists.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as report from '../../functions/api/tournaments/[code]/report.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, send, addPlayers, settle, playerSays } = eventCalls(hit);

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
