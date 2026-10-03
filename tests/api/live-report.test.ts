/**
 * POST /api/live/report, against an in-memory D1 and R2. The rules under test:
 * only archetypes the site names, at an event that is on, one vote per device per seat
 * (a second vote replaces the first), and a seat shows an archetype only while
 * more than half its reports agree. A whole run sent as one batch obeys the same
 * rules, all or nothing, and costs R2 one rewrite.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';

import { _resetRateLimitStore, onRequestPost } from '../../functions/api/live/report.ts';
import { ARCHETYPE_INDEX_KEY } from '../../functions/lib/api/archetypeIndexKey.ts';
import { countingTrips, sqliteD1 } from '../__utils__/sqliteD1.ts';
import { onRequestPost as reconcile } from '../../functions/api/live/reconcile.ts';
import { createVoteStore } from '../../functions/lib/live/votes.ts';
import { type LiveBucket, publishSeats } from '../../functions/lib/live/publish.ts';
import type { LiveReports } from '../../shared/live/reports.ts';
import { LIVE_SCHEDULE_KEY } from '../../shared/live/schedule.ts';

const SLUG = 'test-2027';
const SEAT = 'ada lovelace|GB';
const today = new Date().toISOString().slice(0, 10);

let database: ReturnType<typeof sqliteD1>;
let counted: ReturnType<typeof countingTrips>;
const fakeDb = () => counted.db;
const voteCount = () => (database.raw.prepare('SELECT COUNT(*) AS n FROM votes').get() as { n: number }).n;

function fakeBucket(files: Map<string, string>): LiveBucket {
  return {
    get: (key: string) => {
      const value = files.get(key);
      return Promise.resolve(value === undefined ? null : { etag: value, text: () => Promise.resolve(value) });
    },
    put: (key, value, options) => {
      const existing = files.get(key);
      const matches =
        options.onlyIf instanceof Headers ? existing === undefined : existing === options.onlyIf.etagMatches;
      if (!matches) {
        return Promise.resolve(null);
      }
      files.set(key, value);
      return Promise.resolve({ etag: value });
    }
  };
}

let files: Map<string, string>;

beforeEach(() => {
  _resetRateLimitStore();
  database = sqliteD1('live.sql');
  counted = countingTrips(database);
  files = new Map([
    [
      LIVE_SCHEDULE_KEY,
      JSON.stringify({
        generatedAt: '',
        events: [{ slug: SLUG, name: 'Test', kind: 'regional', rk9Id: 'T1', pod: 2, firstDay: today, lastDay: today }]
      })
    ],
    [ARCHETYPE_INDEX_KEY, JSON.stringify([{ name: 'Dragapult', label: 'Dragapult' }])],
    ['assets/archetype-icons.json', JSON.stringify({ Gardevoir: ['gardevoir'], "Ethan's Typhlosion": ['typhlosion'] })]
  ]);
});

const voter = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function post(body: unknown, env = { REPORTS: fakeBucket(files), LIVE_DB: fakeDb() }, from?: string) {
  const request = new Request('https://ciphermaniac.com/api/live/report', {
    method: 'POST',
    headers: from ? { 'CF-Connecting-IP': from } : undefined,
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  return onRequestPost({ request, env });
}

const report = (archetype: string | null, n: number, seat = SEAT) => ({ slug: SLUG, seat, archetype, voter: voter(n) });
/** Seats device 9 has already reported at the event. */
const fillVotes = (count: number) => {
  for (let i = 0; i < count; i += 1) {
    database.raw
      .prepare('INSERT INTO votes VALUES (?, ?, ?, ?, ?)')
      .run(SLUG, `player ${i}|US`, voter(9), 'Dragapult', 0);
  }
};
const shown = async (response: Response) => (await response.json()) as { archetype: string | null };
const published = () => (JSON.parse(files.get(`live/v1/${SLUG}/reports.json`) ?? '{"decks":{}}') as LiveReports).decks;

