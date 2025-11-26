/* eslint-env browser */
import './utils/buildVersion.js';
import { fetchArchetypeReport, fetchArchetypesList, fetchReport } from './api.js';
import { parseReport } from './parse.js';
import { safeAsync } from './utils/errorHandler.js';
import { logger } from './utils/logger.js';

const { document, HTMLElement, HTMLImageElement } = globalThis;

const elements = {
  container: document.querySelector('.analysis-page'),
  eventName: document.getElementById('analysis-event-name'),
  archetypeList: document.getElementById('analysis-archetype-list'),
  listLoading: document.getElementById('analysis-list-loading'),
  listEmpty: document.getElementById('analysis-list-empty')
  // listSummary removed
};

const templates = {
  listItem: /** @type {globalThis.HTMLTemplateElement|null} */ (document.getElementById('analysis-list-item'))
};

const state = {
  tournament: /** @type {string|null} */ (null),
  tournamentDeckTotal: 0,
  archetypes: /**
   * @type {Array<{name:string,label?:string,deckCount:number|null,percent:number|null,thumbnails?:string[]}>}
   */ ([]),
  cache: new Map()
};

function sanitizeCardNumber(rawNumber) {
  if (rawNumber == null) {
    return null;
  }

  const trimmed = String(rawNumber).trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.match(/^0*(\d+)([A-Za-z]*)$/);
  if (parts) {
    const [, digits, suffix = ''] = parts;
    const normalizedDigits = digits.replace(/^0+/, '') || '0';
    return `${normalizedDigits}${suffix}`;
  }

  return trimmed.replace(/^0+/, '') || '0';
}

function formatCardNumberForCdn(rawNumber) {
  const sanitized = sanitizeCardNumber(rawNumber);
  if (!sanitized) {
    return null;
  }

  const parts = sanitized.match(/^(\d+)([A-Za-z]*)$/);
  if (!parts) {
    return sanitized;
  }

  const [, digits, suffix = ''] = parts;
  const paddedDigits = digits.padStart(3, '0');
  return `${paddedDigits}${suffix}`;
}

