#!/usr/bin/env node

/**
 * Event locator producer.
 *
 * Pulls every League Cup, League Challenge, and Prerelease Pokedata lists,
 * builds the locator artifacts, and publishes them for /events.
 *
 * Reads:   events/v1/index.json (the published run, for the guard)
 * Writes:  events/v1/{run}/cells/{cell}.json, events/v1/{run}/places.json,
 *          then events/v1/index.json, which points at {run}
 * Deletes: the run before last (the last one stays readable one more cycle)
 *
 * Refuses to publish a generation under 60% of the published one unless
 * ALLOW_SHRINK is set, and never publishes an empty one.
 *
 * Without R2 (local development), write to a directory instead:
 *   npx tsx .github/scripts/run-event-locator.ts --out .cache/events
 */

import process from 'node:process';
import { boolEnv, r2Config } from './lib/env.ts';
import { createLocalPublisher, createR2Publisher, runEventLocator } from './lib/eventLocator.ts';
import { fetchAllEvents } from './lib/pokedata.ts';

function outDirectory(): string | null {
  const flag = process.argv.indexOf('--out');
  return flag === -1 ? null : (process.argv[flag + 1] ?? null);
}

async function main(): Promise<void> {
  const log = (message: string) => console.log(message);
  const out = outDirectory();
  const publisher = out ? createLocalPublisher(out) : createR2Publisher(r2Config());
  const result = await runEventLocator({
    fetchEvents: () => fetchAllEvents({ log }),
    publisher,
    allowShrink: boolEnv('ALLOW_SHRINK'),
    log
  });
  log(`Published ${result.total} events in ${result.cells} cells${out ? ` to ${out}` : ''}`);
  if (result.removed.length) {
    log(`Retired the run before last (${result.removed.length} cells)`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