test('a single report is shown, with the time of the file that shows it', async () => {
  const response = await post(report('Dragapult', 1));
  assert.equal(response.status, 200);
  const file = JSON.parse(files.get(`live/v1/${SLUG}/reports.json`)!) as LiveReports;
  assert.deepEqual(await response.json(), {
    archetype: 'Dragapult',
    archetypes: { [SEAT]: 'Dragapult' },
    updatedAt: file.updatedAt
  });
  assert.deepEqual(published(), { [SEAT]: 'Dragapult' });
});

test('a split hides the seat, and a majority brings it back', async () => {
  await post(report('Dragapult', 1));
  await post(report('Gardevoir', 2));
  assert.deepEqual(published(), {});
  await post(report('Gardevoir', 3));
  assert.deepEqual(published(), { [SEAT]: 'Gardevoir' });
});

test('a device changing its mind replaces its vote rather than adding one', async () => {
  await post(report('Dragapult', 1));
  await post(report('Gardevoir', 1));
  assert.equal(voteCount(), 1);
  assert.deepEqual(published(), { [SEAT]: 'Gardevoir' });
});

test('an unchanged winning report still fences older publishers', async () => {
  let writes = 0;
  const bucket = {
    ...fakeBucket(files),
    put: (key: string, value: string) => {
      writes++;
      files.set(key, value);
      return Promise.resolve({ etag: value });
    }
  };
  const env = { REPORTS: bucket, LIVE_DB: fakeDb() };
  await post(report('Dragapult', 1), env);
  const again = await post(report('Dragapult', 1), env);
  assert.equal(writes, 2);
  const file = JSON.parse(files.get(`live/v1/${SLUG}/reports.json`)!) as LiveReports;
  assert.equal(
    ((await again.json()) as { updatedAt: string }).updatedAt,
    file.updatedAt,
    'the file that already shows it'
  );
});

test('a device can take its report back, which leaves the seat to everyone else', async () => {
  await post(report('Dragapult', 1));
  await post(report('Gardevoir', 2));
  const response = await post(report(null, 1));
  assert.equal((await shown(response)).archetype, 'Gardevoir');
  assert.deepEqual(published(), { [SEAT]: 'Gardevoir' });
  await post(report(null, 2));
  assert.deepEqual(published(), {});
  assert.equal(voteCount(), 0);
});

test('other seats already published are kept', async () => {
  await post(report('Dragapult', 1));
  await post(report('Gardevoir', 1, 'grace hopper|US'));
  assert.deepEqual(published(), { [SEAT]: 'Dragapult', 'grace hopper|US': 'Gardevoir' });
});

test('an archetype named only by the icon map is reportable, apostrophe and all', async () => {
  const response = await post(report("Ethan's Typhlosion", 1));
  assert.equal((await shown(response)).archetype, "Ethan's Typhlosion");
});

test('a deck named for a Pokémon neither list has is reportable', async () => {
  const response = await post(report('Tyrantrum', 1));
  assert.equal((await shown(response)).archetype, 'Tyrantrum');
});

test('an archetype outside the index, an event that is not on, and a malformed body are refused', async () => {
  assert.equal((await post(report('Made Up Deck', 1))).status, 400);
  assert.equal((await post({ ...report('Dragapult', 1), slug: 'elsewhere-2027' })).status, 404);
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post({ ...report('Dragapult', 1), note: 'x'.repeat(20_000) })).status, 400);
  assert.equal(voteCount(), 0);
});

test('a whole run goes in as one batch, in one rewrite of the published file and four trips to D1', async () => {
  let writes = 0;
  const bucket = {
    ...fakeBucket(files),
    put: (key: string, value: string) => {
      writes++;
      files.set(key, value);
      return Promise.resolve({ etag: value });
    }
  };
  const run = ['alice|US', 'bob|CA', 'cleo|JP'].map(seat => report('Dragapult', 1, seat));
  const response = await post({ reports: [...run, report('Gardevoir', 1)] }, { REPORTS: bucket, LIVE_DB: fakeDb() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    archetype: 'Dragapult',
    archetypes: {
      'alice|US': 'Dragapult',
      'bob|CA': 'Dragapult',
      'cleo|JP': 'Dragapult',
      [SEAT]: 'Gardevoir'
    },
    updatedAt: (JSON.parse(files.get(`live/v1/${SLUG}/reports.json`)!) as LiveReports).updatedAt
  });
  assert.equal(writes, 1);
  assert.equal(counted.trips(), 4, 'seat cap, atomic vote/outbox commit, fresh recount, acknowledgment');
  assert.equal(voteCount(), 4);
});

