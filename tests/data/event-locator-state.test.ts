/**
 * Locator state: validation of stored and linked values, what a shared link
 * may carry, the calendar file, and recent places.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  centerFromParams,
  clampRadius,
  convertRadius,
  DEFAULT_SETTINGS,
  loadStored,
  type LocatorCenter,
  paramsFor,
  parseCenter,
  parseSettings,
  saveStored,
  settingsFromParams
} from '../../src/lib/events/viewState.ts';
import { calendarFileName, escapeText, eventCalendar, foldLine } from '../../src/lib/events/calendar.ts';
import { loadRecents, rememberRecent } from '../../src/lib/events/recents.ts';
import type { PlaceSuggestion } from '../../src/lib/events/search.ts';
import type { LocatorEvent } from '../../shared/events/types.ts';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

const SEARCHED: LocatorCenter = { lat: 30.26721, lon: -97.74312, label: 'Austin, TX', cc: 'US', source: 'search' };

test('the radius snaps to the slider and stays in range', () => {
  assert.equal(clampRadius(52), 50);
  assert.equal(clampRadius(53), 50);
  assert.equal(clampRadius(68), 75);
  assert.equal(clampRadius(1), 5);
  assert.equal(clampRadius(900), 250);
  assert.equal(clampRadius(Number.NaN), DEFAULT_SETTINGS.radius);
  assert.equal(convertRadius(50, 'mi', 'km'), 75);
  assert.equal(convertRadius(100, 'km', 'mi'), 60);
  assert.equal(convertRadius(40, 'km', 'km'), 40);
});

test('stored centres are validated before use', () => {
  assert.deepEqual(parseCenter(SEARCHED), SEARCHED);
  assert.equal(parseCenter(null), null);
  assert.equal(parseCenter({ ...SEARCHED, lat: 95 }), null);
  assert.equal(parseCenter({ ...SEARCHED, lon: '10' }), null);
  assert.equal(parseCenter({ ...SEARCHED, label: '  ' }), null);
  assert.equal(parseCenter({ ...SEARCHED, cc: 'usa' })?.cc, null);
  assert.equal(parseCenter({ ...SEARCHED, source: 'evil' })?.source, 'search');
  assert.equal(parseCenter({ ...SEARCHED, label: 'x'.repeat(500) })?.label.length, 120);
});

test('stored settings fall back field by field', () => {
  assert.deepEqual(parseSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(
    parseSettings({ radius: 73, unit: 'km', unitPinned: true, kinds: ['cup', 'bogus'], windowDays: 7 }),
    {
      radius: 75,
      unit: 'km',
      unitPinned: true,
      kinds: ['cup'],
      windowDays: 7
    }
  );
  assert.equal(parseSettings({ windowDays: 12 }).windowDays, 30);
  assert.equal(parseSettings({ windowDays: null }).windowDays, null);
  assert.deepEqual(parseSettings({ kinds: [] }).kinds, ['cup', 'challenge', 'prerelease']);
  assert.deepEqual(parseSettings({ kinds: ['local'] }).kinds, ['local']);
  assert.equal(parseSettings({ unit: 'furlongs' }).unit, 'mi');
});

test('a shared link carries a chosen place, its radius, and its unit', () => {
  const params = paramsFor(SEARCHED, { ...DEFAULT_SETTINGS, radius: 75, unit: 'km' });
  assert.deepEqual(params, { near: 'Austin, TX', lat: '30.267', lon: '-97.743', cc: 'US', r: '75', u: 'km' });
  const center = centerFromParams(params);
  assert.deepEqual(center, { lat: 30.267, lon: -97.743, label: 'Austin, TX', cc: 'US', source: 'link' });
  const settings = settingsFromParams(params, DEFAULT_SETTINGS);
  assert.deepEqual([settings.radius, settings.unit, settings.unitPinned], [75, 'km', true]);
});

test("a link never carries the visitor's own position or the automatic default", () => {
  for (const source of ['device', 'approximate', 'default'] as const) {
    const params = paramsFor({ ...SEARCHED, source }, DEFAULT_SETTINGS);
    assert.deepEqual(Object.values(params).filter(Boolean), [], source);
  }
  assert.deepEqual(Object.values(paramsFor(null, DEFAULT_SETTINGS)).filter(Boolean), []);
});

test('malformed link parameters are ignored', () => {
  assert.equal(centerFromParams({}), null);
  assert.equal(centerFromParams({ lat: 'abc', lon: '1' }), null);
  assert.equal(centerFromParams({ lat: '10', lon: '200' }), null);
  assert.equal(centerFromParams({ lat: '10', lon: '20' })?.label, '10.00, 20.00');
  const settings = settingsFromParams({ r: 'lots', u: 'leagues' }, DEFAULT_SETTINGS);
  assert.deepEqual(settings, DEFAULT_SETTINGS);
});

test('storage remembers chosen places, but not automatic defaults', () => {
  const storage = new MemoryStorage();
  saveStored(SEARCHED, DEFAULT_SETTINGS, storage);
  assert.deepEqual(loadStored(storage).center, { ...SEARCHED, lat: 30.267, lon: -97.743 });
  saveStored({ ...SEARCHED, label: 'Guessed', source: 'approximate' }, DEFAULT_SETTINGS, storage);
  assert.equal(loadStored(storage).center?.label, 'Austin, TX');
  saveStored({ ...SEARCHED, label: 'Fallback', source: 'default' }, DEFAULT_SETTINGS, storage);
  assert.equal(loadStored(storage).center?.label, 'Austin, TX');
  storage.setItem('cm:events:settings', '{not json');
  assert.deepEqual(loadStored(storage).settings, DEFAULT_SETTINGS);
  assert.deepEqual(loadStored(undefined), { center: null, settings: DEFAULT_SETTINGS });
});

const EVENT: LocatorEvent = {
  id: '26-09-000001',
  kind: 'cup',
  name: 'CUP; WITH, COMMAS',
  date: '2026-09-20',
  time: '11:00',
  shop: 'TEST GAMES',
  address: '100 MAIN ST, AUSTIN, TX 78701, US',
  city: 'Austin',
  region: 'Texas',
  cc: 'US',
  lat: 30.27,
  lon: -97.74,
  url: 'https://www.pokemon.com/us/pokemon-trainer-club/play-pokemon-tournaments/26-09-000001/'
};

test('calendar text is escaped and long lines are folded', () => {
  assert.equal(escapeText('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne');
  const folded = foldLine('x'.repeat(160));
  assert.deepEqual(
    folded.split('\r\n ').map(part => part.length),
    [74, 74, 12]
  );
});

test('the calendar file describes the event at its local wall-clock time', () => {
  const ics = eventCalendar(EVENT, new Date('2026-09-15T12:34:56.789Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /\r\nDTSTART:20260920T110000\r\n/);
  assert.match(ics, /\r\nDTSTAMP:20260915T123456Z\r\n/);
  assert.match(ics, /\r\nUID:26-09-000001@ciphermaniac\.com\r\n/);
  assert.match(ics, /\r\nSUMMARY:Cup\\; With\\, Commas\r\n/);
  assert.match(ics, /\r\nLOCATION:Test Games\\, 100 Main St\\, Austin\\, TX 78701\r\n/);
  assert.ok(!/\r\n[^ ][^\r]{75,}/.test(ics), 'no unfolded line over 75 characters');
  assert.match(eventCalendar({ ...EVENT, time: '' }), /\r\nDTSTART;VALUE=DATE:20260920\r\n/);
  assert.equal(calendarFileName(EVENT), 'pokemon-event-26-09-000001.ics');
});

function place(id: string): PlaceSuggestion {
  return {
    id,
    kind: 'city',
    label: id,
    detail: 'Texas, United States',
    centerLabel: `${id}, TX`,
    lat: 30,
    lon: -97,
    cc: 'US'
  };
}

test('recent places are newest first, de-duplicated, capped, and validated', () => {
  const storage = new MemoryStorage();
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
    rememberRecent(place(id), storage);
  }
  rememberRecent(place('c'), storage);
  assert.deepEqual(
    loadRecents(storage).map(p => p.id),
    ['c', 'f', 'e', 'd', 'b']
  );
  storage.setItem('cm:events:recent', JSON.stringify([place('ok'), { id: 'broken' }, 'junk']));
  assert.deepEqual(
    loadRecents(storage).map(p => p.id),
    ['ok']
  );
  storage.setItem('cm:events:recent', 'not json');
  assert.deepEqual(loadRecents(storage), []);
});
