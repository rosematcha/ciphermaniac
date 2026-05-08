import { getBaseName, parseDisplayName } from './identifiers.js';
import { buildLgUrlFromVariant, deriveLgUrlFromCandidate, enableHeroImageModal, type VariantInfo } from './modal.js';
import { buildThumbCandidates } from '../thumbs.js';
import { getVariantImageCandidates } from '../utils/cardSynonyms.js';
import {
  createChartSkeleton,
  createEventsTableSkeleton,
  createHistogramSkeleton,
  showSkeleton
} from '../components/placeholders.js';

export const CARD_META_TEMPLATE = `
  <div class="header-title">
    <div class="title-row">
      <h1 id="card-title"></h1>
      <div class="title-row__right">
        <div id="card-ref-links-slot"></div>
        <div id="card-price" class="card-price"></div>
      </div>
    </div>
  </div>
  <div id="card-hero" class="card-hero">
    <div class="thumb" aria-hidden="true">
      <div class="skeleton-image" style="width: 100%; height: 100%; background: var(--bar-bg); animation: skeleton-loading 1.5s ease-in-out infinite;"></div>
    </div>
  </div>
  <div id="card-center">
    <div id="card-chart"></div>
    <div id="card-copies"></div>
  </div>
  <div id="card-events"></div>
`;

export let cardTitleEl: HTMLElement | null = null;
export let metaSection: HTMLElement | null = null;
export let decksSection: HTMLElement | null = null;
export let eventsSection: HTMLElement | null = null;
export let copiesSection: HTMLElement | null = null;
export let chartSection: HTMLElement | null = null;
export let centerSection: HTMLElement | null = null;

export type CardPageState = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
let cardPageState: CardPageState = 'idle';
export let cardLoadTriggered = false;
export function setCardLoadTriggered(value: boolean): void {
  cardLoadTriggered = value;
}

const perfMarksEnabled = typeof performance !== 'undefined' && typeof performance.mark === 'function';

export function markCardPerf(name: string): void {
  if (!perfMarksEnabled) {
    return;
  }
  try {
    performance.mark(name);
  } catch {
    // ignore perf mark errors
  }
}

export function measureCardPerf(name: string, startMark: string, endMark: string): void {
  if (!perfMarksEnabled || typeof performance.measure !== 'function') {
    return;
  }
  try {
    performance.measure(name, startMark, endMark);
  } catch {
    // ignore perf measure errors
  }
}

export function setCardPageState(nextState: CardPageState): void {
  if (cardPageState === nextState) {
    return;
  }
  cardPageState = nextState;
  const main = document.querySelector('main');
  if (main) {
    main.setAttribute('data-card-state', nextState);
  }
  if (metaSection) {
    metaSection.setAttribute('data-card-state', nextState);
  }
}

export function refreshDomRefs() {
  cardTitleEl = document.getElementById('card-title');
  metaSection = document.getElementById('card-meta');
  decksSection = document.getElementById('card-decks');
  eventsSection = document.getElementById('card-events');
  copiesSection = document.getElementById('card-copies');
  chartSection = document.getElementById('card-chart');
  centerSection = document.getElementById('card-center');
  if (metaSection) {
    metaSection.setAttribute('data-card-state', cardPageState);
  }
}

export function ensureCardMetaStructure(): boolean {
  const meta = document.getElementById('card-meta');
  if (!meta) {
    return false;
  }

  const hasHeader = Boolean(meta.querySelector('.header-title'));
  const hasHero = Boolean(meta.querySelector('#card-hero'));
  const hasCenter = Boolean(meta.querySelector('#card-center'));
  const hasChart = Boolean(document.getElementById('card-chart'));
  const hasCopies = Boolean(document.getElementById('card-copies'));
  const hasEvents = Boolean(document.getElementById('card-events'));

  if (hasHeader && hasHero && hasCenter && hasChart && hasCopies && hasEvents) {
    return false;
  }

  meta.innerHTML = CARD_META_TEMPLATE;
  refreshDomRefs();
  return true;
}

export let cardIdentifier: string | null = null;
export let cardName: string | null = null;
export function setCardIdentifier(value: string | null): void {
  cardIdentifier = value;
}
export function setCardName(value: string | null): void {
  cardName = value;
}

