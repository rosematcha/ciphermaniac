/**
 * In Loving Memory — rotated archetype explorer.
 *
 * Loads aggregated Day-2 decklist data for rotated archetypes and renders
 * a media-first card grid with per-card detail panels including histogram,
 * usage timeline, and individual list tracking.
 */

import { renderCopiesHistogram } from './card/charts.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RotationEntry {
  date: string;
  label: string;
}

interface ArchetypeEntry {
  name: string;
  slug: string;
  archetypeId: number;
  listCount: number;
  thumbnail: string | null;
  rotations?: RotationEntry[];
}

interface IndexData {
  archetypes: ArchetypeEntry[];
}

interface DistEntry {
  copies: number;
  players: number;
  percent: number;
}

interface CardItem {
  rank: number;
  name: string;
  uid?: string;
  set?: string;
  number?: string;
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  found: number;
  total: number;
  pct: number;
  dist?: DistEntry[];
}

interface MasterData {
  deckTotal: number;
  archetype: string;
  archetypeId: number;
  items: CardItem[];
}

interface DeckCard {
  name: string;
  set: string;
  number: string;
  count: number;
  category?: string;
}

interface ListEntry {
  id: number;
  player: string;
  playerUrl: string;
  placement: number;
  format: string;
  tournament: string;
  tournamentPlayers: number;
  cards: DeckCard[];
}

