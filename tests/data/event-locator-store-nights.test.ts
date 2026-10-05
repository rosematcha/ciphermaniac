/**
 * Stores on Ciphermaniac over Pokedata's listings (shared/events/storeNights.ts):
 * a store's own league nights stand in for its league's locals, skip the
 * dates it marked off and the dates its league holds a Cup or Challenge,
 * move with an exception, and every event of its league carries its id.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { withStoreNights } from '../../shared/events/storeNights.ts';
import type { StoresIndex } from '../../shared/events/stores.ts';
import type { LocatorEvent } from '../../shared/events/types.ts';

/** Combat Power: Sundays at 3pm and Wednesdays at 7:30pm. */
const STORES: StoresIndex = {
  version: 1,
  updatedAt: '',
  stores: [
    {
      id: 'store-cp',
      leagueId: '6238620',
      name: 'Combat Power Gaming',
      address: '4522 Fredericksburg Rd #B64',
      city: 'San Antonio',
      region: 'TX',
      cc: 'US',
      lat: 29.49,
      lon: -98.55,
      timeZone: 'America/Chicago',
      nights: [
        { id: 'sun', weekday: 0, time: '15:00', name: '', fee: '5' },
        { id: 'wed', weekday: 3, time: '19:30', name: 'Wednesday League', fee: '' }
      ],
      exceptions: [
        { date: '2026-10-14', nightId: 'wed', time: null, note: 'Closed' },
        { date: '2026-10-21', nightId: null, time: '18:00', note: 'Early' }
      ]
    }
  ]
};

function event(overrides: Partial<LocatorEvent>): LocatorEvent {
  return {
    id: 'x',
    kind: 'local',
    name: 'Weekly local',
    date: '2026-10-07',
    time: '19:30',
    shop: 'CP COLLECTIBLES',
    address: '',
    city: 'Balcones Heights',
    region: 'Texas',
    cc: 'US',
    lat: 29.49,
    lon: -98.55,
    ...overrides
  };
}

// Sunday 2026-10-04 through Saturday 2026-10-24: three weeks.
const RANGE = { today: '2026-10-04', horizon: '2026-10-24' };

test('a store’s own nights stand in for the locals Pokedata lists for its league; others stay', () => {
  const pokedata = [event({ leagueId: '6238620', id: 'pd-1' }), event({ leagueId: '1111', id: 'other' })];
  const { locals } = withStoreNights([], pokedata, STORES, RANGE);
  assert.ok(!locals.some(item => item.id === 'pd-1'), 'Pokedata’s guess at the store goes');
  assert.ok(
    locals.some(item => item.id === 'other'),
    'another league’s stays'
  );
  const own = locals.filter(item => item.storeId === 'store-cp');
  assert.deepEqual(
    own.map(item => [item.date, item.time, item.name]),
    [
      ['2026-10-04', '15:00', 'Combat Power Gaming'],
      ['2026-10-07', '19:30', 'Wednesday League'],
      ['2026-10-11', '15:00', 'Combat Power Gaming'],
      ['2026-10-18', '15:00', 'Combat Power Gaming'],
      ['2026-10-21', '18:00', 'Wednesday League']
    ],
    'Oct 14 is off, Oct 21 moved, and it runs through the horizon'
  );
  assert.equal(own[0]?.shop, 'Combat Power Gaming', 'the store’s own name, not Pokedata’s spelling');
  assert.equal(own[0]?.fee, '5');
});

test('a night gives way to its league’s Cup or Challenge that day, and the Cup is marked as the store’s', () => {
  const cup = event({ kind: 'cup', leagueId: '6238620', date: '2026-10-11', time: '11:00', id: 'cup' });
  const prerelease = event({ kind: 'prerelease', leagueId: '6238620', date: '2026-10-18', time: '11:00', id: 'pre' });
  const elsewhere = event({ kind: 'cup', leagueId: '2222', date: '2026-10-04', id: 'far' });
  const { listed, locals } = withStoreNights([cup, prerelease, elsewhere], [], STORES, RANGE);
  assert.deepEqual(
    listed.map(item => [item.id, item.storeId]),
    [
      ['cup', 'store-cp'],
      ['pre', 'store-cp'],
      ['far', undefined]
    ]
  );
  const sundays = locals.filter(item => item.time === '15:00').map(item => item.date);
  assert.deepEqual(sundays, ['2026-10-04', '2026-10-18'], 'no night on the Cup’s Sunday; a Prerelease takes none');
});

test('with locals off, only the marks; with no stores index, everything as Pokedata lists it', () => {
  const cup = event({ kind: 'cup', leagueId: '6238620', id: 'cup' });
  const off = withStoreNights([cup], null, STORES, RANGE);
  assert.deepEqual([off.listed[0]?.storeId, off.locals], ['store-cp', []]);
  const pokedata = [event({ leagueId: '6238620', id: 'pd-1' })];
  const none = withStoreNights([cup], pokedata, null, RANGE);
  assert.deepEqual([none.listed[0]?.storeId, none.locals.map(item => item.id)], [undefined, ['pd-1']]);
});

test('a store with no place on the map shows no nights, and leaves Pokedata’s locals for its league standing', () => {
  const unplaced = { ...STORES, stores: STORES.stores.map(store => ({ ...store, lat: null, lon: null })) };
  const pokedata = [event({ leagueId: '6238620', id: 'pd-1' })];
  assert.deepEqual(
    withStoreNights([], pokedata, unplaced, RANGE).locals.map(item => item.id),
    ['pd-1']
  );
});
