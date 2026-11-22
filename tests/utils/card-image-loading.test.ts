import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createReadinessProbe, preloadImage } from '../../src/components/cardImage/loading.ts';

function browserGlobals(t: TestContext, values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => {
      if (previous) {
        Object.defineProperty(globalThis, key, previous);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    });
  }
}

const flush = () =>
  new Promise<void>(resolve => {
    setImmediate(resolve);
  });

test('readiness shares one storage lookup and request across concurrent and warm calls', async t => {
  let reads = 0;
  const writes: string[] = [];
  browserGlobals(t, {
    window: {},
    sessionStorage: {
      getItem: () => {
        reads++;
        return null;
      },
      setItem: (_key: string, value: string) => writes.push(value)
    }
  });
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 200 }));
  let ready = 0;
  const probe = createReadinessProbe(() => {
    ready++;
  });
  for (let i = 0; i < 100; i++) {
    probe();
  }
  await flush();
  probe();
  assert.equal(reads, 1);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(ready, 1);
  assert.deepEqual(writes, ['1']);
});

for (const cached of ['1', '0']) {
  test(`cached readiness ${cached} skips the network and repeated storage reads`, t => {
    let reads = 0;
    let ready = 0;
    browserGlobals(t, {
      window: {},
      sessionStorage: {
        getItem: () => {
          reads++;
          return cached;
        }
      }
    });
    const fetch = t.mock.method(globalThis, 'fetch');
    const probe = createReadinessProbe(() => {
      ready++;
    });
    probe();
    probe();
    assert.equal(reads, 1);
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(ready, cached === '1' ? 1 : 0);
  });
}

for (const failure of ['storage', 'network', 'marker']) {
  test(`readiness ${failure} failure settles without repeated requests`, async t => {
    let ready = 0;
    browserGlobals(t, {
      window: {},
      sessionStorage: {
        getItem: () => {
          if (failure === 'storage') {
            throw new Error('disabled');
          }
          return null;
        },
        setItem: () => {
          if (failure === 'storage') {
            throw new Error('disabled');
          }
        }
      }
    });
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
      if (failure === 'network') {
        throw new Error('offline');
      }
      return new Response('', { status: failure === 'marker' ? 404 : 200 });
    });
    const probe = createReadinessProbe(() => {
      ready++;
    });
    probe();
    await flush();
    probe();
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(ready, failure === 'storage' ? 1 : 0);
  });
}

for (const fails of [false, true]) {
  test(`concurrent preloads share download and decode, then release ${fails ? 'failed' : 'successful'} entries`, async t => {
    let images = 0;
    let finish!: () => void;
    const decoded = new Promise<void>((resolve, reject) => {
      finish = () => {
        if (fails) {
          reject(new Error('missing art'));
        } else {
          resolve();
        }
      };
    });
    const instances: Array<{ src: string; referrerPolicy: string }> = [];
    class MockImage {
      src = '';
      referrerPolicy = '';
      constructor() {
        images++;
        instances.push(this);
      }
      decode() {
        return decoded;
      }
    }
    browserGlobals(t, { window: {}, Image: MockImage });
    const first = preloadImage('/card.webp');
    const requests = Array.from({ length: 100 }, () => preloadImage('/card.webp'));
    assert.ok(requests.every(pending => pending === first));
    assert.equal(images, 1);
    assert.equal(instances[0].referrerPolicy, 'no-referrer');
    assert.equal(instances[0].src, '/card.webp');
    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await flush();
    assert.equal(settled, false, 'preloading must wait for decode before revealing art');
    finish();
    await Promise.all(requests);
    await preloadImage('/card.webp');
    assert.equal(images, 2, 'settled entries must not retain decoded images or failed promises');
    await preloadImage('/other.webp');
    assert.equal(images, 3, 'distinct images must load independently');
  });
}

test('server rendering never probes or preloads images', async t => {
  browserGlobals(t, { window: undefined });
  const fetch = t.mock.method(globalThis, 'fetch');
  createReadinessProbe(() => assert.fail('server readiness'))();
  await preloadImage('/card.webp');
  assert.equal(fetch.mock.callCount(), 0);
});

test('the marker says whether every printing is mirrored and which cards are not, and the session remembers it', async t => {
  const full = '{"prints":true,"unmirrored":["LOR_TG24"]}';
  for (const [body, expected, stored] of [
    ['{"cards":10,"prints":true,"unmirrored":["LOR_TG24",7]}', { prints: true, unmirrored: ['LOR_TG24'] }, full],
    ['{"cards":10}', { prints: false, unmirrored: [] }, '1'],
    ['', { prints: false, unmirrored: [] }, '1']
  ] as const) {
    const writes: string[] = [];
    browserGlobals(t, {
      window: {},
      sessionStorage: { getItem: () => null, setItem: (_key: string, value: string) => writes.push(value) }
    });
    t.mock.method(globalThis, 'fetch', async () => new Response(body, { status: 200 }));
    const seen: unknown[] = [];
    createReadinessProbe(readiness => seen.push(readiness))();
    await flush();
    await flush();
    assert.deepEqual(seen, [expected], body);
    assert.deepEqual(writes, [stored], body);
    t.mock.restoreAll();
  }
  browserGlobals(t, { window: {}, sessionStorage: { getItem: () => full } });
  const seen: unknown[] = [];
  createReadinessProbe(readiness => seen.push(readiness))();
  assert.deepEqual(seen, [{ prints: true, unmirrored: ['LOR_TG24'] }]);
});

test('a session value this code cannot read asks the bucket again', async t => {
  browserGlobals(t, { window: {}, sessionStorage: { getItem: () => '{bad', setItem: () => {} } });
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('{"prints":true}', { status: 200 }));
  const seen: unknown[] = [];
  createReadinessProbe(readiness => seen.push(readiness))();
  await flush();
  await flush();
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(seen.length, 1);
});
