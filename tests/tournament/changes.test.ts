/** The word between a browser's tabs that an event changed (see src/lib/tournament/changes.ts). */

import assert from 'node:assert/strict';
import test from 'node:test';

import { announceChange, onChange } from '../../src/lib/tournament/changes.ts';

/** Long enough for a message posted on a channel to arrive. */
const delivered = () =>
  new Promise<void>(resolve => {
    setTimeout(resolve, 20);
  });

test('a change announced in one tab reaches the others watching that event', async () => {
  const heard: number[] = [];
  const stop = onChange('ABC123', version => heard.push(version));
  const other = onChange('ZZZ999', () => heard.push(-1));
  announceChange('ABC123', 7);
  await delivered();
  stop();
  other();
  announceChange('ABC123', 8);
  await delivered();
  assert.deepEqual(heard, [7], 'only the event’s own watchers hear it, and only while watching');
});