interface ListsData {
  archetype: string;
  archetypeId: number;
  lists: ListEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_BASE = '/toys/in-loving-memory/data';
const LIMITLESS_CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci';
const LIMITLESS_BASE = 'https://limitlesstcg.com';

const CATEGORIES: Record<string, string> = {
  all: 'All',
  pokemon: 'Pokemon',
  trainer: 'Trainer',
  energy: 'Energy'
};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const $selector = document.getElementById('archetype-selector')!;
const $meta = document.getElementById('memorial-meta')!;
const $tabs = document.getElementById('category-tabs')!;
const $grid = document.getElementById('memorial-grid')!;
const $backdrop = document.getElementById('detail-backdrop')!;
const $panel = document.getElementById('detail-panel')!;
const $closeBtn = document.getElementById('detail-close')!;
const $detailContent = document.getElementById('detail-content')!;
const $sortSelect = document.getElementById('sort-select') as HTMLSelectElement;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentItems: CardItem[] = [];
let currentLists: ListEntry[] | null = null;
let currentRotations: RotationEntry[] = [];
let activeCategory = 'all';
let activeSort = 'usage-desc';
let _activeSlug = '';

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

function buildCardImageUrl(setCode: string, number: string, size: 'SM' | 'LG' = 'SM'): string {
  const s = setCode.toUpperCase();
  const n = String(number).padStart(3, '0');
  return `${LIMITLESS_CDN}/${s}/${s}_${n}_R_EN_${size}.png`;
}

function buildCardPath(setCode: string, number: string): string {
  const s = setCode.toUpperCase();
  const n = String(number).padStart(3, '0');
  return `/card/${s}~${n}`;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// Tournament date parsing
// ---------------------------------------------------------------------------

const MONTH_MAP: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11
};

function parseTournamentDate(name: string): Date | null {
  // Format: "4th April 2026 - Regional Querétaro"
  const match = name.match(/^(\d{1,2})(?:st|nd|rd|th)\s+(\w+)\s+(\d{4})/);
  if (!match) {
    return null;
  }
  const day = parseInt(match[1], 10);
  const month = MONTH_MAP[match[2].toLowerCase()];
  const year = parseInt(match[3], 10);
  if (month === undefined || isNaN(day) || isNaN(year)) {
    return null;
  }
  return new Date(year, month, day);
}

function formatTournamentShort(name: string): string {
  // Strip the date prefix, return just the event name
  const dash = name.indexOf(' - ');
  return dash >= 0 ? name.slice(dash + 3) : name;
}

// ---------------------------------------------------------------------------
// Render: archetype selector
// ---------------------------------------------------------------------------

function renderSelector(archetypes: ArchetypeEntry[], currentSlug: string, onSelect: (slug: string) => void): void {
  $selector.innerHTML = '';
  for (const arch of archetypes) {
    const btn = document.createElement('button');
    btn.className = `archetype-btn${arch.slug === currentSlug ? ' active' : ''}`;
    btn.type = 'button';

    if (arch.thumbnail) {
      const [tSet, tNum] = arch.thumbnail.split('/');
      const img = document.createElement('img');
      img.src = buildCardImageUrl(tSet, tNum, 'SM');
      img.alt = arch.name;
      img.loading = 'lazy';
      btn.appendChild(img);
    }

    const label = document.createElement('span');
    label.textContent = arch.name;
    btn.appendChild(label);

    btn.addEventListener('click', () => onSelect(arch.slug));
    $selector.appendChild(btn);
  }
}

// ---------------------------------------------------------------------------
// Render: meta info
// ---------------------------------------------------------------------------

function renderMeta(data: MasterData): void {
  $meta.innerHTML = '';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = `${data.deckTotal.toLocaleString()} Day 2 lists`;
  $meta.appendChild(badge);

  const cards = document.createElement('span');
  cards.textContent = `${data.items.length} unique cards`;
  $meta.appendChild(cards);
}

// ---------------------------------------------------------------------------
// Render: category tabs
// ---------------------------------------------------------------------------

function renderTabs(items: CardItem[], onFilter: (cat: string) => void): void {
  $tabs.innerHTML = '';
  for (const [key, label] of Object.entries(CATEGORIES)) {
    const btn = document.createElement('button');
    btn.className = `category-tab${key === activeCategory ? ' active' : ''}`;
    btn.type = 'button';

    const count = key === 'all' ? items.length : items.filter(i => (i.category || '').startsWith(key)).length;

    btn.textContent = `${label} (${count})`;
    // eslint-disable-next-line no-loop-func
    btn.addEventListener('click', () => {
      activeCategory = key;
      onFilter(key);
      renderTabs(items, onFilter);
    });
    $tabs.appendChild(btn);
  }
}

// ---------------------------------------------------------------------------
// Render: card grid
// ---------------------------------------------------------------------------

function sortItems(items: CardItem[], sort: string): CardItem[] {
  const sorted = [...items];
  switch (sort) {
    case 'usage-asc':
      sorted.sort((a, b) => a.pct - b.pct);
      break;
    case 'name-asc':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'name-desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    default: // usage-desc (default from server)
      sorted.sort((a, b) => b.pct - a.pct);
      break;
  }
  return sorted;
}

function filterItems(items: CardItem[], category: string): CardItem[] {
  const filtered = category === 'all' ? items : items.filter(i => (i.category || '').startsWith(category));
  return sortItems(filtered, activeSort);
}

function renderGrid(items: CardItem[]): void {
  $grid.innerHTML = '';
  const filtered = filterItems(items, activeCategory);

  for (const item of filtered) {
    const card = document.createElement('div');
    card.className = 'mem-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${item.name} — ${item.pct}%`);

    // Image wrapper with mini histogram overlay
    const imgWrap = document.createElement('div');
    imgWrap.className = 'mem-card-img-wrap';

    const img = document.createElement('img');
    img.className = 'mem-card-img';
    img.alt = item.name;
    img.loading = 'lazy';
    if (item.set && item.number) {
      img.src = buildCardImageUrl(item.set, String(item.number));
    }
    img.onerror = () => {
      img.style.display = 'none';
    };
    imgWrap.appendChild(img);

    card.appendChild(imgWrap);

    // Usage bar
    const usageBar = document.createElement('div');
    usageBar.className = 'mem-card-bar';
    const barFill = document.createElement('div');
    barFill.className = 'mem-card-bar-fill';
    barFill.style.width = `${item.pct}%`;
    usageBar.appendChild(barFill);
    card.appendChild(usageBar);

    // Label
    const label = document.createElement('div');
    label.className = 'mem-card-label';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'mem-card-name';
    nameSpan.textContent = item.name;
    const pctSpan = document.createElement('span');
    pctSpan.className = 'mem-card-pct';
    pctSpan.textContent = `${Math.round(item.pct)}%`;
    label.appendChild(nameSpan);
    label.appendChild(pctSpan);
    card.appendChild(label);

    const openDetail = () => openDetailPanel(item);
    card.addEventListener('click', openDetail);
    card.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDetail();
      }
    });

    $grid.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Timeline chart renderer (SVG)
