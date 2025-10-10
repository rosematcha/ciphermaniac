import { fetchTournamentsList, fetchReport, fetchArchetypeReport, fetchOverrides, fetchArchetypeFiltersReport } from './api.js';
import { parseReport } from './parse.js';
import { render, updateLayout } from './render.js';
import { safeAsync, AppError } from './utils/errorHandler.js';
import { logger } from './utils/logger.js';

const GRANULARITY_MIN_PERCENT = 0;
const GRANULARITY_DEFAULT_PERCENT = 60; // Default granularity percent
const GRANULARITY_STEP_PERCENT = 5;
const RENDER_COMPACT_OPTIONS = { layoutMode: 'compact' };

const elements = {
  page: document.querySelector('.archetype-page'),
  loading: document.getElementById('archetype-loading'),
  error: document.getElementById('archetype-error'),
  simple: /** @type {HTMLElement|null} */ (document.querySelector('.archetype-simple')),
  grid: /** @type {HTMLElement|null} */ (document.getElementById('grid')),
  title: document.getElementById('archetype-title'),
  granularityRange: /** @type {HTMLInputElement|null} */ (document.getElementById('archetype-granularity-range')),
  granularityOutput: /** @type {HTMLOutputElement|null} */ (document.getElementById('archetype-granularity-output')),
  includeCard: /** @type {HTMLSelectElement|null} */ (document.getElementById('archetype-include-card')),
  excludeCard: /** @type {HTMLSelectElement|null} */ (document.getElementById('archetype-exclude-card')),
  filtersContainer: /** @type {HTMLElement|null} */ (document.querySelector('.archetype-controls')),
  filterMessage: /** @type {HTMLElement|null} */ (null),
  skeletonSummary: /** @type {HTMLElement|null} */ (document.getElementById('skeleton-summary')),
  skeletonCountValue: /** @type {HTMLElement|null} */ (document.getElementById('skeleton-count-value')),
  skeletonWarnings: /** @type {HTMLElement|null} */ (document.getElementById('skeleton-warnings'))
};

const state = {
  archetypeBase: '',
  archetypeLabel: '',
  tournament: '',
  tournamentDeckTotal: 0,
  archetypeDeckTotal: 0,
  overrides: {},
  items: [],
  allCards: [],
  thresholdPercent: null,
  defaultItems: [],
  defaultDeckTotal: 0,
  cardLookup: new Map(),
  filterCache: new Map(),
  currentFilters: { include: null, exclude: null }
};

function decodeArchetypeLabel(value) {
  return value.replace(/_/g, ' ');
}

function formatEventName(eventName) {
  return eventName.replace(/^[\d-]+,\s*/u, '');
}

function normalizeCardNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {return '';}
  const match = raw.match(/^(\d+)([A-Za-z]*)$/);
  if (!match) {return raw.toUpperCase();}
  const digits = match[1];
  const suffix = match[2] || '';
  return `${digits.padStart(3, '0')}${suffix.toUpperCase()}`;
}

function buildCardId(card) {
  const setCode = String(card?.set ?? '').toUpperCase().trim();
  if (!setCode) {return null;}
  const number = normalizeCardNumber(card?.number);
  if (!number) {return null;}
  return `${setCode}~${number}`;
}

function formatCardOptionLabel(card, duplicateCounts) {
  const baseName = card?.name || '';
  const count = duplicateCounts.get(baseName) || 0;
  if (!baseName) {
    return buildCardId(card) || 'Unknown Card';
  }
  if (count <= 1) {
    return baseName;
  }
  const setCode = String(card?.set ?? '').toUpperCase().trim();
  const number = normalizeCardNumber(card?.number);
  if (setCode && number) {
    return `${baseName} (${setCode} ${number})`;
  }
  const fallbackId = buildCardId(card);
  return fallbackId ? `${baseName} (${fallbackId.replace('~', ' ')})` : baseName;
}

function ensureFilterMessageElement() {
  if (elements.filterMessage instanceof HTMLElement) {
    return elements.filterMessage;
  }
  const container = elements.filtersContainer;
  if (!container) {return null;}
  const message = document.createElement('p');
  message.className = 'archetype-filter-message';
  message.hidden = true;
  container.appendChild(message);
  elements.filterMessage = message;
  return message;
}

function updateFilterMessage(text, tone = 'info') {
  const message = ensureFilterMessageElement();
  if (!message) {return;}
  if (!text) {
    message.hidden = true;
    message.textContent = '';
    delete message.dataset.tone; // eslint-disable-line no-param-reassign
    return;
  }
  message.hidden = false;
  message.textContent = text;
  message.dataset.tone = tone; // eslint-disable-line no-param-reassign
}

