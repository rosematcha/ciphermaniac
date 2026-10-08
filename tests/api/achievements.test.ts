/**
 * A public profile's badges end to end, against the real schema in SQLite:
 * counted from the events the account played, won, ran and staffed to the
 * end, granted from `account_badges`, and gone with whatever they count.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as me from '../../functions/api/me.ts';
import * as profiles from '../../functions/api/profiles/[handle].ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as report from '../../functions/api/tournaments/[code]/report.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { loadTournament } from '../../functions/lib/tournaments/store.ts';
import type { Badge } from '../../shared/accounts/achievements.ts';
import { latestRound } from '../../shared/tournament/rounds.ts';
import { firstPlaces } from '../../shared/tournament/tdf.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, send, addPlayers, settle } = eventCalls(hit);

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
  event._resetRateLimitStore();
  report._resetRateLimitStore();
  profiles._resetRateLimitStore();
});

const db = () => env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;

const patchMe = (cookie: string, body: Record<string, unknown>) =>
  hit(me.onRequestPatch as Handler, '/api/me', {}, { method: 'PATCH', cookie, body });

const saveProfile = (cookie: string, popId: string) =>
  hit(
    me.onRequestPut as Handler,
    '/api/me',
    {},
    { method: 'PUT', cookie, body: { popId, firstName: 'Pat', lastName: 'Player', birthDate: '02/27/2001' } }
  );

/** The badges on the public profile at `handle`. */
async function badgesAt(handle: string): Promise<Badge[]> {
  const shown = await hit(profiles.onRequestGet as Handler, `/api/profiles/${handle}`, { handle });
  assert.equal(shown.status, 200);
  return shown.json.badges as Badge[];
}

/** Signs in an account with its profile public under `handle`. */
async function publicAccount(name: string, handle: string, role?: 'organizer'): Promise<string> {
  const cookie = await signIn(name, role);
  await patchMe(cookie, { handle });
  await patchMe(cookie, { publicProfile: true });
  return cookie;
}

/** A sanctioned Swiss event of four, one round played to the end with every first seat winning, then finished. */
async function playedEvent(owner: string): Promise<string> {
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  assert.equal((await send(code, owner, { type: 'pairRound', pod: 'masters' })).status, 200);
  const row = await loadTournament(db(), code);
  const pod = row!.tournament.pods.find(p => p.rounds.length > 0)!;
  const round = latestRound(pod)!;
  for (const m of round.matches.filter(m => m.outcome === 'pending')) {
    const done = await send(code, owner, {
      type: 'reportResult',
      pod: pod.category,
      round: round.number,
      ...m,
      outcome: 'p1'
    });
    assert.equal(done.status, 200);
  }
  assert.equal((await settle(code, owner, { finished: true })).status, 200);
  return code;
}

const winnerOf = async (code: string) => firstPlaces((await loadTournament(db(), code))!.tournament);

const wins = (code: string) =>
  db().raw.prepare('SELECT player_id FROM event_wins WHERE code = ?').all(code) as { player_id: string }[];

test('a player who won a finished event has played and won it; one who lost has only played it', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await playedEvent(owner);
  const [winner] = await winnerOf(code);
  assert.deepEqual(
    wins(code).map(row => row.player_id),
    [winner]
  );
  const champ = await publicAccount('Pat Player', 'champ');
  await saveProfile(champ, winner!);
  assert.deepEqual(await badgesAt('champ'), [
    { key: 'played', count: 1, tier: 1 },
    { key: 'won', count: 1, tier: 1 }
  ]);
  const other = await publicAccount('Sam Player', 'other');
  await saveProfile(
    other,
    ['900', '901', '902', '903'].find(id => id !== winner)!
  );
  assert.deepEqual(await badgesAt('other'), [{ key: 'played', count: 1, tier: 1 }]);
});

