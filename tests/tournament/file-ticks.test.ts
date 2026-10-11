/**
 * The linked .tdf's beat: quick while the console is in view, slower but
 * steady behind TOM, a read the moment the console is back, and nothing
 * once stopped.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { type Beat, fileTicks, HIDDEN_MS, SHOWN_MS } from '../../src/lib/tournament/fileTicks.ts';

function page(hidden: boolean) {
  const doc = new EventTarget() as EventTarget & { hidden: boolean };
  doc.hidden = hidden;
  const show = (next: boolean) => {
    doc.hidden = next;
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  return { doc: doc as unknown as Document, show };
}

function fakeBeat() {
  const paces: number[] = [];
  let beat = () => {};
  let stopped = false;
  const make = (onBeat: () => void): Beat => {
    beat = onBeat;
    return { setEvery: ms => paces.push(ms), stop: () => (stopped = true) };
  };
  return { make, paces, beat: () => beat(), stopped: () => stopped };
}

test('reads on the beat, slower while hidden, and at once when shown again', () => {
  const { doc, show } = page(false);
  const beat = fakeBeat();
  let reads = 0;
  const stop = fileTicks(() => (reads += 1), doc, beat.make);
  assert.deepEqual(beat.paces, [SHOWN_MS]);
  assert.equal(reads, 0, 'the first read is the link’s own');

  beat.beat();
  assert.equal(reads, 1);

  show(true);
  assert.deepEqual(beat.paces, [SHOWN_MS, HIDDEN_MS]);
  assert.equal(reads, 1, 'hiding does not read');
  beat.beat();
  assert.equal(reads, 2, 'a hidden page still reads on its beat');

  show(false);
  assert.deepEqual(beat.paces, [SHOWN_MS, HIDDEN_MS, SHOWN_MS]);
  assert.equal(reads, 3, 'back in view reads at once');

  stop();
  assert.ok(beat.stopped());
  show(true);
  assert.equal(beat.paces.length, 3, 'a stopped beat hears nothing more');
});

test('a page hidden from the start beats at the hidden pace', () => {
  const beat = fakeBeat();
  fileTicks(() => {}, page(true).doc, beat.make)();
  assert.deepEqual(beat.paces, [HIDDEN_MS]);
});

test('the beat comes from a worker, which is ended with the beat', () => {
  const sent: unknown[] = [];
  let ended = false;
  class FakeWorker {
    onmessage: (() => void) | null = null;
    constructor(readonly url: string) {
      workers.push(this);
    }
    postMessage(ms: unknown) {
      sent.push(ms);
    }
    terminate() {
      ended = true;
    }
  }
  const workers: FakeWorker[] = [];
  const before = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  try {
    let reads = 0;
    const stop = fileTicks(() => (reads += 1), page(false).doc);
    assert.deepEqual(sent, [SHOWN_MS]);
    assert.match(workers[0]?.url ?? '', /^blob:/);
    workers[0]?.onmessage?.();
    assert.equal(reads, 1, 'each message from the worker is a read');
    stop();
    assert.ok(ended);
  } finally {
    globalThis.Worker = before;
  }
});
