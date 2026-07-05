import type { Resource } from 'solid-js';

/**
 * Non-suspending resource reads.
 *
 * Reading `resource()` while it's loading registers with the nearest
 * <Suspense> boundary — and because @solidjs/router wraps every navigation in
 * a transition, ANY suspending read during a nav holds the entire old page
 * (frozen UI, URL unchanged) until the data lands. On a slow connection that
 * reads as "the site is dead". Cold loads are worse: the app-level boundary
 * has no meaningful fallback, so the main area is blank.
 *
 * Pages should read their data through these helpers instead. Nothing
 * suspends, so navigation commits immediately and each page's own
 * skeleton/empty/error states (already written as <Show> fallbacks) do the
 * progressive-rendering work. The app-level <Suspense> then only covers lazy
 * route chunks.
 */

/**
 * The resource's value once it has resolved, else undefined — including while
 * a refetch is in flight. Use for URL-param-keyed data (card, archetype,
 * player pages): when the param changes you want the skeleton, not the
 * previous entity's data under the new URL.
 */
export function resolved<T>(r: Resource<T>): T | undefined {
  // `state === 'ready'` reads don't suspend; `.error`/`.state` never do.
  // Reading an errored resource throws, so this also guards the error case.
  return r.state === 'ready' ? r() : undefined;
}

/**
 * Like `resolved`, but keeps returning the previous value while a refetch is
 * in flight (stale-while-revalidate). Use for context-keyed data (tournament
 * switcher, filters): the old table updating in place beats a skeleton flash.
 */
export function latestValue<T>(r: Resource<T>): T | undefined {
  if (r.state === 'ready') {
    return r();
  }
  if (r.state === 'refreshing') {
    // `.latest` is documented not to trigger Suspense/transitions once a
    // value exists — which it does in the refreshing state.
    return r.latest;
  }
  return undefined;
}
