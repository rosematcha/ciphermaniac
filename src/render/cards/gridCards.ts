import { buildThumbCandidates } from '../../thumbs.js';
import { buildCardPath, normalizeCardNumber } from '../../card/routing.js';
import { trackMissing } from '../../dev/missingThumbs.js';
import { parallelImageLoader } from '../../utils/parallelImageLoader.js';
import { createElement, setStyles } from '../../utils/dom.js';
import type { CardItem } from '../../types/index.js';
import type { RenderOptions } from '../types.js';
import { formatCardPrice } from '../cardElement.js';

function shouldPreferLowQuality(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const { connection } = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } };
  if (connection?.saveData) {
    return true;
  }
  const effectiveType = connection?.effectiveType || '';
  return effectiveType === '2g' || effectiveType === 'slow-2g';
}

/**
 * Initialize the card image element with lazy loading and fallbacks.
 * @param img - Image element.
 * @param cardName - Card name.
 * @param useSm - Whether to prefer small images.
 * @param overrides - Image override map.
 * @param cardData - Card data.
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

  const thumbContainer = img.closest('.thumb');
  if (thumbContainer) {
    const skeletonImg = thumbContainer.querySelector('.skeleton-img');
    if (skeletonImg) {
      skeletonImg.remove();
    }
    thumbContainer.classList.remove('skeleton-loading');
  }

  const variant =
    cardData && cardData.set && cardData.number ? { set: cardData.set, number: cardData.number } : undefined;

  const preferLowQuality = shouldPreferLowQuality();
  const resolvedUseSm = preferLowQuality ? true : useSm;
  const candidates = buildThumbCandidates(cardName, resolvedUseSm, overrides, variant);

  parallelImageLoader.setupImageElement(img, candidates, {
    alt: cardName,
    fadeIn: false,
    maxParallel: preferLowQuality ? 2 : 3,
    onFailure: () => {
      trackMissing(cardName, resolvedUseSm, overrides);
    },
    deferUntilVisible: true
  });
}

/**
 * Populate a card element with data and markup.
 * @param el - Card container.
 * @param cardData - Card data.
 * @param renderFlags - Rendering options.
 */
export function populateCardContent(
  el: DocumentFragment | HTMLElement,
  cardData: CardItem,
  renderFlags: RenderOptions = {}
): void {
  let card: HTMLElement | null = null;
  if (el instanceof HTMLElement && el.classList.contains('card')) {
    card = el;
  } else if (el.querySelector) {
    card = el.querySelector('.card');
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
        priceBadge.textContent = formattedPrice ?? '-';
        priceBadge.classList.toggle('price-badge--missing', !formattedPrice);
        priceBadge.setAttribute('aria-label', formattedPrice ? `Price ${formattedPrice}` : 'Price unavailable');
        priceBadge.setAttribute('role', 'status');
        priceBadge.title = formattedPrice ?? 'Price unavailable';
      } else if (priceBadge) {
        priceBadge.remove();
      }
    }
  }

  const pct = Number.isFinite(cardData.pct)
    ? cardData.pct
    : cardData.total
      ? (100 * cardData.found) / cardData.total
      : 0;

  const pctText = Number.isFinite(pct) ? `${pct.toFixed(1)}%` : '-';
  const widthPct = `${Math.max(0, Math.min(100, pct))}%`;

  const countBadge = el.querySelector('.count-badge') as HTMLElement | null;
  if (countBadge && cardData.dist && cardData.dist.length > 0) {
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
    countBadge.style.display = 'none';
  }

  const nameEl = el.querySelector('.name') as HTMLElement | null;
  if (nameEl) {
    nameEl.querySelectorAll('.skeleton-text').forEach(skeleton => skeleton.remove());
    nameEl.classList.remove('skeleton-text');
    nameEl.innerHTML = '';

    const nameText = document.createElement('span');
    nameText.textContent = cardData.name;
    nameEl.appendChild(nameText);

    if (cardData.set && cardData.number) {
      const setSpan = document.createElement('span');
      setSpan.className = 'card-title-set';
      setSpan.textContent = `${cardData.set} ${cardData.number}`;
      nameEl.appendChild(setSpan);
    }

    const tooltipText =
      cardData.set && cardData.number ? `${cardData.name} ${cardData.set} ${cardData.number}` : cardData.name;
    nameEl.title = tooltipText;
  }

  const barEl = el.querySelector('.bar') as HTMLElement | null;
  const pctEl = el.querySelector('.pct') as HTMLElement | null;

  if (barEl) {
    barEl.classList.remove('skeleton-usage-bar');
    barEl.style.width = widthPct;
  }

  if (pctEl) {
    pctEl.querySelectorAll('.skeleton-text').forEach(skeleton => skeleton.remove());
    pctEl.classList.remove('skeleton-text', 'small');
    pctEl.textContent = pctText;
  }

  const usageEl = el.querySelector('.usagebar') as HTMLElement | null;
  if (usageEl) {
    const haveCounts = Number.isFinite(cardData.found) && Number.isFinite(cardData.total);
    const countsText = haveCounts ? ` (${cardData.found}/${cardData.total} decks)` : '';
    usageEl.title = `Played ${pctText}${countsText}`;
  }
}

