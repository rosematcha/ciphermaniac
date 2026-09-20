import test from 'node:test';
import assert from 'node:assert/strict';

import { readJsonBody } from '../../functions/lib/api/body.ts';

const URL = 'https://example.test/api';

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request(URL, { method: 'POST', body, headers });

/** A chunked body: no Content-Length, and `pulled` counts the chunks actually read. */
function chunked(chunks: Uint8Array[]): { request: Request; pulled: () => number } {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      index += 1;
      controller.enqueue(chunk);
    }
  });
  const request = new Request(URL, { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
  return { request, pulled: () => index };
}

test('parses a body under the cap', async () => {
  assert.deepEqual(await readJsonBody(post('{"a":[1,2]}'), 64), { ok: true, value: { a: [1, 2] } });
});

test('a body of exactly the cap is accepted', async () => {
  const body = '"aaaa"';
  assert.equal((await readJsonBody(post(body), body.length)).ok, true);
});

test('refuses on the declared length without reading the body', async () => {
  const request = post('{}', { 'content-length': '9999' });
  assert.deepEqual(await readJsonBody(request, 64), { ok: false, reason: 'too-large' });
  assert.equal(request.bodyUsed, false);
});

test('counts bytes, not characters', async () => {
  // Ten characters, thirty bytes: under a twenty-"character" cap, over a twenty-byte one.
  const body = JSON.stringify('あ'.repeat(8));
  assert.ok(body.length < 20);
  assert.deepEqual(await readJsonBody(chunked([new TextEncoder().encode(body)]).request, 20), {
    ok: false,
    reason: 'too-large'
  });
});

test('stops reading a chunked body once it passes the cap', async () => {
  const chunk = new Uint8Array(10).fill(0x20);
  const { request, pulled } = chunked(Array.from({ length: 100 }, () => chunk));
  assert.deepEqual(await readJsonBody(request, 25), { ok: false, reason: 'too-large' });
  assert.ok(pulled() < 10, `read ${pulled()} chunks of 100`);
});

test('a multi-byte character split across chunks survives', async () => {
  const bytes = new TextEncoder().encode('"あ"');
  const { request } = chunked([bytes.slice(0, 2), bytes.slice(2)]);
  assert.deepEqual(await readJsonBody(request, 64), { ok: true, value: 'あ' });
});

test('malformed JSON and an empty body are unparseable', async () => {
  assert.deepEqual(await readJsonBody(post('{nope'), 64), { ok: false, reason: 'unparseable' });
  assert.deepEqual(await readJsonBody(new Request(URL, { method: 'POST' }), 64), { ok: false, reason: 'unparseable' });
});
