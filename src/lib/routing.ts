/**
 * Centralized route definitions and URL parse helpers.
 * Shared by src/router.ts (grid page) and src/card/routing.ts (card page).
 */

export const ROUTES = {
  HOME: '/',
  CARDS: '/cards',
  CARD: '/card',
  TRENDS: '/trends',
  ARCHETYPES: '/archetypes',
  ARCHETYPE: '/archetype',
  ARCHETYPE_HOME: '/archetype-home',
  ARCHETYPE_TRENDS: '/archetype-trends',
  PLAYERS: '/players',
  PLAYER: '/player',
  ABOUT: '/about',
  FEEDBACK: '/feedback',
  TOYS: '/toys'
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

/** Standard query-string param keys used across pages. */
export const QUERY_KEYS = {
  SEARCH: 'q',
  SORT: 'sort',
  ARCHETYPE: 'archetype',
  TOURNAMENT: 'tour',
  SETS: 'sets',
  CARD_TYPE: 'type',
  SUCCESS: 'success',
  ADVANCED: 'advanced',
  CARD_NAME: 'name'
} as const;

/**
 * Read a single query param from a URL-like object.
 */
export function getParam(loc: { search: string }, key: string): string {
  return new URLSearchParams(loc.search).get(key) || '';
}

/**
 * Read multiple query params at once.
 */
export function getParams(loc: { search: string }, keys: readonly string[]): Record<string, string> {
  const params = new URLSearchParams(loc.search);
  const result: Record<string, string> = {};
  for (const key of keys) {
    result[key] = params.get(key) || '';
  }
  return result;
}

/**
 * Build a URL search string from key-value pairs, omitting empty values.
 */
export function buildSearch(entries: Record<string, string | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, value);
    }
  }
  const str = params.toString();
  return str ? `?${str}` : '';
}

/**
 * Strip .html extension and trailing slash to get a canonical path.
 */
export function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, '').replace(/\.html$/i, '') || '/';
}

/**
 * Check whether a pathname matches a given route (ignoring .html / trailing slash).
 */
export function matchesRoute(pathname: string, route: string): boolean {
  return normalizePath(pathname) === route;
}