function describeFilters(includeId, excludeId) {
  const parts = [];
  if (includeId) {
    const info = state.cardLookup.get(includeId);
    parts.push(`including ${info?.name ?? includeId}`);
  }
  if (excludeId) {
    const info = state.cardLookup.get(excludeId);
    parts.push(`excluding ${info?.name ?? excludeId}`);
  }
  if (parts.length === 0) {
    return 'the baseline list';
  }
  return parts.join(' and ');
}

function getFilterKey(includeId, excludeId) {
  return `${includeId || 'null'}::${excludeId || 'null'}`;
}

function normalizeThreshold(value, min, max) {
  if (!Number.isFinite(value)) {return min;}
  if (max <= min) {return min;}

  const clamped = Math.max(min, Math.min(max, value));
  const rounded = min + Math.round((clamped - min) / GRANULARITY_STEP_PERCENT) * GRANULARITY_STEP_PERCENT;
  return Math.max(min, Math.min(max, rounded));
}

function setPageState(status) {
  if (!elements.page) {return;}
  elements.page.setAttribute('data-state', status);
}

function toggleLoading(isLoading) {
  if (elements.loading) {
    elements.loading.hidden = !isLoading;
  }
}

function showError(message) {
  if (elements.error) {
    elements.error.hidden = false;
    const heading = elements.error.querySelector('h2');
    if (heading) {
      heading.textContent = message || 'We couldn’t load that archetype.';
    }
  }
}

function updateHero() {
  if (elements.title) {
    elements.title.textContent = state.archetypeLabel;
  }
  document.title = `${state.archetypeLabel} · ${formatEventName(state.tournament)} – Ciphermaniac`;
}

function getUsagePercent(card) {
  if (Number.isFinite(card.pct)) {
    return Number(card.pct);
  }
  if (Number.isFinite(card.found) && Number.isFinite(card.total) && card.total > 0) {
    return (card.found / card.total) * 100;
  }
  return 0;
}

function syncGranularityOutput(threshold) {
  const safeValue = Number.isFinite(threshold) ? Math.max(GRANULARITY_MIN_PERCENT, threshold) : GRANULARITY_MIN_PERCENT;
  const step = elements.granularityRange
    ? Math.max(1, Number(elements.granularityRange.step) || GRANULARITY_STEP_PERCENT)
    : 1;
  const roundedValue = Math.round(safeValue / step) * step;
  const clampedValue = Math.max(GRANULARITY_MIN_PERCENT, roundedValue);
  const value = `${Math.round(clampedValue)}%`;
  if (elements.granularityRange) {
    elements.granularityRange.value = String(Math.round(clampedValue));
  }
  if (elements.granularityOutput) {
    elements.granularityOutput.textContent = value;
  }
}

function filterItemsByThreshold(items, threshold) {
  const numericThreshold = Number.isFinite(threshold) ? threshold : GRANULARITY_MIN_PERCENT;
  const filtered = items.filter(item => getUsagePercent(item) >= numericThreshold);
  if (filtered.length === 0 && items.length > 0) {
    return [items[0]];
  }
  return filtered;
}

function configureGranularity(items) {
  const range = elements.granularityRange;
  if (!range || items.length === 0) {
    state.thresholdPercent = GRANULARITY_MIN_PERCENT;
    syncGranularityOutput(GRANULARITY_MIN_PERCENT);
    return;
  }

  const percents = items.map(getUsagePercent);
  const computedMax = Math.max(...percents, GRANULARITY_MIN_PERCENT);

  const minValue = GRANULARITY_MIN_PERCENT;
  const maxValue = Math.min(100, Math.ceil(computedMax / GRANULARITY_STEP_PERCENT) * GRANULARITY_STEP_PERCENT);
  range.min = String(minValue);
  range.max = String(maxValue);
  range.step = String(GRANULARITY_STEP_PERCENT);

  const desired = Number.isFinite(state.thresholdPercent)
    ? state.thresholdPercent
    : GRANULARITY_DEFAULT_PERCENT;
  const normalized = normalizeThreshold(desired, minValue, maxValue);
  state.thresholdPercent = normalized;
  syncGranularityOutput(normalized);
}

