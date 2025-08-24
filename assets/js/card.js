// Entry for per-card page: loads meta-share over tournaments and common decks
import { fetchTournamentsList, fetchReport, fetchArchetypesList, fetchArchetypeReport, fetchOverrides, fetchTop8ArchetypesList, fetchCardIndex, fetchMeta } from './api.js';
import { parseReport } from './parse.js';
import { buildThumbCandidates } from './thumbs.js';
import { pickArchetype, baseToLabel } from './selectArchetype.js';
import { normalizeCardRouteOnLoad } from './router.js';
import { prettyTournamentName } from './utils/format.js';
// Show curated suggestions on the card landing view
import './cardsLanding.js';

function getCardNameFromLocation(){
  const params = new URLSearchParams(location.search);
  const q = params.get('name');
  if(q) {return q;}
  // Hash route: #card/<encoded name or UID>
  const m = location.hash.match(/^#card\/(.+)$/);
  if(m) {return decodeURIComponent(m[1]);}
  return null;
}

// Get the canonical identifier for a card - prefer UID, fallback to name
function getCanonicalId(cardItem) {
  return cardItem.uid || cardItem.name;
}

// Get display name from card identifier (UID or name)
function getDisplayName(cardId) {
  if (!cardId) {return null;}
  if (cardId.includes('::')) {
    // UID format: "Name::SET::NUMBER" -> "Name SET NUMBER"
    const parts = cardId.split('::');
    return parts.length >= 3 ? `${parts[0]} ${parts[1]} ${parts[2]}` : cardId;
  }
  return cardId;
}

// Parse display name into name and set ID parts
function parseDisplayName(displayName) {
  if (!displayName) {return {name: '', setId: ''};}
  
  // Match pattern: "CardName SetCode Number" -> split into name and "SetCode Number"
  const match = displayName.match(/^(.+?)\s+([A-Z]+\s+\d+[A-Za-z]?)$/);
  if (match) {
    return {name: match[1], setId: match[2]};
  }
  
  // If no set ID pattern found, treat entire string as name
  return {name: displayName, setId: ''};
}

// Get base name from card identifier
function getBaseName(cardId) {
  if (!cardId) {return null;}
  if (cardId.includes('::')) {
    return cardId.split('::')[0];
  }
  return cardId;
}

// Find canonical identifier for a given search term across all tournaments
async function findCanonicalCard(searchTerm) {
  if (!searchTerm) {return null;}

  let tournaments = [];
  try {
    tournaments = await fetchTournamentsList();
  } catch {
    tournaments = ['World Championships 2025'];
  }

  // Look for exact matches first, then base name matches
  const candidates = new Map(); // base name -> best UID

  for (const tournament of tournaments) {
    try {
      const master = await fetchReport(tournament);
      const parsed = parseReport(master);

      for (const item of parsed.items) {
        const canonicalId = getCanonicalId(item);
        const displayName = getDisplayName(canonicalId);
        const baseName = getBaseName(canonicalId);

        // Direct match - return immediately
        if (canonicalId.toLowerCase() === searchTerm.toLowerCase() ||
            displayName.toLowerCase() === searchTerm.toLowerCase()) {
          return canonicalId;
        }

        // Base name match - store as candidate
        if (baseName.toLowerCase() === searchTerm.toLowerCase()) {
          if (!candidates.has(baseName) || item.uid) {
            candidates.set(baseName, canonicalId);
          }
        }
      }
    } catch {
      // Skip failed tournaments
    }
  }

  // Return best candidate (prefer UID over base name)
  return candidates.get(getBaseName(searchTerm)) || searchTerm;
}

// Normalize #grid route to index when landing on card page via hash
const __ROUTE_REDIRECTING = normalizeCardRouteOnLoad();
const cardIdentifier = getCardNameFromLocation();
const cardName = getDisplayName(cardIdentifier) || cardIdentifier;
const cardTitleEl = document.getElementById('card-title');
if (cardName) {
  const {name, setId} = parseDisplayName(cardName);
  cardTitleEl.innerHTML = '';
  
  const nameSpan = document.createElement('span');
  nameSpan.textContent = name;
  cardTitleEl.appendChild(nameSpan);
  
  if (setId) {
    const setSpan = document.createElement('span');
    setSpan.className = 'card-title-set';
    setSpan.textContent = setId;
    cardTitleEl.appendChild(setSpan);
  }
} else {
  cardTitleEl.textContent = 'Card Details';
}

const metaSection = document.getElementById('card-meta');
const decksSection = document.getElementById('card-decks');
const eventsSection = document.getElementById('card-events');
const copiesSection = document.getElementById('card-copies');
const backLink = document.getElementById('back-link');
// Lightweight floating tooltip used for charts/histograms
let __graphTooltipEl = null;
function ensureGraphTooltip(){
  if(__graphTooltipEl) {return __graphTooltipEl;}
  const t = document.createElement('div');
  t.className = 'graph-tooltip';
  t.setAttribute('role', 'status');
  t.style.position = 'fixed';
  t.style.pointerEvents = 'none';
  t.style.zIndex = 9999;
  t.style.display = 'none';
  document.body.appendChild(t);
  __graphTooltipEl = t;
  return t;
}
function showGraphTooltip(html, x, y){
  const t = ensureGraphTooltip();
  t.innerHTML = html;
  t.style.display = 'block';
  // offset so pointer doesn't overlap
  const offsetX = 12; const offsetY = 12;
  // clamp to viewport
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  let left = x + offsetX;
  let top = y + offsetY;
  // if overflowing right, move left
  const rect = t.getBoundingClientRect();
  if(left + rect.width > vw) {left = Math.max(8, x - rect.width - offsetX);}
  if(top + rect.height > vh) {top = Math.max(8, y - rect.height - offsetY);}
  t.style.left = left + 'px';
  t.style.top = top + 'px';
}
function hideGraphTooltip(){
  const t = __graphTooltipEl;
  if(!t) {return;}
  t.style.display = 'none';
}

// Simple HTML escaper for tooltip content
function escapeHtml(str){
  if(!str) {return '';}
  return String(str).replace(/[&<>\"]/g, (s) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[s]);
}
if(backLink){ backLink.href = 'index.html'; }
const analysisSel = document.getElementById('analysis-event');
const analysisTable = document.getElementById('analysis-table');
const searchInGrid = document.getElementById('search-in-grid');
const windowSelect = document.getElementById('window-select');
// These will be set inside initCardSearch to ensure DOM is ready
let cardSearchInput, cardNamesList, suggestionsBox;
// Copy link button removed per request

// When navigating between cards via hash (e.g., from Suggestions), reload to re-init
try{
  window.addEventListener('hashchange', () => {
    // Only react if we're on card.html and the hash points to a card route
    if(/^#card\//.test(location.hash)){
      location.reload();
    }
  });
}catch{}

// Link to grid prefilled with search
if(searchInGrid){
  const href = `index.html?q=${encodeURIComponent(cardName || '')}`;
  searchInGrid.href = href;
}

// No tabs: all content on one page

// Initialize search suggestions regardless of whether a card is selected
async function initCardSearch(){
  try{
    // Get DOM elements when function is called to ensure DOM is ready
    cardSearchInput = document.getElementById('card-search');
    cardNamesList = document.getElementById('card-names');
    suggestionsBox = document.getElementById('card-suggestions');
    
    if(!(cardSearchInput && cardNamesList)) {
      return;
    }
    let tournaments = [];
    try{ tournaments = await fetchTournamentsList(); }catch{}
    if(!Array.isArray(tournaments) || tournaments.length===0){
      tournaments = ['World Championships 2025'];
    }
    // Union cache across tournaments for robust suggestions
    const SKEY = 'cardNamesUnionV5'; // Updated to include trainers and energies
    const cached = (()=>{ try{ return JSON.parse(localStorage.getItem(SKEY) || '{"names":[]}'); }catch{ return { names: [] }; } })();
    const MAX = 600;
    const byExactName = new Map(); // exact display name -> {display, uid}
    const pushName = (displayName, uid) => {
      if(!displayName) {return false;}
      // Use exact display name as key to avoid collisions between "Snorunt" and "Snorunt TWM 051"
      const k = displayName;
      if(byExactName.has(k)) {return false;}
      byExactName.set(k, {display: displayName, uid: uid || displayName});
      return true;
    };
    // Seed from cache for instant suggestions
    if(Array.isArray(cached.names)){
      for(const n of cached.names){ pushName(n); }
    }
    const updateDatalist = () => {
      const all = Array.from(byExactName.values()).sort((a,b)=> a.display.localeCompare(b.display));
      cardNamesList.innerHTML = '';
      for(const item of all.slice(0, MAX)){
        const opt = document.createElement('option');
        opt.value = item.display;
        opt.setAttribute('data-uid', item.uid);
        cardNamesList.appendChild(opt);
      }
      // update cache
      try{ localStorage.setItem(SKEY, JSON.stringify({ names: all.slice(0, MAX).map(i => i.display) })); }catch{}
    };
    updateDatalist();

    // Incrementally enrich suggestions by scanning tournaments sequentially
    (async () => {
      for(const t of tournaments){
        try{
          const master = await fetchReport(t);
          const parsed = parseReport(master);
          let added = false;
          for(const it of parsed.items){
            const canonicalId = getCanonicalId(it);
            const displayName = getDisplayName(canonicalId);

            // Store all cards: Pokemon with full identifiers (Name SET Number), Trainers/Energies with base names
            if(pushName(displayName, canonicalId)) {added = true;}
          }
          if(added) {updateDatalist();}
        }catch{/* skip missing */}
      }
    })();
    if(cardName) {cardSearchInput.value = cardName;}
    const getAllNames = () => Array.from(cardNamesList?.options || []).map(o=>String(o.value||''));
    const getUidForName = (displayName) => {
      const option = Array.from(cardNamesList?.options || []).find(o => o.value === displayName);
      return option?.getAttribute('data-uid') || displayName;
    };
    const computeMatches = (query) => {
      const q = query.trim().toLowerCase();
      if(!q) {return getAllNames().slice(0, 8);}
      const all = getAllNames();
      const starts = [], contains = [];
      for(const n of all){
        const ln = n.toLowerCase();
        if(ln.startsWith(q)) {starts.push(n);}
        else if(ln.includes(q)) {contains.push(n);}
        if(starts.length + contains.length >= 8) {break;}
      }
      return [...starts, ...contains].slice(0,8);
    };
    const renderSuggestions = () => {
      if(!(suggestionsBox && cardSearchInput)) {return;}
      const matches = computeMatches(cardSearchInput.value);
      // wire keyboard state
      currentMatches = matches;
      // reset selection when suggestions refresh
      selectedIndex = -1;
      suggestionsBox.innerHTML = '';
      if(matches.length === 0 || document.activeElement !== cardSearchInput){
        suggestionsBox.classList.remove('is-open');
        return;
      }
      for(let i=0;i<matches.length;i++){
        const item = document.createElement('div');
        item.className = 'item'; item.setAttribute('role','option');
        if(i===selectedIndex) {item.setAttribute('aria-selected','true');}
        const left = document.createElement('span');
        left.className = 'suggestion-name';
        const {name, setId} = parseDisplayName(matches[i]);
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = name;
        left.appendChild(nameSpan);
        
        if (setId) {
          const setSpan = document.createElement('span');
          setSpan.className = 'suggestion-set';
          setSpan.textContent = setId;
          left.appendChild(setSpan);
        }
        
        item.appendChild(left);
        const right = document.createElement('span');
        // show Tab badge on the first item by default (or on selectedIndex when set)
        const tabTarget = (selectedIndex >= 0) ? selectedIndex : 0;
        if(i === tabTarget){ right.className = 'tab-indicator'; right.textContent = 'Tab'; }
        item.appendChild(right);
        // click selects into input (but doesn't navigate)
        // Prevent blur on mousedown and preview selection without re-rendering
        item.addEventListener('mousedown', (e)=>{ e.preventDefault(); cardSearchInput.value = matches[i]; selectedIndex = i; updateSelection(i); cardSearchInput.focus(); });
        // Single click navigates (same as Enter)
        item.addEventListener('click', (e)=>{ e.preventDefault(); selectedIndex = i; goTo(matches[i]); });
        // Double-click also navigates (kept for fast users)
        item.addEventListener('dblclick', (e)=>{ e.preventDefault(); selectedIndex = i; goTo(matches[i]); });
        suggestionsBox.appendChild(item);
      }
      suggestionsBox.classList.add('is-open');
    };
    cardSearchInput.addEventListener('focus', renderSuggestions);
    cardSearchInput.addEventListener('input', renderSuggestions);
    document.addEventListener('click', (e)=>{
      if(!suggestionsBox) {return;}
      if(!suggestionsBox.contains(e.target) && e.target !== cardSearchInput){ suggestionsBox.classList.remove('is-open'); }
    });
    const goTo = (identifier) => {
      if(!identifier) {return;}
      // Try to get the UID for this display name
      const targetId = getUidForName(identifier) || identifier;
      const clean = `${location.origin}${location.pathname.replace(/card\.html$/, 'card.html')}#card/${encodeURIComponent(targetId)}`;
      location.assign(clean);
      setTimeout(() => { try{ location.reload(); }catch{} }, 0);
    };
    // Keyboard handling: Arrow navigation, Enter to select, Tab to complete, Escape to close
    let currentMatches = [];
    let selectedIndex = -1;
    const updateSelection = (idx) => {
      if(!suggestionsBox) {return;}
      const items = Array.from(suggestionsBox.children);
      items.forEach((it,i)=>{
        if(i===idx) {it.setAttribute('aria-selected','true');} else {it.removeAttribute('aria-selected');}
        // move tab-indicator to the selected item (update right span)
        const right = it.children && it.children[1];
        if(right){
          if(i===idx){ right.className = 'tab-indicator'; right.textContent = 'Tab'; }
          else { right.className = ''; right.textContent = ''; }
        }
      });
      selectedIndex = (idx >= 0 && idx < currentMatches.length) ? idx : -1;
      if(selectedIndex >= 0){
        // preview selection into the input so user sees the chosen suggestion
        cardSearchInput.value = currentMatches[selectedIndex];
      }
    };
    cardSearchInput.addEventListener('keydown', (e) => {
      if(e.key === 'Enter'){
        e.preventDefault();
        // If user navigated suggestions, pick highlighted; otherwise use input value
        const pick = (selectedIndex >= 0 && currentMatches[selectedIndex]) ? currentMatches[selectedIndex] : cardSearchInput.value.trim();
        if(pick) {goTo(pick);}
        return;
      }
      if(e.key === 'Tab'){
        if(!currentMatches || currentMatches.length === 0) {return;}
        e.preventDefault();
        // Tab completes the current highlight (or top/last when none)
        if(selectedIndex >= 0){
          const pick = currentMatches[selectedIndex];
          if(pick && pick !== cardSearchInput.value){
            cardSearchInput.value = pick;
            try{ const end = pick.length; cardSearchInput.setSelectionRange(end, end); }catch{}
            renderSuggestions();
          }
        } else {
          // No selection yet: choose top (or last if shift)
          const idx = e.shiftKey ? (currentMatches.length - 1) : 0;
          updateSelection(idx);
          const pick = currentMatches[idx];
          if(pick && pick !== cardSearchInput.value){
            cardSearchInput.value = pick;
            try{ const end = pick.length; cardSearchInput.setSelectionRange(end, end); }catch{}
            renderSuggestions();
          }
        }
        return;
      }
      if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
        e.preventDefault();
        if(!currentMatches || currentMatches.length === 0) {return;}
        if(e.key === 'ArrowDown'){
          const next = selectedIndex < currentMatches.length - 1 ? selectedIndex + 1 : 0;
          updateSelection(next);
        } else {
          const prev = selectedIndex > 0 ? selectedIndex - 1 : currentMatches.length - 1;
          updateSelection(prev);
        }
        return;
      }
      if(e.key === 'Escape'){
        if(suggestionsBox) {suggestionsBox.classList.remove('is-open');}
        selectedIndex = -1; currentMatches = [];
        return;
      }
    });
    cardSearchInput.addEventListener('change', () => {
      const v = cardSearchInput.value.trim();
      if(v){ goTo(v); }
    });
  }catch{}
}

// Ensure DOM is ready before initializing search
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCardSearch);
} else {
  initCardSearch();
}

