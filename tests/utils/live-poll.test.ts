/**
 * The live poll: waits as long as the event's pace says, holds a look that
 * falls due in a hidden tab until the tab is shown, and stops when the event
 * has finished or the page is done with it.
 */

import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { liveDelay, pollWhileVisible } from '../../src/lib/livePoll.ts';
import type { LiveIndex } from '../../shared/live/types.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function page() {
  let hidden = false;
  let onChange = () => {};
  return {
    visibility: {
      hidden: () => hidden,
      watch: (callback: () => void) => {
        onChange = callback;
        return () => {
          onChange = () => {};
        };
      }
    },
    show: (shown: boolean) => {
      hidden = !shown;
      onChange();
    }
  };
}

/** Lets the awaited refetch settle so the next wait is scheduled. */
const settle = () =>
  new Promise(resolve => {
    setImmediate(resolve);
  });

test('looks each time the wait runs out, holds a look while hidden, and stops when told', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const tab = page();
  let fetches = 0;
  const stop = pollWhileVisible(
    () => {
      fetches += 1;
    },
    () => MINUTE,
    tab.visibility
  );

  mock.timers.tick(MINUTE);
  await settle();
  assert.equal(fetches, 1);

  tab.show(false);
  mock.timers.tick(5 * MINUTE);
  await settle();
  assert.equal(fetches, 1);

  tab.show(true);
  await settle();
  assert.equal(fetches, 2, 'the look owed while hidden happens on showing');

  stop();
  mock.timers.tick(5 * MINUTE);
  await settle();
  assert.equal(fetches, 2);
  mock.timers.reset();
});

test('a null wait ends the polling', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  let fetches = 0;
  pollWhileVisible(
    () => {
      fetches += 1;
    },
    () => null,
    page().visibility
  );
  mock.timers.tick(MINUTE);
  await settle();
  mock.timers.tick(HOUR);
  await settle();
  assert.equal(fetches, 1);
  mock.timers.reset();
});

const NOW = Date.parse('2026-09-20T02:00:00Z');
const index = (extra: Partial<LiveIndex>): LiveIndex => ({
  slug: 'test-2027',
  rk9Id: 'TEST01',
  name: 'Test Regional',
  round: 9,
  matches: 100,
  hash: 'h',
  playing: 0,
  updatedAt: new Date(NOW - 2 * HOUR).toISOString(),
  ...extra
});

test('a page follows the event: a minute while it moves, longer at rest, never once it is over', () => {
  assert.equal(liveDelay(undefined, NOW), MINUTE);
  assert.equal(liveDelay(index({ updatedAt: new Date(NOW - MINUTE).toISOString() }), NOW), MINUTE);
  assert.equal(liveDelay(index({}), NOW), 10 * MINUTE);
  assert.equal(liveDelay(index({ finished: true }), NOW), null);
});

test('a page asleep overnight still looks every half hour', () => {
  // Round two at 14:00 UTC, day one's last result at 23:30: the event sleeps until 11:00.
  const night = index({
    round2At: '2026-09-19T14:00:00Z',
    updatedAt: '2026-09-19T23:30:00Z'
  });
  assert.equal(liveDelay(night, NOW), 30 * MINUTE);
});
