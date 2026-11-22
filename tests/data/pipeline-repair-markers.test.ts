/**
 * tests/data/pipeline-repair-markers.test.ts
 * Maintenance repairs keep their own producer markers, and the release guard refuses unfinished ones.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { assertNoIncompleteProducers } from '../../.github/scripts/build-loop.ts';
import { completedStage } from '../../.github/scripts/lib/pipelineStore.ts';
import { runRepair, runSideBySide } from '../../.github/scripts/run-data-pipeline.ts';

function memoryStore() {
  const objects = new Map<string, unknown>();
  return {
    objects,
    read: async <T>(key: string) => (objects.get(key) as T | undefined) ?? null,
    write: async (key: string, value: unknown) => {
      objects.set(key, value);
    }
  };
}

const fail = () => {
  throw new Error('producer failed');
};

test('a successful price repair does not clear a failed daily run', async () => {
  const store = memoryStore();
  await assert.rejects(
    completedStage(store, 'daily', { inputs: '2026-11-18', revision: 'r', run: async () => fail() }),
    /producer failed/
  );
  await runRepair(store, 'price-history', () => {});
  await assert.rejects(assertNoIncompleteProducers(store.read), /daily producer is incomplete/);
});

const refusals: Record<string, string> = {
  'price-history':
    'repair-price-history producer is incomplete; refusing partial publication; ' +
    're-run the price-history maintenance operation to clear it',
  'print-prices':
    'repair-print-prices producer is incomplete; refusing partial publication; ' +
    're-run the print-prices maintenance operation to clear it, ' +
    'or delete build/v1/producers/repair-print-prices.json if it keeps failing'
};

test('a repair that fails after its first write blocks publication until it is re-run', async () => {
  for (const operation of ['price-history', 'print-prices']) {
    const store = memoryStore();
    await completedStage(store, 'daily', { inputs: '2026-11-18', revision: 'r', run: async () => {} });
    const writeThenFail = (marker: string) => {
      store.objects.set(marker, { status: 'building' });
      fail();
    };
    await assert.rejects(runRepair(store, operation, writeThenFail), /producer failed/);
    await assert.rejects(assertNoIncompleteProducers(store.read), { message: refusals[operation] });
    await runRepair(store, operation, () => {});
    await assertNoIncompleteProducers(store.read);
  }
});

test('a repair that fails before writing blocks nothing', async () => {
  const store = memoryStore();
  await assert.rejects(runRepair(store, 'print-prices', fail), /producer failed/);
  await assertNoIncompleteProducers(store.read);
});

test('side-by-side producers all finish before the first failure is reported', async () => {
  const finished: string[] = [];
  const slow = async () => {
    await new Promise(resolve => {
      setTimeout(resolve, 20);
    });
    finished.push('slow');
  };
  const failing = async () => {
    finished.push('failing');
    throw new Error('format meta failed');
  };
  await assert.rejects(runSideBySide([failing, slow]), /format meta failed/);
  assert.deepEqual(finished, ['failing', 'slow']);
  await runSideBySide([slow]);
});