test('a batch with one bad report in it changes nothing', async () => {
  const good = report('Dragapult', 1, 'alice|US');
  assert.equal((await post({ reports: [good, report('Made Up Deck', 1, 'bob|CA')] })).status, 400);
  assert.equal((await post({ reports: [good, { ...report('Dragapult', 1, 'bob|CA'), voter: 'short' }] })).status, 400);
  assert.equal((await post({ reports: [] })).status, 400);
  assert.equal(voteCount(), 0);
  assert.deepEqual(published(), {});
});

test('a batch that would take a device past its seat cap is refused whole', async () => {
  fillVotes(1498);
  const run = ['alice|US', 'bob|CA', 'cleo|JP'].map(seat => report('Dragapult', 9, seat));
  assert.equal((await post({ reports: run })).status, 429);
  assert.equal((await post({ reports: run.slice(0, 2) })).status, 200);
});

test('a batch of changes and retractions is let through at the cap', async () => {
  fillVotes(1500);
  const held = ['player 0|US', 'player 1|US'].map(seat => report('Gardevoir', 9, seat));
  assert.equal((await post({ reports: [...held, report(null, 9, 'player 2|US')] })).status, 200);
  assert.equal((await post(report('Dragapult', 9, 'newcomer|US'))).status, 200);
  assert.equal((await post(report('Dragapult', 9, 'another|US'))).status, 429);
});

test('a trusted address is not rate limited, and its neighbours still are', async () => {
  const bindings = { REPORTS: fakeBucket(files), LIVE_DB: fakeDb(), TRUSTED_REPORTERS: '2a01:4f9::1, 10.0.0.1' };
  let last = 200;
  for (let i = 0; i < 61; i += 1) {
    last = (await post(report('Dragapult', i, `player ${i}|US`), bindings, '2a01:4f9::1')).status;
  }
  assert.equal(last, 200);
  for (let i = 0; i < 61; i += 1) {
    last = (await post(report('Dragapult', i, `other ${i}|US`), bindings, '203.0.113.7')).status;
  }
  assert.equal(last, 429, 'an address the list does not name is limited as before');
});

test('an empty list trusts nobody, the addressless least of all', async () => {
  const bindings = { REPORTS: fakeBucket(files), LIVE_DB: fakeDb(), TRUSTED_REPORTERS: '' };
  let last = 200;
  for (let i = 0; i < 61; i += 1) {
    last = (await post(report('Dragapult', i, `player ${i}|US`), bindings)).status;
  }
  assert.equal(last, 429);
});

test('missing bindings are a clean 503', async () => {
  assert.equal((await post(report('Dragapult', 1), {} as never)).status, 503);
});

test('a batch costs the address one per report, not one per request', async () => {
  const batch = (from: number) =>
    post({ reports: Array.from({ length: 20 }, (_, i) => report('Dragapult', 1, `player ${from + i}|US`)) });
  for (let sent = 0; sent < 60; sent += 20) {
    assert.equal((await batch(sent)).status, 200, `after ${sent}`);
  }
  assert.equal((await post(report('Dragapult', 1, 'one more|US'))).status, 429);
});

