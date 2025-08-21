// Lightweight router and URL state helpers for the grid page

export function getStateFromURL(loc = window.location){
  const params = new URLSearchParams(loc.search);
  return {
    q: params.get('q') || '',
    sort: params.get('sort') || '',
    archetype: params.get('archetype') || '',
  tour: params.get('tour') || '',
  fav: params.get('fav') || ''
  };
}

export function setStateInURL(state, opts = {}){
  const { replace = false, merge = false } = opts;

  // Start from existing params when merging, otherwise build a fresh set
  const params = merge ? new URLSearchParams(location.search) : new URLSearchParams();

  // Helper to set or remove a param depending on value
  const setOrDelete = (key, val) => {
    if (val === undefined || val === null || val === '') {
      params.delete(key);
    } else {
      params.set(key, String(val));
    }
  };

  setOrDelete('q', state.q);
  setOrDelete('sort', state.sort);
  setOrDelete('archetype', state.archetype);
  setOrDelete('tour', state.tour);
  setOrDelete('fav', state.fav);

  const search = params.toString();
  const newUrl = `${location.pathname}${search ? `?${search}` : ''}${location.hash || ''}`;
  if(replace){
    history.replaceState(null, '', newUrl);
  } else {
    history.pushState(null, '', newUrl);
  }
}

// Pure planning helpers for tests: return { redirect: boolean, url?: string }
export function planNormalizeIndexRoute(loc){
  if(/^#card\//.test(loc.hash)){
    const base = loc.pathname.replace(/index\.html?$/i, 'card.html');
    return { redirect: true, url: `${base}${loc.search}${loc.hash}` };
  }
  return { redirect: false };
}

export function planNormalizeCardRoute(loc){
  if(/^#grid$/.test(loc.hash)){
    const base = loc.pathname.replace(/card\.html?$/i, 'index.html');
    return { redirect: true, url: `${base}${loc.search}#grid` };
  }
  return { redirect: false };
}

// Minimal hash router normalization so index can gracefully handle card hashes
export function normalizeRouteOnLoad(){
  const plan = planNormalizeIndexRoute(location);
  if(plan.redirect && plan.url){
    location.replace(plan.url);
    return true;
  }
  // Accept #grid as a no-op route alias for the index
  return false;
}

// Card page normalization: allow navigating back to the grid via #grid
// Returns true if a redirect was performed.
export function normalizeCardRouteOnLoad(){
  const plan = planNormalizeCardRoute(location);
  if(plan.redirect && plan.url){
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
export function normalizeUnknownHashOnIndex(){
  const h = location.hash || '';
  if(!h) return false;
  if(h === '#grid') return false;
  if(/^#card\/.+/.test(h)) return false;
  // Unknown hash -> clear it but preserve search params
  const newUrl = `${location.pathname}${location.search}`;
  history.replaceState(null, '', newUrl);
  return true;
}

/**
 * Parse a hash string into a simple route object.
 * @param {string} [hash] - optional hash (defaults to location.hash)
 * @returns {{route: 'card'|'grid'|'unknown', name?: string, raw?: string}}
 */
export function parseHash(hash = location.hash){
  const h = String(hash || '');
  const m = h.match(/^#card\/(.+)$/);
  if(m){
    return { route: 'card', name: decodeURIComponent(m[1]) };
  }
  if(h === '#grid' || h === ''){
    return { route: 'grid' };
  }
  return { route: 'unknown', raw: h };
}

/**
 * Serialize a route object back into a hash string.
 * @param {{route: string, name?: string, raw?: string}} obj
 * @returns {string}
 */
export function stringifyRoute(obj = {}){
  if(!obj || !obj.route) return '';
  if(obj.route === 'card' && obj.name) return `#card/${encodeURIComponent(obj.name)}`;
  if(obj.route === 'grid') return '#grid';
  return obj.raw || '';
}
