/**
 * The public page's polling: everyone reads the published file and falls
 * back to the API only every half minute, staff ask the API only for decks
 * the public cannot see yet, a change the console announces is asked of the
 * API once, failed looks back off, and a page whose first load failed keeps
 * trying.
 */

import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { DEFAULT_SETTINGS, type PublishedView, type TournamentView } from '../../shared/tournament/view.ts';
import {
  createViewPoll,
  FALLBACK_MS,
  firstView,
  lookOnReturn,
  POLL_MS,
  pollDelay,
  schedulePolls,
  SCREEN_POLL_MS,
  seesMoreThanPublished,
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
    ownCopy: view => view.viewer.role !== null,
    announced: () => 0,
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

test('a page that shows staff their own copy asks the API on every poll and skips the published copy', async () => {
  const s = source({ shown: viewAt(3, 'staff'), api: async () => viewAt(5, 'staff') });
  await s.poll();
  await s.poll();
  assert.deepEqual([s.calls.api, s.calls.published], [2, 0]);
  assert.equal(s.shown()?.version, 5);
});

test('staff whose copy the published file holds read the file like anyone', async () => {
  const s = source({
    shown: viewAt(3, 'staff'),
    ownCopy: () => false,
    published: async () => ({ version: 4 }) as PublishedView
  });
  await s.poll();
  assert.deepEqual([s.calls.api, s.calls.published], [0, 1]);
  assert.equal(s.shown()?.viewer.role, 'staff', 'the viewer is kept');
});

test('staff see more than the file only while decks are theirs alone', () => {
  const staffWith = (deckVisibility: 'off' | 'after' | 'always', finished = false) =>
    ({
      viewer: { role: 'staff', me: null, signedIn: true },
      settings: { ...DEFAULT_SETTINGS, deckVisibility, finished }
    }) as TournamentView;
  assert.equal(seesMoreThanPublished(staffWith('after')), true);
  assert.equal(seesMoreThanPublished(staffWith('after', true)), false, 'shown to all once the event ends');
  assert.equal(seesMoreThanPublished(staffWith('always')), false);
  assert.equal(seesMoreThanPublished(staffWith('off')), false);
  const player = { ...staffWith('after'), viewer: { role: null, me: null, signedIn: true } } as TournamentView;
  assert.equal(seesMoreThanPublished(player), false);
});

test('a staff copy taken from the file is asked for whole, since the API would call it current', async () => {
  const sinces: number[] = [];
  let own = false;
  const s = source({
    shown: viewAt(3, 'staff'),
    ownCopy: () => own,
    published: async () => ({ version: 4 }) as PublishedView,
    api: async since => {
      sinces.push(since);
      return since === 0 ? viewAt(4, 'staff') : null;
    }
  });
  await s.poll();
  assert.equal(s.shown()?.version, 4, 'decks shown to all: the file will do');
  own = true;
  await s.poll();
  await s.poll();
  assert.deepEqual(sinces, [0, 4], 'whole once, then only what changed');
});

test('a change the console announced asks the API once, until the file catches up', async () => {
  let announced = 5;
  let file = 3;
  const s = source({
    shown: viewAt(3),
    ownCopy: () => false,
    announced: () => announced,
    published: async () => ({ version: file }) as PublishedView,
    api: async () => viewAt(5)
  });
  await s.poll();
  assert.equal(s.shown()?.version, 5, 'the API has the change before the file does');
  await s.poll();
  assert.equal(s.calls.api, 1, 'asked once for the change, not on every poll');
  announced = 7;
  file = 7;
  await s.poll();
  assert.deepEqual([s.shown()?.version, s.calls.api], [7, 1], 'a file that already has the change is enough');
});

test('a failed API look reports failure, and failures wait longer up to five minutes', async () => {
  const s = source({ shown: viewAt(3, 'owner'), api: () => Promise.reject(new Error('offline')) });
  assert.equal(await s.poll(), false);
  assert.deepEqual(
    [0, 1, 2, 10].map(n => pollDelay(n)),
    [POLL_MS, 2 * POLL_MS, 4 * POLL_MS, 5 * 60_000]
  );
  assert.deepEqual(
    [0, 1, 10].map(n => pollDelay(n, SCREEN_POLL_MS)),
    [SCREEN_POLL_MS, 2 * SCREEN_POLL_MS, 5 * 60_000],
    'the big screen looks twice as often, and backs off to the same ceiling'
  );
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

test('a look asked for while one is under way follows it at once', async () => {
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
      () => false,
      SCREEN_POLL_MS
    );
    mock.timers.tick(SCREEN_POLL_MS);
    assert.equal(looks, 1);
    // The console changed the event after this look had already read it.
    polls.soon();
    finish(true);
    await settle();
    mock.timers.tick(0);
    await settle();
    assert.equal(looks, 2, 'the change is looked for without waiting out the schedule');
    finish(true);
    await settle();
    mock.timers.tick(SCREEN_POLL_MS - 1);
    await settle();
    assert.equal(looks, 2, 'and the schedule carries on from there');
    polls.stop();
  } finally {
    mock.timers.reset();
  }
});

test('a page first shows the published file as nobody, and asks the API only when it cannot be read', async () => {
  let asked = 0;
  const api = async () => {
    asked += 1;
    return viewAt(7, 'owner');
  };
  const read = await firstView({ published: async () => ({ version: 6 }) as PublishedView, api });
  assert.deepEqual([read.version, read.viewer], [6, { role: null, me: null, signedIn: false }]);
  assert.equal(asked, 0, 'a room opening the page asks the functions for nothing');
  assert.equal((await firstView({ published: async () => null, api })).version, 7, 'not published yet');
  const unreachable = await firstView({ published: () => Promise.reject(new Error('blocked')), api });
  assert.equal(unreachable.viewer.role, 'owner', 'the API says who is asking');
  assert.equal(asked, 2);
});

test('a page back in view or back online looks at once, until it closes', () => {
  const heard = new Map<string, () => void>();
  const target = {
    addEventListener: (name: string, listener: () => void) => void heard.set(name, listener),
    removeEventListener: (name: string) => void heard.delete(name)
  };
  const page = { ...target, hidden: true };
  const globals = globalThis as { document?: unknown; window?: unknown };
  const before = { document: globals.document, window: globals.window };
  Object.assign(globals, { document: page, window: target });
  try {
    let looks = 0;
    const forget = lookOnReturn({ soon: () => void (looks += 1), stop: () => undefined });
    heard.get('visibilitychange')?.();
    assert.equal(looks, 0, 'going out of view is not a reason to look');
    page.hidden = false;
    heard.get('visibilitychange')?.();
    heard.get('online')?.();
    assert.equal(looks, 2);
    forget();
    assert.equal(heard.size, 0);
  } finally {
    Object.assign(globals, before);
  }
});
