/**
 * The history index end to end, against the real schema in SQLite. What must
 * hold: `pop_history` holds exactly the players of every sanctioned event,
 * however its player list or its sanctioned setting changes (staff, a late
 * arrival, a decklist, a TOM file and its syncs, deleting the event); a
 * change to anything else writes nothing to it; a write that loses the race
 * to the event's row writes nothing there either; and a player taken off the
 * list takes whoever was them at the event with them.
 */

import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

import * as history from '../../functions/api/history.ts';
import * as me from '../../functions/api/me.ts';
import * as profiles from '../../functions/api/profiles/[slug].ts';
import * as claim from '../../functions/api/tournaments/[code]/claim.ts';
import * as decklists from '../../functions/api/tournaments/[code]/decklists.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as manage from '../../functions/api/tournaments/[code]/manage.ts';
import * as report from '../../functions/api/tournaments/[code]/report.ts';
import * as sync from '../../functions/api/tournaments/[code]/sync.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { loadTournament } from '../../functions/lib/tournaments/store.ts';
import type { HistoryEntry } from '../../shared/accounts/types.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { indexedIds } from '../../shared/tournament/history.ts';
import { revisionOf } from '../../shared/tournament/revision.ts';
import type { Player, Tournament } from '../../shared/tournament/types.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { countingTrips, racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { newEvent, newSwiss, send, addPlayers, settle, playerSays } = eventCalls(hit);

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
  decklists._resetRateLimitStore();
  report._resetRateLimitStore();
  event._resetRateLimitStore();
  profiles._resetRateLimitStore();
});

const db = () => env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;

/** The POP IDs the index holds under `code`, in order. */
const indexed = (code: string) =>
  (
    db().raw.prepare('SELECT pop_id FROM pop_history WHERE code = ? ORDER BY pop_id').all(code) as { pop_id: string }[]
  ).map(row => row.pop_id);

/** The player IDs with a reporter row at `code`, in order. */
const reporters = (code: string) =>
  (
    db().raw.prepare('SELECT player_id FROM report_devices WHERE code = ? ORDER BY player_id').all(code) as {
      player_id: string;
    }[]
  ).map(row => row.player_id);

/** The index holds exactly what the event as stored says it should. */
async function inStep(code: string) {
  const row = await loadTournament(db(), code);
  assert.ok(row);
  assert.deepEqual(indexed(code), [...indexedIds(row)].sort());
}

function remove(code: string, cookie: string, id: string) {
  return send(code, cookie, { type: 'removePlayer', id });
}

test('players staff add at a sanctioned event are indexed, and one they remove is not', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  assert.deepEqual(indexed(code), [], 'a Swiss event starts with nobody');
  await addPlayers(code, owner, 3);
  assert.deepEqual(indexed(code), ['900', '901', '902']);
  assert.equal((await remove(code, owner, '901')).status, 200);
  assert.deepEqual(indexed(code), ['900', '902']);
  await send(code, owner, { type: 'editPlayer', id: '900', firstName: 'Renamed', lastName: 'Player', birthDate: '' });
  assert.deepEqual(indexed(code), ['900', '902'], 'a rename changes nothing');
});

test('a late arrival after round 1 and a player added by decklist are indexed', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  await send(code, owner, { type: 'pairRound', pod: 'masters' });
  await send(code, owner, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'Arrival', id: '999' } });
  assert.deepEqual(indexed(code), ['900', '901', '902', '903', '999']);
  await settle(code, owner, { decklists: 'open' });
  const sent = await hit(decklists.onRequestPut as Handler, '/decklists', at(code), {
    method: 'PUT',
    body: {
      deck: '60 Basic {P} Energy SVE 5',
      profile: { popId: '4242', firstName: 'Nia', lastName: 'Okafor', birthDate: '02/27/2001' }
    }
  });
  assert.equal(sent.json.registration, 'added');
  await inStep(code);
  assert.ok(indexed(code).includes('4242'));
});

