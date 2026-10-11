/**
 * The beat a linked .tdf is read on.
 *
 * At an event TOM is the window in front, so the console's tab is hidden, and
 * Chromium stretches a hidden page's timers to one wake-up a minute once it
 * has been hidden for five. A dedicated worker's timers are not stretched, so
 * the beat comes from one as messages, which the page takes at once. A hidden
 * page reads less often, and reads at once when it is back in view. Only
 * Chromium browsers link files, and every one of them runs workers.
 */

export const SHOWN_MS = 2000;
export const HIDDEN_MS = 10_000;

/** Beats every `ms` it is last sent. */
const WORKER = 'let t;onmessage=e=>{clearInterval(t);t=setInterval(()=>postMessage(0),e.data)}';

export interface Beat {
  setEvery: (ms: number) => void;
  stop: () => void;
}

function workerBeat(onBeat: () => void): Beat {
  const url = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
  const worker = new Worker(url);
  worker.onmessage = onBeat;
  return {
    setEvery: ms => worker.postMessage(ms),
    stop: () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  };
}

/** Runs `tick` on the beat until the returned stop is called. */
export function fileTicks(tick: () => void, doc: Document = document, beat = workerBeat): () => void {
  const pace = beat(tick);
  const every = () => (doc.hidden ? HIDDEN_MS : SHOWN_MS);
  const shown = () => {
    pace.setEvery(every());
    if (!doc.hidden) {
      tick();
    }
  };
  pace.setEvery(every());
  doc.addEventListener('visibilitychange', shown);
  return () => {
    doc.removeEventListener('visibilitychange', shown);
    pace.stop();
  };
}
