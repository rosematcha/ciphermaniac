/**
 * The event locator producer: Pokedata paging and the publish step.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchAllEvents,
  fetchLocalEvents,
  fetchPage,
  LOCAL_PAGE_SIZE,
  localsCutoff,
  pageUrl,
  parsePage,
  POKEDATA_TABLE_API
} from '../../.github/scripts/lib/pokedata.ts';
import { cellHash, type Publisher, runEventLocator, runLocalsLocator } from '../../.github/scripts/lib/eventLocator.ts';
import type { LocalsCell, LocalsIndex, LocatorIndex } from '../../shared/events/types.ts';
import { pageBody, rawEventWithId, rawLocalEvent } from '../__utils__/pokedata.ts';

const PHP_FATAL =
  '<br />\n<b>Fatal error</b>:  Uncaught TypeError: mysqli::real_escape_string(): Argument #1 ($string) must be of type string';

const noSleep = async () => undefined;

function respond(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
}

test('a page must be JSON of the documented shape', () => {
  const page = parsePage(pageBody([rawEventWithId(1)], 1, 1));
  assert.equal(page.totalItems, 1);
  assert.equal(page.totalPages, 1);
  assert.equal(page.events.length, 1);
  assert.throws(() => parsePage(PHP_FATAL), /not JSON: <br \/> <b>Fatal error/);
  assert.throws(() => parsePage('{"events":[]}'), /unexpected response shape/);
  assert.throws(
    () => parsePage('{"metadata":{"total_items":1,"total_pages":1},"events":{}}'),
    /unexpected response shape/
  );
});

test('pages are requested by type and page number with a browser-like agent', async () => {
  let seenUrl = '';
  let seenAgent = '';
  await fetchPage(3, {
    fetch: async (input, init) => {
      seenUrl = String(input);
      seenAgent = new Headers(init?.headers).get('User-Agent') ?? '';
      return respond(pageBody([], 0, 0, 3));
    }
  });
  assert.equal(seenUrl, 'https://pokedata.ovh/events/apiv2/_tcg/cups/challenges/pre/_page/3');
  assert.equal(seenUrl, pageUrl(3));
  assert.match(seenAgent, /Ciphermaniac/);
});

test('a page is retried through server errors and PHP error bodies', async () => {
  const answers = [respond('busy', 503), respond(PHP_FATAL), respond(pageBody([rawEventWithId(1)], 1, 1))];
  const logged: string[] = [];
  const page = await fetchPage(1, { fetch: async () => answers.shift()!, sleep: noSleep, log: m => logged.push(m) });
  assert.equal(page.events.length, 1);
  assert.equal(logged.length, 2);
  assert.match(logged[0] ?? '', /HTTP 503/);
});

test('a page that keeps failing fails the pull with the last error', async () => {
  let calls = 0;
  await assert.rejects(
    fetchPage(2, {
      fetch: async () => {
        calls++;
        throw new Error('socket hang up');
      },
      sleep: noSleep,
      attempts: 3
    }),
    /page 2 failed after 3 attempts: socket hang up/
  );
  assert.equal(calls, 3);
});

test('every page is collected in order', async () => {
  const pages: Record<number, string> = {
    1: pageBody([rawEventWithId(1), rawEventWithId(2)], 5, 3, 1),
    2: pageBody([rawEventWithId(3), rawEventWithId(4)], 5, 3, 2),
    3: pageBody([rawEventWithId(5)], 5, 3, 3)
  };
  const pull = await fetchAllEvents({
    fetch: async input => respond(pages[Number(String(input).split('/').pop())] ?? ''),
    sleep: noSleep
  });
  assert.equal(pull.totalItems, 5);
  assert.equal(pull.totalPages, 3);
  assert.deepEqual(
    pull.events.map(event => (event as { Display_id: string }).Display_id),
    ['26-09-000001', '26-09-000002', '26-09-000003', '26-09-000004', '26-09-000005']
  );
});

test('locals come from the table endpoint, posted as a Friendly TCG query', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const events = await fetchLocalEvents({
    fetch: async (input, init) => {
      requests.push({ url: String(input), init });
      return respond(JSON.stringify([rawLocalEvent()]));
    },
    sleep: noSleep
  });
  assert.equal(events.length, 1);
  assert.equal(requests[0]?.url, POKEDATA_TABLE_API);
  assert.equal(requests[0]?.init?.method, 'POST');
  assert.equal(JSON.parse(String(requests[0]?.init?.body)).ftcg, '1');
});

/** Locals records, all on the given date. */
function localsOn(date: string, count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => rawLocalEvent({ date, guid: `${date}-${i}` }));
}