export function updateCardTitle(displayName: string | null, slugHint?: string) {
  if (!cardTitleEl) {
    return;
  }

  cardTitleEl.innerHTML = '';

  if (!displayName && !slugHint) {
    const nameSpan = document.createElement('span');
    nameSpan.textContent = 'Card Details';
    cardTitleEl.appendChild(nameSpan);
    document.title = 'Card Details – Ciphermaniac';
    return;
  }

  const label = displayName || slugHint || 'Card Details';
  const parsed = displayName ? parseDisplayName(displayName) : null;

  let resolvedName = parsed?.name || '';
  let setInfo = parsed?.setId || '';

  if (!resolvedName && setInfo) {
    resolvedName = label;
    setInfo = '';
  } else if (!resolvedName && !setInfo) {
    resolvedName = label;
  }

  const setIdOnlyPattern = /^[A-Z]{2,4}\s+\d+[A-Za-z]?$/i;
  if (setIdOnlyPattern.test(resolvedName) && cardIdentifier) {
    const baseName = getBaseName(cardIdentifier);
    if (baseName && !setIdOnlyPattern.test(baseName)) {
      resolvedName = baseName;
      setInfo = displayName || '';
    }
  }

  const nameSpan = document.createElement('span');
  nameSpan.className = 'card-title-name';
  nameSpan.textContent = resolvedName;
  cardTitleEl.appendChild(nameSpan);

  if (setInfo) {
    const setSpan = document.createElement('span');
    setSpan.className = 'card-title-set';
    setSpan.textContent = setInfo;
    cardTitleEl.appendChild(setSpan);
  }

  document.title = `${resolvedName} – Ciphermaniac`;
}

export function updateSearchLink() {
  const searchInGrid = document.getElementById('search-in-grid') as HTMLAnchorElement | null;
  if (!searchInGrid) {
    return;
  }
  if (cardName) {
    searchInGrid.href = `/cards?q=${encodeURIComponent(cardName)}`;
  } else {
    searchInGrid.href = '/cards';
  }
}

export function syncSearchInputValue(cardSearchInput: HTMLInputElement | null, shouldPrefillSearch: boolean) {
  if (!cardSearchInput || !cardName) {
    return;
  }
  if (!shouldPrefillSearch) {
    return;
  }
  if (document.activeElement === cardSearchInput) {
    return;
  }
  cardSearchInput.value = cardName;
}

export function retryHeroImage(resolvedCardName: string) {
  const hero = document.getElementById('card-hero');
  const img = hero?.querySelector('img') as HTMLImageElement | null;
  if (!hero || !img) {
    return;
  }

  if (img.naturalWidth > 0 && img.style.opacity === '1') {
    return;
  }

  const { name, setId } = parseDisplayName(resolvedCardName);
  let variant: VariantInfo = {};
  if (setId) {
    const setMatch = setId.match(/^([A-Z]+)\s+(\d+[A-Za-z]?)$/);
    if (setMatch) {
      variant = { set: setMatch[1], number: setMatch[2] };
    }
  }

  img.alt = resolvedCardName;

  const newCandidates = buildThumbCandidates(name, true, {}, variant);
  if (newCandidates.length === 0) {
    return;
  }

  const variantLgUrl = buildLgUrlFromVariant(variant);
  (img as any)._fullResUrl = variantLgUrl || null;

  const state = (img as any)._loadingState;
  if (state) {
    state.candidates = newCandidates;
    state.idx = 0;
    state.loading = false;
    state.fallbackAttempted = false;

    const wrap = img.closest('.thumb') as HTMLElement | null;
    if (wrap) {
      enableHeroImageModal(wrap, img, variantLgUrl, resolvedCardName);
    }

    img.src = state.candidates[state.idx++];
  }
}

