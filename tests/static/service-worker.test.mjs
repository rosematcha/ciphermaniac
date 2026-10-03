import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../static/sw.js', import.meta.url), 'utf8');
const origin = 'https://ciphermaniac.com';
const report = { url: 'https://r2.ciphermaniac.com/reports/master.json', method: 'GET' };
const asset = { url: `${origin}/assets/app.js`, method: 'GET' };
const navigation = { url: `${origin}/cards`, method: 'GET', mode: 'navigate' };

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness({ cached, fetcher, put, keys, remove, open } = {}) {
  const listeners = new Map();
  const writes = [];
  const timers = [];
  const cache = {
    match: () => Promise.resolve(cached),
    put: (request, response) => {
      writes.push({ request, response });
      return put ? put() : Promise.resolve();
    },
    keys: keys ?? (() => Promise.resolve([])),
    delete: remove ?? (() => Promise.resolve(true))
  };
  runInNewContext(source, {
    self: { location: { origin }, addEventListener: (name, listener) => listeners.set(name, listener) },
    caches: { open: open ?? (() => Promise.resolve(cache)) },
    fetch: fetcher ?? (() => Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }))),
    Response,
    URL,
    setTimeout: callback => timers.push(callback)
  });
  function dispatch(request) {
    let response;
    const lifetimes = [];
    listeners.get('fetch')({
      request,
      respondWith: promise => {
        response = promise;
      },
      waitUntil: promise => lifetimes.push(promise)
    });
    return { response, lifetimes };
  }
  return { dispatch, writes, timers };
}

async function flush() {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
}

test('cached report responds immediately while waitUntil covers fetch, write, and trimming', async () => {
  const network = deferred();
  const write = deferred();
  const deletion = deferred();
  const cached = new Response('cached');
  const worker = harness({
    cached,
    fetcher: () => network.promise,
    put: () => write.promise,
    keys: () => Promise.resolve(Array.from({ length: 121 }, (_, index) => `report-${index}`)),
    remove: () => deletion.promise
  });
  const event = worker.dispatch(report);
  assert.equal(event.lifetimes.length, 1, 'waitUntil is registered synchronously');
  assert.equal(await event.response, cached);
  let finished = false;
  const lifetime = event.lifetimes[0].then(() => {
    finished = true;
  });
  await flush();
  assert.equal(finished, false);
  network.resolve(new Response('fresh', { headers: { 'content-type': 'application/json' } }));
  await flush();
  assert.equal(worker.writes.length, 1);
  assert.equal(finished, false);
  write.resolve();
  await flush();
  assert.equal(worker.timers.length, 1);
  worker.timers[0]();
  await flush();
  assert.equal(finished, false);
  deletion.resolve(true);
  await lifetime;
  assert.equal(finished, true);
  assert.equal(await worker.writes[0].response.text(), 'fresh');
});

for (const request of [report, asset, navigation]) {
  test(`${request.url}: response does not wait for storage, but event lifetime does`, async () => {
    const write = deferred();
    const worker = harness({ put: () => write.promise });
    const event = worker.dispatch(request);
    assert.equal(event.lifetimes.length, 1);
    assert.equal((await event.response).ok, true);
    let finished = false;
    const lifetime = event.lifetimes[0].then(() => {
      finished = true;
    });
    await flush();
    assert.equal(finished, false);
    write.resolve();
    await flush();
    worker.timers.forEach(callback => callback());
    await lifetime;
    assert.equal(worker.writes.length, 1);
  });

  test(`${request.url}: quota errors do not reject response or event lifetime`, async () => {
    const worker = harness({
      put: () => Promise.reject(new Error('QuotaExceededError'))
    });
    const event = worker.dispatch(request);
    assert.equal((await event.response).ok, true);
    await Promise.all(event.lifetimes);
    assert.equal(worker.timers.length, 0);
  });
}

for (const operation of ['keys', 'remove']) {
  test(`report trimming handles ${operation} failure and can retry next refresh`, async () => {
    const worker = harness({
      keys: () =>
        operation === 'keys'
          ? Promise.reject(new Error('Storage unavailable'))
          : Promise.resolve(Array.from({ length: 121 }, (_, index) => `report-${index}`)),
      remove: () => Promise.reject(new Error('Storage unavailable'))
    });
    for (let i = 0; i < 2; i++) {
      const event = worker.dispatch(report);
      assert.equal((await event.response).ok, true);
      await flush();
      assert.equal(worker.timers.length, i + 1);
      worker.timers[i]();
      await Promise.all(event.lifetimes);
    }
  });
}

