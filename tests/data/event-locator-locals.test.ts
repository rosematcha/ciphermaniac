/* eslint-disable camelcase -- Pokedata's API field names are snake_case; the fixtures mirror them exactly */

/**
 * Locals as series: grouping weekly occurrences into store slots, and
 * expanding them back into dates.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { addDays, buildLocalsArtifacts, expandLocals, weekdayOf } from '../../shared/events/locals.ts';
import type { LocalsCell, LocalSlot } from '../../shared/events/types.ts';
import { rawListedLocal, rawLocalEvent, rawLocalSeries } from '../__utils__/pokedata.ts';

/** A Tuesday. The three-week window runs through Tuesday 2026-10-06. */
const NOW = new Date('2026-09-15T12:00:00Z');
const SOURCE = 'https://pokedata.ovh/events/';
const WEDNESDAYS = ['2026-09-16', '2026-09-23', '2026-09-30'];

/** Venues on UTC unless a test says otherwise, so a record's `when` is its wall time. */
function build(raw: unknown[], { now = NOW, zone = 'UTC' } = {}) {
  return buildLocalsArtifacts(raw, {
    now,
    source: SOURCE,
    horizonDays: 21,
    hash: cell => `h${cell.venues.length}`,
    zoneAt: () => zone
  });
}

function slots(raw: unknown[], cell = '30_-100', venue = 0): LocalSlot[] {
  return build(raw).cells.get(cell)?.venues[venue]?.slots ?? [];
}

test('dates and weekdays', () => {
  assert.equal(addDays('2026-09-15', 21), '2026-10-06');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(weekdayOf('2026-09-15'), 2, 'Tuesday');
  assert.equal(weekdayOf('2026-09-20'), 0, 'Sunday');
});

test('a slot listed on every week of the window is one weekly record with no dates', () => {
  const { index, cells, stats } = build(rawLocalSeries('42', WEDNESDAYS));
  const cell = cells.get('30_-100');
  assert.equal(cell?.venues.length, 1);
  const venue = cell?.venues[0];
  assert.equal(venue?.id, '42');
  assert.equal(venue?.shop, 'TEST GAMES');
  assert.deepEqual(venue?.slots, [{ weekday: 3, time: '19:30', name: 'Weekly local', fee: '$5' }]);
  assert.deepEqual(index.cells, { '30_-100': { slots: 1, hash: 'h1' } });
  assert.equal(index.total, 1);
  assert.equal(index.venues, 1);
  assert.equal(index.horizonDays, 21);
  assert.equal(index.updatedAt, NOW.toISOString());
  assert.equal(stats.kept, 3);
  assert.equal(stats.weekly, 1);
});

test('a store with several slots a week keeps each, by weekday then time', () => {
  const listed = slots([
    ...rawLocalSeries('42', ['2026-09-16', '2026-09-23', '2026-09-30'], { name: 'Wednesday Standard' }),
    ...rawLocalSeries('42', ['2026-09-20', '2026-09-27', '2026-10-04'], {
      time: '15:00:00',
      name: 'Sunday Standard'
    }),
    ...rawLocalSeries('42', ['2026-09-20', '2026-09-27', '2026-10-04'], { time: '11:00:00', name: 'Sunday Juniors' })
  ]);
  assert.deepEqual(
    listed.map(slot => [slot.weekday, slot.time, slot.name]),
    [
      [0, '11:00', 'Sunday Juniors'],
      [0, '15:00', 'Sunday Standard'],
      [3, '19:30', 'Wednesday Standard']
    ]
  );
});

test('a series that starts late or stops early in the window says so, and never invents a week', () => {
  const [late] = slots(rawLocalSeries('42', ['2026-09-23', '2026-09-30']));
  assert.deepEqual([late?.from, late?.until, late?.dates], ['2026-09-23', undefined, undefined]);
  const [early] = slots(rawLocalSeries('42', ['2026-09-16', '2026-09-23']));
  assert.deepEqual([early?.from, early?.until, early?.dates], [undefined, '2026-09-23', undefined]);
  const [once] = slots(rawLocalSeries('42', ['2026-09-23']));
  assert.deepEqual([once?.from, once?.until], ['2026-09-23', '2026-09-23']);
  // Tuesday 2026-10-06 is the window's last day, so a Tuesday series listed through it is complete.
  const [tuesdays] = slots(rawLocalSeries('42', ['2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06']));
  assert.deepEqual(tuesdays, { weekday: 2, time: '19:30', name: 'Weekly local', fee: '$5' });
});