function findCard(items, cardIdentifier){
  if (!cardIdentifier) {return null;}
  const lower = cardIdentifier.toLowerCase();

  // First try direct UID match
  const directUidMatch = items.find(item => item.uid && item.uid.toLowerCase() === lower);
  if (directUidMatch) {return directUidMatch;}

  // Try exact name match (for trainers without UIDs)
  const exactNameMatch = items.find(item => item.name && item.name.toLowerCase() === lower);
  if (exactNameMatch) {return exactNameMatch;}

  // Try UID-to-display-name conversion ("Name SET NUMBER" format)
  for (const item of items) {
    if (item.uid) {
      const displayName = getDisplayName(item.uid);
      if (displayName && displayName.toLowerCase() === lower) {
        return item;
      }
    }
  }

  // Check if this looks like a specific variant request that failed
  if (cardIdentifier.includes(' ') && /[A-Z]{2,4}\s\d+/i.test(cardIdentifier)) {
    // This looks like "Name SET NUMBER" but we didn't find an exact match
    return null;
  }

  // Pure base name query - only return exact name matches (trainers)
  const baseNameMatches = items.filter(item => {
    const baseName = getBaseName(getCanonicalId(item));
    return baseName && baseName.toLowerCase() === lower;
  });

  if (baseNameMatches.length === 0) {return null;}

  // Only return base name matches for cards without UIDs (trainers)
  const withoutUid = baseNameMatches.find(item => !item.uid);
  if (withoutUid) {return withoutUid;}

  // For Pokemon with only UID variants, return null for base name queries
  return null;
}

