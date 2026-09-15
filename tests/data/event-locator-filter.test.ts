/**
 * Choosing, ordering, and grouping the events around a search.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { EventKind, LocatorEvent } from '../../shared/events/types.ts';
import { filterEvents, groupByDay, type LocatorQuery, venueMarkers } from '../../src/lib/events/filter.ts';

function event(id: string, overrides: Partial<LocatorEvent> = {}): LocatorEvent {
  return {
    id,
    kind: 'challenge',
    name: `Event ${id}`,
    date: '2026-09-16',
    time: '18:00',
    shop: 'SHOP A',
    address: '',
    city: 'Austin',
    region: 'Texas',
    cc: 'US',
    lat: 30.2672,
    lon: -97.7431,
    url: 'https://www.pokemon.com/',
    ...overrides
  };
}

function query(overrides: Partial<LocatorQuery> = {}): LocatorQuery {
  return {
    center: { lat: 30.2672, lon: -97.7431 },
    radiusKm: 100,
    kinds: new Set<EventKind>(['cup', 'challenge', 'prerelease']),
    windowDays: 30,
    today: '2026-09-15',
    ...overrides
  };
}

test('only events inside the circle are kept, with their distance', () => {
  const houston = event('far', { lat: 29.7604, lon: -95.3698 });
  const result = filterEvents([event('here'), houston], query());
  assert.deepEqual(
    result.map(e => e.id),
    ['here']
  );
  assert.equal(result[0]?.distanceKm, 0);
  assert.equal(filterEvents([houston], query({ radiusKm: 250 })).length, 1);
});

test('kinds and the date window narrow the list; past events never show', () => {
  const events = [
    event('cup', { kind: 'cup' }),
    event('yesterday', { date: '2026-09-14' }),
    event('today', { date: '2026-09-15' }),
    event('edge', { date: '2026-10-14' }),
    event('beyond', { date: '2026-10-15' })
  ];
  assert.deepEqual(
    filterEvents(events, query({ kinds: new Set(['cup']) })).map(e => e.id),
    ['cup']
  );
  assert.deepEqual(
    filterEvents(events, query()).map(e => e.id),
    ['today', 'cup', 'edge']
  );
  assert.deepEqual(
    filterEvents(events, query({ windowDays: null })).map(e => e.id),
    ['today', 'cup', 'edge', 'beyond']
  );
});

test('locals are excluded until their kind is selected', () => {
  const local = event('local', { kind: 'local' });
  assert.deepEqual(filterEvents([local], query()), []);
  assert.deepEqual(
    filterEvents([local], query({ kinds: new Set(['local']) })).map(e => e.id),
    ['local']
  );
});

test('results run by date, then time, then distance', () => {
  const events = [
    event('late', { time: '19:00' }),
    event('farther', { time: '18:00', lat: 30.5, lon: -97.7 }),
    event('nearer', { time: '18:00' }),
    event('earlier-day', { date: '2026-09-15', time: '23:00' })
  ];
  assert.deepEqual(
    filterEvents(events, query()).map(e => e.id),
    ['earlier-day', 'nearer', 'farther', 'late']
  );
});

test('days group consecutive events', () => {
  const placed = filterEvents(
    [event('a', { date: '2026-09-16' }), event('b', { date: '2026-09-16' }), event('c', { date: '2026-09-18' })],
    query()
  );
  assert.deepEqual(
    groupByDay(placed).map(day => [day.date, day.events.map(e => e.id)]),
    [
      ['2026-09-16', ['a', 'b']],
      ['2026-09-18', ['c']]
    ]
  );
});

test('markers are one per store, flag Cups, and point at the soonest event', () => {
  const placed = filterEvents(
    [
      event('first', { date: '2026-09-16' }),
      event('cup', { date: '2026-09-20', kind: 'cup' }),
      event('other', { shop: 'SHOP B', lat: 30.3, lon: -97.8 })
    ],
    query()
  );
  const markers = venueMarkers(placed);
  assert.equal(markers.length, 2);
  const shopA = markers.find(m => m.shop === 'SHOP A');
  assert.deepEqual([shopA?.count, shopA?.hasCup, shopA?.firstId], [2, true, 'first']);
  assert.equal(markers.find(m => m.shop === 'SHOP B')?.hasCup, false);
});