/**
 * Render the histogram for a card.
 * @param el - Card container.
 * @param cardData - Card data.
 */
export function createCardHistogram(el: DocumentFragment | HTMLElement, cardData: CardItem): void {
  const hist = el.querySelector('.hist');

  if (hist) {
    hist.querySelectorAll('.skeleton-bar').forEach(skeleton => skeleton.remove());
    hist.classList.remove('skeleton-loading');
    hist.innerHTML = '';

    if (!cardData.dist || !cardData.dist.length) {
      return;
    }
  } else {
    return;
  }

  const sortedDist = [...cardData.dist].sort((itemA, itemB) => (itemB.percent ?? 0) - (itemA.percent ?? 0));
  const topFourDist = sortedDist.slice(0, 4);
  const copiesToShow = topFourDist.map(distItem => distItem.copies ?? 0).sort((countA, countB) => countA - countB);
  const maxPct = Math.max(1, ...topFourDist.map(distItem => distItem.percent ?? 0));

  for (const copies of copiesToShow) {
    const distData = cardData.dist?.find(x => x.copies === copies);
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

    if (distData) {
      const total = Number.isFinite(cardData.total) ? cardData.total : null;
      const players = Number.isFinite(distData.players) ? distData.players : undefined;
      const exactPct = Number.isFinite(distData.percent)
        ? distData.percent
        : players !== undefined && total
          ? (100 * players) / total
          : undefined;
      const pctStr = exactPct !== undefined ? `${exactPct.toFixed(1)}%` : '-';
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

/** Setup tooltip for histogram columns via data attributes (event delegation handles listeners) */
function setupHistogramTooltip(col: HTMLElement, cardName: string, tip: string): void {
  const column = col;
  column.setAttribute('tabindex', '0');
  column.setAttribute('role', 'img');
  column.setAttribute('aria-label', tip);
  column.setAttribute('aria-describedby', 'grid-tooltip');
  column.dataset.cardName = cardName;
  column.dataset.tip = tip;
}

/**
 * Attach navigation handlers for a card element.
 * @param card - Card element.
 * @param cardData - Card data.
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
 * Build a card element for the grid.
 * @param cardData - Card data.
 * @param useSm - Whether to use small images.
 * @param overrides - Image override map.
 * @param renderFlags - Rendering options.
 * @param previousCardIds - Previously rendered card ids.
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

      card.addEventListener(
        'animationend',
        () => {
          card.classList.remove('card-entering');
        },
        { once: true }
      );
    }
  }

  setupCardAttributes(card, cardData);

  const img = fragment.querySelector('img') as HTMLImageElement | null;
  setupCardImage(img, cardData.name, useSm, overrides, cardData);

  populateCardContent(fragment, cardData, renderFlags);
  setupCardCounts(fragment, cardData);
  createCardHistogram(fragment, cardData);

  attachCardNavigation(card, cardData);

  return card;
}

/**
 * Assign dataset and accessibility attributes on the card element.
 * @param card - Card element.
 * @param cardData - Card data.
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
  const pct = getCardUsagePercent(cardData);
  if (Number.isFinite(pct)) {
    card.dataset.pct = String(pct);
  } else {
    delete card.dataset.pct;
  }
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  const pctText = cardData.pct != null ? `${cardData.pct.toFixed(1)}% usage` : '';
  const setInfo = cardData.set && cardData.number ? ` ${cardData.set} ${cardData.number}` : '';
  card.setAttribute('aria-label', `${cardData.name}${setInfo}${pctText ? `, ${pctText}` : ''}, click for details`);
  card.setAttribute('aria-roledescription', 'card');
}

/**
 * Resolve the usage percent for a card.
 * @param card - Card data.
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
 * Populate the count summary for a card.
 * @param element - Card container.
 * @param cardData - Card data.
 */
export function setupCardCounts(element: DocumentFragment | HTMLElement, cardData: CardItem): void {
  const counts = element.querySelector('.counts');

  if (!counts) {
    return;
  }

  counts.querySelectorAll('.skeleton-text').forEach(skeleton => skeleton.remove());
  counts.classList.remove('skeleton-text');
  counts.innerHTML = '';

  const hasValidCounts = Number.isFinite(cardData.found) && Number.isFinite(cardData.total);
  const countsText = createElement('span', {
    textContent: hasValidCounts ? `${cardData.found} / ${cardData.total} decks` : 'no data'
  });
  counts.appendChild(countsText);
}