test('an unfinished event counts for nothing, and reopening a finished one takes its win away', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await playedEvent(owner);
  const [winner] = await winnerOf(code);
  const champ = await publicAccount('Pat Player', 'champ');
  await saveProfile(champ, winner!);
  await settle(code, owner, { finished: false });
  assert.deepEqual(wins(code), []);
  assert.deepEqual(await badgesAt('champ'), []);
  await settle(code, owner, { finished: true });
  assert.equal((await badgesAt('champ')).length, 2, 'finishing again counts it again');
  await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: owner });
  assert.deepEqual(wins(code), [], 'a deleted event takes its winners with it');
  assert.deepEqual(await badgesAt('champ'), []);
});

test('running and staffing finished events count, and staffing one’s own event is only running it', async () => {
  const owner = await publicAccount('Olive Organizer', 'olive', 'organizer');
  await publicAccount('Hal Helper', 'hal');
  const first = await playedEvent(owner);
  await playedEvent(owner);
  const helperId = (db().raw.prepare("SELECT id FROM users WHERE handle = 'hal'").get() as { id: string }).id;
  const ownerId = (db().raw.prepare("SELECT id FROM users WHERE handle = 'olive'").get() as { id: string }).id;
  const staff = db().raw.prepare('INSERT INTO staff (code, user_id, joined_at) VALUES (?, ?, 0)');
  staff.run(first, helperId);
  staff.run(first, ownerId);
  assert.deepEqual(await badgesAt('olive'), [{ key: 'organized', count: 2, tier: 1 }]);
  assert.deepEqual(await badgesAt('hal'), [{ key: 'staffed', count: 1, tier: 1 }]);
});

test('events in two cities make a traveler; events at stores in one city do not', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const codes = [await playedEvent(owner), await playedEvent(owner), await playedEvent(owner)];
  const store = db().raw.prepare(
    'INSERT INTO stores (id, league_id, status, name, address, city, region, country, time_zone, created_at, updated_at) ' +
      "VALUES (?, ?, 'active', 'Shop', '1 Main St', ?, 'TX', 'US', 'America/Chicago', 0, 0)"
  );
  store.run('s1', 'L1', 'Austin');
  store.run('s2', 'L2', 'AUSTIN');
  store.run('s3', 'L3', 'Dallas');
  const place = db().raw.prepare('UPDATE tournaments SET store_id = ? WHERE code = ?');
  place.run('s1', codes[0]);
  place.run('s2', codes[1]);
  const player = await publicAccount('Pat Player', 'pat');
  await saveProfile(player, (await winnerOf(codes[0]!))[0] === '900' ? '901' : '900');
  const traveler = async () => (await badgesAt('pat')).find(badge => badge.key === 'traveler');
  assert.equal(await traveler(), undefined, 'one city, however it is written');
  place.run('s3', codes[2]);
  assert.deepEqual(await traveler(), { key: 'traveler', count: 2, tier: 1 });
});

test('granted badges show before counted ones, and go when the account is deleted', async () => {
  const player = await publicAccount('Pat Player', 'pat');
  const { id } = db().raw.prepare("SELECT id FROM users WHERE handle = 'pat'").get() as { id: string };
  const grant = db().raw.prepare('INSERT INTO account_badges (user_id, badge, count, granted_at) VALUES (?, ?, ?, 0)');
  grant.run(id, 'early', 1);
  grant.run(id, 'beta', 1);
  grant.run(id, 'bug', 6);
  assert.deepEqual(await badgesAt('pat'), [{ key: 'beta' }, { key: 'early' }, { key: 'bug', count: 6, tier: 2 }]);
  const gone = await hit(
    me.onRequestDelete as Handler,
    '/api/me',
    {},
    {
      method: 'DELETE',
      cookie: player,
      body: { confirm: 'pat' }
    }
  );
  assert.equal(gone.status, 204);
  assert.deepEqual(db().raw.prepare('SELECT badge FROM account_badges WHERE user_id = ?').all(id), []);
});