test('turning sanctioned off takes an event’s players out of the index, and on again puts them back', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 2);
  assert.equal((await settle(code, owner, { sanctioned: false })).status, 200);
  assert.deepEqual(indexed(code), []);
  await send(code, owner, { type: 'addPlayer', player: { firstName: 'Casual', lastName: 'Player' } });
  assert.deepEqual(indexed(code), [], 'an unsanctioned event indexes nobody it adds');
  await settle(code, owner, { sanctioned: true });
  await inStep(code);
  assert.equal(indexed(code).length, 3);
  await settle(code, owner, { format: 'Expanded' });
  await inStep(code);
});

/** A TOM file holding players under `ids`, before its first round. */
function tomFile(ids: string[]): Tournament {
  const players = ids.map((id): Player => ({
    id,
    firstName: 'Tom',
    lastName: id,
    birthDate: '02/27/1990',
    droppedAfter: null,
    created: '',
    modified: ''
  }));
  return { ...emptyTournament({ name: 'League Cup', startDate: '10/10/2026' }), players };
}

const newTom = (cookie: string, ids: string[]) => newEvent(cookie, { mode: 'tom', tournament: tomFile(ids) });

async function syncFile(code: string, cookie: string, ids: string[]) {
  const held = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie })).json.tournament;
  const synced = await hit(sync.onRequestPut as Handler, '/sync', at(code), {
    method: 'PUT',
    cookie,
    body: { tournament: tomFile(ids), base: await revisionOf(held) }
  });
  assert.equal(synced.status, 200);
}

test('a TOM event indexes every player in its file, and each sync adds, removes and renumbers', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newTom(owner, ['7200001', '7200002', '7200003']);
  assert.deepEqual(indexed(code), ['7200001', '7200002', '7200003']);
  // TOM changed one Player ID, dropped another player and took a new one.
  await syncFile(code, owner, ['7200001', '7200009', '7200004']);
  assert.deepEqual(indexed(code), ['7200001', '7200004', '7200009']);
  await settle(code, owner, { sanctioned: false });
  assert.equal(indexed(code).length, 3, 'a TOM event is sanctioned whatever its settings say');
});

test('a big file goes into the index in runs D1 takes', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const ids = Array.from({ length: 200 }, (_, i) => String(7_300_000 + i));
  const code = await newTom(owner, ids);
  assert.equal(indexed(code).length, 200);
  await syncFile(code, owner, ids.slice(0, 1));
  assert.deepEqual(indexed(code), ids.slice(0, 1));
});

test('deleting an event takes its players out of the index', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newTom(owner, ['7200001', '7200002']);
  const other = await newTom(owner, ['7200001']);
  const deleted = await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: owner });
  assert.equal(deleted.status, 204);
  assert.deepEqual(indexed(code), []);
  assert.deepEqual(indexed(other), ['7200001'], 'another event keeps its own');
});

test('deleting an event takes out the players it has when the delete lands, not only those it read', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newTom(owner, ['7200001', '7200002']);
  // A sync adds a player between the delete's read and its write.
  const inner = db();
  env.TOURNAMENT_DB = racing(inner, 'DELETE FROM', () => {
    inner.raw.prepare("INSERT INTO pop_history (pop_id, code) VALUES ('7200003', ?)").run(code);
    inner.raw
      .prepare(
        'UPDATE tournaments SET state = json_insert(state, \'$.players[#]\', json(\'{"id":"7200003"}\')), ' +
          'version = version + 1 WHERE code = ?'
      )
      .run(code);
  });
  const deleted = await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: owner });
  assert.equal(deleted.status, 204);
  assert.deepEqual(indexed(code), []);
  assert.equal(await loadTournament(inner, code), null);
});

test('a delete beaten to the event by other writes gives up after five tries, and changes nothing', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newTom(owner, ['7200001']);
  const bump = () => db().raw.prepare('UPDATE tournaments SET version = version + 1 WHERE code = ?').run(code);
  env.TOURNAMENT_DB = racing(db(), 'DELETE FROM tournaments', bump, 5);
  const busy = await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: owner });
  assert.deepEqual([busy.status, busy.json.error], [409, 'Busy; try again']);
  assert.deepEqual(indexed(code), ['7200001']);
  assert.notEqual(await loadTournament(db(), code), null);
});