test('failed report refresh preserves cached data and settles background lifetime', async () => {
  const cached = new Response('cached');
  const worker = harness({ cached, fetcher: () => Promise.reject(new Error('Offline')) });
  const event = worker.dispatch(report);
  assert.equal(await event.response, cached);
  await Promise.all(event.lifetimes);
  assert.equal(worker.writes.length, 0);
});

test('failed uncached requests return network errors and navigation falls back to cached shell', async () => {
  for (const request of [report, asset, navigation]) {
    const worker = harness({ fetcher: () => Promise.reject(new Error('Offline')) });
    const event = worker.dispatch(request);
    assert.equal((await event.response).type, 'error');
    await Promise.all(event.lifetimes);
  }
  const cached = new Response('shell');
  const worker = harness({ cached, fetcher: () => Promise.reject(new Error('Offline')) });
  assert.equal(await worker.dispatch(navigation).response, cached);
});

test('HTML responses cannot poison report or asset caches', async () => {
  for (const request of [report, asset]) {
    const worker = harness({
      fetcher: () => Promise.resolve(new Response('shell', { headers: { 'content-type': 'text/html' } }))
    });
    const event = worker.dispatch(request);
    await event.response;
    await Promise.all(event.lifetimes);
    assert.equal(worker.writes.length, 0);
  }
});

test('mutable and live resources bypass service worker caching', () => {
  const worker = harness();
  for (const path of ['/current.json', '/sw.js', '/manifest.webmanifest', '/live/schedule.json']) {
    assert.equal(worker.dispatch({ url: `${origin}${path}`, method: 'GET' }).response, undefined);
  }
  for (const path of [
    '/current.json',
    '/manifest.webmanifest',
    '/channels/shadow.json',
    '/live/run.json',
    '/events/index.json',
    '/tournaments/view.json',
    '/card-images/card.png'
  ]) {
    assert.equal(worker.dispatch({ url: `https://r2.ciphermaniac.com${path}`, method: 'GET' }).response, undefined);
  }
  assert.equal(worker.dispatch({ ...asset, method: 'POST' }).response, undefined);
});

for (const request of [report, asset, navigation]) {
  test(`${request.url}: unavailable cache storage falls back to the network`, async () => {
    const fresh = new Response('network');
    const worker = harness({
      open: () => Promise.reject(new Error('Storage disabled')),
      fetcher: () => Promise.resolve(fresh)
    });
    const event = worker.dispatch(request);
    assert.equal(await event.response, fresh);
    await Promise.all(event.lifetimes);
    assert.equal(worker.writes.length, 0);
  });

  test(`${request.url}: unavailable storage and network return a clean network error`, async () => {
    const worker = harness({
      open: () => Promise.reject(new Error('Storage disabled')),
      fetcher: () => Promise.reject(new Error('Offline'))
    });
    const event = worker.dispatch(request);
    assert.equal((await event.response).type, 'error');
    await Promise.all(event.lifetimes);
  });
}

test('cached report refresh stores the original response without cloning', async () => {
  const fresh = new Response('fresh');
  fresh.clone = () => {
    throw new Error('Unnecessary clone');
  };
  const worker = harness({ cached: new Response('cached'), fetcher: () => Promise.resolve(fresh) });
  const event = worker.dispatch(report);
  assert.equal(await (await event.response).text(), 'cached');
  await flush();
  worker.timers.forEach(callback => callback());
  await Promise.all(event.lifetimes);
  assert.equal(worker.writes[0].response, fresh);
});

test('uncached report response and stored response remain independently readable', async () => {
  const fresh = new Response('fresh');
  const worker = harness({ fetcher: () => Promise.resolve(fresh) });
  const event = worker.dispatch(report);
  assert.equal(await (await event.response).text(), 'fresh');
  await flush();
  worker.timers.forEach(callback => callback());
  await Promise.all(event.lifetimes);
  assert.notEqual(worker.writes[0].response, fresh);
  assert.equal(await worker.writes[0].response.text(), 'fresh');
});
