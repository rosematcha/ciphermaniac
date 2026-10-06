import assert from 'node:assert/strict';
import test from 'node:test';
import { unpublishedEvents } from '../../.github/scripts/unpublished-events.ts';

const root = (folder: string, generation: string) => `/releases/v1/events/${folder}/${generation}`;

test('lists pending events production does not serve, by folder', () => {
  const production = { 'b, Kept': root('b, Kept', 'aaaaaaaaaaaa'), 'c, Redone': root('c, Redone', 'aaaaaaaaaaaa') };
  const sources = {
    ...production,
    'c, Redone': root('c, Redone', 'bbbbbbbbbbbb'),
    'a, New': root('a, New', 'aaaaaaaaaaaa')
  };
  assert.deepEqual(unpublishedEvents(production, sources), ['a, New', 'c, Redone']);
});

test('reports nothing once every pending event is promoted', () => {
  const production = { 'a, Event': root('a, Event', 'aaaaaaaaaaaa') };
  assert.deepEqual(unpublishedEvents(production, { ...production }), []);
});
