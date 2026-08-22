#!/usr/bin/env tsx
/**
 * CLI wrapper around the fixture server, for Playwright's `webServer`.
 *
 * The port is fixed rather than ephemeral because `VITE_DATA_ORIGIN` is baked
 * into the bundle at build time — the app has to know the origin before the
 * server exists.
 */

import { startFixtureServer } from './fixture-server.ts';

const port = Number(process.env.FIXTURE_PORT ?? 4320);
const server = await startFixtureServer(port);
console.log(`fixture server listening on ${server.origin}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
