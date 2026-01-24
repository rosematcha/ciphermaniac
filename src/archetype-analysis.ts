/* eslint-env browser */
/**
 * Archetypes List Page - Re-optimized for performance
 *
 * Design principles:
 * 1. Performance first - no flashing, dimming, or visual bugs
 * 2. Single render pass - render once with stable DOM structure
 * 3. Native lazy loading - use browser's built-in loading="lazy"
 * 4. Simple state management - minimal class toggling
 * 5. Fallback always visible - image covers it when loaded
 */
import './utils/buildVersion.js';
import { fetchArchetypeReport, fetchArchetypesList } from './api.js';
import { parseReport } from './parse.js';
import { logger } from './utils/logger.js';

type SignatureCard = {
  name: string;
  set: string | null;
  number: string | null;
  pct: number;
};

type ArchetypeSummary = {
  name: string;
  label: string;
  deckCount: number | null;
  percent: number | null;
  thumbnails?: string[];
  signatureCards?: SignatureCard[];
};

type CachedSummaries = {
  timestamp: number;
  data: ArchetypeSummary[];
};

// Configuration
const CACHE_KEY = 'analysis/archetypes-index';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PREFETCH_BATCH = 5;
const PREFETCH_DELAY_MS = 150;
const ONLINE_META_TOURNAMENT = 'Online - Last 14 Days';
const DEFAULT_SORT = 'deck-desc';

const numberFormatter = new Intl.NumberFormat('en-US');

const { document } = globalThis;

// DOM references
const elements = {
  archetypeList: document.getElementById('analysis-archetype-list') as HTMLUListElement | null,
  listLoading: document.getElementById('analysis-list-loading'),
  listEmpty: document.getElementById('analysis-list-empty'),
  listEmptyResults: document.getElementById('analysis-list-empty-results'),
  searchInput: document.getElementById('archetype-search') as HTMLInputElement | null,
  sortSelect: document.getElementById('archetype-sort') as HTMLSelectElement | null,
  resultsSummary: document.getElementById('analysis-results'),
  summaryWindow: document.getElementById('archetypes-summary-window'),
  summaryCount: document.getElementById('archetypes-summary-count'),
  summaryDecks: document.getElementById('archetypes-summary-decks'),
  summaryTop: document.getElementById('archetypes-summary-top'),
  summaryTopLabel: document.getElementById('archetypes-summary-top-label')
};

const templates = {
  listItem: document.getElementById('analysis-list-item') as HTMLTemplateElement | null
};

// Simple state
const state = {
  archetypes: [] as ArchetypeSummary[],
  filtered: [] as ArchetypeSummary[],
  prefetched: new Set<string>(),
  prefetchQueue: [] as string[],
  prefetchHandle: null as number | null,
  hoverTimer: null as { target: string; id: number } | null,
  query: '',
  sortMode: DEFAULT_SORT,
  searchTimer: null as number | null
};

// ============================================================================
// Cache Management
// ============================================================================

function readCache(): ArchetypeSummary[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }
    const payload = JSON.parse(raw) as CachedSummaries;
    if (!payload?.timestamp || Date.now() - payload.timestamp > CACHE_TTL_MS) {
      return null;
    }
    if (!Array.isArray(payload.data)) {
      return null;
    }
    return payload.data;
  } catch {
    return null;
  }
}

function writeCache(data: ArchetypeSummary[]) {
  try {
    const payload: CachedSummaries = { timestamp: Date.now(), data };
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Silently fail - cache is optional
  }
}

// ============================================================================
// Data Fetching
// ============================================================================

function normalizeSummary(entry: ArchetypeSummary): ArchetypeSummary {
  return {
    name: entry.name,
    label: entry.label || entry.name.replace(/_/g, ' '),
    deckCount: Number.isFinite(entry.deckCount) ? Number(entry.deckCount) : null,
    percent: Number.isFinite(entry.percent) ? Number(entry.percent) : null,
    thumbnails: Array.isArray(entry.thumbnails) ? entry.thumbnails.filter(Boolean) : [],
    signatureCards: Array.isArray(entry.signatureCards) ? entry.signatureCards : []
  };
}

