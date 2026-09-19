/**
 * The live poll: refetches on the minute, holds off while the tab is hidden,
 * and stops when told to, so a page left open does not poll forever.
 */

import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { pollWhileVisible } from '../../src/lib/livePoll.ts';

const MINUTE = 60_000;

test('polls each minute while visible, not while hidden, and not once stopped', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  let hidden = false;
  let fetches = 0;
  const stop = pollWhileVisible(
    () => {
      fetches += 1;
    },
    () => hidden
  );

  mock.timers.tick(MINUTE);
  assert.equal(fetches, 1);

  hidden = true;
  mock.timers.tick(MINUTE);
  assert.equal(fetches, 1);

  hidden = false;
  mock.timers.tick(MINUTE);
  assert.equal(fetches, 2);

  stop();
  mock.timers.tick(5 * MINUTE);
  assert.equal(fetches, 2);
  mock.timers.reset();
});
