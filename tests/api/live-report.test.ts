/**
 * POST /api/live/report, against an in-memory D1 and R2. The rules under test:
 * only archetypes the site names, at an event that is on, one vote per device per seat
 * (a second vote replaces the first), and a seat shows an archetype only while
 * more than half its reports agree.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { _resetRateLimitStore, onRequestPost } from '../../functions/api/live/report.ts';
import { ARCHETYPE_INDEX_KEY } from '../../functions/lib/api/archetypeIndexKey.ts';
import type { D1Like } from '../../functions/lib/live/votes.ts';
import type { LiveReports } from '../../shared/live/reports.ts';
import { LIVE_SCHEDULE_KEY } from '../../shared/live/schedule.ts';

const SLUG = 'test-2027';
const SEAT = 'ada lovelace|GB';
const today = new Date().toISOString().slice(0, 10);

interface Vote {
  slug: string;
  seat: string;
  voter: string;
  archetype: string;
}

/** Just enough D1 for the three statements the vote store prepares. */
function fakeDb(votes: Vote[]): D1Like {
  return {
    prepare: sql => {
      let args: unknown[] = [];
      const statement = {
        bind: (...values: unknown[]) => {
          args = values;
          return statement;
        },
        first: <T>() =>
          Promise.resolve({ n: votes.filter(vote => vote.slug === args[0] && vote.voter === args[1]).length } as T),
        all: <T>() => {
          const counts = new Map<string, number>();
          for (const vote of votes.filter(candidate => candidate.slug === args[0] && candidate.seat === args[1])) {
            counts.set(vote.archetype, (counts.get(vote.archetype) ?? 0) + 1);
          }
          return Promise.resolve({ results: [...counts].map(([archetype, n]) => ({ archetype, votes: n })) as T[] });
        },
        run: () => {
          const [slug, seat, voter, archetype] = args as string[];
          const existing = votes.find(vote => vote.slug === slug && vote.seat === seat && vote.voter === voter);
          if (sql.startsWith('DELETE')) {
            votes.splice(0, votes.length, ...votes.filter(vote => vote !== existing));
            return Promise.resolve();
          }
          assert.match(sql, /ON CONFLICT \(slug, seat, voter\) DO UPDATE/);
          if (existing) {
            existing.archetype = archetype;
          } else {
            votes.push({ slug, seat, voter, archetype });
          }
          return Promise.resolve();
        }
      };
      return statement;
    }
  };
}

function fakeBucket(files: Map<string, string>) {
  return {
    get: (key: string) => Promise.resolve(files.has(key) ? { text: () => Promise.resolve(files.get(key)!) } : null),
    put: (key: string, value: string) => Promise.resolve(void files.set(key, value))
  };
}

let votes: Vote[];
let files: Map<string, string>;

beforeEach(() => {
  _resetRateLimitStore();
  votes = [];
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

function post(body: unknown, env = { REPORTS: fakeBucket(files), LIVE_DB: fakeDb(votes) }, from?: string) {
  const request = new Request('https://ciphermaniac.com/api/live/report', {
    method: 'POST',
    headers: from ? { 'CF-Connecting-IP': from } : undefined,
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  return onRequestPost({ request, env });
}

const report = (archetype: string | null, n: number, seat = SEAT) => ({ slug: SLUG, seat, archetype, voter: voter(n) });
const published = () => (JSON.parse(files.get(`live/v1/${SLUG}/reports.json`) ?? '{"decks":{}}') as LiveReports).decks;

test('a single report is shown', async () => {
  const response = await post(report('Dragapult', 1));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { archetype: 'Dragapult' });
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
  assert.equal(votes.length, 1);
  assert.deepEqual(published(), { [SEAT]: 'Gardevoir' });
});

test('an unchanged winning report does not rewrite R2', async () => {
  let writes = 0;
  const bucket = {
    ...fakeBucket(files),
    put: (key: string, value: string) => {
      writes++;
      files.set(key, value);
      return Promise.resolve(undefined);
    }
  };
  const env = { REPORTS: bucket, LIVE_DB: fakeDb(votes) };
  await post(report('Dragapult', 1), env);
  await post(report('Dragapult', 1), env);
  assert.equal(writes, 1);
});

test('a device can take its report back, which leaves the seat to everyone else', async () => {
  await post(report('Dragapult', 1));
  await post(report('Gardevoir', 2));
  const response = await post(report(null, 1));
  assert.deepEqual(await response.json(), { archetype: 'Gardevoir' });
  assert.deepEqual(published(), { [SEAT]: 'Gardevoir' });
  await post(report(null, 2));
  assert.deepEqual(published(), {});
  assert.equal(votes.length, 0);
});

test('other seats already published are kept', async () => {
  await post(report('Dragapult', 1));
  await post(report('Gardevoir', 1, 'grace hopper|US'));
  assert.deepEqual(published(), { [SEAT]: 'Dragapult', 'grace hopper|US': 'Gardevoir' });
});

test('an archetype named only by the icon map is reportable, apostrophe and all', async () => {
  const response = await post(report("Ethan's Typhlosion", 1));
  assert.deepEqual(await response.json(), { archetype: "Ethan's Typhlosion" });
});

test('an archetype outside the index, an event that is not on, and a malformed body are refused', async () => {
  assert.equal((await post(report('Made Up Deck', 1))).status, 400);
  assert.equal((await post({ ...report('Dragapult', 1), slug: 'elsewhere-2027' })).status, 404);
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post({ ...report('Dragapult', 1), note: 'x'.repeat(2000) })).status, 400);
  assert.equal(votes.length, 0);
});

test('one device cannot report more seats than an event could plausibly need', async () => {
  for (let i = 0; i < 150; i += 1) {
    votes.push({ slug: SLUG, seat: `player ${i}|US`, voter: voter(9), archetype: 'Dragapult' });
  }
  assert.equal((await post(report('Dragapult', 9))).status, 429);
});

test('a trusted address is not rate limited, and its neighbours still are', async () => {
  const bindings = { REPORTS: fakeBucket(files), LIVE_DB: fakeDb(votes), TRUSTED_REPORTERS: '2a01:4f9::1, 10.0.0.1' };
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
  const bindings = { REPORTS: fakeBucket(files), LIVE_DB: fakeDb(votes), TRUSTED_REPORTERS: '' };
  let last = 200;
  for (let i = 0; i < 61; i += 1) {
    last = (await post(report('Dragapult', i, `player ${i}|US`), bindings)).status;
  }
  assert.equal(last, 429);
});

test('a flood from one address is limited, and missing bindings are a clean 503', async () => {
  let last = 200;
  for (let i = 0; i < 61; i += 1) {
    last = (await post(report('Dragapult', i))).status;
  }
  assert.equal(last, 429);
  assert.equal((await post(report('Dragapult', 1), {} as never)).status, 503);
});