async function fetchSummaries(): Promise<ArchetypeSummary[]> {
  const list = await fetchArchetypesList(ONLINE_META_TOURNAMENT);
  const normalized = Array.isArray(list) ? list.filter(item => item?.name) : [];
  const summaries = normalized.map(normalizeSummary);

  // Sort by deck count (descending), then alphabetically
  summaries.sort((itemA, itemB) => {
    const aDeck = itemA.deckCount ?? 0;
    const bDeck = itemB.deckCount ?? 0;
    if (bDeck !== aDeck) {
      return bDeck - aDeck;
    }
    return itemA.label.localeCompare(itemB.label);
  });

  return summaries;
}

// ============================================================================
// Thumbnail URL Building
// ============================================================================

function formatCardNumber(raw: string | number | null | undefined): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const str = String(raw).trim();
  if (!str) {
    return null;
  }
  const match = str.match(/^(\d+)([A-Za-z]*)$/);
  if (!match) {
    return str.toUpperCase();
  }
  const [, digits, suffix = ''] = match;
  return `${digits.padStart(3, '0')}${suffix.toUpperCase()}`;
}

function buildThumbnailUrl(setCode: string, number: string): string | null {
  const set = String(setCode || '')
    .toUpperCase()
    .trim();
  if (!set) {
    return null;
  }
  const num = formatCardNumber(number);
  if (!num) {
    return null;
  }
  return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${set}/${set}_${num}_R_EN_SM.png`;
}

function getThumbnailUrls(thumbnails?: string[]): string[] {
  if (!Array.isArray(thumbnails) || !thumbnails.length) {
    return [];
  }
  return thumbnails
    .slice(0, 2) // Max 2 thumbnails for split view
    .map(entry => {
      const [set, number] = entry.split('/');
      return buildThumbnailUrl(set, number);
    })
    .filter((url): url is string => url !== null);
}

function buildFallbackText(name: string): string {
  const parts = name.replace(/_/g, ' ').split(/\s+/u).filter(Boolean).slice(0, 3);
  if (!parts.length) {
    return '??';
  }
  return parts.map(word => word[0].toUpperCase()).join('');
}

// ============================================================================
// Formatting + Sorting
// ============================================================================

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function formatPercent(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) {
    return '--';
  }
  return `${(value * 100).toFixed(digits)}%`;
}

function compareNullableNumber(a: number | null, b: number | null, direction: 'asc' | 'desc'): number {
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return direction === 'asc' ? a - b : b - a;
}

function sortArchetypes(list: ArchetypeSummary[], mode: string): ArchetypeSummary[] {
  const sorted = [...list];
  switch (mode) {
    case 'deck-asc':
      sorted.sort((a, b) => compareNullableNumber(a.deckCount, b.deckCount, 'asc') || a.label.localeCompare(b.label));
      break;
    case 'percent-desc':
      sorted.sort((a, b) => compareNullableNumber(a.percent, b.percent, 'desc') || a.label.localeCompare(b.label));
      break;
    case 'percent-asc':
      sorted.sort((a, b) => compareNullableNumber(a.percent, b.percent, 'asc') || a.label.localeCompare(b.label));
      break;
    case 'alpha-asc':
      sorted.sort((a, b) => a.label.localeCompare(b.label));
      break;
    case 'alpha-desc':
      sorted.sort((a, b) => b.label.localeCompare(a.label));
      break;
    case 'deck-desc':
    default:
      sorted.sort((a, b) => compareNullableNumber(a.deckCount, b.deckCount, 'desc') || a.label.localeCompare(b.label));
      break;
  }
  return sorted;
}

function matchesQuery(summary: ArchetypeSummary, query: string): boolean {
  if (!query) {
    return true;
  }
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (summary.label.toLowerCase().includes(normalized) || summary.name.toLowerCase().includes(normalized)) {
    return true;
  }
  if (summary.signatureCards?.some(card => card.name.toLowerCase().includes(normalized))) {
    return true;
  }
  return false;
}

// ============================================================================
// List Item Creation - Simple, stable DOM structure
// ============================================================================

function createListItem(summary: ArchetypeSummary, index: number): HTMLElement | null {
  if (!templates.listItem?.content) {
    return null;
  }

  const node = templates.listItem.content.firstElementChild?.cloneNode(true) as HTMLElement | null;
  if (!node) {
    return null;
  }

  // Set link and data attributes
  const anchor = node.querySelector('.analysis-list-item__button') as HTMLAnchorElement | null;
  if (anchor) {
    anchor.href = `/${encodeURIComponent(summary.name)}`;
    anchor.dataset.archetype = summary.name;
  }

  // Set text content
  const nameEl = node.querySelector('.analysis-list-item__name');
  const pctEl = node.querySelector('.analysis-list-item__percent');
  const deckEl = node.querySelector('.analysis-list-item__count');
  const rankEl = node.querySelector('.analysis-list-item__rank');

  if (nameEl) {
    nameEl.textContent = summary.label;
  }
  if (pctEl) {
    pctEl.textContent = formatPercent(summary.percent, 1);
  }
  if (deckEl) {
    deckEl.textContent =
      summary.deckCount === null
        ? 'Deck count unavailable'
        : `${formatNumber(summary.deckCount)} deck${summary.deckCount === 1 ? '' : 's'}`;
  }
  if (rankEl) {
    rankEl.textContent = `#${index + 1}`;
  }

  if (index < 3) {
    node.classList.add(`analysis-list-item--rank-${index + 1}`);
  }

  // Setup thumbnail - simple approach
  const thumbnailContainer = node.querySelector('.analysis-list-item__thumbnail') as HTMLElement | null;
  const thumbnailImage = node.querySelector('.analysis-list-item__thumbnail-image') as HTMLImageElement | null;
  const thumbnailFallback = node.querySelector('.analysis-list-item__thumbnail-fallback') as HTMLElement | null;
  const signatureSection = node.querySelector('.analysis-list-item__signature') as HTMLElement | null;
  const signatureList = node.querySelector('.analysis-list-item__signature-list') as HTMLElement | null;
  const bar = node.querySelector('.analysis-list-item__bar') as HTMLElement | null;
  const barFill = bar?.querySelector('.bar') as HTMLElement | null;
  const barPct = bar?.querySelector('.pct') as HTMLElement | null;

  if (thumbnailContainer && thumbnailFallback) {
    const fallbackText = buildFallbackText(summary.label);
    thumbnailFallback.textContent = fallbackText;

    const urls = getThumbnailUrls(summary.thumbnails);

    if (urls.length === 0) {
      // No thumbnails - show fallback immediately
      thumbnailContainer.classList.add('is-placeholder');
    } else if (urls.length === 1 && thumbnailImage) {
      // Single thumbnail
      setupSingleThumbnail(thumbnailImage, thumbnailContainer, urls[0], index < 10);
    } else if (urls.length >= 2) {
      // Split thumbnail - create structure upfront
      setupSplitThumbnail(thumbnailContainer, thumbnailImage, thumbnailFallback, urls, index < 10);
    }
  }

  if (bar && barFill && barPct) {
    if (summary.percent === null || Number.isNaN(summary.percent)) {
      bar.classList.add('is-empty');
      barFill.style.width = '0%';
      barPct.textContent = '--';
    } else {
      const clamped = Math.max(0, Math.min(1, summary.percent));
      bar.classList.remove('is-empty');
      barFill.style.width = `${(clamped * 100).toFixed(2)}%`;
      barPct.textContent = formatPercent(clamped, 1);
    }
  }

  if (signatureSection && signatureList) {
    signatureList.innerHTML = '';
    const cards = summary.signatureCards?.filter(card => card?.name) ?? [];
    if (cards.length) {
      signatureSection.hidden = false;
      cards.slice(0, 3).forEach(card => {
        const chip = document.createElement('span');
        chip.className = 'analysis-signature-card';
        const name = document.createElement('span');
        name.className = 'analysis-signature-card__name';
        name.textContent = card.name;
        chip.appendChild(name);
        if (Number.isFinite(card.pct)) {
          const pct = document.createElement('span');
          pct.className = 'analysis-signature-card__pct';
          pct.textContent = formatPercent(card.pct, 0);
          chip.appendChild(pct);
        }
        signatureList.appendChild(chip);
      });
    } else {
      signatureSection.hidden = true;
    }
  }

  return node;
}