test('a delete that another delete beat to the event is done', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newTom(owner, ['7200001']);
  const other = () => {
    db().raw.prepare('DELETE FROM pop_history WHERE code = ?').run(code);
    db().raw.prepare('DELETE FROM tournaments WHERE code = ?').run(code);
  };
  env.TOURNAMENT_DB = racing(db(), 'DELETE FROM', other);
  const deleted = await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: owner });
  assert.equal(deleted.status, 204);
});

test('an event made on a code already taken leaves the first event’s index alone', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const random = mock.method(Math, 'random', () => 0);
  try {
    const first = await newTom(owner, ['7200001']);
    let draws = 0;
    random.mock.mockImplementation(() => {
      draws += 1;
      return draws <= first.length ? 0 : 0.5;
    });
    const second = await newTom(owner, ['7200002', '7200003']);
    assert.notEqual(second, first);
    assert.deepEqual(indexed(first), ['7200001']);
    assert.deepEqual(indexed(second), ['7200002', '7200003']);
  } finally {
    random.mock.restore();
  }
});

/** Every statement the functions prepare from here on, and the round trips they make. */
function watch() {
  const counting = countingTrips(db());
  const seen: string[] = [];
  env.TOURNAMENT_DB = {
    ...counting.db,
    prepare: sql => {
      seen.push(sql);
      return counting.db.prepare(sql);
    }
  };
  return { seen, trips: counting.trips };
}

test('a result, a clock or a setting that leaves the list alone writes nothing to the index', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 4);
  const paired = await send(code, owner, { type: 'pairRound', pod: 'masters' });
  const [match] = paired.json.tournament.pods[0].rounds[0].matches;
  const { seen, trips } = watch();
  const reported = await send(code, owner, {
    type: 'reportResult',
    pod: 'masters',
    round: 1,
    table: match.table,
    p1: match.p1,
    p2: match.p2,
    outcome: 'p1'
  });
  assert.equal(reported.status, 200);
  await send(code, owner, { type: 'startClock', pod: 'masters' });
  await settle(code, owner, { details: 'Doors at 11' });
  assert.ok(!seen.some(sql => /pop_history|report_devices/.test(sql)), 'no index statement');
  assert.equal(trips(), 6, 'each change is one read and one write');
});

/** Has another write land on the event's row just ahead of each of the functions' next `times` writes to it. */
function raceWrites(times: number) {
  const inner = db();
  let left = times;
  env.TOURNAMENT_DB = {
    ...inner,
    prepare: sql => {
      if (left > 0 && sql.startsWith('UPDATE tournaments SET')) {
        left -= 1;
        inner.raw.exec('UPDATE tournaments SET version = version + 1');
      }
      return inner.prepare(sql);
    }
  };
}

test('a change that loses the race to the row writes nothing to the index, and one that lands keeps it in step', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 2);
  await playerSays(code, { popId: '900', device: 'phone' });
  assert.deepEqual(reporters(code), ['900']);
  raceWrites(5);
  assert.equal((await remove(code, owner, '900')).status, 409);
  assert.deepEqual(indexed(code), ['900', '901'], 'the player it failed to remove is still indexed');
  assert.deepEqual(reporters(code), ['900'], 'and still who they were');
  raceWrites(5);
  const late = await send(code, owner, { type: 'addPlayer', player: { firstName: 'A', lastName: 'B', id: '950' } });
  assert.equal(late.status, 409);
  assert.deepEqual(indexed(code), ['900', '901'], 'the player it failed to add is not');
  raceWrites(4);
  assert.equal((await remove(code, owner, '900')).status, 200);
  await inStep(code);
  assert.deepEqual(reporters(code), []);
});

