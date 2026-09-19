/**
 * The two device-stored live signals, end to end: the schedule is fetched once
 * and stored for the next visit's first paint, and a follow is written through.
 * Both modules read storage when first imported, so storage is in place first.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTick } from 'node:timers/promises';

const stored = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value)
  }
});

const SCHEDULE = { generatedAt: '2026-09-19T00:00:00Z', events: [] };

test('the schedule is fetched once, shared, and stored for the next visit', async () => {
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (() => {
    fetches += 1;
    return Promise.resolve(new Response(JSON.stringify(SCHEDULE), { status: 200 }));
  }) as typeof globalThis.fetch;
  try {
    const { useLiveSchedule } = await import('../../src/lib/liveSchedule.ts');
    const schedule = useLiveSchedule();
    assert.equal(schedule(), null);
    useLiveSchedule();
    await nextTick();
    assert.deepEqual(schedule(), SCHEDULE);
    assert.equal(fetches, 1);
    assert.deepEqual(JSON.parse(stored.get('cm-live-schedule') ?? '{}').schedule, SCHEDULE);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a follow is written through to storage, and an unfollow removes it', async () => {
  const { useLiveFollows } = await import('../../src/lib/liveFollows.ts');
  const { follows, toggle } = useLiveFollows();
  toggle('ada lovelace|GB');
  assert.equal(follows().has('ada lovelace|GB'), true);
  assert.equal(stored.get('cm-live-follows'), '["ada lovelace|GB"]');
  toggle('ada lovelace|GB');
  assert.equal(stored.get('cm-live-follows'), '[]');
});
