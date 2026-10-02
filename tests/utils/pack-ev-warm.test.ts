import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { PossibleHit } from '../../shared/packEv/simulate.ts';
import { warmHits, whenShown } from '../../src/pages/packEv/warm.ts';

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

function hit(id: number, reprint = false): PossibleHit {
  return {
    card: {
      id,
      name: `Card ${id}`,
      number: `${id}/200`,
      rarity: 'Rare',
      prices: {},
      reprint: reprint ? true : undefined
    },
    value: 10
  };
}

const flush = () =>
  new Promise<void>(resolve => {
    setImmediate(resolve);
  });

function imageRequests(t: TestContext, values: Record<string, unknown> = {}) {
  const requests: Array<{ src: string; finish: () => void }> = [];
  class MockImage {
    src = '';
    referrerPolicy = '';
    decode() {
      return new Promise<void>(resolve => {
        requests.push({ src: this.src, finish: resolve });
      });
    }
  }
  browserGlobals(t, { window: {}, navigator: {}, Image: MockImage, ...values });
  return requests;
}

test('warming limits concurrent requests and cancellation leaves queued art available', async t => {
  const requests = imageRequests(t);
  const hits = Array.from({ length: 6 }, (_, index) => hit(index + 1));
  const stop = warmHits('WARM-A', hits);
  assert.equal(requests.length, 4);
  requests[0].finish();
  await flush();
  assert.equal(requests.length, 5);
  stop();
  requests.forEach(request => request.finish());
  await flush();
  assert.equal(requests.length, 5);
  warmHits('WARM-A', hits);
  assert.equal(requests.length, 6);
  requests[5].finish();
  await flush();
});

test('overlapping queues deduplicate at dispatch, including different products sharing art', async t => {
  const requests = imageRequests(t);
  const hits = Array.from({ length: 8 }, (_, index) => hit(index + 11));
  warmHits('WARM-B', hits);
  warmHits('WARM-B', hits);
  assert.equal(requests.length, 8);
  requests.forEach(request => request.finish());
  await flush();
  assert.equal(requests.length, 8, 'queued duplicates must not start again after the other queue settles');
  warmHits('warm-b', [{ ...hit(999), card: { ...hit(999).card, number: hits[0].card.number } }]);
  assert.equal(requests.length, 8);
  warmHits('WARM-C', [hits[0]]);
  assert.equal(requests.length, 9, 'the same product in another set has a different art URL');
  requests[8].finish();
  await flush();
});

test('reprints warm their product image once across sets', async t => {
  const requests = imageRequests(t);
  warmHits('WARM-D', [hit(1001, true)]);
  warmHits('WARM-E', [hit(1001, true)]);
  assert.deepEqual(
    requests.map(request => request.src),
    ['https://tcgplayer-cdn.tcgplayer.com/product/1001_200w.jpg']
  );
  requests[0].finish();
  await flush();
});

test('data-saving and server contexts do not warm or mark art as warmed', async t => {
  const connection = { saveData: true };
  const requests = imageRequests(t, { navigator: { connection } });
  warmHits('WARM-F', [hit(1002)]);
  assert.equal(requests.length, 0);
  connection.saveData = false;
  Reflect.set(globalThis, 'window', undefined);
  warmHits('WARM-F', [hit(1002)]);
  assert.equal(requests.length, 0);
  Reflect.set(globalThis, 'window', {});
  warmHits('WARM-F', [hit(1002)]);
  assert.equal(requests.length, 1);
  requests[0].finish();
  await flush();
});

test('visibility warming disconnects before invoking the callback and on cleanup', t => {
  let intersect!: IntersectionObserverCallback;
  let disconnected = 0;
  const element = {} as Element;
  class MockObserver {
    constructor(callback: IntersectionObserverCallback) {
      intersect = callback;
    }
    observe(observed: Element) {
      assert.equal(observed, element);
    }
    disconnect() {
      disconnected++;
    }
  }
  browserGlobals(t, { IntersectionObserver: MockObserver });
  let shown = 0;
  const stop = whenShown(element, () => {
    assert.equal(disconnected, 1);
    shown++;
  });
  intersect([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
  assert.equal(shown, 0);
  intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  assert.equal(shown, 1);
  stop();
  assert.equal(disconnected, 2);
});
