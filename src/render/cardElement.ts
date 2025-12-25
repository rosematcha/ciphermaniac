/**
 * Card element creation and management for the grid renderer.
 * Contains all functions related to creating, populating, and managing individual card DOM elements.
 */
import { buildThumbCandidates } from '../thumbs.js';
import { buildCardPath, normalizeCardNumber } from '../card/routing.js';
import { trackMissing } from '../dev/missingThumbs.js';
import { parallelImageLoader } from '../utils/parallelImageLoader.js';
import { createElement, setStyles } from '../utils/dom.js';
import { escapeHtml } from '../utils/html.js';
import type { CardItem } from '../types/index.js';
import type { RenderOptions } from './types.js';

// Currency formatter for card prices
const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/**
 * Format a card price for display
 */
export function formatCardPrice(rawPrice: number | undefined | null): string | null {
  if (typeof rawPrice === 'number' && Number.isFinite(rawPrice)) {
    return USD_FORMATTER.format(rawPrice);
  }
  return null;
}

// Lightweight floating tooltip used for card histograms
let __gridGraphTooltip: HTMLElement | null = null;

function ensureGridTooltip(): HTMLElement {
  if (__gridGraphTooltip) {
    return __gridGraphTooltip;
  }
  const tooltip = document.createElement('div');
  tooltip.className = 'graph-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('aria-live', 'polite');
  tooltip.id = 'grid-tooltip';
  tooltip.style.position = 'fixed';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.zIndex = '9999';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);
  __gridGraphTooltip = tooltip;
  return tooltip;
}