test('a slot that skips a week keeps its listed dates', () => {
  const [skipping] = slots(rawLocalSeries('42', ['2026-09-16', '2026-09-30']));
  assert.deepEqual(skipping?.dates, ['2026-09-16', '2026-09-30']);
  assert.equal(skipping?.from, undefined);
  assert.equal(build(rawLocalSeries('42', ['2026-09-16', '2026-09-30'])).stats.weekly, 0);
});

test('a name that changes week to week settles on the usual one', () => {
  const [slot] = slots([
    ...rawLocalSeries('42', ['2026-09-16'], { name: 'Liga 16 septiembre' }),
    ...rawLocalSeries('42', ['2026-09-23', '2026-09-30'], { name: 'Liga semanal' })
  ]);
  assert.equal(slot?.name, 'Liga semanal');
});

const CENTRAL = { zone: 'America/Chicago' };

function centralSlots(raw: unknown[], options = {}): LocalSlot[] {
  return build(raw, { ...CENTRAL, ...options }).cells.get('30_-100')?.venues[0]?.slots ?? [];
}

test('a series listed in UTC lands on the weekday and time at the venue', () => {
  const thursdaysUtc = rawLocalSeries('42', ['2026-09-17', '2026-09-24', '2026-10-01'], { time: '00:30:00' });
  assert.deepEqual(centralSlots(thursdaysUtc), [{ weekday: 3, time: '19:30', name: 'Weekly local', fee: '$5' }]);
});

test('a UTC series stays one slot across the end of daylight saving', () => {
  const saturdays = [
    ...rawLocalSeries('42', ['2026-10-24', '2026-10-31'], { time: '20:00:00' }),
    ...rawLocalSeries('42', ['2026-11-07'], { time: '21:00:00' })
  ];
  const listed = centralSlots(saturdays, { now: new Date('2026-10-20T12:00:00Z') });
  assert.deepEqual(
    listed.map(slot => [slot.weekday, slot.time, slot.until]),
    [[6, '15:00', undefined]]
  );
});

test('the window ends on the venue calendar: a last evening dated a day later in UTC is inside it', () => {
  // Tuesday evenings through the window's last day, Tuesday 2026-10-06, and one past it.
  const tuesdaysUtc = rawLocalSeries('42', ['2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07', '2026-10-14'], {
    time: '00:30:00'
  });
  const { cells, stats } = build(tuesdaysUtc, CENTRAL);
  assert.deepEqual(cells.get('30_-100')?.venues[0]?.slots, [
    { weekday: 2, time: '19:30', name: 'Weekly local', fee: '$5' }
  ]);
  assert.equal(stats.later, 1);
});

test('an unnamed record of a session the store also listed as an event gives way to the listed one', () => {
  const evenings = rawLocalSeries('42', ['2026-09-17', '2026-09-24', '2026-10-01'], { time: '00:00:00' });
  const listed = rawListedLocal(1, { league: '42', date: '2026-09-16', when: '2026-09-16 19:30:00' });
  const lunchtimes = rawLocalSeries('42', ['2026-09-16', '2026-09-23', '2026-09-30'], { time: '17:00:00' });
  const { cells, stats } = build([...evenings, listed, ...lunchtimes], CENTRAL);
  assert.deepEqual(
    cells.get('30_-100')?.venues[0]?.slots.map(slot => [slot.time, slot.name, slot.from, slot.until]),
    [
      ['12:00', 'Weekly local', undefined, undefined],
      ['19:00', 'Weekly local', '2026-09-23', undefined],
      ['19:30', 'Test Games Weekly', undefined, '2026-09-16']
    ]
  );
  assert.equal(stats.doubles, 1);
  assert.equal(stats.kept, 6);
});

test('stores are grouped by league ID, and records without one are skipped', () => {
  const { index, stats } = build([
    ...rawLocalSeries('42', ['2026-09-16']),
    ...rawLocalSeries('42', ['2026-09-16'], { shop: 'TEST GAMES (RENAMED)' }),
    rawLocalEvent({ league: '' }),
    rawLocalEvent({ league: 'abc' }),
    rawLocalEvent({ date: '2026-09-13', when: '2026-09-13 19:30:00' }),
    rawLocalEvent({ type: 'League Cup', name: 'A Cup', Display_id: '26-09-000001' })
  ]);
  assert.equal(index.venues, 1);
  assert.deepEqual(stats.skipped, { league: 2, kind: 1 });
  assert.equal(stats.past, 1);
});

test('venues shard into cells', () => {
  const { index, cells } = build([
    ...rawLocalSeries('42', WEDNESDAYS),
    ...rawLocalSeries('7', WEDNESDAYS, { latitude: '51.5074', longitude: '-0.1278', country_code: 'GB' })
  ]);
  assert.deepEqual([...cells.keys()], ['30_-100', '50_-5']);
  assert.equal(index.total, 2);
});

