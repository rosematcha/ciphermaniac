import test from 'node:test';
import assert from 'node:assert/strict';

import { readBoundedBytes, sniffProofType } from '../../functions/lib/api/bytes.ts';

const URL = 'https://example.test/api';

const put = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request(URL, { method: 'PUT', body, headers });

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
  const request = new Request(URL, { method: 'PUT', body: stream, duplex: 'half' } as RequestInit);
  return { request, pulled: () => index };
}

test('reads a body under or exactly at the cap, in one buffer across chunks', async () => {
  assert.deepEqual(await readBoundedBytes(put(new Uint8Array([1, 2, 3])), 8), {
    ok: true,
    bytes: new Uint8Array([1, 2, 3])
  });
  const { request } = chunked([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])]);
  assert.deepEqual(await readBoundedBytes(request, 5), { ok: true, bytes: new Uint8Array([1, 2, 3, 4, 5]) });
});

test('refuses on the declared length without reading the body', async () => {
  const request = put(new Uint8Array(4), { 'content-length': '9999' });
  assert.deepEqual(await readBoundedBytes(request, 64), { ok: false, reason: 'too-large' });
  assert.equal(request.bodyUsed, false);
});

test('stops reading a chunked body once it passes the cap', async () => {
  const chunk = new Uint8Array(10);
  const { request, pulled } = chunked(Array.from({ length: 100 }, () => chunk));
  assert.deepEqual(await readBoundedBytes(request, 25), { ok: false, reason: 'too-large' });
  assert.ok(pulled() < 10, `read ${pulled()} chunks of 100`);
});

test('no body is no bytes, and a stream that fails is unreadable', async () => {
  assert.deepEqual(await readBoundedBytes(put(null), 8), { ok: true, bytes: new Uint8Array(0) });
  const failing = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error('connection reset'));
    }
  });
  const request = new Request(URL, { method: 'PUT', body: failing, duplex: 'half' } as RequestInit);
  assert.deepEqual(await readBoundedBytes(request, 8), { ok: false, reason: 'unreadable' });
});

/** A file that opens with `head`, padded out as a real one would be. */
const file = (head: number[] | string, padding = 16) => {
  const start = typeof head === 'string' ? [...new TextEncoder().encode(head)] : head;
  return new Uint8Array([...start, ...new Array<number>(padding).fill(0)]);
};

test('a proof is a PNG, JPEG, WebP or PDF by its magic number', () => {
  assert.equal(sniffProofType(file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(sniffProofType(file([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffProofType(file('RIFF\x24\x00\x00\x00WEBPVP8 ')), 'image/webp');
  assert.equal(sniffProofType(file('%PDF-1.7')), 'application/pdf');
});

test('WebP takes both of its marks: RIFF alone is a WAV or an AVI', () => {
  assert.equal(sniffProofType(file('RIFF\x24\x00\x00\x00WAVEfmt ')), null);
  assert.equal(sniffProofType(file('RIFX\x24\x00\x00\x00WEBPVP8 ')), null);
  assert.equal(
    sniffProofType(new TextEncoder().encode('RIFF\x24\x00\x00\x00WEB')),
    null,
    'cut off before its mark ends'
  );
});

test('a file cut off inside its magic number is nothing', () => {
  assert.equal(sniffProofType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a])), null);
  assert.equal(sniffProofType(new Uint8Array([0xff, 0xd8])), null);
  assert.equal(sniffProofType(new TextEncoder().encode('%PDF')), null);
  assert.equal(sniffProofType(new Uint8Array(0)), null);
});

test('SVG, HTML and anything else are refused, whatever they are named', () => {
  assert.equal(sniffProofType(file('<svg xmlns="http://www.w3.org/2000/svg"><script>')), null);
  assert.equal(sniffProofType(file('<?xml version="1.0"?><svg>')), null);
  assert.equal(sniffProofType(file('<!DOCTYPE html><html>')), null);
  assert.equal(sniffProofType(file('GIF89a')), null);
  assert.equal(sniffProofType(file(' %PDF-1.7')), null, 'the mark must open the file');
});
