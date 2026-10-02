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

type Listener = (version: number) => void;
const listeners = new Map<string, Set<{ listener: Listener }>>();
let receiver: BroadcastChannel | undefined;

function deliver(listener: Listener, version: number): void {
  try {
    listener(version);
  } catch (error) {
    // Native channels report a listener's error without starving other channels.
    queueMicrotask(() => {
      throw error;
    });
  }
}

function receive(event: MessageEvent<Partial<Change> | null>): void {
  const change = event.data;
  if (typeof change?.code !== 'string' || typeof change.version !== 'number') {
    return;
  }
  const watching = listeners.get(change.code);
  if (!watching) {
    return;
  }
  // A listener can subscribe or unsubscribe during dispatch. New listeners wait
  // for the next notice, and a removed listener is not called after cleanup.
  for (const subscription of [...watching]) {
    if (watching.has(subscription)) {
      deliver(subscription.listener, change.version);
    }
  }
}

/** Calls `listener` with each version another tab announces for the event; returns the unsubscribe. */
export function onChange(code: string, listener: Listener): () => void {
  if (typeof BroadcastChannel === 'undefined') {
    return () => undefined;
  }
  if (!receiver) {
    receiver = new BroadcastChannel(CHANNEL);
    receiver.onmessage = receive;
  }
  const watching = listeners.get(code) ?? new Set<{ listener: Listener }>();
  const subscription = { listener };
  watching.add(subscription);
  listeners.set(code, watching);
  return () => {
    if (!watching.delete(subscription)) {
      return;
    }
    if (watching.size === 0) {
      listeners.delete(code);
    }
    if (listeners.size === 0) {
      receiver?.close();
      receiver = undefined;
    }
  };
}
