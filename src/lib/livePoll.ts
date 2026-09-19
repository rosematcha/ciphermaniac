import { createResource, onCleanup, type Resource } from 'solid-js';

/** The poller publishes at most once a minute, so nothing newer can exist sooner. */
const POLL_MS = 60_000;

/**
 * A resource refetched every minute while the tab is visible. Read it with
 * `latestValue` (lib/resource.ts) so a refetch updates the view in place.
 */
export function createPolled<S, T>(
  source: () => S | false | null | undefined,
  fetcher: (source: S) => Promise<T>
): Resource<T> {
  const [resource, { refetch }] = createResource(source, fetcher);
  const timer = setInterval(() => {
    if (!document.hidden) {
      void refetch();
    }
  }, POLL_MS);
  onCleanup(() => clearInterval(timer));
  return resource;
}