test('a player taken off the list is no one there any more, at either kind of event', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { sanctioned: false });
  await send(code, owner, { type: 'addPlayer', player: { firstName: 'Ash', lastName: 'Ketchum' } });
  await send(code, owner, { type: 'addPlayer', player: { firstName: 'Gary', lastName: 'Oak' } });
  const ash = await playerSays(code, { lastName: 'Ketchum', device: 'ash' });
  await playerSays(code, { lastName: 'Oak', device: 'gary' });
  assert.equal(reporters(code).length, 2);
  const roster = (await hit(manage.onRequestGet as Handler, '/manage', at(code), { cookie: owner })).json.tournament;
  const ashId = roster.players.find((p: Player) => p.lastName === 'Ketchum').id as string;
  assert.ok(ash.json.reportToken);
  await remove(code, owner, ashId);
  assert.deepEqual(
    reporters(code),
    roster.players.filter((p: Player) => p.id !== ashId).map((p: Player) => p.id)
  );
});

const saveProfile = (cookie: string, popId: string) =>
  hit(
    me.onRequestPut as Handler,
    '/api/me',
    {},
    {
      method: 'PUT',
      cookie,
      body: { popId, firstName: 'Pat', lastName: 'Player', birthDate: '02/27/2001' }
    }
  );

const historyOf = async (cookie?: string) => hit(history.onRequestGet as Handler, '/api/history', {}, { cookie });

/** The codes in the account's History, newest first. */
const codesOf = async (cookie: string) =>
  ((await historyOf(cookie)).json.entries as HistoryEntry[]).map(entry => entry.code);

const keyOf = async (code: string, playerId: string) => (await loadTournament(db(), code))?.keys[playerId];

test('an account’s History lists the sanctioned events its POP ID plays in, as each stands', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { format: 'Expanded', startsAt: '2026-10-10T11:00' });
  await addPlayers(code, owner, 4);
  const player = await signIn('Player');
  assert.deepEqual((await historyOf(player)).json, { entries: [] });
  await saveProfile(player, '901');
  const [entry] = (await historyOf(player)).json.entries as HistoryEntry[];
  assert.deepEqual(entry, {
    code,
    key: await keyOf(code, '901'),
    name: 'Test Cup',
    startDate: (await loadTournament(db(), code))?.tournament.info.startDate,
    startsAt: '2026-10-10T11:00',
    format: 'Expanded',
    mode: 'swiss',
    status: 'upcoming'
  });
  await send(code, owner, { type: 'pairRound', pod: 'masters' });
  assert.equal((await historyOf(player)).json.entries[0].status, 'live');
  await settle(code, owner, { finished: true });
  assert.equal((await historyOf(player)).json.entries[0].status, 'finished');
  await settle(code, owner, { sanctioned: false });
  assert.deepEqual(await codesOf(player), [], 'an event no longer sanctioned leaves History');
  await settle(code, owner, { sanctioned: true });
  assert.deepEqual(await codesOf(player), [code], 'and comes back with it');
  await hit(event.onRequestDelete as Handler, '/', at(code), { method: 'DELETE', cookie: owner });
  assert.deepEqual(await codesOf(player), [], 'a deleted event is gone');
});

test('an event is live in History once any of its pods has paired, not only its first', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  for (let i = 0; i < 6; i += 1) {
    await send(code, owner, {
      type: 'addPlayer',
      player: { firstName: 'Junior', lastName: `${i}`, id: `${800 + i}`, birthDate: '02/27/2016' }
    });
  }
  await addPlayers(code, owner, 6);
  const player = await signIn('Player');
  await saveProfile(player, '901');
  const paired = await send(code, owner, { type: 'pairRound', pod: 'senior-masters' });
  assert.equal(paired.status, 200);
  const pods = (await loadTournament(db(), code))?.tournament.pods.map(pod => [pod.category, pod.rounds.length]);
  assert.deepEqual(pods, [
    ['junior', 0],
    ['senior-masters', 1]
  ]);
  assert.equal((await historyOf(player)).json.entries[0].status, 'live');
});