function renderChart(container, points){
  if(!points.length){ container.textContent = 'No data.'; return; }
  // Use the container's actual width to avoid overflow; cap min/max for readability
  const cw = container.getBoundingClientRect ? container.getBoundingClientRect().width : (container.clientWidth || 0);
  const w = Math.max(220, Math.min(700, cw || 600));
  const h = 180;
  const pad = 28;
  const xs = points.map((_,i)=>i);
  const ys = points.map(p=>p.pct || 0);
  const maxY = Math.max(10, Math.ceil(Math.max(...ys)));
  const scaleX = (i) => pad + (i * (w - 2*pad) / Math.max(1, xs.length - 1));
  const scaleY = (y) => h - pad - (y * (h - 2*pad) / maxY);
  const path = points.map((p,i) => `${i===0?'M':'L'}${scaleX(i)},${scaleY(p.pct || 0)}`).join(' ');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  // axes
  const xAxis = document.createElementNS(svgNS, 'line');
  xAxis.setAttribute('x1', String(pad));
  xAxis.setAttribute('y1', String(h - pad));
  xAxis.setAttribute('x2', String(w - pad));
  xAxis.setAttribute('y2', String(h - pad));
  xAxis.setAttribute('stroke', '#39425f');
  svg.appendChild(xAxis);
  const yAxis = document.createElementNS(svgNS, 'line');
  yAxis.setAttribute('x1', String(pad));
  yAxis.setAttribute('y1', String(pad));
  yAxis.setAttribute('x2', String(pad));
  yAxis.setAttribute('y2', String(h - pad));
  yAxis.setAttribute('stroke', '#39425f');
  svg.appendChild(yAxis);
  // line
  const line = document.createElementNS(svgNS, 'path');
  line.setAttribute('d', path);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', '#6aa3ff');
  line.setAttribute('stroke-width', '2');
  svg.appendChild(line);

  // Add a transparent, thick hit-path on top of the line so hovering anywhere near it
  // will show tooltip information for the nearest point.
  const hit = document.createElementNS(svgNS, 'path');
  hit.setAttribute('d', path);
  hit.setAttribute('fill', 'none');
  hit.setAttribute('stroke', 'transparent');
  hit.setAttribute('stroke-width', '18');
  hit.setAttribute('pointer-events', 'stroke');
  svg.appendChild(hit);
  function onHitMove(ev){
    try{
      const rect = svg.getBoundingClientRect();
      const svgX = ev.clientX - rect.left;
      const norm = (svgX - pad) / (w - 2*pad);
      const idx = Math.round(norm * Math.max(1, xs.length - 1));
      const i = Math.max(0, Math.min(xs.length - 1, idx));
      const p = points[i];
      if(p){
        showGraphTooltip(`<strong>${escapeHtml(prettyTournamentName(p.tournament))}</strong><div>${(p.pct||0).toFixed(1)}%</div>`, ev.clientX, ev.clientY);
      }
    }catch(e){}
  }
  hit.addEventListener('mousemove', onHitMove);
  hit.addEventListener('mouseenter', onHitMove);
  hit.addEventListener('mouseleave', hideGraphTooltip);
  // dots
  points.forEach((p,i)=>{
    const cx = scaleX(i);
    const cy = scaleY(p.pct || 0);
    // visible small dot
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', String(cy));
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', '#6aa3ff');
    svg.appendChild(dot);
    // larger invisible hit target behind the dot for easier hover
    const hitDot = document.createElementNS(svgNS, 'circle');
    hitDot.setAttribute('cx', String(cx));
    hitDot.setAttribute('cy', String(cy));
    hitDot.setAttribute('r', '12');
    hitDot.setAttribute('fill', 'transparent');
    hitDot.setAttribute('pointer-events', 'all');
    const tip = `${prettyTournamentName(p.tournament)}: ${(p.pct||0).toFixed(1)}%`;
    hitDot.setAttribute('tabindex', '0');
    hitDot.setAttribute('role', 'img');
    hitDot.setAttribute('aria-label', tip);
    hitDot.addEventListener('mousemove', (ev) => showGraphTooltip(`<strong>${escapeHtml(prettyTournamentName(p.tournament))}</strong><div>${(p.pct||0).toFixed(1)}%</div>`, ev.clientX, ev.clientY));
    hitDot.addEventListener('mouseenter', (ev) => showGraphTooltip(`<strong>${escapeHtml(prettyTournamentName(p.tournament))}</strong><div>${(p.pct||0).toFixed(1)}%</div>`, ev.clientX, ev.clientY));
    hitDot.addEventListener('mouseleave', hideGraphTooltip);
    hitDot.addEventListener('focus', (ev) => showGraphTooltip(`<strong>${escapeHtml(prettyTournamentName(p.tournament))}</strong><div>${(p.pct||0).toFixed(1)}%</div>`, ev.clientX || 0, ev.clientY || 0));
    hitDot.addEventListener('blur', hideGraphTooltip);
    svg.appendChild(hitDot);
  });
  container.innerHTML = '';
  container.appendChild(svg);
  const caption = document.createElement('div');
  caption.className = 'summary';
  caption.textContent = 'Meta-share over tournaments (All archetypes)';
  container.appendChild(caption);
}

