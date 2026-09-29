/**
 * The image proxies (/thumbnails and /sprites): which paths reach an upstream
 * at all, which upstream URL a valid path becomes, and what comes back.
 */

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { mockFetch, restoreFetch } from '../__utils__/test-helpers.js';

import { imageProxyResponse } from '../../functions/lib/api/responses.ts';
import * as ThumbnailModule from '../../functions/thumbnails/[[path]].ts';
import * as SpriteModule from '../../functions/sprites/[[path]].ts';

const LIMITLESS = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreFetch();
});

function makeRequest(path: string): Request {
  return new Request(`https://ciphermaniac.test${path}`, { method: 'GET' });
}

/** Answer every fetch with an image, recording the URLs asked for. */
function recordImageFetches(): string[] {
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested.push(typeof input === 'string' ? input : input instanceof Request ? input.url : String(input));
    return new Response('fake-image-data', { status: 200, headers: { 'Content-Type': 'image/png' } });
  }) as typeof fetch;
  return requested;
}

test('Thumbnail API: malformed and traversal paths are refused without a fetch', async () => {
  const requested = recordImageFetches();
  const malformed: Array<[string, RegExp | null]> = [
    ['/thumbnails/sm/TEF', /Invalid path format/],
    ['/thumbnails/large/TEF/123', /Invalid size/],
    ['/thumbnails/sm/TOOLONGSETCODE/123', /Invalid set code format/],
    ['/thumbnails/sm/X/123', /Invalid set code format/],
    ['/thumbnails/sm/TE-F/123', /Invalid set code format/],
    ['/thumbnails/sm/TEF/abc!@#', null],
    // An encoded separator is refused by validation, not left to routing.
    ['/thumbnails/sm/TE%2FF/123', null],
    ['/thumbnails/sm/TEF/..%2F..%2Fetc%2Fpasswd', null]
  ];
  for (const [path, message] of malformed) {
    const response = await ThumbnailModule.onRequest({ request: makeRequest(path) });
    assert.equal(response.status, 400, `Should reject ${path}`);
    if (message) {
      assert.match(await response.text(), message, path);
    }
  }
  // Traversal may be refused at routing (404) or validation (400); either way
  // nothing is fetched.
  const traversal = [
    '/thumbnails/sm/../TEF/123',
    '/thumbnails/sm/../../etc/passwd',
    '/thumbnails/sm/TEF/../../../secret/123',
    '/thumbnails/sm/TEF/..%2F..%2Fetc/passwd',
    // The pokemontcg.io leg only forwards names it recognises.
    '/thumbnails/ptcgio/base1/..%2F..%2Fetc%2Fpasswd',
    '/thumbnails/ptcgio/base1/94.png%3Fx',
    '/thumbnails/ptcgio/BASE1%20/94',
    '/thumbnails/ptcgio/b/94',
    '/thumbnails/ptcgio/base1/hires'
  ];
  for (const path of traversal) {
    const response = await ThumbnailModule.onRequest({ request: makeRequest(path) });
    assert.ok([400, 404].includes(response.status), `Should refuse ${path}, got ${response.status}`);
  }
  assert.deepStrictEqual(requested, [], 'A refused path must not be fetched');
});

test('Thumbnail API: a valid path becomes the upstream file name, served CORS-open', async () => {
  const cases: Array<[string, string]> = [
    ['/thumbnails/sm/TEF/123', `${LIMITLESS}/TEF/TEF_123_R_EN_SM.png`],
    ['/thumbnails/xs/PAL/45', `${LIMITLESS}/PAL/PAL_045_R_EN_XS.png`],
    ['/thumbnails/sm/TEF/007', `${LIMITLESS}/TEF/TEF_007_R_EN_SM.png`],
    // Variant suffixes are lowercase on the case-sensitive CDN.
    ['/thumbnails/sm/SLG/068A', `${LIMITLESS}/SLG/SLG_068a_R_EN_SM.png`],
    ['/thumbnails/lg/LOR/TG24', `${LIMITLESS}/LOR/LOR_TG24_R_EN_LG.png`],
    // Gallery digits are padded to two.
    ['/thumbnails/sm/CRZ/GG5', `${LIMITLESS}/CRZ/CRZ_GG05_R_EN_SM.png`],
    // The lone type letter of an unnumbered basic Energy stays unpadded.
    ['/thumbnails/sm/TEU/000P', `${LIMITLESS}/TEU/TEU_P_R_EN_SM.png`],
    // Vintage scans come from pokemontcg.io, proxied so they are readable cross-origin.
    ['/thumbnails/ptcgio/base1/94_hires', 'https://images.pokemontcg.io/base1/94_hires.png']
  ];
  for (const [path, expected] of cases) {
    const requested = recordImageFetches();
    const response = await ThumbnailModule.onRequest({ request: makeRequest(path) });
    assert.strictEqual(response.status, 200, path);
    assert.strictEqual(requested[0], expected, path);
    assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*', path);
  }
});

test('Thumbnail API: OPTIONS preflight returns CORS headers', async () => {
  const response = await ThumbnailModule.onRequestOptions();
  assert.strictEqual(response.status, 204);
  assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.ok(response.headers.get('Access-Control-Allow-Methods')?.includes('GET'));
});

test('Sprite API: rejects invalid slugs', async () => {
  const cases: Array<[string, RegExp]> = [
    ['/sprites/../mew.png', /Invalid path format/],
    ['/sprites/mew%2Fmeow.png', /Invalid sprite slug/]
  ];
  for (const [path, message] of cases) {
    const response = await SpriteModule.onRequest({ request: makeRequest(path) });
    assert.strictEqual(response.status, 400, path);
    assert.match(await response.text(), message, path);
  }
});

test('Sprite API: falls back and returns an immutable, CORS-open image', async () => {
  mockFetch([
    { status: 404 },
    {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream', 'Set-Cookie': 'blocked=1', Vary: 'Origin' },
      body: 'fake-image-data'
    }
  ]);

  const response = await SpriteModule.onRequest({ request: makeRequest('/sprites/mew.png') });
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.headers.get('Content-Type'), 'image/png');
  assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.strictEqual(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.strictEqual(response.headers.get('Set-Cookie'), null);
  assert.strictEqual(response.headers.get('Vary'), null);
});

test('Image proxy preserves an upstream image content type', () => {
  const response = imageProxyResponse(new Response('fake-image-data', { headers: { 'Content-Type': 'image/webp' } }));
  assert.strictEqual(response.headers.get('Content-Type'), 'image/webp');
});