// ---------------------------------------------------------------------------

interface TimelinePoint {
  tournament: string;
  date: Date;
  pct: number;
  found: number;
  total: number;
  bestPlayer: string;
  bestPlacement: number;
  bestListId: number;
}

function buildTimeline(item: CardItem, lists: ListEntry[]): TimelinePoint[] {
  interface TournamentGroup {
    total: number;
    found: number;
    date: Date | null;
    bestPlayer: string;
    bestPlacement: number;
    bestListId: number;
  }

  const tournamentGroups = new Map<string, TournamentGroup>();

  for (const list of lists) {
    const key = list.tournament;
    let group = tournamentGroups.get(key);
    if (!group) {
      group = {
        total: 0,
        found: 0,
        date: parseTournamentDate(key),
        bestPlayer: '',
        bestPlacement: Infinity,
        bestListId: 0
      };
      tournamentGroups.set(key, group);
    }
    group.total++;

    const hasCard = list.cards.some(c => cardMatchesItem(c, item));
    if (hasCard) {
      group.found++;
      const place = list.placement || Infinity;
      if (place < group.bestPlacement) {
        group.bestPlacement = place;
        group.bestPlayer = list.player;
        group.bestListId = list.id;
      }
    }
  }

  const points: TimelinePoint[] = [];
  for (const [tournament, group] of tournamentGroups) {
    if (!group.date || group.total < 2) {
      continue;
    }
    points.push({
      tournament,
      date: group.date,
      pct: group.total > 0 ? Math.round((group.found / group.total) * 1000) / 10 : 0,
      found: group.found,
      total: group.total,
      bestPlayer: group.bestPlayer,
      bestPlacement: group.bestPlacement === Infinity ? 0 : group.bestPlacement,
      bestListId: group.bestListId
    });
  }

  points.sort((a, b) => a.date.getTime() - b.date.getTime());
  return points;
}

// ---------------------------------------------------------------------------
// Interesting-point detection
// ---------------------------------------------------------------------------

function findInterestingPoints(points: TimelinePoint[]): Set<number> {
  const interesting = new Set<number>();
  if (!points.length) {
    return interesting;
  }

  let prevPct = 0;
  let maxSoFar = 0;
  let firstNonZeroSeen = false;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (pt.found === 0) {
      prevPct = 0;
      continue;
    }

    // First appearance (or reappearance after a gap of zeros)
    if (!firstNonZeroSeen || prevPct === 0) {
      interesting.add(i);
      firstNonZeroSeen = true;
    }

    // New all-time high
    if (pt.pct > maxSoFar && pt.pct > 0) {
      interesting.add(i);
      maxSoFar = pt.pct;
    }

    // Significant jump from previous (more than doubled, or +10pp)
    if (prevPct > 0 && pt.pct > prevPct * 2) {
      interesting.add(i);
    }
    if (pt.pct - prevPct >= 10) {
      interesting.add(i);
    }

    prevPct = pt.pct;
  }

  return interesting;
}

// ---------------------------------------------------------------------------
// Shared tooltip (interactive — users can click links)
// ---------------------------------------------------------------------------

let $timelineTip: HTMLDivElement | null = null;
let tipHideTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Show the timeline tooltip anchored to a fixed position (the dot).
 * Does NOT follow the cursor — stays put so the user can move onto it to click links.
 */
