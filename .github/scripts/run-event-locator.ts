#!/usr/bin/env node

/**
 * Event locator producer.
 *
 * Pulls every League Cup, League Challenge, and Prerelease Pokedata lists,
 * builds the locator artifacts, and publishes them for /events. Then does the
 * same for locals, which are published apart as weekly series, one file per
 * cell, rewritten only when a cell's content changes.
 *
 * Reads:   events/v1/index.json (the published run, for the guard)
 * Writes:  events/v1/{run}/cells/{cell}.json, events/v1/{run}/places.json,
 *          then events/v1/index.json, which points at {run}
 * Deletes: the run before last (the last one stays readable one more cycle)
 * Locals:  events/locals/v1/cells/{cell}.json (changed cells only), then
 *          events/locals/v1/index.json; dropped cells are deleted
 *
 * Refuses to publish a listing under 60% of the published one unless
 * ALLOW_SHRINK is set, and never publishes an empty one. Each listing is
 * guarded on its own, so an outage in one never blocks the other.
 *
 * Without R2 (local development), write to a directory instead:
 *   npx tsx .github/scripts/run-event-locator.ts --out .cache/events
 */

import process from 'node:process';
import { boolEnv, r2Config } from './lib/env.ts';
import { createLocalPublisher, createR2Publisher, runEventLocator, runLocalsLocator } from './lib/eventLocator.ts';
import { fetchAllEvents, fetchLocalEvents } from './lib/pokedata.ts';

function outDirectory(): string | null {
  const flag = process.argv.indexOf('--out');
  return flag === -1 ? null : (process.argv[flag + 1] ?? null);
}

async function main(): Promise<void> {
  const log = (message: string) => console.log(message);
  const out = outDirectory();
  const publisher = out ? createLocalPublisher(out) : createR2Publisher(r2Config());
  const allowShrink = boolEnv('ALLOW_SHRINK');
  const result = await runEventLocator({ fetchEvents: () => fetchAllEvents({ log }), publisher, allowShrink, log });
  log(`Published ${result.total} events in ${result.cells} cells${out ? ` to ${out}` : ''}`);
  if (result.removed.length) {
    log(`Retired the run before last (${result.removed.length} cells)`);
  }
  const locals = await runLocalsLocator({ fetchLocals: () => fetchLocalEvents({ log }), publisher, allowShrink, log });
  log(
    `Locals: ${locals.total} slots at ${locals.venues} stores; ${locals.written.length} cells written, ${locals.unchanged} unchanged, ${locals.removed.length} removed`
  );
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