test('the locals pull stops at the first page past the horizon and drops what is past it', async () => {
  const now = () => new Date('2026-09-15T12:00:00Z');
  assert.equal(localsCutoff(now(), 21), '2026-10-06');
  const pages = [
    JSON.stringify(localsOn('2026-09-20', LOCAL_PAGE_SIZE)),
    JSON.stringify([...localsOn('2026-10-06', 50), ...localsOn('2026-10-07', 50)])
  ];
  const requested: number[] = [];
  const events = await fetchLocalEvents({
    now,
    fetch: async (_input, init) => {
      const page = JSON.parse(String(init?.body)).page as number;
      requested.push(page);
      return respond(pages[page] ?? '[]');
    },
    sleep: noSleep
  });
  assert.deepEqual(requested, [0, 1]);
  assert.equal(events.length, 150);
  assert.ok(events.every(event => (event as { date: string }).date <= '2026-10-06'));
});

test('a short locals page ends the pull before the horizon', async () => {
  const events = await fetchLocalEvents({
    fetch: async () => respond(JSON.stringify(localsOn('2026-09-16', 3))),
    sleep: noSleep
  });
  assert.equal(events.length, 3);
});

test('a server that answers every page with page 1 is caught', async () => {
  await assert.rejects(
    fetchAllEvents({
      fetch: async () => respond(pageBody([rawEventWithId(1)], 3, 3, 1)),
      sleep: noSleep,
      attempts: 1
    }),
    /asked for page 2, got page 1/
  );
});

test('repeated records do not count toward completeness', async () => {
  const same = [rawEventWithId(1), rawEventWithId(1)];
  await assert.rejects(
    fetchAllEvents({
      fetch: async input => respond(pageBody(same, 4, 2, Number(String(input).split('/').pop()))),
      sleep: noSleep
    }),
    /1 distinct of the 4 events/
  );
});

test('a page count that moves mid-pull fails the pull', async () => {
  const pages: Record<number, string> = {
    1: pageBody([rawEventWithId(1)], 2, 2, 1),
    2: pageBody([rawEventWithId(2)], 2, 3, 2)
  };
  await assert.rejects(
    fetchAllEvents({
      fetch: async input => respond(pages[Number(String(input).split('/').pop())] ?? ''),
      sleep: noSleep
    }),
    /page count moved from 2 to 3/
  );
});

test('a pull well short of the advertised total is refused', async () => {
  await assert.rejects(
    fetchAllEvents({
      fetch: async () => respond(pageBody([rawEventWithId(1)], 300, 1)),
      sleep: noSleep
    }),
    /returned 1 distinct of the 300 events it advertised/
  );
});

function memoryPublisher(existing: LocatorIndex | null = null, existingLocals: LocalsIndex | null = null) {
  const writes: string[] = [];
  const removes: string[] = [];
  const store = new Map<string, unknown>();
  const publisher: Publisher = {
    read: async <T>(key: string) =>
      (key === 'events/v1/index.json' ? existing : key === 'events/locals/v1/index.json' ? existingLocals : null) as T,
    write: async (key, value) => {
      writes.push(key);
      store.set(key, value);
    },
    remove: async key => {
      removes.push(key);
    }
  };
  return { publisher, writes, removes, store };
}

function previousIndex(
  total: number,
  cells: Record<string, number>,
  previous?: LocatorIndex['previous']
): LocatorIndex {
  return {
    version: 1,
    generation: '20260914T100000Z',
    ...(previous ? { previous } : {}),
    generatedAt: '2026-09-14T10:00:00.000Z',
    source: 'https://pokedata.ovh/events/',
    cellDegrees: 5,
    cells,
    countries: ['US'],
    kinds: { cup: total, challenge: 0, prerelease: 0, local: 0 },
    total
  };
}

const pullOf = (events: unknown[]) => async () => ({ events, totalItems: events.length, totalPages: 1 });
const NOW = () => new Date('2026-09-15T12:00:00Z');

test('a run writes its own folder, then the index, then retires the run before last', async () => {
  const { publisher, writes, removes, store } = memoryPublisher(
    previousIndex(2, { '30_-100': 1, '50_-5': 1 }, { generation: '20260913T100000Z', cells: ['40_-80'] })
  );
  const result = await runEventLocator({
    fetchEvents: pullOf([rawEventWithId(1), rawEventWithId(2)]),
    publisher,
    now: NOW
  });
  assert.deepEqual(writes, [
    'events/v1/20260915T120000Z/cells/30_-100.json',
    'events/v1/20260915T120000Z/places.json',
    'events/v1/index.json'
  ]);
  const index = store.get('events/v1/index.json') as LocatorIndex;
  assert.equal(index.generation, '20260915T120000Z');
  assert.deepEqual(index.previous, { generation: '20260914T100000Z', cells: ['30_-100', '50_-5'] });
  // The run just replaced stays readable; only the one before it goes.
  assert.deepEqual(removes, ['events/v1/20260913T100000Z/cells/40_-80.json', 'events/v1/20260913T100000Z/places.json']);
  assert.deepEqual(result.removed, ['40_-80']);
  assert.equal(result.total, 2);
  assert.equal(result.cells, 1);
});

