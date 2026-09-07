/**
 * Hover/focus prefetch helpers (P-perf: warm a route's lazy chunk before the
 * user actually clicks). Each entry is just the same dynamic `import()` used
 * by the `lazy()` call in main.tsx — the module cache dedupes it, so calling
 * this early is free if the user never navigates and saves a network+parse
 * round trip if they do.
 */

const prefetched = new Set<string>();

let routeLoaders: Readonly<Record<string, () => Promise<unknown>>> = {};

/** Install route loaders from the application composition root. */
export function configurePrefetch(loaders: Readonly<Record<string, () => Promise<unknown>>>): void {
  routeLoaders = loaders;
  prefetched.clear();
}

/** Prefetch the lazy chunk for a top-nav route, once per session. */
export function prefetchRoute(path: string): void {
  if (prefetched.has(path)) {
    return;
  }
  const loader = routeLoaders[path];
  if (!loader) {
    return;
  }
  prefetched.add(path);
  loader().catch(() => {
    // A failed prefetch just means the real navigation will fetch it again.
    prefetched.delete(path);
  });
}

/** Prefetch the archetype detail page chunk, once per session. */
export function prefetchArchetypePage(): void {
  prefetchRoute('/archetypes/:slug');
}

/** Prefetch the card detail page chunk (the largest route chunk), once per session. */
export function prefetchCardPage(): void {
  prefetchRoute('/cards/:set/:number');
}

/** Prefetch the player profile page chunk, once per session. */
export function prefetchPlayerProfilePage(): void {
  prefetchRoute('/players/:id');
}
