/**
 * Hover/focus prefetch helpers (P-perf: warm a route's lazy chunk before the
 * user actually clicks). Each entry is just the same dynamic `import()` used
 * by the `lazy()` call in main.tsx — the module cache dedupes it, so calling
 * this early is free if the user never navigates and saves a network+parse
 * round trip if they do.
 */

const prefetched = new Set<string>();

/** Route-path -> loader. Keys match the `path` prop passed to `<Route>` in main.tsx. */
const routeLoaders: Record<string, () => Promise<unknown>> = {
  '/cards': () => import('../pages/CardsIndexPage'),
  '/archetypes': () => import('../pages/ArchetypesIndexPage'),
  '/archetypes/:slug': () => import('../pages/ArchetypePage'),
  '/matchups': () => import('../pages/MatchupMatrixPage'),
  '/trends': () => import('../pages/TrendsPage'),
  '/players': () => import('../pages/PlayersPage')
};

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