function showTimelineTip(html: string, anchorX: number, anchorY: number): void {
  if (tipHideTimer) {
    clearTimeout(tipHideTimer);
    tipHideTimer = null;
  }

  if (!$timelineTip) {
    $timelineTip = document.createElement('div');
    $timelineTip.style.cssText =
      'position:fixed;z-index:200;pointer-events:auto;padding:10px 14px;background:#1e2030;' +
      'border:1px solid #39425f;border-radius:8px;font-size:12px;line-height:1.5;color:#e0e2ea;' +
      'max-width:280px;box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:opacity 0.15s;cursor:default;';
    $timelineTip.addEventListener('mouseenter', () => {
      if (tipHideTimer) {
        clearTimeout(tipHideTimer);
        tipHideTimer = null;
      }
    });
    $timelineTip.addEventListener('mouseleave', () => {
      scheduleHideTip();
    });
    document.body.appendChild($timelineTip);
  }
  $timelineTip.innerHTML = html;
  $timelineTip.style.opacity = '1';
  $timelineTip.style.display = 'block';

  // Position anchored above the dot, not following the cursor
  const tipW = $timelineTip.offsetWidth;
  const tipH = $timelineTip.offsetHeight;
  let left = anchorX - tipW / 2;
  let top = anchorY - tipH - 14;
  if (left < 4) {
    left = 4;
  }
  if (left + tipW > window.innerWidth - 4) {
    left = window.innerWidth - tipW - 4;
  }
  if (top < 4) {
    top = anchorY + 18;
  }
  $timelineTip.style.left = `${left}px`;
  $timelineTip.style.top = `${top}px`;
}

function scheduleHideTip(): void {
  if (tipHideTimer) {
    clearTimeout(tipHideTimer);
  }
  tipHideTimer = setTimeout(() => {
    if ($timelineTip) {
      $timelineTip.style.opacity = '0';
      $timelineTip.style.display = 'none';
    }
    if (activeHoverDot) {
      activeHoverDot.setAttribute('r', '3.5');
      activeHoverDot.setAttribute('fill', '#6aa3ff');
      activeHoverDot = null;
    }
    tipHideTimer = null;
  }, 400);
}

let activeHoverDot: SVGCircleElement | null = null;