test('History follows the player list: removed, added late, by decklist, or by a TOM file and its syncs', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const swiss = await newSwiss(owner);
  await addPlayers(swiss, owner, 2);
  const player = await signIn('Player');
  await saveProfile(player, '901');
  await remove(swiss, owner, '901');
  assert.deepEqual(await codesOf(player), []);
  await send(swiss, owner, { type: 'addPlayer', player: { firstName: 'On', lastName: 'Time', id: '902' } });
  await send(swiss, owner, { type: 'pairRound', pod: 'masters' });
  const late = await signIn('Late');
  await saveProfile(late, '999');
  await send(swiss, owner, { type: 'addPlayer', player: { firstName: 'Late', lastName: 'Arrival', id: '999' } });
  assert.deepEqual(await codesOf(late), [swiss]);

  const listed = await newSwiss(owner);
  await settle(listed, owner, { decklists: 'open' });
  const nia = await signIn('Nia');
  await saveProfile(nia, '4242');
  await hit(decklists.onRequestPut as Handler, '/decklists', at(listed), {
    method: 'PUT',
    body: {
      deck: '60 Basic {P} Energy SVE 5',
      profile: { popId: '4242', firstName: 'Nia', lastName: 'Okafor', birthDate: '02/27/2001' }
    }
  });
  assert.deepEqual(await codesOf(nia), [listed]);

  const tom = await newTom(owner, ['7200001', '4242']);
  assert.deepEqual((await codesOf(nia)).sort(), [listed, tom].sort());
  await syncFile(tom, owner, ['7200001', '4243']);
  assert.deepEqual(await codesOf(nia), [listed], 'TOM changed the ID');
  const other = await signIn('Other');
  await saveProfile(other, '4243');
  assert.deepEqual(await codesOf(other), [tom]);
});

test('History lists an unsanctioned event through the account’s Claim, until it undoes it', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { sanctioned: false });
  await send(code, owner, { type: 'addPlayer', player: { firstName: 'Ash', lastName: 'Ketchum' } });
  const ash = await signIn('Ash');
  const said = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  const entries = (await historyOf(ash)).json.entries as HistoryEntry[];
  assert.deepEqual(
    entries.map(entry => [entry.code, entry.key]),
    [[code, said.json.key]]
  );
  await hit(claim.onRequestDelete as Handler, '/claim', at(code), { method: 'DELETE', cookie: ash });
  assert.deepEqual(await codesOf(ash), []);
});

test('at a sanctioned event the account’s own reporter row does not list the event twice', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 2);
  const player = await signIn('Player');
  await saveProfile(player, '900');
  await playerSays(code, { popId: '900', device: 'phone' }, { cookie: player });
  assert.deepEqual(await codesOf(player), [code]);
});

test('History is newest first: by start time, then date, then last change', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const player = await signIn('Player');
  await saveProfile(player, '900');
  const eventOn = async (info: { startDate?: string }, startsAt = '') => {
    const code = await newSwiss(owner);
    await addPlayers(code, owner, 1);
    await settle(code, owner, { startsAt });
    if (info.startDate) {
      await send(code, owner, { type: 'updateInfo', info });
    }
    return code;
  };
  const autumn = await eventOn({ startDate: '10/01/2026' });
  const later = await eventOn({}, '2026-12-05T10:00');
  const spring = await eventOn({ startDate: '04/01/2026' });
  const winter = await eventOn({}, '2026-12-01T10:00');
  const sameDay = await eventOn({ startDate: '04/01/2026' });
  assert.deepEqual(await codesOf(player), [later, winter, autumn, sameDay, spring]);
});

test('History needs a signed-in account, and is one wait on the database', async () => {
  assert.equal((await historyOf()).status, 401);
  assert.equal((await historyOf('cm_session=forged')).status, 401);
  const player = await signIn('Player');
  const { trips } = watch();
  assert.equal((await historyOf(player)).status, 200);
  assert.equal(trips(), 1);
});

const profileAt = (slug: string) => hit(profiles.onRequestGet as Handler, `/api/profiles/${slug}`, { slug });

const turnProfile = async (cookie: string, publicProfile: boolean) =>
  (await hit(me.onRequestPatch as Handler, '/api/me', {}, { method: 'PATCH', cookie, body: { publicProfile } })).json
    .user.publicSlug as string | null;