function renderCopiesHistogram(container, overall){
  container.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'summary';
  box.textContent = 'Copies distribution in the most recent visible event:';
  container.appendChild(box);
  const hist = document.createElement('div');
  hist.className = 'hist';
  const dist = overall?.dist || [];
  const total = overall?.total || 0;
  const maxPct = Math.max(1, ...dist.map(d => (total ? (100*(d.players||0)/total) : (d.percent || 0))));
  for(let c=1;c<=4;c++){
    const d = dist.find(x=>x.copies===c);
    const pct = d ? (total ? (100*(d.players||0)/total) : (d.percent||0)) : 0;
    const col = document.createElement('div'); col.className='col';
    const bar = document.createElement('div'); bar.className='bar';
    bar.style.height = Math.max(2, Math.round(54 * (pct / maxPct))) + 'px';
    const lbl = document.createElement('div'); lbl.className='lbl'; lbl.textContent=String(c);
    const tipText = d ? `${c}x: ${pct.toFixed(1)}%${(d&&total)?` (${d.players}/${total})`:''}` : `${c}x: 0%`;
    col.setAttribute('tabindex', '0');
    col.setAttribute('role', 'img');
    col.setAttribute('aria-label', tipText);
    col.addEventListener('mousemove', (ev) => showGraphTooltip(escapeHtml(tipText), ev.clientX, ev.clientY));
    col.addEventListener('mouseenter', (ev) => showGraphTooltip(escapeHtml(tipText), ev.clientX, ev.clientY));
    col.addEventListener('mouseleave', hideGraphTooltip);
    col.addEventListener('focus', (ev) => showGraphTooltip(escapeHtml(tipText), ev.clientX || 0, ev.clientY || 0));
    col.addEventListener('blur', hideGraphTooltip);
    col.appendChild(bar); col.appendChild(lbl); hist.appendChild(col);
  }
  container.appendChild(hist);
}