test('a collapsed generation is refused, and nothing is written', async () => {
  const { publisher, writes } = memoryPublisher(previousIndex(100, { '30_-100': 100 }));
  await assert.rejects(
    runEventLocator({ fetchEvents: pullOf([rawEventWithId(1)]), publisher, now: NOW }),
    /Refusing to publish: the new generation has 1 events, under 60% of the 100 published/
  );
  assert.deepEqual(writes, []);
});

test('allow_shrink publishes a real drop but never an empty generation', async () => {
  const shrunk = memoryPublisher(previousIndex(100, { '30_-100': 100 }));
  const logged: string[] = [];
  await runEventLocator({
    fetchEvents: pullOf([rawEventWithId(1)]),
    publisher: shrunk.publisher,
    now: NOW,
    allowShrink: true,
    log: m => logged.push(m)
  });
  assert.equal(shrunk.writes.at(-1), 'events/v1/index.json');
  assert.ok(logged.some(line => /past the shrink guard/.test(line)));

  const emptied = memoryPublisher(previousIndex(100, { '30_-100': 100 }));
  await assert.rejects(
    runEventLocator({ fetchEvents: pullOf([]), publisher: emptied.publisher, now: NOW, allowShrink: true }),
    /no events/
  );
  assert.deepEqual(emptied.writes, []);
});

/** The same weekly slot on three weeks, as Pokedata lists it. */
function weeklyLocal(league: string, overrides: Record<string, unknown> = {}) {
  return ['2026-09-16', '2026-09-23', '2026-09-30'].map((date, i) =>
    rawLocalEvent({
      league,
      date,
      guid: `${league.padStart(8, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ...overrides
    })
  );
}

// eslint-disable-next-line camelcase -- Pokedata's field name
const LONDON = { latitude: '51.5074', longitude: '-0.1278', country_code: 'GB' };

async function localsRun(raw: unknown[], existing: LocalsIndex | null, allowShrink = false) {
  const memory = memoryPublisher(null, existing);
  const result = await runLocalsLocator({
    fetchLocals: async () => raw,
    publisher: memory.publisher,
    now: NOW,
    allowShrink
  });
  return { ...memory, result };
}

test('the first locals run writes every cell, then the index', async () => {
  const { writes, removes, store, result } = await localsRun([...weeklyLocal('42'), ...weeklyLocal('7', LONDON)], null);
  assert.deepEqual(writes, [
    'events/locals/v1/cells/30_-100.json',
    'events/locals/v1/cells/50_-5.json',
    'events/locals/v1/index.json'
  ]);
  assert.deepEqual(removes, []);
  const index = store.get('events/locals/v1/index.json') as LocalsIndex;
  assert.equal(index.total, 2);
  assert.equal(index.venues, 2);
  assert.equal(index.horizonDays, 21);
  assert.equal(index.cells['30_-100']?.hash, cellHash(store.get('events/locals/v1/cells/30_-100.json') as LocalsCell));
  assert.deepEqual(result.written, ['30_-100', '50_-5']);
});

test('a run whose locals did not change writes nothing', async () => {
  const raw = [...weeklyLocal('42'), ...weeklyLocal('7', LONDON)];
  const first = await localsRun(raw, null);
  const previous = first.store.get('events/locals/v1/index.json') as LocalsIndex;
  const second = await localsRun(raw, { ...previous, updatedAt: '2026-09-14T10:00:00.000Z' });
  assert.deepEqual(second.writes, []);
  assert.deepEqual(second.removes, []);
  assert.equal(second.result.unchanged, 2);
});

test('only the cells that changed are rewritten; a cell with no locals left is deleted after the index', async () => {
  const first = await localsRun([...weeklyLocal('42'), ...weeklyLocal('7', LONDON)], null);
  const previous = first.store.get('events/locals/v1/index.json') as LocalsIndex;
  const second = await localsRun(
    [...weeklyLocal('42'), ...weeklyLocal('43', { when: '2026-09-16 20:00:00' })],
    previous
  );
  assert.deepEqual(second.writes, ['events/locals/v1/cells/30_-100.json', 'events/locals/v1/index.json']);
  assert.deepEqual(second.removes, ['events/locals/v1/cells/50_-5.json']);
  assert.deepEqual(second.result.removed, ['50_-5']);
  assert.equal(second.result.unchanged, 0);
});

test('a collapsed locals listing is refused on its own guard, and nothing is written', async () => {
  const first = await localsRun(Array.from({ length: 10 }, (_, i) => weeklyLocal(String(i + 1))).flat(), null);
  const previous = first.store.get('events/locals/v1/index.json') as LocalsIndex;
  await assert.rejects(
    localsRun(weeklyLocal('1'), previous),
    /Refusing to publish locals: .*1 events, under 60% of the 10/
  );
  const shrunk = await localsRun(weeklyLocal('1'), previous, true);
  assert.equal(shrunk.writes.at(-1), 'events/locals/v1/index.json');
  await assert.rejects(localsRun([], previous, true), /no events/);
});
