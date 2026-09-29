/**
 * Word between this browser's tabs that an event changed, so a big screen or
 * public page open beside the console looks again at once instead of at its
 * next poll. It never leaves the browser: a projector on another computer
 * keeps polling.
 */

const CHANNEL = 'cm-tournament-changes';

interface Change {
  code: string;
  version: number;
}

/** Tells this browser's other tabs that the event is now at `version`. */
export function announceChange(code: string, version: number): void {
  if (typeof BroadcastChannel === 'undefined') {
    return;
  }
  // Closing after posting still delivers what was posted, and leaves nothing open.
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage({ code, version } satisfies Change);
  channel.close();
}

/** Calls `listener` with each version another tab announces for the event; returns the unsubscribe. */
export function onChange(code: string, listener: (version: number) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') {
    return () => undefined;
  }
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<Partial<Change> | null>) => {
    if (event.data?.code === code && typeof event.data.version === 'number') {
      listener(event.data.version);
    }
  };
  return () => channel.close();
}