function renderTimeline(container: HTMLElement, points: TimelinePoint[], rotations: RotationEntry[]): void {
  if (points.length < 2) {
    const msg = document.createElement('span');
    msg.style.color = 'var(--muted)';
    msg.style.fontSize = '13px';
    msg.textContent = 'Not enough tournament data for timeline.';
    container.appendChild(msg);
    return;
  }

  const width = 420;
  const height = 140;
  const pad = 28;
  const ns = 'http://www.w3.org/2000/svg';

  const maxY = Math.max(10, Math.ceil(Math.max(...points.map(p => p.pct))));
  const scaleY = (val: number) => height - pad - (val * (height - 2 * pad)) / maxY;

  // Date-based X positioning for both data points and rotation markers
  const dateMin = points[0].date.getTime();
  const dateMax = points[points.length - 1].date.getTime();
  const dateRange = dateMax - dateMin || 1;
  const scaleDateX = (d: Date) => pad + ((d.getTime() - dateMin) / dateRange) * (width - 2 * pad);

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));

  // Axes
  const makeL = (x1: number, y1: number, x2: number, y2: number, stroke = '#39425f') => {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', String(x1));
    l.setAttribute('y1', String(y1));
    l.setAttribute('x2', String(x2));
    l.setAttribute('y2', String(y2));
    l.setAttribute('stroke', stroke);
    return l;
  };
  svg.appendChild(makeL(pad, height - pad, width - pad, height - pad));
  svg.appendChild(makeL(pad, pad, pad, height - pad));

  // Y label
  const yLabel = document.createElementNS(ns, 'text');
  yLabel.setAttribute('x', '12');
  yLabel.setAttribute('y', String(pad - 8));
  yLabel.setAttribute('fill', '#a3a8b7');
  yLabel.setAttribute('font-size', '10');
  yLabel.setAttribute('font-family', 'system-ui, sans-serif');
  yLabel.textContent = 'Usage %';
  svg.appendChild(yLabel);

  // Y ticks
  const yTicks = Math.min(4, Math.ceil(maxY / 10));
  for (let i = 0; i <= yTicks; i++) {
    const val = (i * maxY) / yTicks;
    const y = scaleY(val);
    svg.appendChild(makeL(pad - 3, y, pad, y));
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', String(pad - 6));
    t.setAttribute('y', String(y + 3));
    t.setAttribute('fill', '#a3a8b7');
    t.setAttribute('font-size', '9');
    t.setAttribute('font-family', 'system-ui, sans-serif');
    t.setAttribute('text-anchor', 'end');
    t.textContent = val.toFixed(0);
    svg.appendChild(t);
  }

  // Rotation marker lines (dashed vertical lines)
  for (const rot of rotations) {
    const rotDate = new Date(rot.date);
    const rx = scaleDateX(rotDate);
    if (rx < pad || rx > width - pad) {
      continue;
    }

    const rotLine = document.createElementNS(ns, 'line');
    rotLine.setAttribute('x1', String(rx));
    rotLine.setAttribute('y1', String(pad - 4));
    rotLine.setAttribute('x2', String(rx));
    rotLine.setAttribute('y2', String(height - pad));
    rotLine.setAttribute('stroke', '#e8a83e');
    rotLine.setAttribute('stroke-width', '1');
    rotLine.setAttribute('stroke-dasharray', '3,3');
    rotLine.setAttribute('opacity', '0.5');
    svg.appendChild(rotLine);

    // Rotation diamond marker at the top
    const diamond = document.createElementNS(ns, 'polygon');
    const dx = rx;
    const dy = pad - 8;
    diamond.setAttribute('points', `${dx},${dy - 4} ${dx + 3.5},${dy} ${dx},${dy + 4} ${dx - 3.5},${dy}`);
    diamond.setAttribute('fill', '#e8a83e');
    diamond.setAttribute('opacity', '0.7');
    svg.appendChild(diamond);

    // Rotation hit area for tooltip
    const rotHit = document.createElementNS(ns, 'rect');
    rotHit.setAttribute('x', String(rx - 8));
    rotHit.setAttribute('y', String(pad - 14));
    rotHit.setAttribute('width', '16');
    rotHit.setAttribute('height', String(height - pad + 10));
    rotHit.setAttribute('fill', 'transparent');
    rotHit.setAttribute('pointer-events', 'all');
    rotHit.style.cursor = 'pointer';

    const rotTipHtml = `<div style="font-weight:600;color:#e8a83e">${escapeHtml(rot.label)}</div>`;
    rotHit.addEventListener('mouseenter', () => {
      diamond.setAttribute('opacity', '1');
      rotLine.setAttribute('opacity', '0.8');
      const dRect = diamond.getBoundingClientRect();
      showTimelineTip(rotTipHtml, dRect.x + dRect.width / 2, dRect.y);
    });
    rotHit.addEventListener('mouseleave', () => {
      diamond.setAttribute('opacity', '0.7');
      rotLine.setAttribute('opacity', '0.5');
      scheduleHideTip();
    });
    svg.appendChild(rotHit);
  }

  // Line path
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${scaleDateX(p.date)},${scaleY(p.pct)}`).join(' ');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', pathD);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#6aa3ff');
  path.setAttribute('stroke-width', '2');
  svg.appendChild(path);

  // Determine which points are "interesting" (first appearance, new highs, big jumps)
  const interesting = findInterestingPoints(points);

  // Only render dots and hit targets at interesting points
  for (let i = 0; i < points.length; i++) {
    if (!interesting.has(i)) {
      continue;
    }

    const pt = points[i];
    const cx = scaleDateX(points[i].date);
    const cy = scaleY(pt.pct);

    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', String(cy));
    dot.setAttribute('r', '3.5');
    dot.setAttribute('fill', '#6aa3ff');
    svg.appendChild(dot);

    // Large hit target for easy hovering/clicking
    const hit = document.createElementNS(ns, 'circle');
    hit.setAttribute('cx', String(cx));
    hit.setAttribute('cy', String(cy));
    hit.setAttribute('r', '18');
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('pointer-events', 'all');
    hit.style.cursor = 'pointer';

    const buildTipHtml = (): string => {
      let html = `<div style="font-weight:600;color:#e8a83e;margin-bottom:2px">${escapeHtml(formatTournamentShort(pt.tournament))}</div>`;
      html += `<div>${pt.pct}% usage (${pt.found}/${pt.total} lists)</div>`;
      if (pt.bestPlayer && pt.bestPlacement) {
        html += `<div style="margin-top:4px;color:#6aa3ff">`;
        html += `#${pt.bestPlacement} ${escapeHtml(pt.bestPlayer)}`;
        if (pt.bestListId) {
          html += ` <span style="opacity:0.7">\u2022 <a href="${LIMITLESS_BASE}/decks/list/${pt.bestListId}" target="_blank" rel="noopener" style="color:#6aa3ff;pointer-events:auto;text-decoration:underline">List</a></span>`;
        }
        html += `</div>`;
      }
      return html;
    };

    // eslint-disable-next-line no-loop-func
    hit.addEventListener('mouseenter', () => {
      if (activeHoverDot && activeHoverDot !== dot) {
        activeHoverDot.setAttribute('r', '3.5');
        activeHoverDot.setAttribute('fill', '#6aa3ff');
      }
      activeHoverDot = dot;
      dot.setAttribute('r', '5.5');
      dot.setAttribute('fill', '#e8a83e');
      const dotRect = dot.getBoundingClientRect();
      showTimelineTip(buildTipHtml(), dotRect.x + dotRect.width / 2, dotRect.y);
    });
    hit.addEventListener('mouseleave', () => {
      scheduleHideTip();
    });

    svg.appendChild(hit);
  }

  container.appendChild(svg);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Usage list renderer (players who used the card)
