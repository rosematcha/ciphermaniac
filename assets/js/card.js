// Entry for per-card page: loads meta-share over tournaments and common decks
import { fetchTournamentsList, fetchReport, fetchArchetypesList, fetchArchetypeReport, fetchOverrides, fetchTop8ArchetypesList } from './api.js';
import { parseReport } from './parse.js';
import { buildThumbCandidates } from './thumbs.js';
import { pickArchetype, baseToLabel } from './selectArchetype.js';
import { normalizeCardRouteOnLoad } from './router.js';

function getCardNameFromLocation(){
	const params = new URLSearchParams(location.search);
	const q = params.get('name');
	if(q) return q;
	// Hash route: #card/<encoded name>
	const m = location.hash.match(/^#card\/(.+)$/);
	if(m) return decodeURIComponent(m[1]);
	return null;
}

// Normalize #grid route to index when landing on card page via hash
const __ROUTE_REDIRECTING = normalizeCardRouteOnLoad();
const cardName = getCardNameFromLocation();
document.getElementById('card-title').textContent = cardName ? cardName : 'Card Details';

const metaSection = document.getElementById('card-meta');
const decksSection = document.getElementById('card-decks');
const eventsSection = document.getElementById('card-events');
const copiesSection = document.getElementById('card-copies');
const backLink = document.getElementById('back-link');
if(backLink){ backLink.href = 'index.html'; }
const analysisSel = document.getElementById('analysis-event');
const analysisTable = document.getElementById('analysis-table');
const copyBtn = document.getElementById('copy-link');
const searchInGrid = document.getElementById('search-in-grid');
const windowSelect = document.getElementById('window-select');
const copyStatus = document.getElementById('copy-status');
const cardSearchInput = document.getElementById('card-search');
const cardNamesList = document.getElementById('card-names');
const suggestionsBox = document.getElementById('card-suggestions');
if(copyBtn){
	copyBtn.addEventListener('click', async () => {
		const params = new URLSearchParams(location.search);
		const win = params.get('win');
		const qstr = win ? `?win=${encodeURIComponent(win)}` : '';
		const clean = `${location.origin}${location.pathname.replace(/card\.html$/,'card.html')}${qstr}#card/${encodeURIComponent(cardName || '')}`;
		try{
			await navigator.clipboard.writeText(clean);
			if(copyStatus){ copyStatus.textContent = 'Link copied!'; setTimeout(()=>copyStatus.textContent='', 2000); }
		}catch{
			// Fallback
			const ta = document.createElement('textarea');
			ta.value = clean; document.body.appendChild(ta); ta.select();
			try{ document.execCommand('copy'); if(copyStatus){ copyStatus.textContent = 'Link copied!'; setTimeout(()=>copyStatus.textContent='', 2000); } }
			finally{ ta.remove(); }
		}
	});
}

// Link to grid prefilled with search
if(searchInGrid){
	const href = `index.html?q=${encodeURIComponent(cardName || '')}`;
	searchInGrid.href = href;
}

// No tabs: all content on one page

// Initialize search suggestions regardless of whether a card is selected
async function initCardSearch(){
	try{
		if(!(cardSearchInput && cardNamesList)) return;
		let tournaments = [];
		try{ tournaments = await fetchTournamentsList(); }catch{}
		if(!Array.isArray(tournaments) || tournaments.length===0){
			tournaments = ['World Championships 2025'];
		}
		// Union cache across tournaments for robust suggestions
		const SKEY = 'cardNamesUnionV1';
		const cached = (()=>{ try{ return JSON.parse(localStorage.getItem(SKEY) || '{"names":[]}'); }catch{ return { names: [] }; } })();
		const MAX = 600;
		const byLower = new Map(); // lower -> canonical name
		const pushName = (n) => {
			if(!n) return false;
			const k = n.toLowerCase();
			if(byLower.has(k)) return false;
			byLower.set(k, n);
			return true;
		};
		// Seed from cache for instant suggestions
		if(Array.isArray(cached.names)){
			for(const n of cached.names){ pushName(n); }
		}
		const updateDatalist = () => {
			const all = Array.from(byLower.values()).sort((a,b)=> a.localeCompare(b));
			cardNamesList.innerHTML = '';
			for(const n of all.slice(0, MAX)){
				const opt = document.createElement('option');
				opt.value = n; cardNamesList.appendChild(opt);
			}
			// update cache
			try{ localStorage.setItem(SKEY, JSON.stringify({ names: all.slice(0, MAX) })); }catch{}
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
						if(pushName(it?.name)) added = true;
					}
					if(added) updateDatalist();
				}catch{/* skip missing */}
			}
		})();
		if(cardName) cardSearchInput.value = cardName;
				const getAllNames = () => Array.from(cardNamesList?.options || []).map(o=>String(o.value||''));
				const computeMatches = (query) => {
					const q = query.trim().toLowerCase();
					if(!q) return getAllNames().slice(0, 8);
					const all = getAllNames();
					const starts = [], contains = [];
					for(const n of all){
						const ln = n.toLowerCase();
						if(ln.startsWith(q)) starts.push(n);
						else if(ln.includes(q)) contains.push(n);
						if(starts.length + contains.length >= 8) break;
					}
					return [...starts, ...contains].slice(0,8);
				};
				const renderSuggestions = () => {
					if(!(suggestionsBox && cardSearchInput)) return;
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
						if(i===selectedIndex) item.setAttribute('aria-selected','true');
						const left = document.createElement('span');
						left.textContent = matches[i];
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
					if(!suggestionsBox) return;
					if(!suggestionsBox.contains(e.target) && e.target !== cardSearchInput){ suggestionsBox.classList.remove('is-open'); }
				});
		const goTo = (name) => {
			if(!name) return;
			const clean = `${location.origin}${location.pathname.replace(/card\.html$/, 'card.html')}#card/${encodeURIComponent(name)}`;
			location.assign(clean);
			setTimeout(() => { try{ location.reload(); }catch{} }, 0);
		};
			// Keyboard handling: Arrow navigation, Enter to select, Tab to complete, Escape to close
			let currentMatches = [];
			let selectedIndex = -1;
			const updateSelection = (idx) => {
				if(!suggestionsBox) return;
				const items = Array.from(suggestionsBox.children);
				items.forEach((it,i)=>{
					if(i===idx) it.setAttribute('aria-selected','true'); else it.removeAttribute('aria-selected');
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
					if(pick) goTo(pick);
					return;
				}
				if(e.key === 'Tab'){
					if(!currentMatches || currentMatches.length === 0) return;
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
					if(!currentMatches || currentMatches.length === 0) return;
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
					if(suggestionsBox) suggestionsBox.classList.remove('is-open');
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
initCardSearch();

function findCard(items){
	const lower = cardName.toLowerCase();
	return items.find(x => x.name.toLowerCase() === lower);
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
	// dots
	points.forEach((p,i)=>{
		const c = document.createElementNS(svgNS, 'circle');
		c.setAttribute('cx', String(scaleX(i)));
		c.setAttribute('cy', String(scaleY(p.pct || 0)));
		c.setAttribute('r', '3');
		c.setAttribute('fill', '#6aa3ff');
		const tip = `${p.tournament}: ${(p.pct||0).toFixed(1)}%`;
		c.setAttribute('title', tip);
		c.setAttribute('tabindex', '0');
		c.setAttribute('role', 'img');
		c.setAttribute('aria-label', tip);
		svg.appendChild(c);
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
		col.title = `${c}x: ${pct.toFixed(1)}%${(d&&total)?` (${d.players}/${total})`:''}`;
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
		;['Tournament','Most Success In','Usage % (All)','Decks (All)'].forEach(h=>{
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
			tLink.textContent = r.tournament;
			const cells = [tLink, r.archetype || '—', r.pct!=null? r.pct.toFixed(1)+'%':'—', r.found!=null && r.total!=null? `${r.found}/${r.total}`:'—'];
			cells.forEach((v,i)=>{ const td = document.createElement('td'); if(v instanceof HTMLElement){ td.appendChild(v); } else { td.textContent = v; } td.style.padding='10px 12px'; if(i===2) td.style.textAlign='right'; tr.appendChild(td); });
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
	;['Tournament','Most Success In','Usage % (All)'].forEach((h,i)=>{ const th = document.createElement('th'); th.textContent=h; th.style.textAlign= i===2 ? 'right' : 'left'; th.style.padding='10px 12px'; th.style.borderBottom='1px solid #2c335a'; th.style.color='var(--muted)'; hdr.appendChild(th); });
	thead.appendChild(hdr); tbl.appendChild(thead);
	const tbody = document.createElement('tbody');
	rows.forEach(r => {
		const tr = document.createElement('tr');
		const tLink = document.createElement('a'); tLink.href = `index.html?tour=${encodeURIComponent(r.tournament)}`; tLink.textContent = r.tournament;
		const cells = [tLink, r.archetype || '—', r.pct!=null? r.pct.toFixed(1)+'%':'—'];
		cells.forEach((v,i)=>{ const td = document.createElement('td'); if(v instanceof HTMLElement){ td.appendChild(v); } else { td.textContent = v; } td.style.padding='10px 12px'; if(i===2) td.style.textAlign='right'; tr.appendChild(td); });
		tbody.appendChild(tr);
	});
	tbl.appendChild(tbody);
	container.appendChild(tbl);
}

async function load(){
	if(!cardName){ metaSection.textContent = 'Missing card name.'; return; }
		// Loading state
	const chartEl = document.getElementById('card-chart') || metaSection;
	chartEl.textContent = 'Loading…';
	if(eventsSection) eventsSection.textContent = '';
	if(copiesSection) copiesSection.textContent = '';
	// Load overrides for thumbnails and render hero
	const overrides = await fetchOverrides();
	const hero = document.getElementById('card-hero');
	if(hero && cardName){
		const img = document.createElement('img');
		img.alt = cardName; img.decoding = 'async'; img.loading = 'lazy';
		const candidates = buildThumbCandidates(cardName, true, overrides);
		let idx = 0; const tryNext = () => { if(idx>=candidates.length) return; img.src = candidates[idx++]; };
		img.onerror = () => tryNext();
		tryNext();
		const wrap = document.createElement('div'); wrap.className = 'thumb'; wrap.appendChild(img);
		hero.appendChild(wrap);
		hero.removeAttribute('aria-hidden');
	}
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
						const ck = `${t}::${cardName}`;
						let globalPct = null, globalFound = null, globalTotal = null;
						if(cache[ck]){
							({ pct: globalPct, found: globalFound, total: globalTotal } = cache[ck]);
						}else{
							const master = await fetchReport(t);
							const parsed = parseReport(master);
							const card = findCard(parsed.items);
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

		// Default window comes from selector (6)
		let LIMIT = 6;
		let showAll = false;
		if(windowSelect){
			const params = new URLSearchParams(location.search);
			const initWin = params.get('win');
			if(initWin){ windowSelect.value = initWin; }
			const parseWin = () => {
				const v = windowSelect.value;
				if(v === 'all'){ showAll = true; }
				else { LIMIT = Math.max(1, parseInt(v,10) || 6); showAll = false; }
				// sync URL
				const u = new URL(location.href);
				u.searchParams.delete('win');
				if(v && v !== '6'){ // default is 6; omit if default
					u.searchParams.set('win', v);
				}
				history.replaceState(null, '', u.toString());
			};
			parseWin();
			windowSelect.addEventListener('change', () => { parseWin(); refresh(); });
			window.addEventListener('popstate', () => {
				const p = new URLSearchParams(location.search);
				const w = p.get('win') || '6';
				if(windowSelect.value !== w){ windowSelect.value = w; parseWin(); refresh(); }
			});
		}
		const renderToggles = () => {
		// Clear previous notes
		const oldNotes = metaSection.querySelectorAll('.summary.toggle-note');
		oldNotes.forEach(n => n.remove());
			const totalP = timePoints.length;
		const needToggleP = totalP > LIMIT;
		if(needToggleP){
			const note = document.createElement('div');
			note.className = 'summary toggle-note';
			const shown = showAll ? totalP : Math.min(LIMIT, totalP);
			note.textContent = `Chronological (oldest to newest). Showing ${shown} of ${totalP}.`;
			const a = document.createElement('a');
			a.href = '#'; a.style.marginLeft = '8px'; a.textContent = showAll ? 'Show fewer' : 'Show all';
			a.addEventListener('click', (e)=>{ e.preventDefault(); showAll = !showAll; refresh(); });
			note.appendChild(a);
			metaSection.appendChild(note);
		}else{
			const note = document.createElement('div');
			note.className = 'summary toggle-note';
			note.textContent = 'Chronological (oldest to newest).';
			metaSection.appendChild(note);
		}
		// Events/decks toggle mirrors chart (attach to eventsSection if present)
			const tableSection = eventsSection || decksSection;
		if(tableSection){
			const oldNotes2 = tableSection.querySelectorAll('.summary.toggle-note');
			oldNotes2.forEach(n => n.remove());
				const totalR = deckRows.length;
			const needToggleR = totalR > LIMIT;
			if(needToggleR){
				const note2 = document.createElement('div');
				note2.className = 'summary toggle-note';
				const shownR = showAll ? totalR : Math.min(LIMIT, totalR);
				note2.textContent = `Chronological (oldest to newest). Showing ${shownR} of ${totalR}.`;
				const a2 = document.createElement('a');
				a2.href = '#'; a2.style.marginLeft = '8px'; a2.textContent = showAll ? 'Show fewer' : 'Show all';
				a2.addEventListener('click', (e)=>{ e.preventDefault(); showAll = !showAll; refresh(); });
				note2.appendChild(a2);
				tableSection.appendChild(note2);
			}else{
				const note2 = document.createElement('div');
				note2.className = 'summary toggle-note';
				note2.textContent = 'Chronological (oldest to newest).';
				tableSection.appendChild(note2);
			}
		}
	};

	// Cache for chosen archetype label per (tournament, card)
	const PICK_CACHE_KEY = 'archPickV2';
	const pickCache = (()=>{ try{ return JSON.parse(localStorage.getItem(PICK_CACHE_KEY) || '{}'); }catch{ return {}; } })();
	const savePickCache = () => { try{ localStorage.setItem(PICK_CACHE_KEY, JSON.stringify(pickCache)); }catch{} };

	async function chooseArchetypeForTournament(tournament){
		const ck = `${tournament}::${cardName}`;
		if(pickCache[ck]) return pickCache[ck];
	    try{
		const list = await fetchArchetypesList(tournament);
			const top8 = await fetchTop8ArchetypesList(tournament);
			const candidates = [];
			for(const base of list){
				try{
					const arc = await fetchArchetypeReport(tournament, base);
					const p = parseReport(arc);
					const ci = findCard(p.items);
					if(ci){
			const pct = Number.isFinite(ci.pct)? ci.pct : (ci.total? (100*ci.found/ci.total): 0);
			const found = Number.isFinite(ci.found) ? ci.found : null;
			const total = Number.isFinite(ci.total) ? ci.total : null;
						candidates.push({ base, pct, found, total });
					}
				}catch{/* missing archetype file */}
			}
			const minTotal = 3; // sensible default
			const chosen = pickArchetype(candidates, top8 || undefined, { minTotal });
			const label = chosen ? baseToLabel(chosen.base) : null;
			pickCache[ck] = label;
			savePickCache();
			return label;
		}catch{
			return null;
		}
	}

			let renderNonce = 0;
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
							const overall = parsed.items.find(x=> x.name.toLowerCase() === (cardName||'').toLowerCase());
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
							if(!rowEl) return;
							const t = rowEl.dataset.tournament;
							if(!t) return;
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
		if(resizeTimer) return;
		resizeTimer = setTimeout(() => { resizeTimer = null; const el = document.getElementById('card-chart') || metaSection; renderChart(el, (showAll? [...timePoints].reverse() : [...timePoints].reverse().slice(-LIMIT))); }, 120);
	});

	// No min-decks selector in UI; default minTotal used in picker
}

		function renderAnalysisSelector(events){
			if(!analysisSel) return;
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
					const ci = parsed.items.find(x=> x.name.toLowerCase() === (cardName||'').toLowerCase());
					if(ci){ overall = ci; }
				}catch{/* ignore */}

				// Per-archetype distributions
				const list = await fetchArchetypesList(tournament);
				const rows = [];
				for(const base of list){
					try{
						const arc = await fetchArchetypeReport(tournament, base);
						const p = parseReport(arc);
						const ci = p.items.find(x=> x.name.toLowerCase() === (cardName||'').toLowerCase());
						if(ci){
							// Skip archetypes with only one sample in the event
							if(!(ci.total > 1)) continue;
							const pct = Number.isFinite(ci.pct)? ci.pct : (ci.total? (100*ci.found/ci.total): 0);
							// Precompute percent of all decks in archetype by copies
							const copiesPct = (n) => {
								if(!Array.isArray(ci.dist) || !(ci.total>0)) return null;
								const d = ci.dist.find(x=>x.copies===n);
								if(!d) return 0;
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
				rows.sort((a,b)=> (b.pct ?? -1) - (a.pct ?? -1) || a.archetype.localeCompare(b.archetype));

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
						if(!overall || !overall.total || !Array.isArray(overall.dist)) return `${n}x: —`;
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
				;['Archetype','Played %','1x','2x','3x','4x','Decks'].forEach((h,i)=>{ const th = document.createElement('th'); th.textContent=h; if(h==='Played %'){ th.title='Percent of decks in the archetype that ran the card (any copies).'; } if(['1x','2x','3x','4x'].includes(h)){ th.title = `Percent of decks in the archetype that ran exactly ${h}`; } th.style.textAlign = (i>0 && i<6) ? 'right' : 'left'; th.style.padding='10px 12px'; th.style.borderBottom='1px solid #2c335a'; th.style.color='var(--muted)'; trh.appendChild(th); });
				thead.appendChild(trh); tbl.appendChild(thead);
				const tbody = document.createElement('tbody');
				for(const r of rows){
					const tr = document.createElement('tr');
					const fmt = (v) => v==null? '—' : `${v.toFixed(1)}%`;
					const cells = [
						r.archetype,
						r.pct!=null? r.pct.toFixed(1)+'%':'—',
						fmt(r.c1), fmt(r.c2), fmt(r.c3), fmt(r.c4),
						(r.found!=null && r.total!=null? `${r.found}/${r.total}`:'—')
					];
					cells.forEach((v,i)=>{ const td = document.createElement('td'); td.textContent = v; if(i===1){ td.title = 'Played % = (decks with the card / total decks in archetype)'; } if(i>=2 && i<=5){ const n = i-1; td.title = `Percent of decks in archetype that ran exactly ${n}x`; } td.style.padding='10px 12px'; if(i>=1 && i<=5) td.style.textAlign='right'; tr.appendChild(td); });
					tbody.appendChild(tr);
				}
				tbl.appendChild(tbody);
				analysisTable.appendChild(tbl);
			}catch(err){
				analysisTable.textContent = 'Failed to load analysis for this event.';
			}
		}

if(!__ROUTE_REDIRECTING) load();