function renderDecks(container, rows){
  container.innerHTML = '';
  if(!rows.length){ container.textContent = 'No common decks data.'; return; }
  const tbl = document.createElement('table');
  tbl.style.width = '100%';
  tbl.style.borderCollapse = 'collapse';
  tbl.style.marginTop = '8px';
  tbl.style.background = 'var(--panel)';
  tbl.style.border = '1px solid #242a4a';
  tbl.style.borderRadius = '8px';
  const thead = document.createElement('thead');
  const hdr = document.createElement('tr');
	    ['Tournament','Usage % (All)','Decks (All)'].forEach(h=>{
		    const th = document.createElement('th'); th.textContent = h; th.style.textAlign='left'; th.style.padding='10px 12px'; th.style.borderBottom='1px solid #2c335a'; th.style.color='var(--muted)'; hdr.appendChild(th);
	    });
  thead.appendChild(hdr);
  tbl.appendChild(thead);
  const tbody = document.createElement('tbody');
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    // Tournament cell is a link back to main with tournament selected
    const tLink = document.createElement('a');
    tLink.href = `index.html?tour=${encodeURIComponent(r.tournament)}`;
    tLink.textContent = prettyTournamentName(r.tournament);
    const cells = [tLink, r.pct!=null? r.pct.toFixed(1)+'%':'—', r.found!=null && r.total!=null? `${r.found}/${r.total}`:'—'];
    cells.forEach((v,i)=>{ const td = document.createElement('td'); if(v instanceof HTMLElement){ td.appendChild(v); } else { td.textContent = v; } td.style.padding='10px 12px'; if(i===1) {td.style.textAlign='right';} tr.appendChild(td); });
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  container.appendChild(tbl);
}
function renderEvents(container, rows){
  container.innerHTML = '';
  if(!rows.length){ container.textContent = 'No recent events data.'; return; }
  const tbl = document.createElement('table');
  tbl.style.width = '80%'; tbl.style.marginLeft='auto'; tbl.style.marginRight='auto'; tbl.style.borderCollapse='collapse'; tbl.style.marginTop='8px'; tbl.style.background='var(--panel)'; tbl.style.border='1px solid #242a4a'; tbl.style.borderRadius='8px';
  const thead = document.createElement('thead');
  const hdr = document.createElement('tr');
  ['Tournament','Usage % (All)'].forEach((h,i)=>{ const th = document.createElement('th'); th.textContent=h; th.style.textAlign= i===1 ? 'right' : 'left'; th.style.padding='10px 12px'; th.style.borderBottom='1px solid #2c335a'; th.style.color='var(--muted)'; hdr.appendChild(th); });
  thead.appendChild(hdr); tbl.appendChild(thead);
  const tbody = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    const tLink = document.createElement('a'); tLink.href = `index.html?tour=${encodeURIComponent(r.tournament)}`; tLink.textContent = prettyTournamentName(r.tournament);
    const cells = [tLink, r.pct!=null? r.pct.toFixed(1)+'%':'—'];
    cells.forEach((v,i)=>{ const td = document.createElement('td'); if(v instanceof HTMLElement){ td.appendChild(v); } else { td.textContent = v; } td.style.padding='10px 12px'; if(i===1) {td.style.textAlign='right';} tr.appendChild(td); });
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  container.appendChild(tbl);
}

async function collectCardVariants(cardIdentifier) {
  if (!cardIdentifier) {return [];}

  const variants = new Set();
  let tournaments = [];

  try {
    tournaments = await fetchTournamentsList();
  } catch {
    tournaments = ['World Championships 2025'];
  }

  if (!Array.isArray(tournaments) || tournaments.length === 0) {
    tournaments = ['World Championships 2025'];
  }

  // Collect variants from all tournaments
  for (const tournament of tournaments) {
    try {
      const master = await fetchReport(tournament);
      const parsed = parseReport(master);

      for (const item of parsed.items) {
        const canonicalId = getCanonicalId(item);
        const itemBaseName = getBaseName(canonicalId);
        const searchBaseName = getBaseName(cardIdentifier);

        if (itemBaseName && searchBaseName && itemBaseName.toLowerCase() === searchBaseName.toLowerCase()) {
          // Add canonical display name
          variants.add(getDisplayName(canonicalId));
        }
      }
    } catch {
      // Skip failed tournament loads
    }
  }

  return Array.from(variants).sort();
}

