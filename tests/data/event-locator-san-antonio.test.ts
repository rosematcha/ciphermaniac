import assert from 'node:assert/strict';
import test from 'node:test';

import { expandLocals } from '../../shared/events/locals.ts';
import { filterEvents } from '../../src/lib/events/filter.ts';
import { sanAntonioLocals, sanAntonioScheduled } from '../__utils__/sanAntonioEvents.ts';

function eventsFor(league: string) {
  const artifacts = sanAntonioLocals();
  return expandLocals([...artifacts.cells.values()], '2026-09-16', 21)
    .filter(event => event.id.startsWith(`${league}-`))
    .map(event => [event.date, event.time, ...(event.reportedTimes ? [event.reportedTimes] : [])]);
}

test('PokeHive UTC Saturday starts become Friday 7:30 PM Central', () => {
  assert.deepEqual(eventsFor('6243233'), [
    ['2026-09-18', '19:30'],
    ['2026-09-25', '19:30'],
    ['2026-10-02', '19:30']
  ]);
});

test('Combat Power preserves the listed Sunday and Wednesday, deduplicating only the same session', () => {
  assert.deepEqual(eventsFor('6238620'), [
    ['2026-09-20', '15:00'],
    ['2026-09-23', '19:00'],
    ['2026-09-30', '19:00'],
    ['2026-10-07', '19:00'],
    ['2026-09-16', '19:30']
  ]);
});

test('Time2Play conflicting Sunday starts form one unresolved session per date', () => {
  assert.deepEqual(eventsFor('25098755'), [
    ['2026-09-20', '', ['13:00', '14:30']],
    ['2026-09-27', '', ['13:00', '14:30']],
    ['2026-10-04', '', ['13:00', '14:30']]
  ]);
});

test('San Antonio combines the real scheduled feed with locals without duplicating Combat Power on challenge day', () => {
  const artifacts = sanAntonioLocals();
  const locals = expandLocals([...artifacts.cells.values()], '2026-09-16', 21);
  const events = filterEvents([...sanAntonioScheduled, ...locals], {
    center: { lat: 29.4928, lon: -98.552 },
    radiusKm: 50,
    kinds: new Set(['cup', 'challenge', 'prerelease', 'local']),
    windowDays: 30,
    today: '2026-09-16'
  });
  const cp = events.filter(event => event.shop === 'CP COLLECTIBLES');
  assert.deepEqual(
    cp.filter(event => event.date === '2026-09-23').map(event => [event.kind, event.time]),
    [['challenge', '19:30']]
  );
  assert.ok(cp.some(event => event.date === '2026-09-30' && event.kind === 'local'));
  assert.ok(cp.some(event => event.date === '2026-09-20' && event.time === '15:00'));
  assert.equal(events.filter(event => event.shop === 'TIME2PLAY').length, 3);
  assert.equal(events.filter(event => event.shop === 'THE POKEHIVE WONDERLAND MALL').length, 3);
});
