import assert from 'node:assert/strict';
import test from 'node:test';
import { clearPromotedEvents } from '../../.github/scripts/update-channel.ts';

test('clears pending events only after every event reached the promoted manifest', async () => {
  let deleted = false;
  const store = {
    async get() {
      return JSON.stringify({ events: { A: '/releases/v1/events/A/aaaaaaaaaaaa' } });
    },
    async delete() {
      deleted = true;
    }
  };
  assert.equal(await clearPromotedEvents(store, { events: { A: '/releases/v1/events/A/aaaaaaaaaaaa' } }), 1);
  assert.equal(deleted, true);
});

test('refuses to clear malformed or unpromoted pending events', async () => {
  let body: string | null = JSON.stringify({ events: { Missing: '/releases/v1/events/Missing/aaaaaaaaaaaa' } });
  const store = {
    async get() {
      return body;
    },
    async delete() {
      throw new Error('must not delete');
    }
  };
  await assert.rejects(clearPromotedEvents(store, { events: {} }), /unpromoted/);
  await assert.rejects(
    clearPromotedEvents(store, { events: { Missing: '/releases/v1/events/Missing/bbbbbbbbbbbb' } }),
    /unpromoted/
  );
  body = JSON.stringify({ nope: true });
  await assert.rejects(clearPromotedEvents(store, { events: {} }), /invalid/);
  body = null;
  assert.equal(await clearPromotedEvents(store, { events: {} }), 0);
});