function populateCardDropdowns() {
  if (!elements.includeCard || !elements.excludeCard) {
    return;
  }

  // Sort cards alphabetically by name
  const sortedCards = [...state.allCards].sort((left, right) =>
    (left.name || '').localeCompare(right.name || '')
  );

  // Clear existing options (except the first "Select a card" option)
  elements.includeCard.length = 1;
  elements.excludeCard.length = 1;

  state.cardLookup = new Map();
  const deckTotal = state.defaultDeckTotal || state.archetypeDeckTotal || 0;

  const duplicateCounts = new Map();
  state.allCards.forEach(card => {
    const cardId = buildCardId(card);
    const baseName = card?.name;
    if (!cardId || !baseName) {
      return;
    }
    duplicateCounts.set(baseName, (duplicateCounts.get(baseName) || 0) + 1);
  });

  // Populate both dropdowns with all cards from master JSON
  sortedCards.forEach(card => {
    const cardId = buildCardId(card);
    const found = Number(card.found ?? 0);
    const total = Number(card.total ?? deckTotal);
    const pct = total > 0 ? (found / total) * 100 : 0;
    const alwaysIncluded = total > 0 && found === total;
    const normalizedNumber = normalizeCardNumber(card.number);

    if (cardId) {
      state.cardLookup.set(cardId, {
        id: cardId,
        name: card.name || cardId,
        set: card.set || null,
        number: normalizedNumber || null,
        found,
        total,
        pct: Math.round(pct * 100) / 100,
        alwaysIncluded
      });
    }

    if (!cardId || alwaysIncluded) {
      return;
    }

    const optionInclude = document.createElement('option');
    optionInclude.value = cardId;
    optionInclude.textContent = formatCardOptionLabel(card, duplicateCounts);
    optionInclude.dataset.cardName = card.name || cardId;
    elements.includeCard.appendChild(optionInclude);

    const optionExclude = document.createElement('option');
    optionExclude.value = cardId;
    optionExclude.textContent = formatCardOptionLabel(card, duplicateCounts);
    optionExclude.dataset.cardName = card.name || cardId;
    elements.excludeCard.appendChild(optionExclude);
  });
}

function isAceSpec(cardName) {
  // Common Ace Spec card names - you can expand this list
  const aceSpecKeywords = ['ace spec', 'computer search', 'dowsing machine', 'scramble switch', 'master ball', 'legacy energy', 'prime catcher', 'reboot pod', 'secret box'];
  const lowerName = cardName.toLowerCase();
  return aceSpecKeywords.some(keyword => lowerName.includes(keyword));
}

function updateSkeletonSummary(items) {
  if (!elements.skeletonSummary || !elements.skeletonCountValue || !elements.skeletonWarnings) {
    return;
  }

  // Calculate total count by summing the most frequent count for each card
  let totalCount = 0;
  let aceSpecCount = 0;
  const aceSpecCards = [];

  items.forEach(item => {
    if (item.dist && item.dist.length > 0) {
      // Find the distribution entry with the highest percentage
      const mostFrequent = item.dist.reduce((max, current) =>
        (current.percent > max.percent) ? current : max
      );
      totalCount += mostFrequent.copies;

      // Check if this is an Ace Spec card
      if (isAceSpec(item.name)) {
        aceSpecCount += mostFrequent.copies;
        aceSpecCards.push(item.name);
      }
    }
  });

  // Update the count display
  elements.skeletonCountValue.textContent = String(totalCount);

  // Generate warnings
  const warnings = [];
  if (aceSpecCount > 1) {
    warnings.push(`⚠️ Multiple Ace Spec cards detected: ${aceSpecCards.join(', ')}`);
  }
  if (totalCount > 60) {
    warnings.push(`⚠️ Deck exceeds 60 cards (${totalCount} cards)`);
  }

  // Update warnings display
  if (warnings.length > 0) {
    elements.skeletonWarnings.textContent = warnings.join(' • ');
    elements.skeletonWarnings.hidden = false;
  } else {
    elements.skeletonWarnings.textContent = '';
    elements.skeletonWarnings.hidden = true;
  }

  // Show the summary
  elements.skeletonSummary.hidden = false;
}

function renderCards() {
  if (!Array.isArray(state.items)) {
    return;
  }

  configureGranularity(state.items);
  const threshold = Number.isFinite(state.thresholdPercent)
    ? state.thresholdPercent
    : GRANULARITY_DEFAULT_PERCENT;
  const visibleItems = filterItemsByThreshold(state.items, threshold);

  const grid = document.getElementById('grid');
  if (grid) {
    grid._visibleRows = 24;
  }
  render(visibleItems, state.overrides, RENDER_COMPACT_OPTIONS);
  syncGranularityOutput(threshold);
  updateSkeletonSummary(visibleItems);
  requestAnimationFrame(() => {
    updateLayout();
  });
}