async function renderCardSets(cardIdentifier) {
  const setsContainer = document.getElementById('card-sets');
  if (!setsContainer || !cardIdentifier) {return;}

  try {
    const variants = await collectCardVariants(cardIdentifier);

    if (variants.length === 0) {
      setsContainer.textContent = '';
      return;
    }

    setsContainer.textContent = variants.join(', ');
  } catch (error) {
    console.warn('Failed to load card variants:', error);
    setsContainer.textContent = '';
  }
}

async function load(){
  if(!cardIdentifier){ metaSection.textContent = 'Missing card identifier.'; return; }
  // Loading state
  const chartEl = document.getElementById('card-chart') || metaSection;
  chartEl.textContent = 'Loading…';
  if(eventsSection) {eventsSection.textContent = '';}
  if(copiesSection) {copiesSection.textContent = '';}
  // Load overrides for thumbnails and render hero
  const overrides = await fetchOverrides();
  const hero = document.getElementById('card-hero');
  if(hero && cardName){
    const img = document.createElement('img');
    img.alt = cardName; img.decoding = 'async'; img.loading = 'eager'; // Use eager for hero image
    img.style.opacity = '0'; img.style.transition = 'opacity .18s ease-out';
    const candidates = buildThumbCandidates(cardName, true, overrides);
    let idx = 0;
    const tryNext = () => {
      if(idx>=candidates.length) {return;}
      img.src = candidates[idx++];
    };
    img.onerror = () => tryNext();
    img.onload = () => { img.style.opacity = '1'; }; // Smooth fade-in
    tryNext();
    const wrap = document.createElement('div'); wrap.className = 'thumb'; wrap.appendChild(img);
    hero.appendChild(wrap);
    hero.removeAttribute('aria-hidden');
  }

  // Collect and display all card variants (set/number combinations)
  await renderCardSets(cardName);

  let tournaments = [];
  try{ tournaments = await fetchTournamentsList(); }
  catch{ /* fallback below */ }
  if(!Array.isArray(tournaments) || tournaments.length===0){
    tournaments = ['World Championships 2025'];
  }
  // Simple localStorage cache for All-archetypes stats: key by tournament+card
  const CACHE_KEY = 'metaCacheV1';
  const cache = (()=>{ try{ return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }catch{ return {}; } })();
  const saveCache = () => { try{ localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }catch{} };

  // Aggregate meta-share per tournament; eager load across all tournaments
  const timePoints = [];
  const deckRows = [];
  const eventsWithCard = [];
  for(const t of tournaments){
    try{
      const ck = `${t}::${cardIdentifier}`;
      let globalPct = null, globalFound = null, globalTotal = null;
      if(cache[ck]){
        ({ pct: globalPct, found: globalFound, total: globalTotal } = cache[ck]);
      }else{
        // For specific variants (like "Snorunt TWM 51"), skip cardIndex and go directly to master
        // cardIndex only has aggregated base names, not individual variants
        let card = null;
        const hasUID = cardIdentifier && cardIdentifier.includes('::'); // Matches "Name SET NUMBER" pattern

        if (!hasUID) {
          // Try cardIndex for base name lookups (trainers and base Pokemon names)
          try{
            const idx = await fetchCardIndex(t);
            const baseName = getBaseName(cardIdentifier);
            const entry = idx.cards?.[baseName] || idx.cards?.[Object.keys(idx.cards||{}).find(k => k.toLowerCase() === baseName.toLowerCase()) || ''];
            if(entry){
              card = { name: baseName, found: entry.found, total: entry.total, pct: entry.pct, dist: entry.dist };
            }
          }catch{}
        }

        if(!card){
          // Always check master.json for precise variant matching
          const master = await fetchReport(t);
          const parsed = parseReport(master);
          card = findCard(parsed.items, cardIdentifier);
        }
        if(card){
          globalPct = Number.isFinite(card.pct)? card.pct : (card.total? (100*card.found/card.total): 0);
          globalFound = Number.isFinite(card.found)? card.found : null;
          globalTotal = Number.isFinite(card.total)? card.total : null;
          cache[ck] = { pct: globalPct, found: globalFound, total: globalTotal };
          saveCache();
        }
      }
      if(globalPct != null){
        timePoints.push({ tournament: t, pct: globalPct });
        eventsWithCard.push(t);
        deckRows.push({ tournament: t, archetype: null, pct: globalPct, found: globalFound, total: globalTotal });
      }
    }catch{/* missing tournament master */}
  }

  // Fixed window: always show the most recent 6 tournaments
  const LIMIT = 6;
  const showAll = false;
  const renderToggles = () => {
    // Clear previous notes
    const oldNotes = metaSection.querySelectorAll('.summary.toggle-note');
    oldNotes.forEach(n => n.remove());
    const totalP = timePoints.length;
    const shown = Math.min(LIMIT, totalP);
    const note = document.createElement('div');
    note.className = 'summary toggle-note';
    note.textContent = `Chronological (oldest to newest). Showing most recent ${shown} of ${totalP}.`;
    metaSection.appendChild(note);
    // Events/decks toggle mirrors chart (attach to eventsSection if present)
    const tableSection = eventsSection || decksSection;
    if(tableSection){
      const oldNotes2 = tableSection.querySelectorAll('.summary.toggle-note');
      oldNotes2.forEach(n => n.remove());
      const totalR = deckRows.length;
      const shownR = Math.min(LIMIT, totalR);
      const note2 = document.createElement('div');
      note2.className = 'summary toggle-note';
      note2.textContent = `Chronological (oldest to newest). Showing most recent ${shownR} of ${totalR}.`;
      tableSection.appendChild(note2);
    }
  };

  // Cache for chosen archetype label per (tournament, card)
  const PICK_CACHE_KEY = 'archPickV2';
  const pickCache = (()=>{ try{ return JSON.parse(localStorage.getItem(PICK_CACHE_KEY) || '{}'); }catch{ return {}; } })();
  const savePickCache = () => { try{ localStorage.setItem(PICK_CACHE_KEY, JSON.stringify(pickCache)); }catch{} };

  async function chooseArchetypeForTournament(tournament){
    const ck = `${tournament}::${cardIdentifier}`;
    if(pickCache[ck]) {return pickCache[ck];}
	    try{
      const list = await fetchArchetypesList(tournament);
      const top8 = await fetchTop8ArchetypesList(tournament);
      const candidates = [];
      for(const base of list){
        try{
          const arc = await fetchArchetypeReport(tournament, base);
          const p = parseReport(arc);
          const ci = findCard(p.items, cardIdentifier);
          if(ci){
            const pct = Number.isFinite(ci.pct)? ci.pct : (ci.total? (100*ci.found/ci.total): 0);
            const found = Number.isFinite(ci.found) ? ci.found : null;
            const total = Number.isFinite(ci.total) ? ci.total : null;
            candidates.push({ base, pct, found, total });
          }
        }catch{/* missing archetype file */}
      }
      // Dynamic minimum based on card usage: if card has high overall usage but low per-archetype,
      // use a lower threshold to capture distributed usage patterns
      const overallUsage = cache[`${tournament}::${cardIdentifier}`]?.pct || 0;
      const minTotal = overallUsage > 20 ? 1 : 3; // Lower threshold for high-usage cards
      const chosen = pickArchetype(candidates, top8 || undefined, { minTotal });
      const label = chosen ? baseToLabel(chosen.base) : null;
      pickCache[ck] = label;
      savePickCache();
      return label;
    }catch{
      return null;
    }
  }

  const renderNonce = 0;
  const refresh = () => {
    const chartEl = document.getElementById('card-chart') || metaSection;
    // Show chronological from oldest to newest
    const ptsAll = [...timePoints].reverse();
    const rowsAll = [...deckRows].reverse();
    const pts = showAll ? ptsAll : ptsAll.slice(-LIMIT);
    const rows = showAll ? rowsAll : rowsAll.slice(-LIMIT);
    renderChart(chartEl, pts);
    // Copies histogram from the most recent event in the visible window if available
    if(copiesSection){
      const latest = rows[rows.length-1];
      if(latest){
        // Find overall stats for the same tournament
        (async () => {
          try{
            const master = await fetchReport(latest.tournament);
            const parsed = parseReport(master);
            const overall = findCard(parsed.items, cardIdentifier);
            if(overall){ renderCopiesHistogram(copiesSection, overall); }
            else { copiesSection.textContent = ''; }
          }catch{ copiesSection.textContent = ''; }
        })();
      } else {
        copiesSection.textContent = '';
      }
    }
    renderEvents(eventsSection || decksSection, rows);
    renderToggles();
    renderAnalysisSelector(eventsWithCard);

    // After initial paint, fill archetype labels for visible rows asynchronously
    // Attach lazy hover handlers for event rows to prefetch and compute archetype label on demand
    const tableContainer = eventsSection || decksSection;
    if(tableContainer && !tableContainer._hoverPrefetchAttached){
      tableContainer.addEventListener('mouseover', async (e) => {
        const rowEl = e.target && e.target.closest ? e.target.closest('.event-row') : null;
        if(!rowEl) {return;}
        const t = rowEl.dataset.tournament;
        if(!t) {return;}
        // Prefetch event master if not present
        await loadTournament(t);
        // Compute archetype label if missing
        const target = deckRows.find(x=>x.tournament === t);
        if(target && !target.archetype){
          const label = await chooseArchetypeForTournament(t);
          if(label){ target.archetype = label; renderEvents(tableContainer, showAll ? [...deckRows].reverse() : [...deckRows].reverse().slice(-LIMIT)); renderToggles(); }
        }
      });
      tableContainer._hoverPrefetchAttached = true;
    }
  };
  refresh();

  // Lazy-load older events as the user hovers suggestions or event rows
  // no hover prefetch on card page in eager mode

  // Re-render chart on resize (throttled)
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if(resizeTimer) {return;}
    resizeTimer = setTimeout(() => { resizeTimer = null; const el = document.getElementById('card-chart') || metaSection; renderChart(el, (showAll? [...timePoints].reverse() : [...timePoints].reverse().slice(-LIMIT))); }, 120);
  });

  // No min-decks selector in UI; default minTotal used in picker
}

