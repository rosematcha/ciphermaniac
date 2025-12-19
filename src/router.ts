// Lightweight router and URL state helpers for the grid page
import { buildCardPath } from './card/routing.js';

export interface AppState {
  query?: string;
  sort?: string;
  archetype?: string;
  tour?: string;
  sets?: string;
  cardType?: string;
  advanced?: string;
}

export interface SetStateOptions {
  replace?: boolean;
  merge?: boolean;
}

export interface RoutePlan {
  redirect: boolean;
  url?: string;
}

export interface RouteObject {
  route: 'card' | 'grid' | 'unknown';
  name?: string;
  raw?: string;
}

/**
 * Get state from URL
 * @param loc
 */
export function getStateFromURL(loc: Location | URL = window.location): AppState {
  const params = new URLSearchParams(loc.search);
  return {
    query: params.get('q') || '',
    sort: params.get('sort') || '',
    archetype: params.get('archetype') || '',
    tour: params.get('tour') || '',
    sets: params.get('sets') || '',
    cardType: params.get('type') || '',
    advanced: params.get('advanced') || ''
  };
}

/**
 * Set state in URL
 * @param state
 * @param opts
 */
export function setStateInURL(state: AppState, opts: SetStateOptions = {}): void {
  const { replace = false, merge = false } = opts;

  // Start from existing params when merging, otherwise build a fresh set
  const params = merge ? new URLSearchParams(location.search) : new URLSearchParams();

  // Helper to set or remove a param depending on value
  const setOrDelete = (key: string, val: string | undefined | null) => {
    if (val === undefined || val === null || val === '') {
      params.delete(key);
    } else {
      params.set(key, String(val));
    }
  };

  // Only update parameters that are explicitly provided in the state object
  if ('query' in state) {
    setOrDelete('q', state.query);
  }
  if ('sort' in state) {
    setOrDelete('sort', state.sort);
  }
  if ('archetype' in state) {
    setOrDelete('archetype', state.archetype);
  }
  if ('tour' in state) {
    setOrDelete('tour', state.tour);
  }
  if ('sets' in state) {
    setOrDelete('sets', state.sets);
  }
  if ('cardType' in state) {
    setOrDelete('type', state.cardType);
  }
  if ('advanced' in state) {
    setOrDelete('advanced', state.advanced);
  }

  const search = params.toString();
  const newUrl = `${location.pathname}${search ? `?${search}` : ''}${location.hash || ''}`;
  if (replace) {
    history.replaceState(null, '', newUrl);
  } else {
    history.pushState(null, '', newUrl);
  }
}

// Pure planning helpers for tests: return { redirect: boolean, url?: string }
/**
 * Plan normalize index route
 * @param loc
 */
export function planNormalizeIndexRoute(loc: Location | URL): RoutePlan {
  const hash = loc.hash || '';
  if (/^#card\//.test(hash)) {
    const identifier = decodeURIComponent(hash.replace(/^#card\//, ''));
    const search = loc.search || '';
    const targetPath = buildCardPath(identifier);
    return { redirect: true, url: `${targetPath}${search}` };
  }
  return { redirect: false };
}

/**
 * Plan normalize card route
 * @param loc
 */
export function planNormalizeCardRoute(loc: Location | URL): RoutePlan {
  if (/^#grid$/.test(loc.hash)) {
    const search = loc.search || '';
    const base = /card\.html?$/i.test(loc.pathname) ? loc.pathname.replace(/card\.html?$/i, 'index.html') : '/';
    return { redirect: true, url: `${base}${search}#grid` };
  }
  return { redirect: false };
}

// Minimal hash router normalization so index can gracefully handle card hashes
/**
 * Normalize route on load
 */
export function normalizeRouteOnLoad(): boolean {
  const plan = planNormalizeIndexRoute(location);
  if (plan.redirect && plan.url) {
    location.replace(plan.url);
    return true;
  }
  // Accept #grid as a no-op route alias for the index
  return false;
}

// Card page normalization: allow navigating back to the grid via #grid
// Returns true if a redirect was performed.
/**
 * Normalize card route on load
 */
export function normalizeCardRouteOnLoad(): boolean {
  const plan = planNormalizeCardRoute(location);
  if (plan.redirect && plan.url) {
    location.replace(plan.url);
    return true;
  }
  return false;
}

/**
 * Ensure index page has a valid hash. If the hash is present but not recognized
 * (not #grid and not #card/...), clear the hash to avoid leaving the app in an
 * unknown state. Returns true if the hash was cleared.
 *
 * This is intentionally conservative and only runs on index.html.
 */
export function normalizeUnknownHashOnIndex(): boolean {
  const hash = location.hash || '';
  if (!hash) {
    return false;
  }
  if (hash === '#grid') {
    return false;
  }
  if (/^#card\/.+/.test(hash)) {
    return false;
  }
  // Unknown hash -> clear it but preserve search params
  const newUrl = `${location.pathname}${location.search}`;
  history.replaceState(null, '', newUrl);
  return true;
}

/**
 * Parse a hash string into a simple route object.
 * @param hash - optional hash (defaults to location.hash)
 * @returns RouteObject
 */
export function parseHash(hash: string = location.hash): RouteObject {
  const hashValue = String(hash || '');
  const match = hashValue.match(/^#card\/(.+)$/);
  if (match) {
    return { route: 'card', name: decodeURIComponent(match[1]) };
  }
  if (hashValue === '#grid' || hashValue === '') {
    return { route: 'grid' };
  }
  return { route: 'unknown', raw: hashValue };
}

/**
 * Serialize a route object back into a hash string.
 * @param obj
 * @returns string
 */
export function stringifyRoute(obj: Partial<RouteObject> = {}): string {
  if (!obj || !obj.route) {
    return '';
  }
  if (obj.route === 'card' && obj.name) {
    return `#card/${encodeURIComponent(obj.name)}`;
  }
  if (obj.route === 'grid') {
    return '#grid';
  }
  return obj.raw || '';
}
