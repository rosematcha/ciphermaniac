/* eslint-disable camelcase -- Pokedata's API field names are snake_case; the fixtures mirror them exactly */

/**
 * Locals as series: grouping weekly occurrences into store slots, and
 * expanding them back into dates.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { addDays, buildLocalsArtifacts, expandLocals, weekdayOf } from '../../shared/events/locals.ts';
import type { LocalsCell } from '../../shared/events/types.ts';
import { rawLocalEvent } from '../__utils__/pokedata.ts';

const NOW = new Date('2026-09-15T12:00:00Z');
const SOURCE = 'https://pokedata.ovh/events/';

function build(raw: unknown[]) {
  return buildLocalsArtifacts(raw, {
    now: NOW,
    source: SOURCE,
    horizonDays: 21,
    hash: cell => `h${cell.venues.length}`
  });
}

/** The same slot on consecutive weeks, each with its own GUID as Pokedata lists them. */
function weekly(league: string, dates: string[], overrides: Record<string, unknown> = {}) {
  return dates.map((date, i) =>
    rawLocalEvent({
      league,
      date,
      guid: `${league.padStart(8, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ...overrides
    })
  );
}

test('dates and weekdays', () => {
  assert.equal(addDays('2026-09-15', 21), '2026-10-06');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(weekdayOf('2026-09-15'), 2, 'Tuesday');
  assert.equal(weekdayOf('2026-09-20'), 0, 'Sunday');
});

test('a slot seen on consecutive weeks is one weekly record with no dates', () => {
  const { index, cells, stats } = build(weekly('42', ['2026-09-16', '2026-09-23', '2026-09-30']));
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

test('a store with two slots a week keeps both, by weekday then time', () => {
  const { cells } = build([
    ...weekly('42', ['2026-09-16', '2026-09-23'], { when: '2026-09-16 19:30:00', name: 'Wednesday Standard' }),
    ...weekly('42', ['2026-09-20', '2026-09-27'], { when: '2026-09-20 15:00:00', name: 'Sunday Standard' }),
    ...weekly('42', ['2026-09-20', '2026-09-27'], { when: '2026-09-20 11:00:00', name: 'Sunday Juniors' })
  ]);
  const slots = cells.get('30_-100')?.venues[0]?.slots.map(slot => [slot.weekday, slot.time, slot.name]);
  assert.deepEqual(slots, [
    [0, '11:00', 'Sunday Juniors'],
    [0, '15:00', 'Sunday Standard'],
    [3, '19:30', 'Wednesday Standard']
  ]);
});

test('a slot that does not repeat weekly keeps its listed dates', () => {
  const { cells, stats } = build([
    ...weekly('42', ['2026-09-16', '2026-09-30']),
    ...weekly('43', ['2026-09-17'], { latitude: '30.3', name: '' })
  ]);
  const [biweekly, once] = cells.get('30_-100')?.venues ?? [];
  assert.deepEqual(biweekly?.slots[0]?.dates, ['2026-09-16', '2026-09-30']);
  assert.deepEqual(once?.slots[0]?.dates, ['2026-09-17']);
  assert.equal(once?.slots[0]?.name, 'Local', 'not weekly, so not "Weekly local"');
  assert.equal(stats.weekly, 0);
});

test('a name that changes week to week settles on the usual one', () => {
  const { cells } = build([
    ...weekly('42', ['2026-09-16'], { name: 'Liga 16 septiembre' }),
    ...weekly('42', ['2026-09-23', '2026-09-30'], { name: 'Liga semanal' })
  ]);
  assert.equal(cells.get('30_-100')?.venues[0]?.slots[0]?.name, 'Liga semanal');
});

test('stores are grouped by league ID, and records without one are skipped', () => {
  const { index, stats } = build([
    ...weekly('42', ['2026-09-16']),
    ...weekly('42', ['2026-09-16'], { shop: 'TEST GAMES (RENAMED)' }),
    rawLocalEvent({ league: '' }),
    rawLocalEvent({ league: 'abc' }),
    rawLocalEvent({ date: '2026-09-13' }),
    rawLocalEvent({ type: 'League Cup', name: 'A Cup', Display_id: '26-09-000001' })
  ]);
  assert.equal(index.venues, 1);
  assert.deepEqual(stats.skipped, { league: 2, kind: 1 });
  assert.equal(stats.past, 1);
});

test('the same slot is one venue record, and venues shard into cells', () => {
  const { index, cells } = build([
    ...weekly('42', ['2026-09-16', '2026-09-23']),
    ...weekly('7', ['2026-09-16', '2026-09-23'], { latitude: '51.5074', longitude: '-0.1278', country_code: 'GB' })
  ]);
  assert.deepEqual([...cells.keys()], ['30_-100', '50_-5']);
  assert.equal(index.total, 2);
});

function cell(overrides: Partial<LocalsCell['venues'][number]> = {}): LocalsCell {
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
        slots: [{ weekday: 3, time: '19:30', name: 'Weekly local', fee: '$5' }],
        ...overrides
      }
    ]
  };
}

test('a weekly slot expands to every matching date from today through the horizon', () => {
  const events = expandLocals([cell()], '2026-09-15', 21);
  assert.deepEqual(
    events.map(event => event.date),
    ['2026-09-16', '2026-09-23', '2026-09-30']
  );
  const [first] = events;
  assert.equal(first?.id, '42-2026-09-16-19:30');
  assert.equal(first?.kind, 'local');
  assert.equal(first?.time, '19:30');
  assert.equal(first?.fee, '$5');
  assert.equal(first?.shop, 'TEST GAMES');
  assert.equal(first?.url, undefined);
  assert.equal('slots' in (first ?? {}), false);
});

test('a slot on today expands from today, and one with no time has a stable ID', () => {
  const events = expandLocals([cell({ slots: [{ weekday: 2, time: '', name: 'Local' }] })], '2026-09-15', 7);
  assert.deepEqual(
    events.map(event => event.id),
    ['42-2026-09-15-tba', '42-2026-09-22-tba']
  );
});

test('listed dates expand as listed, less the past', () => {
  const dated = cell({
    slots: [{ weekday: 3, time: '19:30', name: 'Local', dates: ['2026-09-09', '2026-09-16', '2026-09-30'] }]
  });
  assert.deepEqual(
    expandLocals([dated], '2026-09-15', 21).map(event => event.date),
    ['2026-09-16', '2026-09-30']
  );
});