// ---------------------------------------------------------------------------

function cardMatchesItem(c: DeckCard, item: CardItem): boolean {
  // Trainer/energy were merged by name in the scraper, so match by name only
  const cat = (item.category || '').toLowerCase();
  if (cat.startsWith('trainer') || cat.startsWith('energy')) {
    return c.name === item.name;
  }
  // Pokemon: match by UID (lists.json cards are already canonicalized at scrape time)
  if (item.uid) {
    const uid = `${c.name}::${(c.set || '').toUpperCase()}::${String(c.number || '').padStart(3, '0')}`;
    return uid === item.uid;
  }
  return c.name === item.name;
}

function findListsWithCard(item: CardItem, lists: ListEntry[]): ListEntry[] {
  return lists.filter(list => list.cards.some(c => cardMatchesItem(c, item)));
}

/**
 * Score a list entry for sorting. Higher = more interesting.
 * Rewards high placement at large events, with slight randomization.
 */
function scoreListEntry(entry: ListEntry): number {
  const players = entry.tournamentPlayers || 32;
  const place = entry.placement || players;
  // Percentile: 1st at a 1000-player event → ~1.0, last → ~0.0
  const percentile = 1 - (place - 1) / Math.max(1, players - 1);
  // Weight by log of event size so a 1000-player event matters more than a 10-player one
  const sizeWeight = Math.log2(Math.max(2, players));
  // Slight randomization (±15%) so results shuffle a bit each time
  const jitter = 0.85 + Math.random() * 0.3;
  return percentile * sizeWeight * jitter;
}