export function showGridTooltip(html: string, x: number, y: number): void {
  const tooltip = ensureGridTooltip();
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  const offsetX = 12;
  const offsetY = 12;
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  let left = x + offsetX;
  let top = y + offsetY;
  const rect = tooltip.getBoundingClientRect();
  if (left + rect.width > vw) {
    left = Math.max(8, x - rect.width - offsetX);
  }
  if (top + rect.height > vh) {
    top = Math.max(8, y - rect.height - offsetY);
  }
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

export function hideGridTooltip(): void {
  if (__gridGraphTooltip) {
    __gridGraphTooltip.style.display = 'none';
  }
}

/**
 * Helper to extract usage percent from card data
 */
export function getCardUsagePercent(card: CardItem): number {
  if (Number.isFinite(card.pct)) {
    return Number(card.pct);
  }
  if (Number.isFinite(card.found) && Number.isFinite(card.total) && card.total > 0) {
    return (card.found / card.total) * 100;
  }
  return 0;
}

/**
 * Setup card attributes on the DOM element
 */
export function setupCardAttributes(card: HTMLElement, cardData: CardItem): void {
  if (cardData.name) {
    card.dataset.name = cardData.name.toLowerCase();
  } else {
    delete card.dataset.name;
  }
  const categorySlug = typeof cardData.category === 'string' ? cardData.category : '';
  if (categorySlug) {
    card.dataset.category = categorySlug;
  } else {
    delete card.dataset.category;
  }
  if (cardData.trainerType) {
    card.dataset.trainerType = cardData.trainerType;
  } else {
    delete card.dataset.trainerType;
  }
  if (cardData.energyType) {
    card.dataset.energyType = cardData.energyType;
  } else {
    delete card.dataset.energyType;
  }
  const baseCategory = categorySlug.split('/')[0] || '';
  if (baseCategory) {
    card.dataset.categoryPrimary = baseCategory;
  } else {
    delete card.dataset.categoryPrimary;
  }
  if (cardData.uid) {
    card.dataset.uid = cardData.uid;
  } else {
    delete card.dataset.uid;
  }
  const setCode = cardData.set ? String(cardData.set).toUpperCase() : '';
  const number = cardData.number ? normalizeCardNumber(cardData.number) : '';
  if (setCode && number) {
    card.dataset.cardId = `${setCode}~${number}`;
  } else {
    delete card.dataset.cardId;
  }
  // Store usage percent for CSS-based visibility filtering (avoids DOM rebuild on threshold change)
  const pct = getCardUsagePercent(cardData);
  if (Number.isFinite(pct)) {
    card.dataset.pct = String(pct);
  } else {
    delete card.dataset.pct;
  }
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  // Make aria-label more descriptive with usage percentage when available
  const pctText = cardData.pct != null ? `${cardData.pct.toFixed(1)}% usage` : '';
  const setInfo = cardData.set && cardData.number ? ` ${cardData.set} ${cardData.number}` : '';
  card.setAttribute('aria-label', `${cardData.name}${setInfo}${pctText ? `, ${pctText}` : ''}, click for details`);
  card.setAttribute('aria-roledescription', 'card');
}

/**
 * Setup counts display on the card
 */
export function setupCardCounts(element: DocumentFragment | HTMLElement, cardData: CardItem): void {
  const counts = element.querySelector('.counts');

  if (!counts) {
    return;
  }

  // Remove any skeleton elements and classes
  counts.querySelectorAll('.skeleton-text').forEach(skeleton => skeleton.remove());
  counts.classList.remove('skeleton-text');
  counts.innerHTML = '';

  const hasValidCounts = Number.isFinite(cardData.found) && Number.isFinite(cardData.total);
  const countsText = createElement('span', {
    textContent: hasValidCounts ? `${cardData.found} / ${cardData.total} decks` : 'no data'
  });
  counts.appendChild(countsText);
}

/**
 * Setup card image with fallback handling
 */
export function setupCardImage(
  img: HTMLImageElement | null,
  cardName: string,
  useSm: boolean,
  overrides: Record<string, string>,
  cardData: CardItem
): void {
  if (!img) {
    return;
  }

  // Remove any skeleton classes and elements from the thumb container
  const thumbContainer = img.closest('.thumb');
  if (thumbContainer) {
    // Remove skeleton image if it exists
    const skeletonImg = thumbContainer.querySelector('.skeleton-img');
    if (skeletonImg) {
      skeletonImg.remove();
    }
    // Remove skeleton-loading class
    thumbContainer.classList.remove('skeleton-loading');
  }

  // Only pass variant info if cardData exists and has both set and number
  const variant =
    cardData && cardData.set && cardData.number ? { set: cardData.set, number: cardData.number } : undefined;

  const candidates = buildThumbCandidates(cardName, useSm, overrides, variant);

  // Use parallel image loader for better performance
  parallelImageLoader.setupImageElement(img, candidates, {
    alt: cardName,
    fadeIn: false, // Disabled to prevent flashing on re-render
    maxParallel: 3, // Try first 3 candidates in parallel
    onFailure: () => {
      // Track missing images for debugging
      trackMissing(cardName, useSm, overrides);
    }
  });
}

/**
 * Populate card content with data
 */
export function populateCardContent(
  el: DocumentFragment | HTMLElement,
  cardData: CardItem,
  renderFlags: RenderOptions = {}
): void {
  // Remove skeleton classes from the card element itself
  // el could be the card directly or a fragment containing the card
  let card: HTMLElement | null = null;
  if (el instanceof HTMLElement && el.classList.contains('card')) {
    card = el; // el is the card itself
  } else if (el.querySelector) {
    card = el.querySelector('.card'); // el is a fragment, find the card
  }

  const shouldShowPrice = Boolean(renderFlags.showPrice);
  const formattedPrice = shouldShowPrice ? formatCardPrice(cardData.price) : null;

  if (card) {
    card.classList.remove('skeleton-card');
    card.removeAttribute('aria-hidden');
    card.classList.toggle('has-price', shouldShowPrice);

    const thumb = card.querySelector('.thumb');
    if (thumb) {
      let priceBadge = thumb.querySelector('.price-badge') as HTMLElement | null;
      if (shouldShowPrice) {
        if (!priceBadge) {
          priceBadge = document.createElement('div');
          priceBadge.className = 'price-badge';
          thumb.appendChild(priceBadge);
        }
        priceBadge.textContent = formattedPrice ?? '—';
        priceBadge.classList.toggle('price-badge--missing', !formattedPrice);
        priceBadge.setAttribute('aria-label', formattedPrice ? `Price ${formattedPrice}` : 'Price unavailable');
        priceBadge.setAttribute('role', 'status');
        priceBadge.title = formattedPrice ?? 'Price unavailable';
      } else if (priceBadge) {
        priceBadge.remove();
      }
    }
  }

  // Calculate percentage once
  const pct = Number.isFinite(cardData.pct)
    ? cardData.pct
    : cardData.total
      ? (100 * cardData.found) / cardData.total
      : 0;

  const pctText = Number.isFinite(pct) ? `${pct.toFixed(1)}%` : '—';
  const widthPct = `${Math.max(0, Math.min(100, pct))}%`;

  // Update count badge with most frequent count
  const countBadge = el.querySelector('.count-badge') as HTMLElement | null;
  if (countBadge && cardData.dist && cardData.dist.length > 0) {
    // Find the distribution entry with the highest percentage
    const mostFrequent = cardData.dist.reduce((max, current) => {
      const currentPct = current.percent ?? 0;
      const maxPct = max.percent ?? 0;
      if (currentPct > maxPct) {
        return current;
      }
      return max;
    });
    const mfCopies = mostFrequent.copies ?? 0;
    const mfPercent = mostFrequent.percent ?? 0;
    countBadge.textContent = String(mfCopies);
    countBadge.title = `Most common: ${mfCopies}x (${mfPercent.toFixed(1)}%)`;
  } else if (countBadge) {
    // Hide badge if no distribution data
    countBadge.style.display = 'none';
  }

  // Update name element - remove skeleton and set real content
  const nameEl = el.querySelector('.name') as HTMLElement | null;
  if (nameEl) {
    // Remove any existing skeleton-text elements and classes
    nameEl.querySelectorAll('.skeleton-text').forEach(skeleton => skeleton.remove());
    nameEl.classList.remove('skeleton-text');

    // Clear existing content
    nameEl.innerHTML = '';

    // Create the main name text
    const nameText = document.createElement('span');
    nameText.textContent = cardData.name;
    nameEl.appendChild(nameText);

    // Add set ID and number in smaller, de-emphasized text if available
    if (cardData.set && cardData.number) {
      const setSpan = document.createElement('span');
      setSpan.className = 'card-title-set';
      setSpan.textContent = `${cardData.set} ${cardData.number}`;
      nameEl.appendChild(setSpan);
    }

    // Set tooltip with full card name and set info if available
    const tooltipText =
      cardData.set && cardData.number ? `${cardData.name} ${cardData.set} ${cardData.number}` : cardData.name;
    nameEl.title = tooltipText;
  }

  // Update percentage display - remove skeleton elements
  const barEl = el.querySelector('.bar') as HTMLElement | null;
  const pctEl = el.querySelector('.pct') as HTMLElement | null;

  if (barEl) {
    barEl.classList.remove('skeleton-usage-bar');
    barEl.style.width = widthPct;
  }

  if (pctEl) {
    // Remove skeleton text elements and classes
    pctEl.querySelectorAll('.skeleton-text').forEach(skeleton => skeleton.remove());
    pctEl.classList.remove('skeleton-text', 'small');
    pctEl.textContent = pctText;
  }

  // Update usage tooltip
  const usageEl = el.querySelector('.usagebar') as HTMLElement | null;
  if (usageEl) {
    const haveCounts = Number.isFinite(cardData.found) && Number.isFinite(cardData.total);
    const countsText = haveCounts ? ` (${cardData.found}/${cardData.total} decks)` : '';
    usageEl.title = `Played ${pctText}${countsText}`;
  }
}

/**
 * Setup tooltip for histogram columns
 */
function setupHistogramTooltip(col: HTMLElement, cardName: string, tip: string): void {
  col.setAttribute('tabindex', '0');
  col.setAttribute('role', 'img');
  col.setAttribute('aria-label', tip);
  col.setAttribute('aria-describedby', 'grid-tooltip');

  const showTooltip = (ev: MouseEvent) =>
    showGridTooltip(
      `<strong>${escapeHtml(cardName)}</strong><div>${escapeHtml(tip)}</div>`,
      ev.clientX || 0,
      ev.clientY || 0
    );

  col.addEventListener('mousemove', showTooltip);
  col.addEventListener('mouseenter', showTooltip);
  col.addEventListener('mouseleave', hideGridTooltip);
  col.addEventListener('blur', hideGridTooltip);
  col.addEventListener('focus', (_ev: FocusEvent) => {
    const rect = col.getBoundingClientRect();
    showGridTooltip(
      `<strong>${escapeHtml(cardName)}</strong><div>${escapeHtml(tip)}</div>`,
      rect.left + rect.width / 2,
      rect.top
    );
  });
}

/**
 * Create histogram visualization for card distribution
 */
export function createCardHistogram(el: DocumentFragment | HTMLElement, cardData: CardItem): void {
  const hist = el.querySelector('.hist');

  if (hist) {
    // Remove skeleton elements and classes
    hist.querySelectorAll('.skeleton-bar').forEach(skeleton => skeleton.remove());
    hist.classList.remove('skeleton-loading');
    hist.innerHTML = '';

    if (!cardData.dist || !cardData.dist.length) {
      return;
    }
  } else {
    return;
  }

  // Sort distribution by percentage (descending) and take top 4
  const sortedDist = [...cardData.dist].sort((itemA, itemB) => (itemB.percent ?? 0) - (itemA.percent ?? 0));
  const topFourDist = sortedDist.slice(0, 4);

  // Get the copy counts we're showing and sort them for display
  const copiesToShow = topFourDist.map(distItem => distItem.copies ?? 0).sort((countA, countB) => countA - countB);
  const maxPct = Math.max(1, ...topFourDist.map(distItem => distItem.percent ?? 0));

  for (const copies of copiesToShow) {
    const distData = cardData.dist!.find(x => x.copies === copies);
    const col = createElement('div', { className: 'col' });
    const bar = createElement('div', { className: 'bar' });
    const lbl = createElement('div', {
      className: 'lbl',
      textContent: String(copies)
    });

    const distPct = distData?.percent ?? 0;
    const height = distData ? Math.max(2, Math.round(54 * (distPct / maxPct))) : 2;
    setStyles(bar, {
      height: `${height}px`,
      ...(distData ? {} : { opacity: '0.25' })
    });

    // Setup tooltip
    if (distData) {
      const total = Number.isFinite(cardData.total) ? cardData.total : null;
      const players = Number.isFinite(distData.players) ? distData.players : undefined;
      const exactPct = Number.isFinite(distData.percent)
        ? distData.percent
        : players !== undefined && total
          ? (100 * players) / total
          : undefined;
      const pctStr = exactPct !== undefined ? `${exactPct.toFixed(1)}%` : '—';
      const countsStr = players !== undefined && total !== null ? ` (${players}/${total})` : '';
      const tip = `${copies}x: ${pctStr}${countsStr}`;

      setupHistogramTooltip(col, cardData.name, tip);
    } else {
      const tip = `${copies}x: 0%`;
      setupHistogramTooltip(col, cardData.name, tip);
    }

    col.appendChild(bar);
    col.appendChild(lbl);
    hist.appendChild(col);
  }
}

/**
 * Attach click/keyboard navigation to card
 */
export function attachCardNavigation(card: HTMLElement, cardData: CardItem): void {
  const cardIdentifier = cardData.uid || cardData.name;
  const url = buildCardPath(cardIdentifier);

  card.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey) {
      window.open(url, '_blank');
    } else {
      location.assign(url);
    }
  });

  card.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      location.assign(url);
    }
  });
}