const dirtyCount = () =>
  (
    database.raw.prepare('SELECT COUNT(*) AS n FROM live_report_outbox WHERE revision > published_revision').get() as {
      n: number;
    }
  ).n;

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Hold the first conditional write while another request commits and publishes. */
function pausedBucket() {
  const base = fakeBucket(files);
  const entered = deferred();
  const release = deferred();
  let writes = 0;
  let conflicts = 0;
  const bucket: LiveBucket = {
    ...base,
    put: async (key, value, options) => {
      writes += 1;
      if (writes === 1) {
        entered.resolve();
        await release.promise;
      }
      const result = await base.put(key, value, options);
      if (result === null) {
        conflicts += 1;
      }
      return result;
    }
  };
  return { bucket, entered, release, conflicts: () => conflicts };
}

for (const existing of [false, true]) {
  test(`simultaneous distinct seats survive conditional ${existing ? 'replacement' : 'creation'}`, async () => {
    if (existing) {
      await post(report('Dragapult', 3, 'previous|US'));
    }
    const race = pausedBucket();
    const env = { REPORTS: race.bucket, LIVE_DB: fakeDb() };
    const first = post(report('Dragapult', 1), env);
    await race.entered.promise;
    assert.equal((await post(report('Gardevoir', 2, 'grace hopper|US'), env)).status, 200);
    race.release.resolve();
    assert.equal((await first).status, 200);
    assert.equal(race.conflicts(), 1);
    assert.equal(published()[SEAT], 'Dragapult');
    assert.equal(published()['grace hopper|US'], 'Gardevoir');
    if (existing) {
      assert.equal(published()['previous|US'], 'Dragapult');
    }
    assert.equal(dirtyCount(), 0);
  });
}

for (const newer of ['Dragapult', null]) {
  test(`a delayed same-seat tally cannot overwrite a newer ${newer ?? 'retraction'}`, async () => {
    await post(report('Dragapult', 1));
    const race = pausedBucket();
    const env = { REPORTS: race.bucket, LIVE_DB: fakeDb() };
    const first = post(report('Gardevoir', 1), env);
    await race.entered.promise;
    // First request wants Gardevoir. The newer transaction must produce a different file.
    const latest = newer;
    assert.equal((await post(report(latest, 1), env)).status, 200);
    race.release.resolve();
    assert.equal((await first).status, 200);
    assert.equal(race.conflicts(), 1);
    assert.deepEqual(published(), latest === null ? {} : { [SEAT]: latest });
    assert.equal(dirtyCount(), 0);
  });
}

function sweep(
  env: { REPORTS?: LiveBucket; LIVE_DB?: ReturnType<typeof fakeDb>; LIVE_RECONCILE_TOKEN?: string },
  token = 'secret'
) {
  return reconcile({
    request: new Request('https://ciphermaniac.com/api/live/reconcile', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    }),
    env
  });
}

test('R2 failure after a D1 commit remains durable until the scheduled sweep succeeds', async () => {
  let writes = 0;
  const bucket: LiveBucket = {
    ...fakeBucket(files),
    put: () => {
      writes += 1;
      return Promise.reject(new Error('R2 unavailable'));
    }
  };
  const env = { REPORTS: bucket, LIVE_DB: fakeDb(), LIVE_RECONCILE_TOKEN: 'secret' };
  const before = Date.now();
  const response = await post(report('Dragapult', 1), env);
  assert.equal(response.status, 200);
  const answer = (await response.json()) as { updatedAt: string };
  assert.ok(Date.parse(answer.updatedAt) >= before && Date.parse(answer.updatedAt) <= Date.now());
  assert.deepEqual(answer, {
    pending: true,
    updatedAt: answer.updatedAt,
    archetype: 'Dragapult',
    archetypes: { [SEAT]: 'Dragapult' }
  });
  assert.equal(writes, 5, 'bounded retries');
  assert.equal(voteCount(), 1);
  assert.equal(dirtyCount(), 1);
  assert.equal((await sweep(env)).status, 503);
  assert.equal(dirtyCount(), 1);
  assert.equal((await sweep({ ...env, REPORTS: fakeBucket(files) })).status, 200);
  assert.deepEqual(published(), { [SEAT]: 'Dragapult' });
  assert.equal(dirtyCount(), 0);
});

