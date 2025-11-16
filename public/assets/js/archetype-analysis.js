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
  archetypes: /** @type {Array<{name:string, deckTotal:number, percent:number}>} */ ([]),
  cache: new Map(),
  thumbnailConfig: /** @type {Record<string, string[]>|null} */ (null)
};

// Load archetype thumbnail configuration
async function loadThumbnailConfig() {
  try {
    const response = await fetch('/assets/data/archetype-thumbnails.json');
    if (!response.ok) {
      throw new Error(`Failed to load thumbnail config: ${response.status}`);
    }
    state.thumbnailConfig = await response.json();
  } catch (error) {
    logger.warn('Failed to load archetype thumbnail config', error);
    state.thumbnailConfig = {};
  }
}

const deckThumbnailConfig_DEPRECATED = {
  'Raging Bolt Ogerpon': {
    cardSlug: 'Raging_Bolt_ex',
    set: 'TEF',
    number: '123',
    alt: 'Raging Bolt ex'
  },
  Gardevoir: {
    cardSlug: 'Gardevoir_ex',
    set: 'SVI',
    number: '086',
    alt: 'Gardevoir ex'
  },
  'Dragapult Dusknoir': {
    cards: [
      {
        cardSlug: 'Dusknoir',
        set: 'PRE',
        number: '037',
        alt: 'Dusknoir',
        crop: { x: 0, width: 0.5 }
      },
      {
        cardSlug: 'Dragapult_ex',
        set: 'TWM',
        number: '130',
        alt: 'Dragapult ex',
        crop: { x: 0.5, width: 0.5 }
      }
    ],
    alt: 'Dragapult ex & Dusknoir'
  },
  Dragapult: {
    cardSlug: 'Dragapult_ex',
    set: 'TWM',
    number: '130',
    alt: 'Dragapult ex'
  },
  'Dragapult Charizard': {
    cards: [
      {
        cardSlug: 'Dragapult_ex',
        set: 'TWM',
        number: '130',
        alt: 'Dragapult ex',
        crop: { x: 0, width: 0.5 }
      },
      {
        cardSlug: 'Charizard_ex',
        set: 'OBF',
        number: '125',
        alt: 'Charizard ex',
        crop: { x: 0.5, width: 0.5 }
      }
    ],
    alt: 'Dragapult ex & Charizard ex'
  },
  Gholdengo: {
    cardSlug: 'Gholdengo_ex',
    set: 'PAR',
    number: '139',
    alt: 'Gholdengo ex'
  },
  'Gholdengo Joltik Box': {
    cards: [
      {
        cardSlug: 'Gholdengo_ex',
        set: 'PAR',
        number: '139',
        alt: 'Gholdengo ex',
        crop: { x: 0, y: 0, width: 0.5 }
      },
      {
        cardSlug: 'Joltik',
        set: 'SCR',
        number: '050',
        alt: 'Joltik',
        crop: { x: 0.5, y: 0, width: 0.5 }
      }
    ],
    alt: 'Gholdengo ex & Joltik'
  },
  'Gholdengo Lunatone': {
    cards: [
      {
        cardSlug: 'Gholdengo_ex',
        set: 'PAR',
        number: '139',
        alt: 'Gholdengo ex',
        crop: { x: 0, width: 0.5 }
      },
      {
        cardSlug: 'Lunatone',
        set: 'MEG',
        number: '074',
        alt: 'Lunatone',
        crop: { x: 0.5, width: 0.5 }
      }
    ],
    alt: 'Gholdengo ex & Lunatone'
  },
  'Gardevoir Jellicent': {
    cards: [
      {
        cardSlug: 'Gardevoir_ex',
        set: 'SVI',
        number: '086',
        alt: 'Gardevoir ex',
        crop: { x: 0, width: 0.5 }
      },
      {
        cardSlug: 'Jellicent_ex',
        set: 'WHT',
        number: '045',
        alt: 'Jellicent ex',
        crop: { x: 0.5, width: 0.5 }
      }
    ],
    alt: 'Gardevoir ex & Jellicent ex'
  },
  'Tera Box': {
    cardSlug: 'Terapagos_ex',
    set: 'SCR',
    number: '128',
    alt: 'Terapagos ex'
  },
  'Joltik Box': {
    cardSlug: 'Joltik',
    set: 'SCR',
    number: '050',
    alt: 'Joltik'
  },
  'Charizard Pidgeot': {
    cardSlug: 'Charizard_ex',
    set: 'OBF',
    number: '125',
    alt: 'Charizard ex'
  },
  'Grimmsnarl Froslass': {
    cardSlug: "Marnie's_Grimmsnarl_ex",
    set: 'DRI',
    number: '136',
    alt: "Marnie's Grimmsnarl ex"
  },
  'Flareon Noctowl': {
    cardSlug: 'Flareon_ex',
    set: 'PRE',
    number: '014',
    alt: 'Flareon ex'
  },
  Ceruledge: {
    cardSlug: 'Ceruledge_ex',
    set: 'SSP',
    number: '036',
    alt: 'Ceruledge ex'
  },
  'Mega Venusaur': {
    cardSlug: 'Mega_Venusaur_ex',
    set: 'MEG',
    number: '003',
    alt: 'Mega Venusaur ex'
  },
  Alakazam: {
    cardSlug: 'Alakazam_ex',
    set: 'MEG',
    number: '056',
    alt: 'Alakazam ex'
  },
  'Alakazam Dudunsparce': {
    cardSlug: 'Alakazam_ex',
    set: 'MEG',
    number: '056',
    alt: 'Alakazam ex'
  },
  Lucario: {
    cardSlug: 'Lucario_ex',
    set: 'MEG',
    number: '077',
    alt: 'Lucario ex'
  },
  'Lucario Hariyama': {
    cardSlug: 'Mega_Lucario_ex',
    set: 'MEG',
    number: '077',
    alt: 'Mega Lucario ex'
  },
  Slowking: {
    cardSlug: 'Slowking',
    set: 'SCR',
    number: '058',
    alt: 'Slowking'
  },
  Conkeldurr: {
    cardSlug: 'Conkeldurr',
    set: 'TWM',
    number: '105',
    alt: 'Conkeldurr'
  },
  Crustle: { cardSlug: 'Crustle', set: 'DRI', number: '012', alt: 'Crustle' },
  "Ethan's Typhlosion": {
    cardSlug: "Ethan's_Typhlosion",
    set: 'DRI',
    number: '034',
    alt: "Ethan's Typhlosion"
  },
  "N's Zoroark": {
    cardSlug: "N's_Zoroark_ex",
    set: 'JTG',
    number: '098',
    alt: "N's Zoroark ex"
  },
  'Zoroark Lucario': {
    cardSlug: "N's_Zoroark_ex",
    set: 'JTG',
    number: '098',
    alt: "N's Zoroark ex"
  },
  'Pidgeot Control': {
    cardSlug: 'Pidgeot_ex',
    set: 'OBF',
    number: '164',
    alt: 'Pidgeot ex'
  },
  "Cynthia's Garchomp": {
    cardSlug: "Cynthia's_Garchomp_ex",
    set: 'DRI',
    number: '104',
    alt: "Cynthia's Garchomp ex"
  },
  'Ho-Oh Armarouge': {
    cardSlug: "Ethan's_Ho-Oh_ex",
    set: 'DRI',
    number: '039',
    alt: 'Ho-Oh ex'
  },
  'Froslass Munkidori': {
    cardSlug: 'Froslass',
    set: 'TWM',
    number: '053',
    alt: 'Froslass'
  },
  'Mega Absol Box': {
    cardSlug: 'Mega_Absol_ex',
    set: 'MEG',
    number: '086',
    alt: 'Mega Absol ex'
  },
  'Milotic Farigiraf': {
    cardSlug: 'Milotic_ex',
    set: 'SSP',
    number: '042',
    alt: 'Milotic ex'
  }
};

