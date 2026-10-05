import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as history from '../../functions/api/history.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { endSession } from '../../functions/lib/auth/session.ts';
import type { D1Like } from '../../functions/lib/types.ts';
import { apiCalls, request } from '../__utils__/apiCalls.ts';
import { deferred } from '../__utils__/deferred.ts';
import { eventCalls } from '../__utils__/eventCalls.ts';
import { countingTrips, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, addPlayers, send } = eventCalls(hit);

beforeEach(() => {
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true' };
  event._resetRateLimitStore();
});

function get(code: string | null, cookie?: string, etag?: string, suffix = '') {
  const asked = request(code ? `/api/tournaments/${code}${suffix}` : '/api/history', { cookie });
  if (etag !== undefined) {
    asked.headers.set('If-None-Match', etag);
  }
  return code
    ? event.onRequestGet({ request: asked, env, params: { code } })
    : history.onRequestGet({ request: asked, env, params: {} });
}

function validator(response: Response): string {
  const etag = response.headers.get('ETag');
  assert.ok(etag);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-cache');
  assert.equal(response.headers.get('Vary'), 'Cookie');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  return etag;
}

test('tournament validators handle weak lists, wildcard, and changed data', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  const first = await get(code);
  const etag = validator(first);
  const version = (await first.json()).version as number;
  const counted = countingTrips(env.TOURNAMENT_DB as D1Like);
  env.TOURNAMENT_DB = counted.db;
  const unchanged = await get(code, undefined, `"other,tag", W/${etag}`);
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), '');
  assert.equal(validator(unchanged), etag);
  assert.equal(counted.trips(), 1, 'revalidation still reads current data once');
  assert.equal((await get(code, undefined, '*')).status, 304);
  const mismatch = await get(code, undefined, '"stale"', `?since=${version}`);
  assert.equal(mismatch.status, 200, 'ETag takes precedence over the legacy version poll');
  const poll = await get(code, undefined, undefined, `?since=${version}`);
  assert.equal(poll.status, 204);
  assert.equal(poll.headers.get('Cache-Control'), 'no-store');
  await send(code, owner, { type: 'updateInfo', info: { name: 'Changed' } });
  const changed = await get(code, undefined, etag);
  assert.equal(changed.status, 200);
  assert.notEqual(validator(changed), etag);
});

test('tournament validators follow viewer changes without an event version change', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  const owned = await get(code, owner);
  const etag = validator(owned);
  const anonymous = await get(code, undefined, etag);
  assert.equal(anonymous.status, 200);
  assert.notEqual(validator(anonymous), etag);
  await endSession(env.TOURNAMENT_DB as D1Like, request('/', { cookie: owner }));
  const signedOut = await get(code, owner, etag);
  assert.equal(signedOut.status, 200);
  assert.equal((await signedOut.json()).viewer.role, null);
  assert.equal(validator(signedOut), validator(anonymous));
});

test('a profile change invalidates a player view even when the event version is unchanged', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  await addPlayers(code, owner, 1);
  const player = await signIn('Player');
  const before = await get(code, player);
  const etag = validator(before);
  const oldView = await before.json();
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  db.raw.prepare("UPDATE users SET pop_id = '900' WHERE handle = 'player'").run();
  const after = await get(code, player, etag, `?since=${oldView.version}`);
  assert.equal(after.status, 200);
  const newView = await after.json();
  assert.equal(newView.version, oldView.version);
  assert.equal(oldView.viewer.me, null);
  assert.ok(newView.viewer.me);
  assert.notEqual(validator(after), etag);
});

test('history revalidates entries and refuses a revoked session before matching its ETag', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  const first = await get(null, owner);
  const etag = validator(first);
  const unchanged = await get(null, owner, `W/${etag}`);
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), '');
  assert.equal(validator(unchanged), etag);
  await addPlayers(code, owner, 1);
  // Link the account to the player directly, without changing the tournament version.
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  db.raw.prepare("UPDATE users SET pop_id = '900' WHERE handle = 'organizer'").run();
  const changed = await get(null, owner, etag);
  assert.equal(changed.status, 200);
  assert.notEqual(validator(changed), etag);
  assert.equal((await changed.json()).entries.length, 1);
  await endSession(db, request('/', { cookie: owner }));
  const revoked = await get(null, owner, validator(changed));
  assert.equal(revoked.status, 401);
  assert.equal(revoked.headers.get('Cache-Control'), 'no-store');
  assert.equal(revoked.headers.get('ETag'), null);
});

/** Keep a database read pending long enough for a burst of session hashes to finish. */
function heldDatabase(db: D1Like) {
  const counted = countingTrips(db);
  const release = deferred<void>();
  const started = deferred<void>();
  return {
    db: {
      ...counted.db,
      batch: async statements => {
        started.resolve();
        await release.promise;
        return counted.db.batch(statements);
      }
    } satisfies D1Like,
    started: started.promise,
    release: release.resolve,
    trips: counted.trips
  };
}

test('bursts share reads and serialization, but receive independently consumable responses', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  for (const target of [code, null]) {
    const etag = validator(await get(target, owner));
    const held = heldDatabase(env.TOURNAMENT_DB as D1Like);
    env.TOURNAMENT_DB = held.db;
    const calls = Array.from({ length: 8 }, (_, index) =>
      get(target, `${owner}; unrelated=${index}`, index === 0 ? etag : undefined)
    );
    await held.started;
    // Let the other crypto operations enter the pending read before releasing it.
    await new Promise<void>(resolve => {
      setTimeout(resolve, 30);
    });
    held.release();
    const responses = await Promise.all(calls);
    assert.equal(held.trips(), 1);
    assert.equal(responses[0].status, 304, 'each caller evaluates its own condition');
    assert.equal(await responses[0].text(), '');
    const bodies = await Promise.all(responses.slice(1).map(response => response.text()));
    assert.ok(bodies.every(body => body === bodies[0] && body.length > 0));
    await get(target, owner);
    assert.equal(held.trips(), 2, 'settled reads are not retained');
  }
});

test('legacy polls coalesce their version reads, and missing resources remain uncacheable', async () => {
  const owner = await signIn('Organizer', 'organizer');
  const code = await newSwiss(owner);
  const version = (await (await get(code)).json()).version as number;
  const counted = countingTrips(env.TOURNAMENT_DB as D1Like);
  env.TOURNAMENT_DB = counted.db;
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => get(code, undefined, undefined, `?since=${version}`))
  );
  assert.ok(responses.every(response => response.status === 204));
  assert.equal(counted.trips(), 1);
  const missing = await get('ZZZZZZ', undefined, '*');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('Cache-Control'), 'no-store');
  assert.equal(missing.headers.get('ETag'), null);
  assert.equal((await get(null, undefined, '*')).status, 401);
  const errors = await Promise.all(Array.from({ length: 3 }, () => get('ZZZZZZ')));
  const bodies = await Promise.all(errors.map(error => error.text()));
  assert.ok(bodies.every(body => body === bodies[0] && body.includes('No such tournament')));
  env = {};
  assert.equal((await get(code, undefined, '*')).status, 503);
  assert.equal((await get(null, owner, '*')).status, 503);
});