test('failed retraction is reconciled even after the last vote is deleted', async () => {
  await post(report('Dragapult', 1));
  const env = { REPORTS: { ...fakeBucket(files), put: () => Promise.resolve(null) }, LIVE_DB: fakeDb() };
  const before = Date.now();
  const response = await post(report(null, 1), env);
  assert.equal(response.status, 200);
  const answer = (await response.json()) as { updatedAt: string };
  assert.ok(Date.parse(answer.updatedAt) >= before && Date.parse(answer.updatedAt) <= Date.now());
  assert.deepEqual(answer, {
    pending: true,
    updatedAt: answer.updatedAt,
    archetype: null,
    archetypes: { [SEAT]: null }
  });
  assert.equal(voteCount(), 0);
  assert.equal(dirtyCount(), 1);
  await sweep({ ...env, REPORTS: fakeBucket(files), LIVE_RECONCILE_TOKEN: 'secret' });
  assert.deepEqual(published(), {});
  assert.equal(dirtyCount(), 0);
});

test('reconciliation requires its token and bindings', async () => {
  assert.equal((await sweep({})).status, 403);
  assert.equal((await sweep({ LIVE_RECONCILE_TOKEN: 'secret' }, 'wrong')).status, 403);
  assert.equal((await sweep({ LIVE_RECONCILE_TOKEN: 'secret' })).status, 503);
});

test('a vote transaction rolls back both votes and dirty markers on failure', async () => {
  database.raw.exec(
    "CREATE TRIGGER refuse_dirty BEFORE INSERT ON live_report_outbox BEGIN SELECT RAISE(ABORT, 'failure'); END"
  );
  await assert.rejects(createVoteStore(fakeDb()).settle([report('Dragapult', 1)], 0));
  assert.equal(voteCount(), 0);
  assert.equal(dirtyCount(), 0);
});

test('a vote committed between R2 publication and acknowledgment stays dirty', async () => {
  const store = createVoteStore(fakeDb());
  const base = fakeBucket(files);
  let intervene = true;
  const bucket: LiveBucket = {
    ...base,
    put: async (key, value, options) => {
      const result = await base.put(key, value, options);
      if (intervene) {
        intervene = false;
        await store.settle([report('Gardevoir', 1)], Date.now());
      }
      return result;
    }
  };
  await post(report('Dragapult', 1), { REPORTS: bucket, LIVE_DB: fakeDb() });
  assert.deepEqual(published(), { [SEAT]: 'Dragapult' });
  assert.equal(dirtyCount(), 1);
  await sweep({ REPORTS: bucket, LIVE_DB: fakeDb(), LIVE_RECONCILE_TOKEN: 'secret' });
  assert.deepEqual(published(), { [SEAT]: 'Gardevoir' });
  assert.equal(dirtyCount(), 0);
});

test('an acknowledgment failure retries safely after R2 already succeeded', async () => {
  const store = createVoteStore(fakeDb());
  await store.settle([report('Dragapult', 1)], 0);
  let acknowledgments = 0;
  const flaky = {
    ...store,
    acknowledge: async (...args: Parameters<typeof store.acknowledge>) => {
      acknowledgments += 1;
      if (acknowledgments === 1) {
        throw new Error('D1 unavailable');
      }
      await store.acknowledge(...args);
    }
  };
  await publishSeats(fakeBucket(files), flaky, SLUG);
  assert.equal(acknowledgments, 2);
  assert.equal(dirtyCount(), 0);
  assert.deepEqual(published(), { [SEAT]: 'Dragapult' });
});

test('transient R2 reads are retried and an idle publisher does not write', async () => {
  const store = createVoteStore(fakeDb());
  const base = fakeBucket(files);
  let reads = 0;
  const bucket: LiveBucket = {
    ...base,
    get: key => {
      reads += 1;
      if (reads === 1) {
        return Promise.reject(new Error('R2 unavailable'));
      }
      return base.get(key);
    }
  };
  assert.equal(await publishSeats(bucket, store, SLUG), null);
  assert.equal(reads, 2);
  assert.equal(files.has(`live/v1/${SLUG}/reports.json`), false);
});