function renderAnalysisSelector(events){
  if(!analysisSel) {return;}
  analysisSel.innerHTML = '';
  if(!events || events.length === 0){ analysisTable.textContent = 'Select an event to view per-archetype usage.'; return; }
  for(const t of events){
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t; analysisSel.appendChild(opt);
  }
  analysisSel.addEventListener('change', () => { renderAnalysisTable(analysisSel.value); });
  renderAnalysisTable(analysisSel.value || events[0]);
}

async function renderAnalysisTable(tournament){
  if(!analysisTable){ return; }
  analysisTable.textContent = 'Loading…';
  try{
    // Overall (All archetypes) distribution for this event
    let overall = null;
    try{
      const master = await fetchReport(tournament);
      const parsed = parseReport(master);
      const ci = findCard(parsed.items, cardIdentifier);
      if(ci){ overall = ci; }
    }catch{/* ignore */}

    // Per-archetype distributions
    const list = await fetchArchetypesList(tournament);
    const rows = [];
    for(const base of list){
      try{
        const arc = await fetchArchetypeReport(tournament, base);
        const p = parseReport(arc);
        const ci = findCard(p.items, cardIdentifier);
        if(ci){
          // For high-usage cards (>20%), include single-deck archetypes to show distribution
          const overallItem = overall || {};
          const overallPct = overallItem.total ? (100 * overallItem.found / overallItem.total) : (overallItem.pct || 0);
          const minSample = overallPct > 20 ? 1 : 2; // Lower threshold for high-usage cards
          if(!(ci.total >= minSample)) {continue;}
          const pct = Number.isFinite(ci.pct)? ci.pct : (ci.total? (100*ci.found/ci.total): 0);
          // Precompute percent of all decks in archetype by copies
          const copiesPct = (n) => {
            if(!Array.isArray(ci.dist) || !(ci.total>0)) {return null;}
            const d = ci.dist.find(x=>x.copies===n);
            if(!d) {return 0;}
            return 100 * (d.players ?? 0) / ci.total;
          };
          rows.push({
            archetype: base.replace(/_/g,' '),
            pct,
            found: ci.found,
            total: ci.total,
            c1: copiesPct(1),
            c2: copiesPct(2),
            c3: copiesPct(3),
            c4: copiesPct(4)
          });
        }
      }catch{/*missing*/}
    }
    rows.sort((a,b)=> {
      // Primary sort: actual deck count (found)
      const foundDiff = (b.found ?? 0) - (a.found ?? 0);
      if (foundDiff !== 0) return foundDiff;
      
      // Secondary sort: deck popularity (total) when found counts are equal
      const totalDiff = (b.total ?? 0) - (a.total ?? 0);
      if (totalDiff !== 0) return totalDiff;
      
      // Tertiary sort: alphabetical by archetype name
      return a.archetype.localeCompare(b.archetype);
    });

    analysisTable.innerHTML = '';

    // Overall summary block
    if(overall){
      const box = document.createElement('div');
      box.className = 'card-sect';
      box.style.margin = '0 0 8px 0';
      const title = document.createElement('div');
      title.className = 'summary';
      const overallPct = (overall.total? (100*overall.found/overall.total): (overall.pct||0));
      title.textContent = `Overall (All archetypes): Played ${overallPct.toFixed(1)}% of decks`;
      title.title = 'Percentage of all decks in this event that included the card (any copies).';
      box.appendChild(title);
      // 1x-4x list
      const listEl = document.createElement('div');
      listEl.className = 'summary';
      const part = (n) => {
        if(!overall || !overall.total || !Array.isArray(overall.dist)) {return `${n}x: —`;}
        const d = overall.dist.find(x=>x.copies===n);
        const pct = d? (100 * (d.players||0) / overall.total) : 0;
        return `${n}x: ${pct.toFixed(1)}%`;
      };
      listEl.textContent = `Copies across all decks — ${[1,2,3,4].map(part).join('  •  ')}`;
      listEl.title = 'For each N, the percent of all decks in this event that ran exactly N copies.';
      box.appendChild(listEl);
      analysisTable.appendChild(box);
    }

    // Per-archetype table
    if(rows.length === 0){
      const note = document.createElement('div');
      note.className = 'summary';
      note.textContent = 'No per-archetype usage found for this event (or all archetypes have only one deck).';
      analysisTable.appendChild(note);
      return;
    }
    const tbl = document.createElement('table');
    tbl.style.width = '100%'; tbl.style.borderCollapse='collapse'; tbl.style.background='var(--panel)'; tbl.style.border='1px solid #242a4a'; tbl.style.borderRadius='8px';
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    ['Archetype','Played %','1x','2x','3x','4x'].forEach((h,i)=>{ const th = document.createElement('th'); th.textContent=h; if(h==='Played %'){ th.title='Percent of decks in the archetype that ran the card (any copies).'; } if(['1x','2x','3x','4x'].includes(h)){ th.title = `Percent of decks in the archetype that ran exactly ${h}`; } th.style.textAlign = (i>0 && i<6) ? 'right' : 'left'; th.style.padding='10px 12px'; th.style.borderBottom='1px solid #2c335a'; th.style.color='var(--muted)'; trh.appendChild(th); });
    thead.appendChild(trh); tbl.appendChild(thead);
    const tbody = document.createElement('tbody');
    for(const r of rows){
      const tr = document.createElement('tr');
      const fmt = (v) => v==null? '—' : `${v.toFixed(1)}%`;
      // Compose archetype cell: bold archetype name + deck count in parentheses
      const archeCount = (r.total!=null) ? r.total : (r.found!=null ? r.found : null);
      const td0 = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = r.archetype;
      td0.appendChild(strong);
      if(archeCount!=null){ td0.appendChild(document.createTextNode(` (${archeCount})`)); }
      td0.style.padding = '10px 12px';
      td0.style.textAlign = 'left';
      tr.appendChild(td0);

      const otherValues = [ r.pct!=null? r.pct.toFixed(1)+'%':'—', fmt(r.c1), fmt(r.c2), fmt(r.c3), fmt(r.c4) ];
      otherValues.forEach((v,i)=>{
        const td = document.createElement('td');
        td.textContent = v;
        if(i===0){ td.title = 'Played % = (decks with the card / total decks in archetype)'; }
        if(i>=1 && i<=4){ const n = i; td.title = `Percent of decks in archetype that ran exactly ${n}x`; }
        td.style.padding = '10px 12px';
        td.style.textAlign = 'right';
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    analysisTable.appendChild(tbl);
  }catch(err){
    analysisTable.textContent = 'Failed to load analysis for this event.';
  }
}

if(!__ROUTE_REDIRECTING) {load();}
