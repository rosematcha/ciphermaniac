/**
 * The public page's polling: players read the published file and fall back
 * to the API only every half minute, staff always ask the API, failed looks
 * back off, and a page whose first load failed keeps trying.
 */

import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import type { PublishedView, TournamentView } from '../../shared/tournament/view.ts';
import {
  createViewPoll,
  FALLBACK_MS,
  POLL_MS,
  pollDelay,
  schedulePolls,
  type ViewSource
} from '../../src/lib/tournament/viewPoll.ts';

const viewAt = (version: number, role: 'owner' | 'staff' | null = null) =>
  ({ version, viewer: { role, me: null, signedIn: role !== null } }) as unknown as TournamentView;

function source(overrides: Partial<ViewSource> & { shown?: TournamentView }) {
  let now = 0;
  let { shown } = overrides;
  const calls = { api: 0, published: 0, reload: 0 };
  const poll = createViewPoll({
    current: () => shown,
    reload: async () => {
      calls.reload += 1;
      return false;
    },
    apply: view => {
      shown = view;
    },
    now: () => now,
    ...overrides,
    published: async () => {
      calls.published += 1;
      return overrides.published ? overrides.published() : null;
    },
    api: async since => {
      calls.api += 1;
      return overrides.api ? overrides.api(since) : null;
    }
  });
  return { poll, calls, shown: () => shown, tick: (ms: number) => (now += ms) };
}

test('a player takes a newer published copy and never asks the API while it can be read', async () => {
  const s = source({ shown: viewAt(3), published: async () => ({ version: 4 }) as PublishedView });
  assert.equal(await s.poll(), true);
  assert.equal(s.shown()?.version, 4);
  assert.equal(s.shown()?.viewer.role, null, 'the viewer is kept');
  assert.equal(s.calls.api, 0);
});

test('a player whose published copy cannot be read asks the API every half minute, not every poll', async () => {
  const s = source({ shown: viewAt(3), published: () => Promise.reject(new Error('R2 down')) });
  for (let i = 0; i < 6; i += 1) {
    assert.equal(await s.poll(), true);
    s.tick(POLL_MS);
  }
  assert.equal(s.calls.api, Math.ceil((6 * POLL_MS) / FALLBACK_MS));
});

test('staff ask the API on every poll and skip the published copy', async () => {
  const s = source({ shown: viewAt(3, 'staff'), api: async () => viewAt(5, 'staff') });
  await s.poll();
  await s.poll();
  assert.deepEqual([s.calls.api, s.calls.published], [2, 0]);
  assert.equal(s.shown()?.version, 5);
});

test('a failed API look reports failure, and failures wait longer up to five minutes', async () => {
  const s = source({ shown: viewAt(3, 'owner'), api: () => Promise.reject(new Error('offline')) });
  assert.equal(await s.poll(), false);
  assert.deepEqual([0, 1, 2, 10].map(pollDelay), [POLL_MS, 2 * POLL_MS, 4 * POLL_MS, 5 * 60_000]);
});

test('a page with no event yet loads it again instead of polling for changes', async () => {
  const s = source({});
  assert.equal(await s.poll(), false);
  assert.deepEqual(s.calls, { api: 0, published: 0, reload: 1 });
});

/** Lets the looks the timers started run to the end. */
const settle = () =>
  new Promise<void>(resolve => {
    setImmediate(resolve);
  });

test('looks run on the schedule, one at a time, and back off after failures', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const answers = [false, false, true];
    let looks = 0;
    const polls = schedulePolls(
      async () => {
        looks += 1;
        return answers.shift() ?? true;
      },
      () => false
    );
    mock.timers.tick(POLL_MS);
    await settle();
    mock.timers.tick(pollDelay(1) - 1);
    await settle();
    assert.equal(looks, 1, 'the second look waits out the backoff');
    mock.timers.tick(1);
    await settle();
    assert.equal(looks, 2);
    polls.soon();
    mock.timers.tick(0);
    await settle();
    assert.equal(looks, 3, 'coming back online looks at once');
    polls.stop();
    mock.timers.tick(10 * POLL_MS);
    await settle();
    assert.equal(looks, 3);
  } finally {
    mock.timers.reset();
  }
});

test('a look under way when the page closes schedules nothing after it', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let finish: (ok: boolean) => void = () => undefined;
    let looks = 0;
    const polls = schedulePolls(
      () => {
        looks += 1;
        return new Promise<boolean>(resolve => {
          finish = resolve;
        });
      },
      () => false
    );
    mock.timers.tick(POLL_MS);
    polls.stop();
    finish(true);
    await settle();
    mock.timers.tick(10 * POLL_MS);
    await settle();
    assert.equal(looks, 1);
  } finally {
    mock.timers.reset();
  }
});

test('a hidden page skips its look and keeps the schedule', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let hidden = true;
    let looks = 0;
    const polls = schedulePolls(
      async () => {
        looks += 1;
        return true;
      },
      () => hidden
    );
    mock.timers.tick(POLL_MS);
    await settle();
    hidden = false;
    mock.timers.tick(POLL_MS);
    await settle();
    assert.equal(looks, 1);
    polls.stop();
  } finally {
    mock.timers.reset();
  }
});
