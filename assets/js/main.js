import { fetchReport, fetchOverrides, fetchArchetypeReport, fetchTournamentsList, fetchArchetypesList } from './api.js';
import { parseReport } from './parse.js';
import { render, renderSummary, updateLayout } from './render.js';
import { applyFiltersSort } from './controls.js';
import { initMissingThumbsDev, dumpMissingReport } from './dev/missingThumbs.js';
import { initCacheDev } from './dev/cacheDev.js';
import { getStateFromURL, setStateInURL, normalizeRouteOnLoad } from './router.js';

(async function init(){
  // Normalize hash routes like #card/... to card.html
  if(normalizeRouteOnLoad()) return;
  initMissingThumbsDev();
  initCacheDev();
  // Populate tournament selector from manifest
  const tourSel = document.getElementById('tournament');
  let tournaments = [];
  try{
    tournaments = await fetchTournamentsList();
  }catch(e){
    console.error(e);
  }
  if(!Array.isArray(tournaments) || tournaments.length === 0){
    tournaments = ['World Championships 2025'];
  }
  const urlState = getStateFromURL();
  for(const t of tournaments){
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    tourSel.appendChild(opt);
  }
  tourSel.value = urlState.tour && tournaments.includes(urlState.tour) ? urlState.tour : tournaments[0];
  // If URL had an invalid tour, clean it up to the default without adding history
  if(urlState.tour && !tournaments.includes(urlState.tour)){
    setStateInURL({
      q: urlState.q,
      sort: urlState.sort,
      archetype: urlState.archetype,
      tour: tourSel.value
    }, { replace: true });
  }

  // Load initial data for default tournament
  let currentTournament = tourSel.value;
  const overrides = await fetchOverrides();
  let deckTotal = 0; let items = [];
  // Simple local cache for master and archetype index
  const GCACHE_KEY = 'gridCacheV1';
  const TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
  const now = Date.now();
  const loadGridCache = () => { try{ return JSON.parse(localStorage.getItem(GCACHE_KEY) || '{}'); }catch{ return {}; } };
  const saveGridCache = (obj) => { try{ localStorage.setItem(GCACHE_KEY, JSON.stringify(obj)); }catch{} };
  const cache = loadGridCache();
  const getCachedMaster = (tour) => {
    const entry = cache?.master?.[tour];
    if(!entry) return null;
    if(now - (entry.ts||0) > TTL_MS) return null;
    return entry;
  };
  const setCachedMaster = (tour, data) => {
    cache.master = cache.master || {};
    cache.master[tour] = { ts: Date.now(), deckTotal: data.deckTotal, items: data.items };
    saveGridCache(cache);
  };
  const getCachedArcheIndex = (tour) => {
    const entry = cache?.archeIndex?.[tour];
    if(!entry) return null;
    if(now - (entry.ts||0) > TTL_MS) return null;
    return entry;
  };
  const setCachedArcheIndex = (tour, list) => {
    cache.archeIndex = cache.archeIndex || {};
    cache.archeIndex[tour] = { ts: Date.now(), list };
    saveGridCache(cache);
  };
  try{
    // Prefill from cache if available
    const cached = getCachedMaster(currentTournament);
    if(cached){ ({ deckTotal, items } = cached); }
    // Always fetch fresh and update UI/cache
    const master = await fetchReport(currentTournament);
    const parsed = parseReport(master);
    ({ deckTotal, items } = parsed);
    setCachedMaster(currentTournament, parsed);
  }catch(err){
    console.error(err);
    document.getElementById('summary').textContent = `No data for "${currentTournament}". Ensure reports/${currentTournament}/master.json exists.`;
  }

  renderSummary(document.getElementById('summary'), deckTotal, items.length);

  const search = document.getElementById('search');
  const sort = document.getElementById('sort');
  const favFilter = document.getElementById('fav-filter');
  const archeSel = document.getElementById('archetype');
  // Initialize controls from URL state
  if(urlState.q) search.value = urlState.q;
  if(urlState.sort && sort.querySelector(`option[value="${urlState.sort}"]`)) sort.value = urlState.sort;
  if(urlState.fav && favFilter && favFilter.querySelector(`option[value="${urlState.fav}"]`)) favFilter.value = urlState.fav;

  let current = { items, deckTotal };
  const rerender = () => {
    applyFiltersSort(current.items, overrides);
    dumpMissingReport();
  };
  const syncURL = (opts={}) => {
    setStateInURL({
      q: search.value.trim(),
      sort: sort.value,
      archetype: archeSel.value !== '__all__' ? archeSel.value : '',
      tour: currentTournament || '',
      fav: (favFilter && favFilter.value === 'fav') ? 'fav' : ''
    }, opts);
  };
  // Enhanced search suggestions (same features as card page)
  const cardNamesList = document.getElementById('card-names');
  const suggestionsBox = document.getElementById('home-suggestions');
  (async function initHomeSearch(){
    try{
      if(!(search)) return;
      // Populate names from cache + tournaments
      let tournamentsList = [];
      try{ tournamentsList = await fetchTournamentsList(); }catch{}
      if(!Array.isArray(tournamentsList) || tournamentsList.length===0){
        tournamentsList = ['World Championships 2025'];
      }
      const SKEY = 'cardNamesUnionV1';
      const cached = (()=>{ try{ return JSON.parse(localStorage.getItem(SKEY) || '{"names":[]}'); }catch{ return { names: [] }; } })();
      const MAX = 600;
      const byLower = new Map();
      const pushName = (n) => { if(!n) return false; const k = n.toLowerCase(); if(byLower.has(k)) return false; byLower.set(k, n); return true; };
      // seed from cache
      if(Array.isArray(cached.names)) cached.names.forEach(pushName);
      const updateDatalist = () => {
        if(!cardNamesList) return;
        const all = Array.from(byLower.values()).sort((a,b)=> a.localeCompare(b));
        cardNamesList.innerHTML = '';
        for(const n of all.slice(0, MAX)){
          const opt = document.createElement('option'); opt.value = n; cardNamesList.appendChild(opt);
        }
        try{ localStorage.setItem(SKEY, JSON.stringify({ names: all.slice(0, MAX) })); }catch{}
      };
      updateDatalist();
      // progressively enrich
      (async () => {
        for(const t of tournamentsList){
          try{
            const master = await fetchReport(t);
            const parsed = parseReport(master);
            let added = false;
            for(const it of parsed.items){ if(pushName(it?.name)) added = true; }
            if(added) updateDatalist();
          }catch{}
        }
      })();

      // Suggestions logic
      let currentMatches = [];
      let selectedIndex = -1;
      const getAllNames = () => Array.from(cardNamesList?.options || []).map(o=>String(o.value||''));
      const computeMatches = (query) => {
        const q = String(query||'').trim().toLowerCase();
        if(!q) return getAllNames().slice(0, 8);
        const all = getAllNames();
        const starts = [], contains = [];
        for(const n of all){
          const ln = n.toLowerCase();
          if(ln.startsWith(q)) starts.push(n); else if(ln.includes(q)) contains.push(n);
          if(starts.length + contains.length >= 8) break;
        }
        return [...starts, ...contains].slice(0,8);
      };
      const updateSelection = (idx) => {
        if(!suggestionsBox) return;
        const items = Array.from(suggestionsBox.children);
        items.forEach((it,i)=>{
          if(i===idx) it.setAttribute('aria-selected','true'); else it.removeAttribute('aria-selected');
          const right = it.children && it.children[1];
          if(right){ if(i===idx){ right.className='tab-indicator'; right.textContent='Tab'; } else { right.className=''; right.textContent=''; } }
        });
        selectedIndex = (idx>=0 && idx<currentMatches.length) ? idx : -1;
        if(selectedIndex>=0){ search.value = currentMatches[selectedIndex]; }
      };
      const renderSuggestions = () => {
        if(!(suggestionsBox && search)) return;
        currentMatches = computeMatches(search.value);
        selectedIndex = -1;
        suggestionsBox.innerHTML = '';
        if(currentMatches.length === 0 || document.activeElement !== search){ suggestionsBox.classList.remove('is-open'); return; }
        for(let i=0;i<currentMatches.length;i++){
          const item = document.createElement('div'); item.className = 'item'; item.setAttribute('role','option');
          if(i===selectedIndex) item.setAttribute('aria-selected','true');
          const left = document.createElement('span'); left.textContent = currentMatches[i]; item.appendChild(left);
          const right = document.createElement('span'); const tabTarget = (selectedIndex>=0)? selectedIndex : 0; if(i===tabTarget){ right.className='tab-indicator'; right.textContent='Tab'; } item.appendChild(right);
          item.addEventListener('mousedown', (e)=>{ e.preventDefault(); search.value = currentMatches[i]; selectedIndex = i; updateSelection(i); search.focus(); });
          item.addEventListener('click', (e)=>{ e.preventDefault(); selectedIndex = i; doSearch(currentMatches[i]); });
          item.addEventListener('dblclick', (e)=>{ e.preventDefault(); selectedIndex = i; doSearch(currentMatches[i]); });
          suggestionsBox.appendChild(item);
        }
        suggestionsBox.classList.add('is-open');
      };
      const doSearch = (name) => {
        if(name!=null) search.value = name;
        rerender(); syncURL({ replace: false });
      };
      search.addEventListener('focus', renderSuggestions);
      search.addEventListener('input', () => { renderSuggestions(); rerender(); syncURL({ replace: true }); });
      document.addEventListener('click', (e)=>{ if(!suggestionsBox) return; if(!suggestionsBox.contains(e.target) && e.target !== search){ suggestionsBox.classList.remove('is-open'); } });
      search.addEventListener('keydown', (e) => {
        if(e.key === 'Enter'){
          e.preventDefault();
          if(!currentMatches || currentMatches.length === 0){ currentMatches = computeMatches(search.value); }
          const inputVal = search.value.trim();
          let pick = null;
          if(currentMatches && currentMatches.length > 0){
            const idx = (selectedIndex>=0 && selectedIndex<currentMatches.length) ? selectedIndex : 0;
            pick = currentMatches[idx];
          }
          if(!pick){
            const firstEl = suggestionsBox && suggestionsBox.firstElementChild;
            if(firstEl){ const left = firstEl.querySelector('span'); if(left && left.textContent) pick = left.textContent; else pick = firstEl.textContent || null; }
          }
          if(!pick){ const recomputed = computeMatches(search.value); if(recomputed && recomputed.length>0) pick = recomputed[0]; }
          if(!pick && inputVal) pick = inputVal;
          if(pick) doSearch(pick);
          return;
        }
        if(e.key === 'Tab'){
          if(!currentMatches || currentMatches.length===0) return;
          e.preventDefault();
          if(selectedIndex >= 0){ const pick = currentMatches[selectedIndex]; if(pick && pick !== search.value){ search.value = pick; renderSuggestions(); } }
          else { const idx = e.shiftKey ? (currentMatches.length-1) : 0; updateSelection(idx); const pick = currentMatches[idx]; if(pick && pick !== search.value){ search.value = pick; renderSuggestions(); } }
          return;
        }
        if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
          e.preventDefault();
          if(!currentMatches || currentMatches.length===0) return;
          if(e.key === 'ArrowDown'){ const next = selectedIndex < currentMatches.length - 1 ? selectedIndex + 1 : 0; updateSelection(next); }
          else { const prev = selectedIndex > 0 ? selectedIndex - 1 : currentMatches.length - 1; updateSelection(prev); }
          return;
        }
        if(e.key === 'Escape'){ if(suggestionsBox) suggestionsBox.classList.remove('is-open'); selectedIndex = -1; currentMatches = []; return; }
      });
    }catch{}
  })();
  sort.addEventListener('change', () => { rerender(); syncURL(); });
  if(favFilter){ favFilter.addEventListener('change', () => { rerender(); syncURL(); }); }
  rerender();

  // Reflow-only on resize so per-row scaling adapts without reloading images
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    if(resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; updateLayout(); });
  });

  // cache per tournament
  const archeCacheByTournament = new Map(); // tournament -> Map(name -> {data, deckTotal, items})
  const getTournamentCache = (t) => {
    if(!archeCacheByTournament.has(t)) archeCacheByTournament.set(t, new Map());
    return archeCacheByTournament.get(t);
  };
  let archeCache = getTournamentCache(currentTournament);

  async function populateArchetypesSelector(tournament, preserveValue){
    // Remove all options except the first (All archetypes)
    while(archeSel.options.length > 1){ archeSel.remove(1); }
    let list = [];
    try{
      const cachedIndex = getCachedArcheIndex(tournament);
      if(cachedIndex){ list = cachedIndex.list; }
      // Fetch fresh and update cache
      const fresh = await fetchArchetypesList(tournament);
      list = Array.isArray(fresh) && fresh.length ? fresh : list;
      if(Array.isArray(fresh) && fresh.length){ setCachedArcheIndex(tournament, fresh); }
    }catch(err){
      console.warn('No archetype index for', tournament, err);
      list = [];
    }
  // Populate alphabetically without eager fetching; defer per-archetype fetch to selection/hover
  const entries = list.map(fileBase => ({ file: fileBase, label: fileBase.replace(/_/g,' ') }));
  entries.sort((a,b)=> a.label.localeCompare(b.label));
  for(const e of entries){
      const opt = document.createElement('option');
      opt.value = e.file;
      opt.textContent = e.label;
      archeSel.appendChild(opt);
    }
    // preserve selection if still present
    if(preserveValue && entries.some(e => e.file === preserveValue)){
      archeSel.value = preserveValue;
    }else{
      archeSel.value = '__all__';
    }
    // If URL requested a specific archetype and we have it, select it
    if(urlState.archetype && Array.from(archeSel.options).some(o=>o.value===urlState.archetype)){
      archeSel.value = urlState.archetype;
    }
  }

  await populateArchetypesSelector(currentTournament);
  // If URL selected an archetype, trigger dataset switch now; otherwise just sync URL
  if(archeSel.value !== '__all__'){
    archeSel.dispatchEvent(new Event('change'));
  }
  // Ensure URL reflects current initial state
  syncURL({ replace: true });

  archeSel.addEventListener('change', async () => {
    const val = archeSel.value;
    if(val === '__all__'){
      current = { items, deckTotal };
      renderSummary(document.getElementById('summary'), deckTotal, items.length);
      rerender(); syncURL();
      return;
    }
    let cached = archeCache.get(val);
    if(!cached){
      const data = await fetchArchetypeReport(currentTournament, val);
      const parsed = parseReport(data);
      cached = { data, deckTotal: parsed.deckTotal, items: parsed.items };
      archeCache.set(val, cached);
    }
    current = { items: cached.items, deckTotal: cached.deckTotal };
  renderSummary(document.getElementById('summary'), cached.deckTotal, cached.items.length);
  rerender(); syncURL();
  });

  // Hover prefetch for the currently highlighted option in the native select (best-effort)
  // When the dropdown is open, many browsers update selectedIndex as you hover options.
  let lastPrefetched = null;
  archeSel.addEventListener('mousemove', async () => {
    const opt = archeSel.options[archeSel.selectedIndex];
    if(!opt) return;
    const val = opt.value;
    if(val === '__all__') return;
    if(lastPrefetched === val) return;
    lastPrefetched = val;
    if(!archeCache.has(val)){
      try{
        const data = await fetchArchetypeReport(currentTournament, val);
        const parsed = parseReport(data);
        archeCache.set(val, { data, deckTotal: parsed.deckTotal, items: parsed.items });
      }catch{/* ignore */}
    }
  });

  // Tournament change: refetch master and archetype summaries for the selected tournament
  tourSel.addEventListener('change', async () => {
    currentTournament = tourSel.value;
    const prevArchetype = archeSel.value !== '__all__' ? archeSel.value : null;
    let parsedMaster = { deckTotal: 0, items: [] };
    try{
      const masterNew = await fetchReport(currentTournament);
      parsedMaster = parseReport(masterNew);
    }catch(err){
      console.error(err);
      document.getElementById('summary').textContent = `No data for "${currentTournament}". Ensure reports/${currentTournament}/master.json exists.`;
    }
    // swap current dataset
    current = { items: parsedMaster.items, deckTotal: parsedMaster.deckTotal };
  renderSummary(document.getElementById('summary'), current.deckTotal, current.items.length);
  rerender(); syncURL();
    // warm archetype cache (non-blocking fetch)
    archeCache = getTournamentCache(currentTournament);
    await populateArchetypesSelector(currentTournament, prevArchetype);
    // If we preserved selection, switch dataset accordingly
    if(archeSel.value !== '__all__'){
      const sel = archeSel.value;
      const cached = archeCache.get(sel);
      if(cached){
        current = { items: cached.items, deckTotal: cached.deckTotal };
        renderSummary(document.getElementById('summary'), cached.deckTotal, cached.items.length);
        rerender(); syncURL({ replace: true });
      }
    }
  });

  // Handle back/forward navigation restoring state
  window.addEventListener('popstate', () => {
    const st = getStateFromURL();
    // Tournament
    if(st.tour && tournaments.includes(st.tour) && tourSel.value !== st.tour){
      tourSel.value = st.tour;
      tourSel.dispatchEvent(new Event('change'));
    } else if(st.tour && !tournaments.includes(st.tour)){
      // Fallback to default and replace URL so back/forward remains sane
      tourSel.value = tournaments[0];
      setStateInURL({
        q: st.q,
        sort: st.sort,
        archetype: st.archetype,
        tour: tourSel.value
      }, { replace: true });
      tourSel.dispatchEvent(new Event('change'));
    }
    // Controls
    search.value = st.q || '';
    if(st.sort && sort.querySelector(`option[value="${st.sort}"]`)) sort.value = st.sort;
  if(st.archetype && Array.from(archeSel.options).some(o=>o.value===st.archetype)){
      archeSel.value = st.archetype;
      archeSel.dispatchEvent(new Event('change'));
    } else if(!st.archetype) {
      archeSel.value = '__all__';
      archeSel.dispatchEvent(new Event('change'));
    } else {
      rerender();
    }
  if(favFilter){ favFilter.value = (st.fav === 'fav') ? 'fav' : 'all'; }
  });
})();
