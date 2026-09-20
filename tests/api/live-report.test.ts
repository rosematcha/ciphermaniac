/**
 * POST /api/live/report, against an in-memory D1 and R2. The rules under test:
 * only archetypes the site names, at an event that is on, one vote per device per seat
 * (a second vote replaces the first), and a seat shows an archetype only while
 * more than half its reports agree. A whole run sent as one batch obeys the same
 * rules, all or nothing, and costs R2 one rewrite.
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
        first: <T>() => {
          // `loadOf` binds the seats it asks about, then the slug and the voter.
          const seats = args.slice(0, -2) as string[];
          const [slug, voter] = args.slice(-2) as string[];
          const mine = votes.filter(vote => vote.slug === slug && vote.voter === voter);
          return Promise.resolve({ n: mine.length, mine: mine.filter(vote => seats.includes(vote.seat)).length } as T);
        },
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
/** Seats device 9 has already reported at the event. */
const fillVotes = (count: number) => {
  for (let i = 0; i < count; i += 1) {
    votes.push({ slug: SLUG, seat: `player ${i}|US`, voter: voter(9), archetype: 'Dragapult' });
  }
};
const shown = async (response: Response) => (await response.json()) as { archetype: string | null };
const published = () => (JSON.parse(files.get(`live/v1/${SLUG}/reports.json`) ?? '{"decks":{}}') as LiveReports).decks;

test('an oversized body is refused by its bytes, not its characters', async () => {
  // 5,000 characters but 15,000 bytes: past the cap only when counted properly.
  const response = await post({ ...report('Dragapult', 1), padding: 'あ'.repeat(5000) });
  assert.equal(response.status, 400);
  assert.deepEqual(published(), {});
});

test('a single report is shown', async () => {
  const response = await post(report('Dragapult', 1));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    archetype: 'Dragapult',
    archetypes: { [SEAT]: 'Dragapult' }
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
  assert.equal((await shown(response)).archetype, 'Gardevoir');
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
  assert.equal((await shown(response)).archetype, "Ethan's Typhlosion");
});

test('an archetype outside the index, an event that is not on, and a malformed body are refused', async () => {
  assert.equal((await post(report('Made Up Deck', 1))).status, 400);
  assert.equal((await post({ ...report('Dragapult', 1), slug: 'elsewhere-2027' })).status, 404);
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post({ ...report('Dragapult', 1), note: 'x'.repeat(20_000) })).status, 400);
  assert.equal(votes.length, 0);
});

test('a whole run goes in as one batch, in one rewrite of the published file', async () => {
  let writes = 0;
  const bucket = {
    ...fakeBucket(files),
    put: (key: string, value: string) => {
      writes++;
      files.set(key, value);
      return Promise.resolve(undefined);
    }
  };
  const run = ['alice|US', 'bob|CA', 'cleo|JP'].map(seat => report('Dragapult', 1, seat));
  const response = await post(
    { reports: [...run, report('Gardevoir', 1)] },
    { REPORTS: bucket, LIVE_DB: fakeDb(votes) }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    archetype: 'Dragapult',
    archetypes: {
      'alice|US': 'Dragapult',
      'bob|CA': 'Dragapult',
      'cleo|JP': 'Dragapult',
      [SEAT]: 'Gardevoir'
    }
  });
  assert.equal(writes, 1);
  assert.equal(votes.length, 4);
});

test('a batch with one bad report in it changes nothing', async () => {
  const good = report('Dragapult', 1, 'alice|US');
  assert.equal((await post({ reports: [good, report('Made Up Deck', 1, 'bob|CA')] })).status, 400);
  assert.equal((await post({ reports: [good, { ...report('Dragapult', 1, 'bob|CA'), voter: 'short' }] })).status, 400);
  assert.equal((await post({ reports: [] })).status, 400);
  assert.equal(votes.length, 0);
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

test('one device cannot report more seats than an event could plausibly need', async () => {
  fillVotes(1500);
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

test('a device at the cap can still change and take back the seats it has', async () => {
  fillVotes(1500);
  const seat = 'player 0|US';
  assert.equal((await post(report('Gardevoir', 9, seat))).status, 200);
  assert.deepEqual(published(), { [seat]: 'Gardevoir' });
  assert.equal((await post(report(null, 9, seat))).status, 200);
  assert.deepEqual(published(), {});
});

test('a flood from one address is limited, and missing bindings are a clean 503', async () => {
  let last = 200;
  for (let i = 0; i < 61; i += 1) {
    last = (await post(report('Dragapult', i))).status;
  }
  assert.equal(last, 429);
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