function cell(slot: LocalSlot = { weekday: 3, time: '19:30', name: 'Weekly local', fee: '$5' }): LocalsCell {
  return {
    version: 1,
    key: '30_-100',
    venues: [
      {
        id: '42',
        shop: 'TEST GAMES',
        address: '100 MAIN ST',
        city: 'Austin',
        region: 'Texas',
        cc: 'US',
        lat: 30.2672,
        lon: -97.7431,
        slots: [slot]
      }
    ]
  };
}

const dates = (cells: LocalsCell[], today: string, horizon = 21) =>
  expandLocals(cells, today, horizon).map(e => e.date);

test('a weekly slot expands to every matching date from today through the horizon', () => {
  const events = expandLocals([cell()], '2026-09-15', 21);
  assert.deepEqual(
    events.map(event => event.date),
    ['2026-09-16', '2026-09-23', '2026-09-30']
  );
  const [first] = events;
  assert.equal(first?.id, '42-2026-09-16-1930');
  assert.equal(first?.kind, 'local');
  assert.equal(first?.time, '19:30');
  assert.equal(first?.fee, '$5');
  assert.equal(first?.shop, 'TEST GAMES');
  assert.equal(first?.url, undefined);
  assert.equal('slots' in (first ?? {}), false);
});

test('from and until bound a weekly slot, and a slot on today expands from today', () => {
  const bounded = cell({ weekday: 3, time: '19:30', name: 'Weekly local', from: '2026-09-23', until: '2026-09-30' });
  assert.deepEqual(dates([bounded], '2026-09-15'), ['2026-09-23', '2026-09-30']);
  assert.deepEqual(dates([bounded], '2026-09-24'), ['2026-09-30'], 'a from in the past is just today');
  const today = cell({ weekday: 2, time: '', name: 'Weekly local' });
  assert.deepEqual(
    expandLocals([today], '2026-09-15', 7).map(event => event.id),
    ['42-2026-09-15-tba', '42-2026-09-22-tba']
  );
});

test('listed dates expand as listed, less the past', () => {
  const dated = cell({ weekday: 3, time: '19:30', name: 'Local', dates: ['2026-09-09', '2026-09-16', '2026-09-30'] });
  assert.deepEqual(dates([dated], '2026-09-15'), ['2026-09-16', '2026-09-30']);
});

test('unnamed conflicts group only nearby starts on the same date without chaining', () => {
  const raw = ['13:00:00', '14:30:00', '16:00:00', '19:00:00'].flatMap(time =>
    rawLocalSeries('42', WEDNESDAYS, { time })
  );
  const { cells } = build(raw);
  const listed = cells.get('30_-100')?.venues[0]?.slots;
  assert.deepEqual(
    listed?.map(slot => [slot.time, slot.reportedTimes]),
    [
      ['', ['13:00', '14:30']],
      ['16:00', undefined],
      ['19:00', undefined]
    ]
  );
  const expanded = expandLocals([...cells.values()], '2026-09-15', 21);
  assert.equal(expanded.length, 9);
  assert.deepEqual(expanded[0]?.reportedTimes, ['13:00', '14:30']);
  assert.equal(new Set(expanded.map(event => event.id)).size, 9);
});

test('named events at nearby times remain separate', () => {
  const raw = ['13:00:00', '14:30:00'].flatMap((time, i) =>
    WEDNESDAYS.map(date => rawListedLocal(i + 1, { league: '42', date, when: `${date} ${time}` }))
  );
  assert.deepEqual(
    slots(raw).map(slot => slot.time),
    ['13:00', '14:30']
  );
});

test('identical unnamed starts deduplicate without inventing a conflict, unknown starts stay unknown', () => {
  const raw = ['13:00:00', '13:00:00', '00:00:00'].flatMap(time => rawLocalSeries('42', WEDNESDAYS, { time }));
  assert.deepEqual(
    slots(raw).map(slot => [slot.time, slot.reportedTimes]),
    [
      ['', undefined],
      ['13:00', undefined]
    ]
  );
});

test('an aging index never extends a weekly slot beyond the dates the producer actually fetched', () => {
  assert.deepEqual(expandLocals([cell()], '2026-10-01', 21, '2026-09-15'), []);
  assert.deepEqual(
    expandLocals([cell()], '2026-09-29', 21, '2026-09-15').map(event => event.date),
    ['2026-09-30']
  );
  const dated = cell({ weekday: 3, time: '19:30', name: 'Weekly local', dates: ['2026-09-30', '2026-10-14'] });
  assert.deepEqual(
    expandLocals([dated], '2026-09-29', 21, '2026-09-15').map(event => event.date),
    ['2026-09-30']
  );
});