function setupSingleThumbnail(img: HTMLImageElement, container: HTMLElement, url: string, eager: boolean): void {
  img.loading = eager ? 'eager' : 'lazy';
  img.decoding = 'async';
  img.alt = '';

  // Simple error handling - just show fallback on error
  img.onerror = () => {
    container.classList.add('is-placeholder');
    img.style.display = 'none';
  };

  img.src = url;
}

function setupSplitThumbnail(
  container: HTMLElement,
  baseImg: HTMLImageElement | null,
  fallback: HTMLElement,
  urls: string[],
  eager: boolean
): void {
  // Hide the base image for split view
  if (baseImg) {
    baseImg.style.display = 'none';
  }

  container.classList.add('analysis-list-item__thumbnail--split');

  // Create split wrapper
  const splitWrapper = document.createElement('div');
  splitWrapper.className = 'analysis-list-item__split';

  let errorCount = 0;
  let _loadedCount = 0;

  const checkComplete = () => {
    if (errorCount === urls.length) {
      // All images failed - show fallback
      container.classList.remove('analysis-list-item__thumbnail--split');
      container.classList.add('is-placeholder');
      splitWrapper.remove();
    }
  };

  urls.slice(0, 2).forEach((url, i) => {
    const slice = document.createElement('div');
    slice.className = `analysis-list-item__slice analysis-list-item__slice--${i === 0 ? 'left' : 'right'}`;

    const img = document.createElement('img');
    img.className = 'analysis-list-item__thumbnail-image analysis-list-item__thumbnail-image--split';
    img.loading = eager ? 'eager' : 'lazy';
    img.decoding = 'async';
    img.alt = '';

    // Apply clip-path for split effect
    const clipLeft = i === 0 ? '0%' : '50%';
    const clipRight = i === 0 ? '50%' : '0%';
    img.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      clip-path: inset(0% ${clipRight} 0% ${clipLeft});
    `;

    img.onload = () => {
      _loadedCount++;
    };
    img.onerror = () => {
      errorCount++;
      slice.style.display = 'none';
      checkComplete();
    };

    img.src = url;
    slice.appendChild(img);
    splitWrapper.appendChild(slice);
  });

  container.insertBefore(splitWrapper, fallback);
}

// ============================================================================
// Rendering - Single pass, no re-renders
// ============================================================================

function renderList(archetypes: ArchetypeSummary[]): void {
  const listEl = elements.archetypeList;
  if (!listEl) {
    return;
  }

  // Clear any existing content
  listEl.innerHTML = '';

  if (archetypes.length === 0) {
    return;
  }

  // Build all items in a single fragment
  const fragment = document.createDocumentFragment();
  archetypes.forEach((summary, index) => {
    const item = createListItem(summary, index);
    if (item) {
      fragment.appendChild(item);
    }
  });

  listEl.appendChild(fragment);
}

function showLoading(show: boolean): void {
  if (elements.listLoading) {
    elements.listLoading.hidden = !show;
  }
  if (show) {
    if (elements.archetypeList) {
      elements.archetypeList.hidden = true;
    }
    if (elements.listEmpty) {
      elements.listEmpty.hidden = true;
    }
    if (elements.listEmptyResults) {
      elements.listEmptyResults.hidden = true;
    }
  }
}

function showError(message: string): void {
  if (elements.listLoading) {
    elements.listLoading.textContent = message;
    elements.listLoading.hidden = false;
  }
  if (elements.archetypeList) {
    elements.archetypeList.hidden = true;
  }
  if (elements.listEmpty) {
    elements.listEmpty.hidden = true;
  }
  if (elements.listEmptyResults) {
    elements.listEmptyResults.hidden = true;
  }
}

function updateSummary(archetypes: ArchetypeSummary[]): void {
  if (elements.summaryWindow) {
    elements.summaryWindow.textContent = ONLINE_META_TOURNAMENT;
  }

  if (elements.summaryCount) {
    elements.summaryCount.textContent = archetypes.length ? formatNumber(archetypes.length) : '--';
  }

  if (elements.summaryDecks) {
    let totalDecks = 0;
    let unknownCount = 0;
    archetypes.forEach(entry => {
      if (entry.deckCount === null || Number.isNaN(entry.deckCount)) {
        unknownCount += 1;
      } else {
        totalDecks += entry.deckCount;
      }
    });
    if (!archetypes.length) {
      elements.summaryDecks.textContent = '--';
    } else {
      elements.summaryDecks.textContent = `${formatNumber(totalDecks)}${unknownCount ? '+' : ''}`;
      elements.summaryDecks.title = unknownCount
        ? `${unknownCount} archetype${unknownCount === 1 ? '' : 's'} missing deck counts`
        : '';
    }
  }

  if (elements.summaryTop) {
    const top = archetypes.reduce<ArchetypeSummary | null>((best, entry) => {
      if (entry.percent === null || Number.isNaN(entry.percent)) {
        return best;
      }
      if (!best || best.percent === null || Number.isNaN(best.percent)) {
        return entry;
      }
      return entry.percent > best.percent ? entry : best;
    }, null);

    elements.summaryTop.textContent = top?.percent != null ? formatPercent(top.percent, 1) : '--';
    if (elements.summaryTopLabel) {
      elements.summaryTopLabel.textContent = top?.label ?? '';
    }
  }
}

function updateResultsSummary(): void {
  if (!elements.resultsSummary) {
    return;
  }
  if (!state.archetypes.length) {
    elements.resultsSummary.textContent = '';
    return;
  }

  const total = state.archetypes.length;
  const shown = state.filtered.length;
  const queryLabel = state.query ? ` for "${state.query}"` : '';
  elements.resultsSummary.textContent = `Showing ${formatNumber(shown)} of ${formatNumber(total)} archetype${
    total === 1 ? '' : 's'
  }${queryLabel}.`;
}

function updateEmptyState(): void {
  const hasData = state.archetypes.length > 0;
  const hasResults = state.filtered.length > 0;

  if (elements.listEmpty) {
    elements.listEmpty.hidden = hasData;
  }
  if (elements.listEmptyResults) {
    elements.listEmptyResults.hidden = !hasData || hasResults;
  }
  if (elements.archetypeList) {
    elements.archetypeList.hidden = !hasResults;
  }
}

function applyFiltersAndRender(): void {
  const filtered = state.archetypes.filter(entry => matchesQuery(entry, state.query));
  state.filtered = sortArchetypes(filtered, state.sortMode);
  renderList(state.filtered);
  updateResultsSummary();
  updateEmptyState();
  resetPrefetchQueue(state.filtered.length ? state.filtered : state.archetypes);
}

// ============================================================================
// Prefetching - Hover to prefetch archetype data
// ============================================================================

async function prefetchArchetype(name: string): Promise<void> {
  if (state.prefetched.has(name)) {
    return;
  }
  try {
    const raw = await fetchArchetypeReport(ONLINE_META_TOURNAMENT, name);
    parseReport(raw);
    state.prefetched.add(name);
  } catch (err) {
    logger.debug('Archetype prefetch failed', { name, message: (err as Error)?.message });
  }
}

function resetPrefetchQueue(archetypes: ArchetypeSummary[]): void {
  if (!archetypes.length) {
    return;
  }

  if (state.prefetchHandle !== null) {
    clearTimeout(state.prefetchHandle);
    state.prefetchHandle = null;
  }

  state.prefetchQueue = [];

  const batch = archetypes.slice(0, PREFETCH_BATCH);
  for (const item of batch) {
    if (!state.prefetched.has(item.name)) {
      state.prefetchQueue.push(item.name);
    }
  }

  drainPrefetchQueue();
}

function drainPrefetchQueue(): void {
  if (!state.prefetchQueue.length || state.prefetchHandle !== null) {
    return;
  }

  const next = state.prefetchQueue.shift();
  if (!next) {
    return;
  }

  state.prefetchHandle = window.setTimeout(async () => {
    state.prefetchHandle = null;
    await prefetchArchetype(next);
    drainPrefetchQueue();
  }, PREFETCH_DELAY_MS);
}

function setupHoverPrefetch(): void {
  const listEl = elements.archetypeList;
  if (!listEl) {
    return;
  }

  listEl.addEventListener(
    'pointerenter',
    event => {
      const target = (event.target as HTMLElement)?.closest('.analysis-list-item__button') as HTMLElement | null;
      if (!target?.dataset.archetype) {
        return;
      }

      const { archetype } = target.dataset;

      // Cancel any existing timer
      if (state.hoverTimer) {
        clearTimeout(state.hoverTimer.id);
        state.hoverTimer = null;
      }

      // Start new timer
      const id = window.setTimeout(() => {
        prefetchArchetype(archetype);
        state.hoverTimer = null;
      }, PREFETCH_DELAY_MS);

      state.hoverTimer = { target: archetype, id };
    },
    true
  );

  listEl.addEventListener(
    'pointerleave',
    event => {
      const target = (event.target as HTMLElement)?.closest('.analysis-list-item__button') as HTMLElement | null;
      if (!target?.dataset.archetype) {
        return;
      }

      if (state.hoverTimer?.target === target.dataset.archetype) {
        clearTimeout(state.hoverTimer.id);
        state.hoverTimer = null;
      }
    },
    true
  );
}

// ============================================================================
// Controls
// ============================================================================

function setupControls(): void {
  if (elements.searchInput) {
    elements.searchInput.addEventListener('input', event => {
      const target = event.target as HTMLInputElement | null;
      const nextQuery = target?.value ?? '';
      if (state.searchTimer) {
        clearTimeout(state.searchTimer);
      }
      state.searchTimer = window.setTimeout(() => {
        state.query = nextQuery.trim();
        applyFiltersAndRender();
        state.searchTimer = null;
      }, 150);
    });
  }

  if (elements.sortSelect) {
    elements.sortSelect.value = state.sortMode;
    elements.sortSelect.addEventListener('change', event => {
      const target = event.target as HTMLSelectElement | null;
      const nextSort = target?.value ?? DEFAULT_SORT;
      if (nextSort === state.sortMode) {
        return;
      }
      state.sortMode = nextSort;
      applyFiltersAndRender();
    });
  }
}

// ============================================================================
// Initialization
// ============================================================================

async function initialize(): Promise<void> {
  showLoading(true);
  setupControls();

  try {
    // First, try to show cached data immediately
    const cached = readCache();
    if (cached?.length) {
      state.archetypes = cached;
      updateSummary(cached);
      applyFiltersAndRender();
      showLoading(false);
    }

    // Fetch fresh data
    const freshData = await fetchSummaries();

    if (freshData.length) {
      writeCache(freshData);
      if (!state.archetypes.length || hasDataChanged(state.archetypes, freshData)) {
        state.archetypes = freshData;
        updateSummary(freshData);
        applyFiltersAndRender();
      }
      showLoading(false);
    } else if (!state.archetypes.length) {
      updateSummary([]);
      showLoading(false);
      updateEmptyState();
    }

    // Setup prefetching
    setupHoverPrefetch();
    resetPrefetchQueue(state.filtered.length ? state.filtered : state.archetypes);
  } catch (err) {
    logger.exception('Failed to initialize archetypes page', err);

    // If we have cached data, keep showing it
    if (state.archetypes.length) {
      showLoading(false);
    } else {
      showError('Unable to load archetypes. Please try again later.');
    }
  }
}

function hasDataChanged(oldData: ArchetypeSummary[], newData: ArchetypeSummary[]): boolean {
  if (oldData.length !== newData.length) {
    return true;
  }

  for (let i = 0; i < oldData.length; i++) {
    if (oldData[i].name !== newData[i].name) {
      return true;
    }
    if (oldData[i].deckCount !== newData[i].deckCount) {
      return true;
    }
    if (oldData[i].percent !== newData[i].percent) {
      return true;
    }
    const oldSig = oldData[i].signatureCards ?? [];
    const newSig = newData[i].signatureCards ?? [];
    if (oldSig.length !== newSig.length) {
      return true;
    }
    for (let j = 0; j < oldSig.length; j++) {
      if (oldSig[j].name !== newSig[j].name || oldSig[j].pct !== newSig[j].pct) {
        return true;
      }
    }
  }

  return false;
}

initialize();
