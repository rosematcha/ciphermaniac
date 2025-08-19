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
  const { replace = false } = opts;
  const params = new URLSearchParams();
  if(state.q) params.set('q', state.q);
  if(state.sort) params.set('sort', state.sort);
  if(state.archetype) params.set('archetype', state.archetype);
  if(state.tour) params.set('tour', state.tour);
  if(state.fav) params.set('fav', state.fav);
  const newUrl = `${location.pathname}?${params.toString()}${location.hash || ''}`;
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
