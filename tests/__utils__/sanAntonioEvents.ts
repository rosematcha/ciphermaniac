import { readFileSync } from 'node:fs';
import { buildLocalsArtifacts } from '../../shared/events/locals.ts';
import type { LocatorEvent } from '../../shared/events/types.ts';
import { cellHash, zoneAt } from '../../.github/scripts/lib/eventLocator.ts';

// Live Pokedata records and published sanctioned events captured on 2026-09-16.
// Keep conflicting source times intact so tests exercise the actual conversion and grouping.
const raw: unknown[] = JSON.parse(
  readFileSync(new URL('../fixtures/events/san-antonio-locals.json', import.meta.url), 'utf8')
);

export const sanAntonioScheduled: LocatorEvent[] = JSON.parse(
  readFileSync(new URL('../fixtures/events/combat-power-scheduled.json', import.meta.url), 'utf8')
);

export function sanAntonioLocals() {
  return buildLocalsArtifacts(raw, {
    now: new Date('2026-09-16T17:00:00Z'),
    source: 'https://pokedata.ovh/events/',
    horizonDays: 21,
    hash: cellHash,
    zoneAt
  });
}