export function setupImmediateUI() {
  const chartEl = document.getElementById('card-chart');
  if (chartEl) {
    showSkeleton(chartEl, createChartSkeleton('180px'));
  }

  if (copiesSection) {
    showSkeleton(copiesSection, createHistogramSkeleton());
  }

  if (eventsSection) {
    showSkeleton(eventsSection, createEventsTableSkeleton());
  }

  const hero = document.getElementById('card-hero');
  if (hero && cardName) {
    const existingThumb = hero.querySelector('.thumb');
    const skeletonImage = existingThumb?.querySelector('.skeleton-image');

    const img = document.createElement('img');
    img.alt = cardName;
    img.decoding = 'async';
    img.loading = 'eager';
    img.fetchPriority = 'high';
    img.style.opacity = '0';
    img.style.transition = 'opacity .18s ease-out';

    const wrap = document.createElement('div');
    wrap.className = 'thumb';
    wrap.style.position = 'relative';
    wrap.appendChild(img);

    if (skeletonImage instanceof HTMLElement) {
      skeletonImage.style.transition = 'opacity 0.15s ease-out';
      skeletonImage.style.opacity = '0';

      setTimeout(() => {
        hero.innerHTML = '';
        hero.appendChild(wrap);
        hero.removeAttribute('aria-hidden');
      }, 150);
    } else {
      hero.innerHTML = '';
      hero.appendChild(wrap);
      hero.removeAttribute('aria-hidden');
    }

    (img as any)._loadingState = {
      candidates: [],
      idx: 0,
      loading: false,
      fallbackAttempted: false
    };

    const tryNextImage = async () => {
      const state = (img as any)._loadingState;
      if (state.loading) {
        return;
      }

      if (state.idx >= state.candidates.length && !state.fallbackAttempted) {
        state.fallbackAttempted = true;
        try {
          const fallbackCandidates = await getVariantImageCandidates(cardIdentifier!, true, {});
          if (fallbackCandidates.length > 0) {
            state.candidates.push(...fallbackCandidates);
            if (state.idx < state.candidates.length) {
              state.loading = true;
              img.src = state.candidates[state.idx++];
            }
          }
        } catch {
          // Silently continue if fallback fails
        }
        return;
      }

      if (state.idx >= state.candidates.length) {
        return;
      }

      state.loading = true;
      img.src = state.candidates[state.idx++];
    };

    img.onerror = () => {
      (img as any)._loadingState.loading = false;
      tryNextImage();
    };

    const assignHiResCandidate = () => {
      const currentSrc = img.currentSrc || img.src;
      const derived = deriveLgUrlFromCandidate(currentSrc);
      if (derived) {
        (img as any)._fullResUrl = derived;
      } else if (!(img as any)._fullResUrl) {
        (img as any)._fullResUrl = currentSrc;
      }
    };

    img.onload = () => {
      img.style.opacity = '1';
      assignHiResCandidate();
    };

    const { name, setId } = parseDisplayName(cardName);
    let variant: VariantInfo = {};
    if (setId) {
      const setMatch = setId.match(/^([A-Z]+)\s+(\d+[A-Za-z]?)$/);
      if (setMatch) {
        variant = { set: setMatch[1], number: setMatch[2] };
      }
    }

    const variantLgUrl = buildLgUrlFromVariant(variant);
    (img as any)._fullResUrl = variantLgUrl || null;

    enableHeroImageModal(wrap, img, variantLgUrl, cardName);

    const defaultCandidates = buildThumbCandidates(name, true, {}, variant);
    (img as any)._loadingState.candidates = defaultCandidates;
    tryNextImage();
  }
}

const ONLINE_BANNER_STYLES = `
.online-only-banner {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.65rem 0.9rem;
  border-radius: 8px;
  border: 1px solid rgba(106, 163, 255, 0.25);
  background: rgba(106, 163, 255, 0.06);
  margin-bottom: 0.75rem;
  animation: fadeIn 0.25s ease-out;
}
.online-only-banner__icon {
  flex-shrink: 0;
  color: var(--accent-2, #6aa3ff);
}
.online-only-banner__text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.85rem;
  line-height: 1.4;
}
.online-only-banner__text strong {
  color: var(--text, #eef1f7);
  font-size: 0.9rem;
}
.online-only-banner__text span {
  color: var(--muted, #a3a8b7);
}
.online-stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  padding: 1.5rem 1rem;
  text-align: center;
}
.online-stat-value {
  font-size: 2.8rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--accent-2, #6aa3ff);
  line-height: 1;
}
.online-stat-label {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted, #a3a8b7);
  margin-top: 0.25rem;
}
.online-stat-context {
  font-size: 0.85rem;
  color: var(--muted, #a3a8b7);
}
`;

function ensureOnlineBannerStyles(): void {
  if (!document.getElementById('online-banner-style')) {
    const style = document.createElement('style');
    style.id = 'online-banner-style';
    style.textContent = ONLINE_BANNER_STYLES;
    document.head.appendChild(style);
  }
}

export function renderOnlineOnlyBanner(): void {
  ensureOnlineBannerStyles();

  const cardCenter = document.getElementById('card-center');
  if (!cardCenter) {
    return;
  }

  if (cardCenter.querySelector('.online-only-banner')) {
    return;
  }

  const banner = document.createElement('div');
  banner.className = 'online-only-banner';
  banner.innerHTML = `
    <svg class="online-only-banner__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    <div class="online-only-banner__text">
      <strong>Online Usage Data</strong>
      <span>This card has online tournament usage but hasn't appeared in Day 2 of a physical Regional or International yet.</span>
    </div>
  `;

  const chart = document.getElementById('card-chart');
  if (chart) {
    cardCenter.insertBefore(banner, chart);
  } else {
    cardCenter.prepend(banner);
  }
}