function buildLimitlessCdnUrl(setCode, cardNumber, size = 'SM') {
  return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${setCode}/${setCode}_${cardNumber}_R_EN_${size}.png`;
}

function buildThumbnailSources(cardIds) {
  if (!Array.isArray(cardIds) || cardIds.length === 0) {
    return [];
  }

  return cardIds
    .map(cardId => {
      const [set, number] = cardId.split('/');
      return buildThumbnailSourceFromCard({ set, number });
    })
    .filter(Boolean);
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function buildThumbnailSourceFromCard(card) {
  if (!card || !card.set || !card.number) {
    return null;
  }

  const normalizedSet = String(card.set).toUpperCase().trim();
  const cdnNumber = formatCardNumberForCdn(card.number);
  if (!normalizedSet || !cdnNumber) {
    return null;
  }
  return buildLimitlessCdnUrl(normalizedSet, cdnNumber, 'SM');
}

function isSplitThumbnailConfig(cardIds) {
  return Array.isArray(cardIds) && cardIds.length >= 2;
}

function applySplitThumbnail(thumbnailEl, baseImgEl, fallbackEl, sources, usePlaceholder, deckName) {
  if (sources.length < 2) {
    usePlaceholder();
    return;
  }

  const baseImage = baseImgEl;
  baseImage.style.display = 'none';
  baseImage.dataset.cropped = '';
  baseImage.onload = null;
  baseImage.onerror = null;
  baseImage.removeAttribute('src');

  thumbnailEl.classList.remove('is-placeholder');
  thumbnailEl.classList.add('analysis-list-item__thumbnail--split');

  let splitWrapper = thumbnailEl.querySelector('.analysis-list-item__split');
  if (!(splitWrapper instanceof HTMLElement)) {
    splitWrapper = document.createElement('div');
    splitWrapper.className = 'analysis-list-item__split';
    thumbnailEl.insertBefore(splitWrapper, fallbackEl);
  }

  const handleError = () => {
    usePlaceholder();
  };

  splitWrapper.replaceChildren();
  for (let index = 0; index < Math.min(sources.length, 2); index += 1) {
    const src = sources[index];
    if (!src) {
      continue;
    }

    const slice = document.createElement('div');
    const orientation = index === 0 ? 'left' : 'right';
    slice.className = `analysis-list-item__slice analysis-list-item__slice--${orientation}`;

    const splitImg = document.createElement('img');
    splitImg.className = 'analysis-list-item__thumbnail-image analysis-list-item__thumbnail-image--split';
    splitImg.loading = 'lazy';
    splitImg.decoding = 'async';
    splitImg.alt = '';
    splitImg.onerror = handleError;

    // Auto-apply standard crop for split thumbnails
    const crop = index === 0 ? { x: 0, width: 0.5 } : { x: 0.5, width: 0.5 };
    applySplitCropStyles(splitImg, crop, orientation);

    splitImg.src = src;
    slice.appendChild(splitImg);
    splitWrapper.appendChild(slice);
  }

  if (!splitWrapper.hasChildNodes()) {
    usePlaceholder();
  }
}

function applySplitCropStyles(imgEl, crop, orientation) {
  const imageElement = imgEl;
  const defaultX = orientation === 'left' ? 0 : 0.5;
  const defaultWidth = 0.5;
  const defaultY = 0;
  const defaultHeight = 1;

  const x = clamp(typeof crop?.x === 'number' ? crop.x : defaultX, 0, 1);
  const width = clamp(typeof crop?.width === 'number' ? crop.width : defaultWidth, 0.05, 1 - x);
  const y = clamp(typeof crop?.y === 'number' ? crop.y : defaultY, 0, 1);
  const height = clamp(typeof crop?.height === 'number' ? crop.height : defaultHeight, 0.05, 1 - y);

  const leftInset = clamp(x * 100, 0, 100);
  const rightInset = clamp((1 - (x + width)) * 100, 0, 100);
  const topInset = clamp(y * 100, 0, 100);
  const bottomInset = clamp((1 - (y + height)) * 100, 0, 100);

  imageElement.style.position = 'absolute';
  imageElement.style.top = '0';
  imageElement.style.left = '0';
  imageElement.style.width = '100%';
  imageElement.style.height = '100%';
  imageElement.style.objectFit = 'cover';
  imageElement.style.objectPosition = '';
  imageElement.style.marginTop = '';
  imageElement.style.clipPath = `inset(${topInset}% ${rightInset}% ${bottomInset}% ${leftInset}%)`;
  imageElement.style.transformOrigin = '';
  imageElement.style.transform = 'none';
}

function getDeckFallbackText(rawName) {
  const words = rawName.replace(/_/g, ' ').split(/\s+/u).filter(Boolean);
  if (words.length === 0) {
    return '??';
  }
  return words
    .slice(0, 3)
    .map(word => word[0])
    .join('')
    .toUpperCase();
}

function applyDeckThumbnail(thumbnailEl, imgEl, fallbackEl, deckName, explicitCardIds = null) {
  const thumbnailElement = thumbnailEl;
  const imageElement = imgEl;
  const fallbackElement = fallbackEl;
  const cardIds = Array.isArray(explicitCardIds) ? explicitCardIds : [];
  const sources = buildThumbnailSources(cardIds);
  const fallbackText = getDeckFallbackText(deckName);

  fallbackElement.textContent = fallbackText;

  const clearSplitImages = () => {
    const splitWrapper = thumbnailElement.querySelector('.analysis-list-item__split');
    if (splitWrapper) {
      splitWrapper.remove();
    }
    thumbnailElement.classList.remove('analysis-list-item__thumbnail--split');
  };

  const usePlaceholder = () => {
    clearSplitImages();
    thumbnailElement.classList.add('is-placeholder');
    imageElement.style.display = '';
    imageElement.dataset.cropped = '';
    imageElement.onload = null;
    imageElement.onerror = null;
    imageElement.removeAttribute('src');
  };

  if (sources.length === 0) {
    usePlaceholder();
    return;
  }

  if (isSplitThumbnailConfig(cardIds)) {
    applySplitThumbnail(thumbnailElement, imageElement, fallbackElement, sources, usePlaceholder, deckName);
    return;
  }

  clearSplitImages();
  thumbnailElement.classList.remove('is-placeholder');
  imageElement.style.display = 'block';
  imageElement.dataset.cropped = '';
  imageElement.alt = '';
  imageElement.onerror = usePlaceholder;

  imageElement.onload = () => {
    // Image loaded successfully, ensure placeholder stays hidden
    thumbnailElement.classList.remove('is-placeholder');
  };

  imageElement.src = sources[0];
}

function assertElement(value, message) {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function updateContainerState(status) {
  if (!elements.container) {
    return;
  }
  elements.container.setAttribute('data-state', status);
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

// updateListSummary removed

function buildDetailUrl(archetype) {
  const safeName = encodeURIComponent(archetype);
  return `/archetype/${safeName}`;
}

function toggleLoading(isLoading) {
  if (elements.listLoading) {
    elements.listLoading.hidden = !isLoading;
  }
  if (elements.archetypeList) {
    elements.archetypeList.hidden = isLoading;
  }
  if (isLoading && elements.listEmpty) {
    elements.listEmpty.hidden = true;
  }
}

function renderList() {
  if (!elements.archetypeList || !templates.listItem) {
    return;
  }

  elements.archetypeList.innerHTML = '';

  if (state.archetypes.length === 0) {
    if (elements.listEmpty) {
      elements.listEmpty.hidden = false;
    }
    return;
  }

  const fragment = document.createDocumentFragment();

  state.archetypes.forEach(entry => {
    if (!entry || !entry.name) {
      return;
    }
    const node = templates.listItem.content.firstElementChild.cloneNode(true);
    const itemEl = /** @type {HTMLElement} */ (node);
    const anchor = assertElement(itemEl.querySelector('.analysis-list-item__button'), 'Missing archetype link');
    const previewEl = itemEl.querySelector('.analysis-list-item__preview');
    const thumbnailContainer = itemEl.querySelector('.analysis-list-item__thumbnail');
    const thumbnailImage = itemEl.querySelector('.analysis-list-item__thumbnail-image');
    const thumbnailFallback = itemEl.querySelector('.analysis-list-item__thumbnail-fallback');
    const nameEl = anchor.querySelector('.analysis-list-item__name');
    const pctEl = anchor.querySelector('.analysis-list-item__percent');
    const countEl = anchor.querySelector('.analysis-list-item__count');

    const deckName = entry.label || entry.name.replace(/_/g, ' ');

    anchor.href = buildDetailUrl(entry.name);
    anchor.dataset.archetype = entry.name;

    // Add hover event listeners for aggressive pre-caching
    setupArchetypeHoverHandlers(anchor, entry.name);

    if (
      previewEl &&
      thumbnailContainer instanceof HTMLElement &&
      thumbnailImage instanceof HTMLImageElement &&
      thumbnailFallback instanceof HTMLElement
    ) {
      applyDeckThumbnail(thumbnailContainer, thumbnailImage, thumbnailFallback, deckName, entry.thumbnails || []);
    } else if (previewEl instanceof HTMLElement) {
      previewEl.classList.add('analysis-list-item__preview--no-thumb');
    }

    if (nameEl) {
      nameEl.textContent = deckName;
    }
    if (pctEl) {
      pctEl.textContent = Number.isFinite(entry.percent) ? formatPercent(entry.percent || 0) : '—';
    }
    if (countEl) {
      if (Number.isFinite(entry.deckCount)) {
        const decks = Number(entry.deckCount);
        countEl.textContent = `${decks} deck${decks === 1 ? '' : 's'}`;
      } else {
        countEl.textContent = 'Deck count unavailable';
      }
    }

    fragment.appendChild(itemEl);
  });

  elements.archetypeList.appendChild(fragment);
  elements.archetypeList.hidden = false;
  if (elements.listEmpty) {
    elements.listEmpty.hidden = true;
  }
}

/**
 * Setup hover event handlers for aggressive pre-caching
 * @param {HTMLElement} element
 * @param {string} archetypeName
 */
function setupArchetypeHoverHandlers(element, archetypeName) {
  let hoverTimerId = null;
  const HOVER_DELAY_MS = 200;

  element.addEventListener('mouseenter', async () => {
    if (!state.tournament) {
      return;
    }

    // Clear any existing timer
    if (hoverTimerId) {
      clearTimeout(hoverTimerId);
    }

    // Start hover timer - will pre-fetch archetype report after 200ms
    hoverTimerId = setTimeout(async () => {
      try {
        if (!state.cache.has(archetypeName)) {
          logger.debug(`Pre-fetching archetype report for ${archetypeName}`);
          await loadArchetype(archetypeName);
        }
      } catch (error) {
        logger.debug(`Pre-fetch failed for ${archetypeName}`, error.message);
      }
    }, HOVER_DELAY_MS);
  });

  element.addEventListener('mouseleave', () => {
    // Clear hover timer if user moves away before delay expires
    if (hoverTimerId) {
      clearTimeout(hoverTimerId);
      hoverTimerId = null;
    }
  });
}

async function loadArchetype(name) {
  if (state.cache.has(name)) {
    return state.cache.get(name);
  }

  const tournament = assertElement(state.tournament, 'No tournament selected');
  const raw = await fetchArchetypeReport(tournament, name);
  const parsed = parseReport(raw);
  const percent = state.tournamentDeckTotal > 0 ? parsed.deckTotal / state.tournamentDeckTotal : 0;
  const record = {
    deckTotal: parsed.deckTotal,
    percent
  };
  state.cache.set(name, record);
  return record;
}

async function initialize() {
  try {
    updateContainerState('loading');
    toggleLoading(true);

    // Always use "Online - Last 14 Days" data
    const tournament = 'Online - Last 14 Days';
    state.tournament = tournament;

    const report = await safeAsync(() => fetchReport(tournament), `fetching ${tournament} report`, null);
    if (!report || typeof report.deckTotal !== 'number') {
      throw new Error(`Tournament report for ${tournament} is missing deck totals.`);
    }
    state.tournamentDeckTotal = report.deckTotal;

    if (elements.eventName) {
      elements.eventName.textContent = tournament;
    }

    const archetypes = await safeAsync(
      () => fetchArchetypesList(tournament),
      `fetching archetypes for ${tournament}`,
      []
    );
    const normalizedList = Array.isArray(archetypes) ? archetypes.filter(entry => entry && entry.name) : [];
    if (normalizedList.length === 0) {
      throw new Error(`No archetypes found for ${tournament}.`);
    }

    state.archetypes = normalizedList.slice().sort((left, right) => {
      const leftDecks = Number.isFinite(left.deckCount) ? Number(left.deckCount) : 0;
      const rightDecks = Number.isFinite(right.deckCount) ? Number(right.deckCount) : 0;
      if (rightDecks !== leftDecks) {
        return rightDecks - leftDecks;
      }
      return left.name.localeCompare(right.name);
    });
    renderList();

    updateContainerState('ready');
    toggleLoading(false);
  } catch (error) {
    logger.exception('Failed to initialize archetype analysis', error);
    updateContainerState('error');
    if (elements.eventName) {
      elements.eventName.textContent = 'Unable to load event data';
    }
    if (elements.listLoading) {
      elements.listLoading.textContent = 'Something went wrong while loading archetypes.';
      elements.listLoading.hidden = false;
    }
  }
}

initialize();
