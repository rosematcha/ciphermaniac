/**
 * Static server for the deterministic browser tests.
 *
 * Serves `tests/fixtures/e2e/` as if it were r2.ciphermaniac.com, with CORS
 * open so the SPA can read it cross-origin exactly as it reads R2. Deliberately
 * hand-rolled rather than pulled from a package: it is 60 lines, it must not
 * decode-then-normalize paths in a way that diverges from R2's behavior, and
 * adding a dependency for it would be the tail wagging the dog.
 * @module tests/e2e/fixture-server
 */

import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/e2e');

export interface FixtureServer {
  origin: string;
  /** Paths requested so far, in order. Lets a test assert request fan-out. */
  requests: string[];
  close: () => Promise<void>;
}

/**
 * Start the fixture server.
 * @param port - Port to bind; 0 picks an ephemeral one
 * @param root - Fixture directory; defaults to tests/fixtures/e2e
 * @returns The running server, its origin, and the request log
 */
export async function startFixtureServer(port = 0, root: string = FIXTURE_ROOT): Promise<FixtureServer> {
  const requests: string[] = [];

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const decoded = decodeURIComponent(url.pathname);
    requests.push(decoded);

    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'no-store'
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers);
      res.end();
      return;
    }

    // Contain the read to the fixture root: `normalize` collapses any `..` a
    // test (or the app) might produce before it can escape.
    const resolved = join(FIXTURE_ROOT, normalize(decoded));
    if (!resolved.startsWith(FIXTURE_ROOT)) {
      res.writeHead(403, headers);
      res.end('forbidden');
      return;
    }

    readFile(join(root, normalize(decoded))).then(
      body => {
        res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
        res.end(body);
      },
      () => {
        // A miss is a 404, matching R2 — the app treats optional artifacts'
        // 404s as "absent", and that path has to be exercised too.
        res.writeHead(404, headers);
        res.end('not found');
      }
    );
  });

  await new Promise<void>(resolve => {
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('fixture server did not bind a port');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      })
  };
}
