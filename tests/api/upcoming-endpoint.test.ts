import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { onRequest, onRequestOptions } from '../../functions/api/limitless/upcoming.ts';
import { mockFetch, restoreFetch } from '../__utils__/test-helpers.ts';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/upcoming');

async function fixture(name: string): Promise<string> {
  return readFile(join(fixtureRoot, `${name}.html`), 'utf8');
}

afterEach(() => {
  restoreFetch();
  mock.restoreAll();
});

test('upcoming OPTIONS exposes the cacheable CORS contract', async () => {
  const response = await onRequestOptions();

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), null);
  assert.equal(response.headers.get('Access-Control-Max-Age'), '86400');
});

test('upcoming GET forwards a browser-like request and returns parsed events with cache headers', async () => {
  const html = await fixture('normal');
  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  mockFetch({
    predicate: (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return true;
    },
    status: 200,
    body: html
  });

  const response = await onRequest({ request: new Request('https://ciphermaniac.test/api/limitless/upcoming') });
  const payload = (await response.json()) as { events: Array<{ name: string }>; source: string; refreshedAt: string };

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3600, s-maxage=21600');
  assert.equal(requestedUrl, 'https://limitlesstcg.com/tournaments/upcoming?game=PTCG');
  assert.match(
    String(requestedInit?.headers && (requestedInit.headers as Record<string, string>)['User-Agent']),
    /Ciphermaniac/
  );
  assert.equal(payload.events.length, 3);
  assert.equal(payload.events[0]?.name, 'World Championships 2026');
  assert.equal(payload.source, 'https://limitlesstcg.com/tournaments/upcoming?game=PTCG');
  assert.match(payload.refreshedAt, /^2026|^20/);
});

test('upcoming GET distinguishes a structurally broken schedule from an empty one', async () => {
  const warn = mock.method(console, 'warn', () => undefined);
  mockFetch({ status: 200, body: await fixture('renamed-attributes') });

  const response = await onRequest({ request: new Request('https://ciphermaniac.test/api/limitless/upcoming') });
  const payload = (await response.json()) as { events: unknown[]; parseWarning?: string };

  assert.equal(response.status, 200);
  assert.deepEqual(payload.events, []);
  assert.match(payload.parseWarning ?? '', /markup may have changed/);
  assert.equal(warn.mock.calls.length, 1);
});

test('upcoming GET does not warn for a legitimate empty schedule', async () => {
  const warn = mock.method(console, 'warn', () => undefined);
  mockFetch({ status: 200, body: await fixture('empty') });

  const response = await onRequest({ request: new Request('https://ciphermaniac.test/api/limitless/upcoming') });
  const payload = (await response.json()) as { events: unknown[]; parseWarning?: string };

  assert.equal(response.status, 200);
  assert.deepEqual(payload.events, []);
  assert.equal(payload.parseWarning, undefined);
  assert.equal(warn.mock.calls.length, 0);
});

test('upcoming GET turns upstream status and network failures into 502 JSON errors', async () => {
  mockFetch({ status: 503, body: 'upstream unavailable' });
  const upstream = await onRequest({ request: new Request('https://ciphermaniac.test/api/limitless/upcoming') });
  assert.equal(upstream.status, 502);
  assert.match(String(((await upstream.json()) as { error: string }).error), /Upstream 503/);

  mock.method(globalThis, 'fetch', async () => {
    throw new Error('connection reset');
  });
  const network = await onRequest({ request: new Request('https://ciphermaniac.test/api/limitless/upcoming') });
  assert.equal(network.status, 502);
  assert.match(String(((await network.json()) as { error: string }).error), /connection reset/);
});
