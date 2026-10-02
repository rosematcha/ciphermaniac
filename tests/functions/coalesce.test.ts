import assert from 'node:assert/strict';
import { test } from 'node:test';

import { coalescedRead } from '../../shared/coalesce.ts';
import { jsonRepresentation, revalidatedJson } from '../../functions/lib/api/revalidation.ts';
import { deferred, never } from '../__utils__/deferred.ts';

const sleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

test('read coalescing isolates bindings and keys, and permits retry after rejection', async () => {
  const read = coalescedRead<number>();
  const binding = {};
  const other = {};
  let joinerReads = 0;
  const failed = read(binding, 'session', () => Promise.reject(new Error('read failed')));
  const joined = read(binding, 'session', () => {
    joinerReads += 1;
    return Promise.resolve(2);
  });
  assert.equal(await read(other, 'session', () => Promise.resolve(3)), 3);
  assert.equal(await read(binding, 'other-session', () => Promise.resolve(4)), 4);
  await assert.rejects(failed, /read failed/);
  await assert.rejects(joined, /read failed/);
  assert.equal(joinerReads, 0, 'a joiner shares the pending read instead of starting its own');
  assert.equal(await read(binding, 'session', () => Promise.resolve(5)), 5);
});

test('a read that never settles is joined only briefly, then abandoned', async () => {
  const read = coalescedRead<number>(20);
  const binding = {};
  // A canceled request's I/O: the shared promise never settles.
  const hung = never<number>();
  void read(binding, 'session', () => hung);
  const started = Date.now();
  assert.equal(await read(binding, 'session', () => Promise.resolve(2)), 2, 'the joiner reads for itself');
  assert.ok(Date.now() - started >= 15, 'the joiner waited for the shared read first');
  // Timers and Date.now() round differently; step clear of the window's edge.
  await sleep(5);
  const fresh = deferred<number>();
  const next = read(binding, 'session', () => fresh.promise);
  let lateReads = 0;
  const late = read(binding, 'session', () => {
    lateReads += 1;
    return Promise.resolve(4);
  });
  fresh.resolve(3);
  assert.equal(await next, 3, 'a caller after the window does not join the abandoned read');
  assert.equal(await late, 3);
  assert.equal(lateReads, 0, 'the replacement read is shared again');
});

test('abandoned reads do not hold capacity', async () => {
  const read = coalescedRead<number>(10);
  const binding = {};
  for (let index = 0; index < 256; index += 1) {
    void read(binding, String(index), () => never<number>());
  }
  await sleep(15);
  const held = deferred<number>();
  const first = read(binding, 'fresh', () => held.promise);
  const second = read(binding, 'fresh', () => Promise.resolve(2));
  held.resolve(1);
  assert.equal(await second, 1, 'stale entries were pruned, so the fresh read is shared');
  assert.equal(await first, 1);
});

test('pending reads are bounded, and capacity is released when they settle', async () => {
  const read = coalescedRead<number>();
  const binding = {};
  const held = deferred<number>();
  const pending = Array.from({ length: 256 }, (_, index) => read(binding, String(index), () => held.promise));
  assert.equal(await read(binding, 'overflow', () => Promise.resolve(1)), 1);
  assert.equal(await read(binding, 'overflow', () => Promise.resolve(2)), 2);
  held.resolve(0);
  await Promise.all(pending);
  const next = read(binding, 'overflow', () => Promise.resolve(3));
  assert.equal(await read(binding, 'overflow', () => Promise.resolve(4)), 3);
  assert.equal(await next, 3);
});

test('JSON validators compare whole quoted tags and serialize the exact bytes returned', async () => {
  const representation = await jsonRepresentation({ entries: [] });
  for (const header of [`W/${representation.etag}`, `"a,b", ${representation.etag}`, '*']) {
    const response = revalidatedJson(
      new Request('https://cm.test', { headers: { 'If-None-Match': header } }),
      representation
    );
    assert.equal(response.status, 304);
    assert.equal(await response.text(), '');
  }
  for (const header of [undefined, '', '"other"', `"prefix${representation.etag.slice(1)}`]) {
    const headers = new Headers();
    if (header !== undefined) {
      headers.set('If-None-Match', header);
    }
    const response = revalidatedJson(new Request('https://cm.test', { headers }), representation);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), representation.body);
  }
});