test('a first-publish retraction creates an empty file and clears its durable marker', async () => {
  assert.equal((await post(report(null, 1))).status, 200);
  assert.equal(files.has(`live/v1/${SLUG}/reports.json`), true);
  assert.deepEqual(published(), {});
  assert.equal(dirtyCount(), 0);
});

test('the migration backfills existing votes and preserves revisions when reapplied', async () => {
  fillVotes(2);
  database.raw.exec('DROP TABLE live_report_outbox');
  const migration = readFileSync(
    new URL('../../config/d1/migrations/live-0001-report-outbox.sql', import.meta.url),
    'utf8'
  );
  database.raw.exec(migration);
  database.raw.exec(
    readFileSync(new URL('../../config/d1/migrations/live-0002-sweep-attempts.sql', import.meta.url), 'utf8')
  );
  assert.equal(dirtyCount(), 2);
  const store = createVoteStore(fakeDb());
  await store.settle([report('Gardevoir', 9, 'player 0|US')], 0);
  database.raw.exec(migration);
  assert.equal((await store.dirty(SLUG)).find(row => row.seat === 'player 0|US')?.revision, 2);
  await publishSeats(fakeBucket(files), store, SLUG);
  assert.deepEqual(published(), { 'player 0|US': 'Gardevoir', 'player 1|US': 'Dragapult' });
  assert.equal(dirtyCount(), 0);
});

test('the weekly reset preserves unpublished events until they reconcile', async () => {
  const store = createVoteStore(fakeDb());
  await store.settle([report('Dragapult', 1)], 0);
  await store.settle([{ ...report('Dragapult', 1), slug: 'finished-2027' }], 0);
  await publishSeats(fakeBucket(files), store, 'finished-2027');
  const workflow = readFileSync(new URL('../../.github/workflows/live-reports-reset.yml', import.meta.url), 'utf8');
  const data = /--data '([^']+)'/.exec(workflow)?.[1];
  assert.ok(data);
  const { sql } = JSON.parse(data) as { sql: string };
  database.raw.exec(sql);
  assert.equal(voteCount(), 1);
  assert.equal(dirtyCount(), 1);
  assert.equal(database.raw.prepare('SELECT COUNT(*) AS n FROM live_report_outbox').get()?.n, 1);
  await publishSeats(fakeBucket(files), store, SLUG);
  assert.deepEqual(published(), { [SEAT]: 'Dragapult' });
  database.raw.exec(sql);
  assert.equal(voteCount(), 0);
  assert.equal(database.raw.prepare('SELECT COUNT(*) AS n FROM live_report_outbox').get()?.n, 0);
});

test('a failed event does not prevent the sweep from publishing other events', async () => {
  const store = createVoteStore(fakeDb());
  await store.settle([report('Dragapult', 1)], 0);
  await store.settle([{ ...report('Gardevoir', 1), slug: 'another-2027' }], 0);
  const base = fakeBucket(files);
  const bucket: LiveBucket = {
    ...base,
    put: (key, value, options) => (key.includes(SLUG) ? Promise.resolve(null) : base.put(key, value, options))
  };
  assert.equal((await sweep({ REPORTS: bucket, LIVE_DB: fakeDb(), LIVE_RECONCILE_TOKEN: 'secret' })).status, 503);
  assert.deepEqual(await store.pending(), [SLUG]);
  const other = JSON.parse(files.get('live/v1/another-2027/reports.json')!) as LiveReports;
  assert.deepEqual(other.decks, { [SEAT]: 'Gardevoir' });
});

