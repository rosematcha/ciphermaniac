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

class Channel {
  static opened: Channel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(_name: string) {
    Channel.opened.push(this);
  }
  postMessage(data: unknown) {
    for (const channel of Channel.opened) {
      if (channel !== this && !channel.closed) {
        channel.onmessage?.({ data } as MessageEvent);
      }
    }
  }
  close() {
    this.closed = true;
  }
}

function makeChannel(name: string): BroadcastChannel {
  return new Channel(name) as unknown as BroadcastChannel;
}

test('many event subscriptions share one receiver and independently release it', t => {
  Channel.opened = [];
  t.mock.method(globalThis, 'BroadcastChannel', makeChannel);
  let calls = 0;
  const listener = () => {
    calls += 1;
  };
  const stops = Array.from({ length: 1000 }, (_, i) => onChange(`event-${i % 10}`, listener));
  assert.equal(Channel.opened.length, 1);
  announceChange('event-0', 1);
  assert.equal(calls, 100);
  stops[0]!();
  stops[0]!();
  announceChange('event-0', 2);
  assert.equal(calls, 199, 'the same callback can have independent subscriptions');
  assert.equal(Channel.opened[0]!.closed, false);
  stops.forEach(stop => stop());
  assert.equal(Channel.opened[0]!.closed, true);
  const stop = onChange('event-0', listener);
  announceChange('event-0', 3);
  assert.equal(calls, 200, 'subscribing again reopens the receiver');
  stop();
  assert.ok(Channel.opened.every(channel => channel.closed));
});

test('dispatch ignores malformed notices and handles listener changes during delivery', t => {
  Channel.opened = [];
  t.mock.method(globalThis, 'BroadcastChannel', makeChannel);
  const heard: string[] = [];
  let stopLater = () => {};
  let stopNew = () => {};
  const stopFirst = onChange('ABC123', () => {
    heard.push('first');
    stopLater();
    stopNew();
    stopNew = onChange('ABC123', () => heard.push('new'));
  });
  stopLater = onChange('ABC123', () => heard.push('later'));
  const channel = Channel.opened[0]!;
  for (const data of [null, {}, { code: 'ABC123', version: '1' }, { code: 1, version: 1 }]) {
    channel.onmessage?.({ data } as MessageEvent);
  }
  assert.deepEqual(heard, []);
  announceChange('ABC123', 1);
  assert.deepEqual(heard, ['first']);
  stopFirst();
  announceChange('ABC123', 2);
  assert.deepEqual(heard, ['first', 'new']);
  stopNew();
});

test('one failed listener does not starve the other event subscribers', t => {
  Channel.opened = [];
  t.mock.method(globalThis, 'BroadcastChannel', makeChannel);
  const errors: (() => void)[] = [];
  t.mock.method(globalThis, 'queueMicrotask', (callback: () => void) => {
    errors.push(callback);
  });
  const failure = new Error('listener failed');
  let heard = 0;
  const stopBad = onChange('ABC123', () => {
    throw failure;
  });
  const stopGood = onChange('ABC123', () => {
    heard += 1;
  });
  announceChange('ABC123', 1);
  stopBad();
  stopGood();
  assert.equal(heard, 1);
  assert.equal(errors.length, 1);
  assert.throws(errors[0]!, failure);
});