/**
 * Create a complete card DOM element from card data
 */
export function makeCardElement(
  cardData: CardItem,
  useSm: boolean,
  overrides: Record<string, string>,
  renderFlags: RenderOptions = {},
  previousCardIds: Set<string> | null = null
): HTMLElement {
  const template = document.getElementById('card-template') as HTMLTemplateElement | null;
  const fragment = template
    ? (template.content.cloneNode(true) as DocumentFragment)
    : document.createDocumentFragment();

  let card = fragment.querySelector('.card') as HTMLElement | null;

  if (!(card instanceof HTMLElement)) {
    card = document.createElement('div');
    card.className = 'card';
    fragment.appendChild(card);
  }

  // Mark card as newly entering for animation only if it wasn't visible before
  if (previousCardIds) {
    const { uid } = cardData;
    const setCode = cardData.set ? String(cardData.set).toUpperCase() : '';
    const number = cardData.number ? normalizeCardNumber(cardData.number) : '';
    const cardId = setCode && number ? `${setCode}~${number}` : null;
    const name = cardData.name ? cardData.name.toLowerCase() : null;

    const wasVisible =
      (uid && previousCardIds.has(uid)) ||
      (cardId && previousCardIds.has(cardId)) ||
      (name && previousCardIds.has(name));

    if (!wasVisible) {
      card.classList.add('card-entering');

      // Remove the entering class after animation completes
      // Using { once: true } to automatically remove the listener and prevent memory leaks
      card.addEventListener(
        'animationend',
        () => {
          card.classList.remove('card-entering');
        },
        { once: true }
      );
    }
  }

  // Setup card attributes
  setupCardAttributes(card, cardData);

  // Setup image
  const img = fragment.querySelector('img') as HTMLImageElement | null;
  setupCardImage(img, cardData.name, useSm, overrides, cardData);

  // Populate content
  populateCardContent(fragment, cardData, renderFlags);
  setupCardCounts(fragment, cardData);
  createCardHistogram(fragment, cardData);

  // Attach behavior
  attachCardNavigation(card, cardData);

  return card;
}
