import { createResource, onCleanup, type Resource } from 'solid-js';
import { nextCheck } from '../../shared/live/pace';
import type { LiveIndex } from '../../shared/live/types';
import { fetchLiveIndex } from './data/live';
import { latestValue } from './resource';

/** The poller publishes at most once a minute, so nothing newer can exist sooner. */
const POLL_MS = 60_000;
/**
 * The longest a page waits between looks, however long the event sleeps. The
 * overnight wake is worked out from the reader's clock, and a wrong clock
 * should cost a late update, not a missed morning.
 */
const MAX_WAIT_MS = 30 * 60_000;

/**
 * How long to wait before looking again, by the same rule the poller follows
 * (`shared/live/pace.ts`): a minute while the event moves, longer while it
 * rests, never once it has finished.
 * @param index - The last index read, if any
 * @param now - Epoch milliseconds
 * @returns Milliseconds to wait, or null to stop
 */
export function liveDelay(index: LiveIndex | null | undefined, now = Date.now()): number | null {
  if (!index) {
    return POLL_MS;
  }
  const pace = {
    changedAt: index.updatedAt,
    roundComplete: index.playing === 0,
    round2At: index.round2At,
    finished: index.finished
  };
  const next = nextCheck(pace, now);
  return next === null ? null : Math.min(MAX_WAIT_MS, Math.max(POLL_MS, next - now));
}

interface Visibility {
  hidden: () => boolean;
  /** Calls back when the page is shown or hidden; returns the unsubscribe. */
  watch: (onChange: () => void) => () => void;
}

const documentVisibility: Visibility = {
  hidden: () => document.hidden,
  watch: onChange => {
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }
};

/**
 * Calls `refetch` after each wait `delay` asks for, while the tab is visible.
 * A look that falls due in a hidden tab happens when the tab is shown again. A
 * null delay stops the polling; so does the return value.
 */
export function pollWhileVisible(
  refetch: () => unknown,
  delay: () => number | null = () => POLL_MS,
  visibility: Visibility = documentVisibility
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let owed = false;
  let stopped = false;
  const schedule = (ms: number | null) => {
    if (!stopped && ms !== null) {
      timer = setTimeout(fire, ms);
    }
  };
  const look = async () => {
    owed = false;
    try {
      await refetch();
    } finally {
      schedule(delay());
    }
  };
  const fire = () => {
    if (visibility.hidden()) {
      owed = true;
    } else {
      void look();
    }
  };
  const unwatch = visibility.watch(() => {
    if (owed && !visibility.hidden()) {
      void look();
    }
  });
  // The resource fetches on creation, so the first wait is a plain minute.
  schedule(POLL_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
    unwatch();
  };
}

/**
 * A resource refetched while the tab is visible, as often as `delay` says;
 * every minute by default. Read it with `latestValue` (lib/resource.ts) so a
 * refetch updates the view in place.
 */
export function createPolled<S, T>(
  source: () => S | false | null | undefined,
  fetcher: (source: S) => Promise<T>,
  delay?: () => number | null
): Resource<T> {
  const [resource, { refetch }] = createResource(source, fetcher);
  onCleanup(pollWhileVisible(refetch, delay));
  return resource;
}

/** An event's index, polled at the pace it sets for itself. */
export function createLiveIndex(slug: () => string | false | null | undefined): Resource<LiveIndex | null> {
  const index: Resource<LiveIndex | null> = createPolled(slug, fetchLiveIndex, () => liveDelay(latestValue(index)));
  return index;
}