function renderUsageList(container: HTMLElement, item: CardItem, lists: ListEntry[]): void {
  const matching = findListsWithCard(item, lists);
  if (!matching.length) {
    return;
  }

  // Sort by interestingness: high placement at large events first
  matching.sort((a, b) => scoreListEntry(b) - scoreListEntry(a));

  const INITIAL_SHOW = 10;
  const listEl = document.createElement('div');
  listEl.className = 'detail-usage-list';

  function renderRows(entries: ListEntry[]): void {
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'usage-row';

      const player = document.createElement('span');
      player.className = 'usage-player';
      player.textContent = entry.player;

      const tournament = document.createElement('span');
      tournament.className = 'usage-tournament';
      tournament.textContent = formatTournamentShort(entry.tournament);
      tournament.title = entry.tournament;

      const placement = document.createElement('span');
      placement.className = 'usage-placement';
      placement.textContent = entry.placement ? `#${entry.placement}` : '';

      const link = document.createElement('a');
      link.className = 'usage-list-link';
      link.href = `${LIMITLESS_BASE}/decks/list/${entry.id}`;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'List';

      row.appendChild(player);
      row.appendChild(tournament);
      row.appendChild(placement);
      row.appendChild(link);
      listEl.appendChild(row);
    }
  }

  renderRows(matching.slice(0, INITIAL_SHOW));

  if (matching.length > INITIAL_SHOW) {
    const more = document.createElement('button');
    more.className = 'usage-show-more';
    more.type = 'button';
    more.textContent = `Show all ${matching.length} lists`;
    more.addEventListener('click', () => {
      more.remove();
      renderRows(matching.slice(INITIAL_SHOW));
    });
    listEl.appendChild(more);
  }

  container.appendChild(listEl);
}

// ---------------------------------------------------------------------------
// Render: detail panel
// ---------------------------------------------------------------------------

function openDetailPanel(item: CardItem): void {
  // Mark active card
  document.querySelectorAll('.mem-card.active').forEach(el => el.classList.remove('active'));
  const cards = $grid.querySelectorAll('.mem-card');
  const idx = filterItems(currentItems, activeCategory).indexOf(item);
  if (idx >= 0 && cards[idx]) {
    cards[idx].classList.add('active');
  }

  $detailContent.innerHTML = '';

  // Large card image
  if (item.set && item.number) {
    const img = document.createElement('img');
    img.className = 'detail-image';
    img.src = buildCardImageUrl(item.set, String(item.number), 'LG');
    img.alt = item.name;
    img.onerror = () => {
      img.style.display = 'none';
    };
    $detailContent.appendChild(img);
  }

  // Card name
  const name = document.createElement('h2');
  name.className = 'detail-card-name';
  name.textContent = item.name;
  $detailContent.appendChild(name);

  // Set info
  if (item.set && item.number) {
    const setInfo = document.createElement('div');
    setInfo.className = 'detail-set-info';
    setInfo.textContent = `${item.set} ${item.number}`;
    $detailContent.appendChild(setInfo);
  }

  // Stats
  const stats: [string, string][] = [
    ['Found in', `${item.found.toLocaleString()} of ${item.total.toLocaleString()} lists`],
    ['Usage rate', `${item.pct}%`],
    ['Category', formatCategory(item)]
  ];

  for (const [label, value] of stats) {
    const row = document.createElement('div');
    row.className = 'detail-stat';
    const labelEl = document.createElement('span');
    labelEl.className = 'detail-stat-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'detail-stat-value';
    valueEl.textContent = value;
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    $detailContent.appendChild(row);
  }

  // Histogram
  if (item.dist && item.dist.length > 0) {
    const histHeading = document.createElement('div');
    histHeading.className = 'detail-section-heading';
    histHeading.textContent = 'Copy distribution';
    $detailContent.appendChild(histHeading);

    const histContainer = document.createElement('div');
    renderCopiesHistogram(histContainer, { dist: item.dist, total: item.found });
    $detailContent.appendChild(histContainer);
  }

  // Timeline chart (needs lists data)
  if (currentLists) {
    const timelineHeading = document.createElement('div');
    timelineHeading.className = 'detail-section-heading';
    timelineHeading.textContent = 'Usage over time';
    $detailContent.appendChild(timelineHeading);

    const timelineContainer = document.createElement('div');
    timelineContainer.className = 'mem-timeline';
    const points = buildTimeline(item, currentLists);
    renderTimeline(timelineContainer, points, currentRotations);
    $detailContent.appendChild(timelineContainer);
  }

  // Player usage list
  if (currentLists) {
    const usageHeading = document.createElement('div');
    usageHeading.className = 'detail-section-heading';
    usageHeading.textContent = `Lists using this card (${item.found})`;
    $detailContent.appendChild(usageHeading);

    renderUsageList($detailContent, item, currentLists);
  }

  // "View on Ciphermaniac" link
  if (item.set && item.number) {
    const link = document.createElement('a');
    link.className = 'detail-link';
    link.href = buildCardPath(item.set, String(item.number));
    link.textContent = 'View on Ciphermaniac \u2192';
    $detailContent.appendChild(link);
  }

  // Open panel
  $backdrop.classList.add('open');
  $panel.classList.add('open');
  $panel.scrollTop = 0;
}

