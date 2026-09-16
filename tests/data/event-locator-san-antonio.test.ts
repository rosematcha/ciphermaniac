import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildLocalsArtifacts, expandLocals } from '../../shared/events/locals.ts';
import { cellHash, zoneAt } from '../../.github/scripts/lib/eventLocator.ts';

// Captured from Pokedata's locals table on 2026-09-16, league IDs
// 6238620, 6243233, and 25098755. Keep the source's conflicting entries:
// a regression test must not silently replace them with an expected schedule.
const raw: unknown[] = JSON.parse(
  readFileSync(new URL('../fixtures/events/san-antonio-locals.json', import.meta.url), 'utf8')
);

function eventsFor(league: string) {
  const artifacts = buildLocalsArtifacts(raw, {
    now: new Date('2026-09-16T17:00:00Z'),
    source: 'https://pokedata.ovh/events/',
    horizonDays: 21,
    hash: cellHash,
    zoneAt
  });
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