function normalizeDeckName(label) {
  return label
    .replace(/['']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function getDeckThumbnail(name) {
  if (!state.thumbnailConfig) {
    return null;
  }
  
  // Try exact match first
  if (state.thumbnailConfig[name]) {
    return state.thumbnailConfig[name];
  }
  
  // Try normalized match
  const normalized = normalizeDeckName(name);
  for (const [key, value] of Object.entries(state.thumbnailConfig)) {
    if (normalizeDeckName(key) === normalized) {
      return value;
    }
  }
  
  return null;
}

function buildThumbnailSources(cardIds) {
  if (!Array.isArray(cardIds) || cardIds.length === 0) {
    return [];
  }

  return cardIds.map(cardId => {
    const [set, number] = cardId.split('/');
    return buildThumbnailSourceFromCard({ set, number });
  }).filter(Boolean);
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function buildThumbnailSourceFromCard(card) {
  if (!card || !card.set || !card.number) {
    return null;
  }
  
  // Try Limitless CDN (always available)
  const normalizedSet = String(card.set).toUpperCase().trim();
  // Remove leading zeroes from card number (Limitless format)
  const normalizedNumber = String(card.number).trim().replace(/^0+/, '') || '0';
  
  if (normalizedSet && normalizedNumber) {
    return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${normalizedSet}/${normalizedSet}_${normalizedNumber}_R_EN_SM.png`;
  }
  
  return null;
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
    splitImg.alt = deckName.replace(/_/g, ' ');
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

function applyDeckThumbnail(thumbnailEl, imgEl, fallbackEl, deckName) {
  const thumbnailElement = thumbnailEl;
  const imageElement = imgEl;
  const fallbackElement = fallbackEl;
  const cardIds = getDeckThumbnail(deckName);
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
  imageElement.alt = deckName.replace(/_/g, ' ');
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

  state.archetypes.forEach(({ name, deckTotal, percent }) => {
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

    anchor.href = buildDetailUrl(name);
    anchor.dataset.archetype = name;

    // Add hover event listeners for aggressive pre-caching
    setupArchetypeHoverHandlers(anchor, name);

    if (
      previewEl &&
      thumbnailContainer instanceof HTMLElement &&
      thumbnailImage instanceof HTMLImageElement &&
      thumbnailFallback instanceof HTMLElement
    ) {
      applyDeckThumbnail(thumbnailContainer, thumbnailImage, thumbnailFallback, name);
    } else if (previewEl instanceof HTMLElement) {
      previewEl.classList.add('analysis-list-item__preview--no-thumb');
    }

    if (nameEl) {
      nameEl.textContent = name.replace(/_/g, ' ');
    }
    if (pctEl) {
      pctEl.textContent = formatPercent(percent);
    }
    if (countEl) {
      countEl.textContent = `${deckTotal} decks`;
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

async function loadArchetypeSummaries(archetypeNames) {
  const results = await Promise.all(
    archetypeNames.map(async name => {
      try {
        const summary = await loadArchetype(name);
        return { name, deckTotal: summary.deckTotal, percent: summary.percent };
      } catch (error) {
        logger.warn(`Failed to load archetype ${name}`, error);
        return null;
      }
    })
  );

  // Only include archetypes with 4 or more decks
  const filtered = /** @type {Array<{name:string, deckTotal:number, percent:number}>} */ (
    results.filter(entry => entry && entry.deckTotal >= 4)
  );
  filtered.sort((left, right) => right.deckTotal - left.deckTotal);
  state.archetypes = filtered;
}

async function initialize() {
  try {
    updateContainerState('loading');
    toggleLoading(true);

    // Load thumbnail configuration
    await loadThumbnailConfig();

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
    if (!Array.isArray(archetypes) || archetypes.length === 0) {
      throw new Error(`No archetypes found for ${tournament}.`);
    }

    await loadArchetypeSummaries(archetypes);
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