test('simultaneous conflicting voters publish the latest same-seat majority', async () => {
  await post(report('Dragapult', 1));
  const race = pausedBucket();
  const env = { REPORTS: race.bucket, LIVE_DB: fakeDb() };
  const split = post(report('Gardevoir', 2), env);
  await race.entered.promise;
  assert.equal((await post(report('Gardevoir', 3), env)).status, 200);
  race.release.resolve();
  assert.equal((await split).status, 200);
  assert.deepEqual(published(), { [SEAT]: 'Gardevoir' });
  assert.equal(race.conflicts(), 1);
  assert.equal(voteCount(), 3);
  assert.equal(dirtyCount(), 0);
});

test('a conditional conflict re-reads D1 instead of retrying the captured tally', async () => {
  const store = createVoteStore(fakeDb());
  const base = fakeBucket(files);
  let writes = 0;
  const bucket: LiveBucket = {
    ...base,
    put: async (key, value, options) => {
      writes += 1;
      if (writes === 1) {
        await store.settle([report('Gardevoir', 1)], 0);
        return null;
      }
      return base.put(key, value, options);
    }
  };
  assert.equal((await post(report('Dragapult', 1), { REPORTS: bucket, LIVE_DB: fakeDb() })).status, 200);
  assert.equal(writes, 2);
  assert.deepEqual(published(), { [SEAT]: 'Gardevoir' });
  assert.equal(dirtyCount(), 0);
});

test('ten permanently failing slugs do not starve later events in subsequent sweeps', async () => {
  const store = createVoteStore(fakeDb());
  const broken = Array.from({ length: 10 }, (_, i) => `a-broken-${i}`);
  for (const slug of broken) {
    await store.settle([{ ...report('Dragapult', 1), slug }], 0);
    files.set(`live/v1/${slug}/reports.json`, 'corrupt JSON');
  }
  const healthy = 'z-healthy';
  await store.settle([{ ...report('Gardevoir', 1), slug: healthy }], 0);
  const env = { REPORTS: fakeBucket(files), LIVE_DB: fakeDb(), LIVE_RECONCILE_TOKEN: 'secret' };
  assert.deepEqual(await store.pending(), broken);
  assert.equal((await sweep(env)).status, 503);
  assert.equal(files.has(`live/v1/${healthy}/reports.json`), false);
  assert.equal((await store.pending())[0], healthy);
  assert.equal((await sweep(env)).status, 503);
  const publishedHealthy = JSON.parse(files.get(`live/v1/${healthy}/reports.json`)!) as LiveReports;
  assert.deepEqual(publishedHealthy.decks, { [SEAT]: 'Gardevoir' });
  assert.equal(dirtyCount(), 10, 'permanent failures remain available for later recovery');
});

test('new dirty seats preserve event sweep priority even when earlier seats are clean', async () => {
  const store = createVoteStore(fakeDb());
  await store.settle([report('Dragapult', 1)], 0);
  await store.markAttempted(SLUG, 100);
  await publishSeats(fakeBucket(files), store, SLUG);
  await store.settle([report('Gardevoir', 1, 'new seat|US')], 0);
  await store.settle([{ ...report('Gardevoir', 1), slug: 'z-unattempted' }], 0);
  assert.deepEqual(await store.pending(), ['z-unattempted', SLUG]);
  await store.markAttempted(SLUG, 100);
  assert.equal(
    database.raw.prepare('SELECT MAX(last_attempted) AS at FROM live_report_outbox WHERE slug = ?').get(SLUG)?.at,
    101
  );
});

test('reset keeps published outbox rows for an event that still has dirty votes', async () => {
  const store = createVoteStore(fakeDb());
  await post(report('Dragapult', 1));
  await store.settle([report('Gardevoir', 1, 'new seat|US')], 0);
  const workflow = readFileSync(new URL('../../.github/workflows/live-reports-reset.yml', import.meta.url), 'utf8');
  const data = /--data '([^']+)'/.exec(workflow)?.[1];
  assert.ok(data);
  database.raw.exec((JSON.parse(data) as { sql: string }).sql);
  assert.equal(voteCount(), 2);
  assert.equal(database.raw.prepare('SELECT COUNT(*) AS n FROM live_report_outbox').get()?.n, 2);
  assert.equal(dirtyCount(), 1);
});