test('a public profile shows the account’s name and History to anyone with its address, and nothing private', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 2);
  const player = await signIn('Pat Player');
  await saveProfile(player, '901');
  db().raw.exec(
    "UPDATE users SET email = 'pat@example.com', avatar = 'https://cdn.test/pat.png' WHERE name = 'Pat Player'"
  );
  const slug = (await turnProfile(player, true)) ?? '';
  const shown = await profileAt(slug);
  assert.equal(shown.status, 200);
  assert.deepEqual([shown.json.name, shown.json.avatar], ['Pat Player', 'https://cdn.test/pat.png']);
  assert.deepEqual(shown.json.entries, (await historyOf(player)).json.entries);
  const text = JSON.stringify({
    ...shown.json,
    entries: shown.json.entries.map((e: HistoryEntry) => ({ ...e, code: '' }))
  });
  assert.ok(!text.includes('901') && !text.includes('pat@example.com'), 'no POP ID, no email');
  assert.equal(shown.headers.get('Cache-Control'), 'public, max-age=60');
  assert.equal(shown.headers.get('X-Robots-Tag'), 'noindex');
  assert.equal((await profileAt(slug.toLowerCase())).status, 200, 'an address typed in lower case');

  await turnProfile(player, false);
  const off = await profileAt(slug);
  const unknown = await profileAt('ZZZZZZZZ');
  assert.deepEqual([off.status, off.json], [404, unknown.json], 'off reads as no profile at all');
  assert.equal(unknown.status, 404);
  assert.equal((await profileAt('nope')).status, 404);
  const again = (await turnProfile(player, true)) ?? '';
  assert.equal((await profileAt(slug)).status, 404, 'the old address stays dead');
  assert.equal((await profileAt(again)).status, 200);
});

test('a profile is one wait on the database, and an address that asks too often is turned away', async () => {
  const player = await signIn('Player');
  const slug = (await turnProfile(player, true)) ?? '';
  const { trips } = watch();
  assert.equal((await profileAt(slug)).status, 200);
  assert.equal(trips(), 1);
  profiles._resetRateLimitStore();
  for (let i = 0; i < 1200; i += 1) {
    await profileAt('nope');
  }
  assert.equal((await profileAt(slug)).status, 429);
  profiles._resetRateLimitStore();
});

test('an event that becomes sanctioned ends its Claims, and its devices keep reporting', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await settle(code, owner, { sanctioned: false, playerReporting: true });
  await send(code, owner, { type: 'addPlayer', player: { firstName: 'Ash', lastName: 'Ketchum' } });
  await send(code, owner, { type: 'addPlayer', player: { firstName: 'Gary', lastName: 'Oak' } });
  const ash = await signIn('Ash');
  const said = await playerSays(code, { lastName: 'Ketchum', device: 'ash-phone' }, { cookie: ash });
  assert.deepEqual(await codesOf(ash), [code]);
  await settle(code, owner, { sanctioned: true });
  assert.deepEqual(await codesOf(ash), [], 'a Claim made by name links no one at a sanctioned event');
  const ids = (await loadTournament(db(), code))?.tournament.players.map(player => player.id) ?? [];
  const holders = db().raw.prepare('SELECT user_id FROM report_devices WHERE code = ?').all(code) as {
    user_id: string | null;
  }[];
  assert.deepEqual(
    holders.map(row => row.user_id),
    [null]
  );
  const asked = { popId: ids[0], device: 'ash-phone', reportToken: said.json.reportToken };
  assert.equal((await playerSays(code, asked)).status, 404, 'with no birth date on the list, nobody is Ash yet');
  await send(code, owner, {
    type: 'editPlayer',
    id: ids[0],
    firstName: 'Ash',
    lastName: 'Ketchum',
    birthDate: '02/27/1990'
  });
  const again = await playerSays(code, asked);
  assert.equal(again.json.reporter, true, 'once staff add it, the phone still reports');
});