function closeDetailPanel(): void {
  $backdrop.classList.remove('open');
  $panel.classList.remove('open');
  document.querySelectorAll('.mem-card.active').forEach(el => el.classList.remove('active'));
}

function formatCategory(item: CardItem): string {
  if (item.aceSpec) {
    return 'Ace Spec';
  }
  const cat = item.category || '';
  if (cat.includes('/')) {
    return cat
      .split('/')
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' \u203A ');
  }
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

// ---------------------------------------------------------------------------
// Close handlers
// ---------------------------------------------------------------------------

$closeBtn.addEventListener('click', closeDetailPanel);
$backdrop.addEventListener('click', closeDetailPanel);
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    closeDetailPanel();
  }
});
$sortSelect.addEventListener('change', () => {
  activeSort = $sortSelect.value;
  renderGrid(currentItems);
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  const index = await fetchJson<IndexData>(`${DATA_BASE}/index.json`);

  // Sort by list count descending
  index.archetypes.sort((a, b) => (b.listCount || 0) - (a.listCount || 0));

  if (!index.archetypes.length) {
    $grid.innerHTML =
      '<div class="memorial-loading">No rotated archetypes have been added yet. Check back after the next rotation.</div>';
    return;
  }

  const hash = window.location.hash.replace('#', '');
  const initialSlug = index.archetypes.find(a => a.slug === hash)?.slug || '';

  function showEmptyState(): void {
    $meta.innerHTML = '';
    $tabs.innerHTML = '';
    $sortSelect.style.display = 'none';
    $grid.innerHTML = '<div class="memorial-loading">Select an archetype.</div>';
  }

  async function loadArchetype(slug: string): Promise<void> {
    window.location.hash = slug;
    _activeSlug = slug;
    $grid.innerHTML = '<div class="memorial-loading">Loading deck data...</div>';

    renderSelector(index.archetypes, slug, loadArchetype);

    // Load master and lists in parallel
    const [data, listsData] = await Promise.all([
      fetchJson<MasterData>(`${DATA_BASE}/${slug}/master.json`),
      fetchJson<ListsData>(`${DATA_BASE}/${slug}/lists.json`)
    ]);

    currentItems = data.items;
    currentLists = listsData.lists;
    currentRotations = index.archetypes.find(a => a.slug === slug)?.rotations || [];
    activeCategory = 'all';

    $sortSelect.style.display = '';
    renderMeta(data);
    renderTabs(data.items, () => renderGrid(currentItems));
    renderGrid(currentItems);
  }

  renderSelector(index.archetypes, initialSlug, loadArchetype);
  if (initialSlug) {
    await loadArchetype(initialSlug);
  } else {
    showEmptyState();
  }
}

init().catch(err => {
  console.error('In Loving Memory init failed:', err);
  $grid.innerHTML = '<div class="memorial-loading">Failed to load data. Please refresh.</div>';
});

export {};
