/**
 * Prelaunch switches: off outside development until their launch flips them.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EVENTS_SITE_URL, showEventsSite } from '../../src/lib/flags.ts';

test('the Events link stays hidden outside development until the events site launches', () => {
  assert.equal(showEventsSite, false);
});

test('the Events link goes out to the events site', () => {
  assert.equal(EVENTS_SITE_URL, 'https://events.ciphermaniac.com');
});