function loadFilterCombination(includeId, excludeId) {
  const key = getFilterKey(includeId, excludeId);
  if (state.filterCache.has(key)) {
    return state.filterCache.get(key);
  }

  const promise = (async () => {
    try {
      const raw = await fetchArchetypeFiltersReport(state.tournament, state.archetypeBase, includeId, excludeId);
      const parsed = parseReport(raw);
      return {
        deckTotal: parsed.deckTotal,
        items: parsed.items,
        raw
      };
    } catch (error) {
      state.filterCache.delete(key);
      throw error;
    }
  })();

  state.filterCache.set(key, promise);
  return promise;
}

function resetToDefaultData() {
  state.items = state.defaultItems;
  state.archetypeDeckTotal = state.defaultDeckTotal;
  state.currentFilters = { include: null, exclude: null };
  updateFilterMessage('');
  renderCards();
}

function applyAlwaysIncludedGuard(includeId) {
  if (!includeId) {return null;}
  const info = state.cardLookup.get(includeId);
  if (info?.alwaysIncluded) {
    return null;
  }
  return includeId;
}

function handleImpossibleExclusion(excludeId) {
  if (!excludeId) {return false;}
  const info = state.cardLookup.get(excludeId);
  if (!info?.alwaysIncluded) {return false;}
  updateFilterMessage(`${state.archetypeLabel} decks always play ${info.name}. Try a different exclusion.`, 'warning');
  state.items = [];
  state.archetypeDeckTotal = 0;
  state.currentFilters = { include: null, exclude: excludeId };
  renderCards();
  return true;
}

async function applyFilters() {
  if (!elements.includeCard || !elements.excludeCard) {
    return;
  }
  if (!state.tournament || !state.archetypeBase) {
    return;
  }

  const originalIncludeValue = elements.includeCard.value || null;
  let includeId = originalIncludeValue;
  const excludeId = elements.excludeCard.value || null;

  includeId = applyAlwaysIncludedGuard(includeId);
  if (!includeId && originalIncludeValue) {
    elements.includeCard.value = '';
  }

  if (!includeId && !excludeId) {
    resetToDefaultData();
    return;
  }

  if (includeId && excludeId && includeId === excludeId) {
    updateFilterMessage('Choose different cards to include and exclude.', 'warning');
    state.items = [];
    state.archetypeDeckTotal = 0;
    state.currentFilters = { include: includeId, exclude: excludeId };
    renderCards();
    return;
  }

  if (handleImpossibleExclusion(excludeId)) {
    return;
  }

  const comboLabel = describeFilters(includeId, excludeId);
  updateFilterMessage(`Crunching the numbers for decks ${comboLabel}…`, 'info');

  const requestKey = getFilterKey(includeId, excludeId);

  try {
    const result = await loadFilterCombination(includeId, excludeId);

    const currentInclude = applyAlwaysIncludedGuard(elements.includeCard ? elements.includeCard.value || null : null);
    const currentExclude = elements.excludeCard ? elements.excludeCard.value || null : null;
    const activeKey = getFilterKey(currentInclude, currentExclude);
    if (activeKey !== requestKey) {
      return;
    }

    // eslint-disable-next-line require-atomic-updates -- Guarded by requestKey check
    Object.assign(state, {
      items: result.items,
      archetypeDeckTotal: result.deckTotal,
      currentFilters: { include: includeId, exclude: excludeId }
    });

    if (!result.deckTotal || result.items.length === 0) {
      updateFilterMessage(`No decks match the combination ${comboLabel}.`, 'warning');
    } else {
      const deckLabel = result.deckTotal === 1 ? 'deck' : 'decks';
      updateFilterMessage(`${result.deckTotal} ${deckLabel} match the combination ${comboLabel}.`, 'info');
    }
    renderCards();
  } catch (error) {
    if (error instanceof AppError && error.context?.status === 404) {
      updateFilterMessage(`No decks match the combination ${comboLabel}.`, 'warning');
      // eslint-disable-next-line require-atomic-updates -- Selection validated above
      Object.assign(state, {
        items: [],
        archetypeDeckTotal: 0,
        currentFilters: { include: includeId, exclude: excludeId }
      });
      renderCards();
      return;
    }
    logger.exception('Failed to apply include/exclude filters', error);
    updateFilterMessage('We ran into an issue loading that combination. Please try again.', 'warning');
  }
}

function setupFilterListeners() {
  if (elements.includeCard) {
    elements.includeCard.addEventListener('change', () => {
      applyFilters().catch(error => {
        logger.debug('Include filter change failed', error?.message || error);
      });
    });
  }
  if (elements.excludeCard) {
    elements.excludeCard.addEventListener('change', () => {
      applyFilters().catch(error => {
        logger.debug('Exclude filter change failed', error?.message || error);
      });
    });
  }
}

