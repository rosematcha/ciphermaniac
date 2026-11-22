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
    Headers,
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

test('immutable release bodies are served from cache without a network refresh', async () => {
  const release = { url: 'https://r2.ciphermaniac.com/releases/v1/online/abc123/master.json', method: 'GET' };
  const cached = new Response('cached', { headers: { 'x-cm-stored-at': String(Date.now()) } });
  let fetches = 0;
  const hit = harness({
    cached,
    fetcher: () => {
      fetches += 1;
      return Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    }
  });
  const event = hit.dispatch(release);
  assert.equal(await event.response, cached);
  await Promise.all(event.lifetimes);
  assert.equal(fetches, 0);
  assert.equal(hit.writes.length, 0);

  const opened = [];
  const miss = harness({
    open: name => {
      opened.push(name);
      return Promise.resolve({ match: () => Promise.resolve(undefined), put: () => Promise.resolve() });
    }
  });
  const first = miss.dispatch(release);
  assert.equal((await first.response).ok, true);
  await flush();
  assert.equal(miss.timers.length, 1, 'the release cache is trimmed like the JSON cache');
  assert.match(opened[0], /^cm-release-/);
});

test('a release body that does not parse is served once, never stored, and refetched next time', async () => {
  const release = { url: 'https://r2.ciphermaniac.com/releases/v1/online/abc123/master.json', method: 'GET' };
  const bodies = ['{"items": [', '{"items": [', '{"items": []}'];
  let fetches = 0;
  const worker = harness({
    fetcher: () => {
      const body = bodies[Math.min(fetches, bodies.length - 1)];
      fetches += 1;
      return Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } }));
    }
  });
  const broken = worker.dispatch(release);
  assert.equal(await (await broken.response).text(), '{"items": [');
  await Promise.all(broken.lifetimes);
  assert.equal(worker.writes.length, 0);
  const healthy = worker.dispatch(release);
  assert.equal(await (await healthy.response).text(), '{"items": []}');
  await flush();
  assert.equal(fetches, 3, 'the bad body was retried once past the browser cache, then fetched anew');
  assert.equal(worker.writes.length, 1);
});

test('a release body that does not parse is fetched again past the browser cache, and the good copy stored', async () => {
  const release = { url: 'https://r2.ciphermaniac.com/releases/v1/online/abc123/master.json', method: 'GET' };
  const inits = [];
  const worker = harness({
    fetcher: (_request, init) => {
      inits.push(init);
      const body = init?.cache === 'reload' ? '{"items": []}' : '{"items": [';
      return Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } }));
    }
  });
  const event = worker.dispatch(release);
  assert.equal(await (await event.response).text(), '{"items": [');
  await flush();
  await flush();
  assert.deepEqual(
    inits.map(init => init?.cache),
    [undefined, 'reload']
  );
  assert.equal(worker.writes.length, 1);
  assert.equal(await worker.writes[0].response.text(), '{"items": []}');
});

test('a release body stored over a day ago is served once more while a refetch replaces it', async () => {
  const release = { url: 'https://r2.ciphermaniac.com/releases/v1/online/abc123/master.json', method: 'GET' };
  const stale = new Response('null', { headers: { 'x-cm-stored-at': String(Date.now() - 2 * 24 * 60 * 60 * 1000) } });
  const inits = [];
  const worker = harness({
    cached: stale,
    fetcher: (_request, init) => {
      inits.push(init);
      return Promise.resolve(new Response('{"items": []}', { headers: { 'content-type': 'application/json' } }));
    }
  });
  const event = worker.dispatch(release);
  assert.equal(await (await event.response).text(), 'null');
  await flush();
  assert.equal(worker.writes.length, 1);
  assert.equal(await worker.writes[0].response.text(), '{"items": []}');
  assert.ok(Number(worker.writes[0].response.headers.get('x-cm-stored-at')) > Date.now() - 60_000);
  assert.equal(inits[0]?.cache, 'reload', 'the refetch skips the browser HTTP cache');
});

test('a mutable report refresh uses the browser HTTP cache as usual', async () => {
  const inits = [];
  const worker = harness({
    cached: new Response('cached'),
    fetcher: (_request, init) => {
      inits.push(init);
      return Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    }
  });
  await worker.dispatch(report).response;
  assert.equal(inits.length, 1);
  assert.equal(inits[0], undefined);
});

test('a write that lands while a trim is deleting makes the trim read the keys again', async () => {
  const deletion = deferred();
  let keyReads = 0;
  const worker = harness({
    keys: () => {
      keyReads += 1;
      return Promise.resolve(Array.from({ length: 121 }, (_, index) => `report-${index}`));
    },
    remove: () => (keyReads === 1 ? deletion.promise : Promise.resolve(true))
  });
  const first = worker.dispatch(report);
  await first.response;
  await flush();
  worker.timers[0]();
  await flush();
  assert.equal(keyReads, 1, 'the first trim read the keys and is deleting');
  const second = worker.dispatch(report);
  await second.response;
  await flush();
  deletion.resolve(true);
  await Promise.all([...first.lifetimes, ...second.lifetimes]);
  assert.equal(keyReads, 2);
});

test('a stored release body drops the transfer encoding and length the browser already undid', async () => {
  const release = { url: 'https://r2.ciphermaniac.com/releases/v1/online/abc123/master.json', method: 'GET' };
  const worker = harness({
    fetcher: () =>
      Promise.resolve(
        new Response('{"items": []}', {
          headers: { 'content-type': 'application/json', 'content-encoding': 'br', 'content-length': '9' }
        })
      )
  });
  await worker.dispatch(release).response;
  await flush();
  assert.equal(worker.writes.length, 1);
  const stored = worker.writes[0].response;
  assert.equal(stored.headers.get('content-encoding'), null);
  assert.equal(stored.headers.get('content-length'), null);
  assert.equal(stored.headers.get('content-type'), 'application/json');
});

test('a reload past a day that does not parse is not reloaded a second time', async () => {
  const release = { url: 'https://r2.ciphermaniac.com/releases/v1/online/abc123/master.json', method: 'GET' };
  const stale = new Response('{}', { headers: { 'x-cm-stored-at': String(Date.now() - 2 * 24 * 60 * 60 * 1000) } });
  const inits = [];
  const worker = harness({
    cached: stale,
    fetcher: (_request, init) => {
      inits.push(init);
      return Promise.resolve(new Response('{"items": [', { headers: { 'content-type': 'application/json' } }));
    }
  });
  const event = worker.dispatch(release);
  await event.response;
  await Promise.all(event.lifetimes);
  assert.deepEqual(
    inits.map(init => init?.cache),
    ['reload']
  );
  assert.equal(worker.writes.length, 0);
});

test('a release body stored "in the future" by a clock that stepped back counts as stale', async () => {
  const release = { url: 'https://r2.ciphermaniac.com/releases/v1/online/abc123/master.json', method: 'GET' };
  const future = new Response('{}', { headers: { 'x-cm-stored-at': String(Date.now() + 60 * 60 * 1000) } });
  let fetches = 0;
  const worker = harness({
    cached: future,
    fetcher: () => {
      fetches += 1;
      return Promise.resolve(new Response('{"items": []}', { headers: { 'content-type': 'application/json' } }));
    }
  });
  await worker.dispatch(release).response;
  assert.equal(fetches, 1);
});