function handleGranularityInput(event) {
  const target = /** @type {HTMLInputElement|null} */ (event.currentTarget || event.target);
  if (!target || !Array.isArray(state.items) || state.items.length === 0) {return;}

  const percents = state.items.map(getUsagePercent);
  const computedMax = Math.max(...percents, GRANULARITY_MIN_PERCENT);

  if (computedMax <= GRANULARITY_STEP_PERCENT) {
    syncGranularityOutput(computedMax);
    return;
  }

  const maxPercent = Math.min(100, Math.ceil(computedMax / GRANULARITY_STEP_PERCENT) * GRANULARITY_STEP_PERCENT);
  const rawValue = Number(target.value);
  const normalized = normalizeThreshold(rawValue, GRANULARITY_MIN_PERCENT, maxPercent);

  if (state.thresholdPercent !== normalized) {
    state.thresholdPercent = normalized;
    renderCards();
  } else {
    syncGranularityOutput(normalized);
  }
}

function setupGranularityListeners() {
  const range = elements.granularityRange;
  if (range) {
    range.addEventListener('input', handleGranularityInput);
  }
}

function resolveTournamentPreference(defaultTournament, tournamentsList) {
  const params = new URLSearchParams(window.location.search);
  const preferredTournament = params.get('tour');

  if (!preferredTournament) {
    return defaultTournament;
  }

  const tournaments = Array.isArray(tournamentsList) ? tournamentsList : [];
  if (tournaments.includes(preferredTournament)) {
    return preferredTournament;
  }
  logger.warn(`Preferred tournament ${preferredTournament} not found, falling back to ${defaultTournament}`);
  return defaultTournament;
}

async function initialize() {
  const params = new URLSearchParams(window.location.search);
  const base = params.get('archetype');
  if (!base) {
    showError('Choose an archetype from the analysis page first.');
    setPageState('error');
    toggleLoading(false);
    return;
  }

  state.archetypeBase = base;
  state.archetypeLabel = decodeArchetypeLabel(base);
  state.thresholdPercent = GRANULARITY_DEFAULT_PERCENT;
  syncGranularityOutput(GRANULARITY_DEFAULT_PERCENT);

  try {
    setPageState('loading');
    toggleLoading(true);

    const tournaments = await safeAsync(
      () => fetchTournamentsList(),
      'fetching tournaments list',
      []
    );
    if (!Array.isArray(tournaments) || tournaments.length === 0) {
      throw new Error('No tournaments available for archetype analysis.');
    }
    const latestTournament = tournaments[0];
    state.tournament = resolveTournamentPreference(latestTournament, tournaments);

    const [overrides, tournamentReport, archetypeRaw] = await Promise.all([
      safeAsync(() => fetchOverrides(), 'fetching thumbnail overrides', {}),
      safeAsync(() => fetchReport(state.tournament), `fetching ${state.tournament} report`, null),
      fetchArchetypeReport(state.tournament, state.archetypeBase)
    ]);

    if (!tournamentReport || typeof tournamentReport.deckTotal !== 'number') {
      throw new Error(`Tournament report for ${state.tournament} is missing deck totals.`);
    }

    const parsedArchetype = parseReport(archetypeRaw);
    Object.assign(state, {
      overrides: overrides || {},
      tournamentDeckTotal: tournamentReport.deckTotal,
      archetypeDeckTotal: parsedArchetype.deckTotal,
      items: parsedArchetype.items,
      allCards: parsedArchetype.items,
      defaultItems: parsedArchetype.items,
      defaultDeckTotal: parsedArchetype.deckTotal,
      filterCache: new Map(),
      currentFilters: { include: null, exclude: null }
    });

    updateHero();
    ensureFilterMessageElement();
    updateFilterMessage('');
    populateCardDropdowns();
    renderCards();

    if (elements.loading) {
      elements.loading.hidden = true;
    }
    if (elements.error) {
      elements.error.hidden = true;
    }
    if (elements.simple) {
      elements.simple.hidden = false;
    }
    if (elements.grid) {
      elements.grid.hidden = false;
    }
    setPageState('ready');
  } catch (error) {
    logger.exception('Failed to load archetype detail', error);
    toggleLoading(false);
    showError('We couldn’t load that archetype.');
    setPageState('error');
  }
}

window.addEventListener('resize', () => {
  if (state.items.length > 0) {
    updateLayout();
  }
});

setupGranularityListeners();
setupFilterListeners();

initialize();
