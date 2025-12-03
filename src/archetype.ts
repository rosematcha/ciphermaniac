/* eslint-disable id-length, no-param-reassign, no-unused-vars */
import './utils/buildVersion.js';
import { fetchArchetypeFiltersReport, fetchArchetypeReport, fetchReport } from './api.js';
import { parseReport } from './parse.js';
import { render, updateLayout } from './render.js';
import { normalizeCardNumber } from './card/routing.js';
import { AppError, ErrorTypes } from './utils/errorHandler.js';
import { logger } from './utils/logger.js';
import type { GridElement } from './render.js';

const GRANULARITY_MIN_PERCENT = 0;
const GRANULARITY_DEFAULT_PERCENT = 60; // Default granularity percent
const GRANULARITY_STEP_PERCENT = 5;
const RENDER_COMPACT_OPTIONS = { layoutMode: 'compact' as const };
const CARD_COUNT_DEFAULT_MAX = 4;
const CARD_COUNT_BASIC_ENERGY_MAX = 59;

const elements = {
  page: document.querySelector('.archetype-page'),
  loading: document.getElementById('archetype-loading'),
  error: document.getElementById('archetype-error'),
  simple: /** @type {HTMLElement|null} */ (document.querySelector('.archetype-simple')),
  grid: document.getElementById('grid') as GridElement | null,
  title: document.getElementById('archetype-title'),
  granularityRange: document.getElementById('archetype-granularity-range') as HTMLInputElement | null,
  granularityOutput: /** @type {HTMLOutputElement|null} */ (document.getElementById('archetype-granularity-output')),
  successFilter: document.getElementById('archetype-success-filter') as HTMLSelectElement | null,
  filterRowsContainer: /** @type {HTMLElement|null} */ (document.getElementById('archetype-filter-rows')),
  addFilterButton: /** @type {HTMLButtonElement|null} */ (document.getElementById('archetype-add-filter')),
  filtersContainer: /** @type {HTMLElement|null} */ (document.querySelector('.archetype-controls')),
  filterEmptyState: /** @type {HTMLElement|null} */ (document.getElementById('archetype-filter-empty-state')),
  filterMessage: /** @type {HTMLElement|null} */ (null),
  skeletonSummary: /** @type {HTMLElement|null} */ (document.getElementById('skeleton-summary')),
  skeletonCountValue: /** @type {HTMLElement|null} */ (document.getElementById('skeleton-count-value')),
  skeletonWarnings: /** @type {HTMLElement|null} */ (document.getElementById('skeleton-warnings')),
  skeletonExportButton: /** @type {HTMLButtonElement|null} */ (document.getElementById('skeleton-export-live')),
  skeletonExportStatus: /** @type {HTMLElement|null} */ (document.getElementById('skeleton-export-status'))
};

/**
 * @typedef {object} FilterDescriptor
 * @property {string} cardId
 * @property {('<' | '>' | '=' | '<=' | '>=' | null)} [operator]
 * @property {number|null} [count]
 */

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
  successFilter: 'all',
  defaultItems: [],
  defaultDeckTotal: 0,
  cardLookup: new Map(),
  filterCache: new Map(),
  filterRows: [], // Array of filter objects: { id, cardId, operator, count }
  nextFilterId: 1,
  skeleton: {
    totalCards: 0,
    exportEntries: /**
       @type {Array<{
      name: string,
      copies: number,
      set: string,
      number: string,
      primaryCategory: string
    }>} */ ([]),
    plainWarnings: /** @type {string[]} */ ([]),
    displayWarnings: /** @type {string[]} */ ([]),
    lastExportText: ''
  }
};

const CARD_CATEGORY_SORT_PRIORITY = new Map([
  ['pokemon', 0],
  ['trainer/supporter', 1],
  ['trainer/item', 2],
  ['trainer/tool/acespec', 3],
  ['trainer/tool', 4],
  ['trainer/stadium', 5],
  ['trainer/other', 6],
  ['trainer', 6],
  ['energy/basic', 7],
  ['energy/special', 8],
  ['energy', 7]
]);

const WARNING_ICON = '\u26A0\uFE0F';

const TCG_LIVE_SECTION_ORDER = [
  { key: 'pokemon', label: 'Pok\u00E9mon' },
  { key: 'trainer', label: 'Trainer' },
  { key: 'energy', label: 'Energy' }
];

const SUCCESS_FILTER_LABELS = {
  all: 'all finishes',
  winner: 'winners',
  top2: 'finals',
  top4: 'top 4',
  top8: 'top 8',
  top16: 'top 16',
  top10: 'top 10%',
  top25: 'top 25%',
  top50: 'top 50%'
};

const TRAINER_SUPPORTER_OVERRIDES = new Set([
  'iono',
  'arven',
  'penny',
  'briar',
  'crispin',
  'cyrano',
  'jacq',
  'clavell',
  'hilda',
  'hop',
  'n',
  'cynthia',
  'guzma',
  'melony',
  'nessa',
  'grant',
  'irida',
  'adaman',
  'raihan',
  'rika',
  'mela',
  'peonia',
  'peony',
  'shauna',
  'rosa',
  'hilbert',
  'gloria',
  'selene',
  'gladion',
  'grimsley',
  'volo',
  'lucian',
  'gardenia',
  'clair',
  'clay',
  'bede',
  'katie',
  'sparky'
]);

const TRAINER_SUPPORTER_KEYWORDS = [
  "professor'",
  'professor ',
  "boss's orders",
  'boss\u2019s orders',
  'orders',
  'judge',
  'research',
  'scenario',
  'vitality',
  'assistant',
  'team star',
  'team rocket',
  'gym leader',
  "n's ",
  'n\u2019s '
];

const TRAINER_STADIUM_KEYWORDS = [
  ' stadium',
  ' arena',
  ' park',
  ' tower',
  ' city',
  ' town',
  ' plaza',
  ' hq',
  ' headquarters',
  ' laboratory',
  ' lab',
  ' factory',
  ' ruins',
  ' temple',
  ' beach',
  ' garden',
  ' library',
  ' forest',
  ' village',
  ' court',
  ' academy',
  ' grand tree',
  ' jamming tower',
  ' artazon',
  ' mesagoza',
  ' levincia',
  ' area zero',
  ' dojo',
  ' mine',
  ' depot',
  ' square',
  ' colosseum',
  ' hall',
  ' palace',
  ' lake',
  ' mountain',
  ' hideout',
  ' cave'
];

const TRAINER_TOOL_KEYWORDS = [
  ' belt',
  ' band',
  ' cape',
  ' mask',
  ' goggles',
  ' boots',
  ' helmet',
  ' gloves',
  ' shield',
  ' vest',
  ' charm',
  ' stone',
  ' tablet',
  ' capsule',
  ' scope',
  ' cloak',
  ' glasses',
  ' amplifier',
  ' weight',
  ' booster',
  ' anklet'
];

const TRAINER_ITEM_KEYWORDS = [
  ' ball',
  ' switch',
  ' rope',
  ' catcher',
  ' rod',
  ' capsule',
  ' tablet',
  ' candy',
  ' vessel',
  ' bag',
  ' phone',
  ' transceiver',
  ' generator',
  ' pass',
  ' gear',
  ' pad',
  ' vacuum',
  ' machine',
  ' pickaxe',
  ' basket',
  ' hammer',
  ' letter',
  ' map',
  ' board',
  ' pouch',
  ' poffin',
  ' incense',
  ' cart',
  ' camera',
  ' shoes',
  ' energy search',
  'energy switch',
  'energy recycler',
  'energy retrieval',
  'technical machine'
];

const TRAINER_HINT_KEYWORDS = [
  ...TRAINER_SUPPORTER_KEYWORDS,
  ...TRAINER_STADIUM_KEYWORDS,
  ...TRAINER_TOOL_KEYWORDS,
  ...TRAINER_ITEM_KEYWORDS,
  ' trainer',
  'orders',
  'supporter',
  'stadium',
  'tool'
];

function extractArchetypeFromLocation(loc = window.location) {
  const params = new URLSearchParams(loc.search);
  const paramValue = params.get('archetype');
  if (paramValue) {
    return paramValue;
  }

  const pathname = loc.pathname || '';
  const trimmedPath = pathname.replace(/\/+$/u, '');
  const candidatePaths = new Set([trimmedPath]);

  try {
    const decoded = decodeURIComponent(trimmedPath);
    candidatePaths.add(decoded);
  } catch (error) {
    logger.debug('Failed to decode pathname when searching for archetype slug', {
      pathname,
      message: error?.message
    });
  }

  for (const candidate of candidatePaths) {
    const segments = candidate.split('/').filter(Boolean);
    const archetypeIndex = segments.indexOf('archetype');
    if (archetypeIndex === -1) {
      continue;
    }

    const slugSegments = segments.slice(archetypeIndex + 1);
    if (slugSegments.length === 0) {
      continue;
    }

    const rawSlug = slugSegments.join('/');
    try {
      return decodeURIComponent(rawSlug);
    } catch (error) {
      logger.warn('Failed to decode archetype slug from path', {
        rawSlug,
        error: error?.message
      });
      return rawSlug;
    }
  }

  return null;
}

function decodeArchetypeLabel(value) {
  return value.replace(/_/g, ' ');
}

function formatEventName(eventName) {
  return eventName.replace(/^[\d-]+,\s*/u, '');
}

function formatTcgliveCardNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  const match = raw.match(/^0*([0-9]+)([A-Za-z]*)$/);
  if (match) {
    const digits = match[1] ? String(Number(match[1])) : '0';
    const suffix = match[2] || '';
    return `${digits}${suffix.toUpperCase()}`;
  }
  if (/^\d+$/.test(raw)) {
    return String(Number(raw));
  }
  return raw.toUpperCase();
}

function buildCardId(card) {
  const setCode = String(card?.set ?? '')
    .toUpperCase()
    .trim();
  if (!setCode) {
    return null;
  }
  const number = normalizeCardNumber(card?.number);
  if (!number) {
    return null;
  }
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
  const setCode = String(card?.set ?? '')
    .toUpperCase()
    .trim();
  const number = normalizeCardNumber(card?.number);
  if (setCode && number) {
    return `${baseName} (${setCode} ${number})`;
  }
  const fallbackId = buildCardId(card);
  return fallbackId ? `${baseName} (${fallbackId.replace('~', ' ')})` : baseName;
}

function ensureFilterMessageElement() {
  // Legacy function - disabled as we now use dedicated warning containers
  return null;
  // if (elements.filterMessage instanceof HTMLElement) {
  //   return elements.filterMessage;
  // }
  // const container = elements.filtersContainer;
  // if (!container) {
  //   return null;
  // }
  // const message = document.createElement('p');
  // message.className = 'archetype-filter-message';
  // message.hidden = true;
  // container.appendChild(message);
  // elements.filterMessage = message;
  // return message;
}

function updateFilterMessage(text, tone = 'info') {
  const message = ensureFilterMessageElement();
  if (!message) {
    return;
  }
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

function updateFilterEmptyState() {
  const message = elements.filterEmptyState;
  if (!message) {
    return;
  }
  const hasFilters = state.filterRows.length > 0;
  message.hidden = hasFilters;
}

function describeFilters(filters) {
  if (!filters || filters.length === 0) {
    return 'the baseline list';
  }

  const descriptions = filters.map(filter => {
    const info = state.cardLookup.get(filter.cardId);
    let desc = `${info?.name ?? filter.cardId}`;

    // Handle special operators
    if (filter.operator === 'any') {
      desc += ' (any count)';
    } else if (!filter.operator || filter.operator === '') {
      desc += ' (none)';
    } else if (filter.count !== null && filter.count !== undefined) {
      // Add quantity description for numeric operators
      const operatorText =
        {
          '=': 'exactly',
          '<': 'less than',
          '>': 'more than',
          '<=': 'at most',
          '>=': 'at least'
        }[filter.operator] || filter.operator;

      desc += ` (${operatorText} ${filter.count})`;
    }

    return desc;
  });

  if (descriptions.length === 1) {
    return `including ${descriptions[0]}`;
  }

  return `including ${descriptions.slice(0, -1).join(', ')} and ${descriptions[descriptions.length - 1]}`;
}

function describeSuccessFilter(tag) {
  if (!tag || tag === 'all') {
    return '';
  }
  return SUCCESS_FILTER_LABELS[tag] || tag;
}

function getFilterKey(filters, successFilter = 'all') {
  const base = successFilter || 'all';
  if (!filters || filters.length === 0) {
    return `${base}::null`;
  }

  return `${base}::${filters
    .map(f => {
      let part = f.cardId || 'null';
      if (f.operator === 'any') {
        part += '::any';
      } else if (f.operator === '') {
        part += '::none';
      } else if (f.operator && f.count !== null && f.count !== undefined) {
        part += `::${f.operator}${f.count}`;
      }
      return part;
    })
    .join('||')}`;
}

function normalizeThreshold(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (max <= min) {
    return min;
  }

  const clamped = Math.max(min, Math.min(max, value));
  const rounded = min + Math.round((clamped - min) / GRANULARITY_STEP_PERCENT) * GRANULARITY_STEP_PERCENT;
  return Math.max(min, Math.min(max, rounded));
}

function setPageState(status) {
  if (!elements.page) {
    return;
  }
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
      heading.textContent = message || "We couldn't load that archetype.";
    }
  }
}

function updateHero() {
  if (elements.title) {
    elements.title.textContent = state.archetypeLabel;
  }
  document.title = `${state.archetypeLabel} \u00B7 ${formatEventName(state.tournament)} \u2013 Ciphermaniac`;
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

function toLower(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function normalizeCategoryValue(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  return value.trim().toLowerCase().replace(/\\/g, '/');
}

function inferPrimaryCategory(card) {
  const direct = normalizeCategoryValue(card?.category);
  if (direct) {
    const [base] = direct.split(/[/-]/);
    if (base === 'pokemon' || base === 'trainer' || base === 'energy') {
      return base;
    }
  }

  if (card?.trainerType) {
    return 'trainer';
  }
  if (card?.energyType) {
    return 'energy';
  }

  const name = toLower(card?.name);
  const uid = toLower(card?.uid);

  if (name && TRAINER_HINT_KEYWORDS.some(keyword => name.includes(keyword))) {
    return 'trainer';
  }
  if (uid && TRAINER_HINT_KEYWORDS.some(keyword => uid.includes(keyword))) {
    return 'trainer';
  }

  const endsWithEnergy = name && name.endsWith(' energy');
  if (endsWithEnergy) {
    return 'energy';
  }
  if (!endsWithEnergy && uid && (uid.endsWith(' energy') || uid.includes(' energy::'))) {
    return 'energy';
  }
  if (name && name.includes(' energy ') && !TRAINER_HINT_KEYWORDS.some(keyword => name.includes(keyword))) {
    return 'energy';
  }

  return 'pokemon';
}

function inferTrainerSubtype(card) {
  const trainerType = toLower(card?.trainerType);
  if (trainerType) {
    return trainerType;
  }

  const name = toLower(card?.name);
  const uid = toLower(card?.uid);

  if (TRAINER_SUPPORTER_OVERRIDES.has(name) || TRAINER_SUPPORTER_OVERRIDES.has(uid)) {
    return 'supporter';
  }
  if (name.startsWith('technical machine') || uid.includes('technical_machine')) {
    return 'item';
  }
  if (name.includes('ace spec') || uid.includes('ace_spec')) {
    return 'ace-spec';
  }
  if (
    TRAINER_STADIUM_KEYWORDS.some(keyword => name.includes(keyword)) ||
    TRAINER_STADIUM_KEYWORDS.some(keyword => uid.includes(keyword))
  ) {
    return 'stadium';
  }
  if (
    TRAINER_TOOL_KEYWORDS.some(keyword => name.includes(keyword)) ||
    TRAINER_TOOL_KEYWORDS.some(keyword => uid.includes(keyword))
  ) {
    return 'tool';
  }
  if (
    TRAINER_SUPPORTER_KEYWORDS.some(keyword => name.includes(keyword)) ||
    TRAINER_SUPPORTER_KEYWORDS.some(keyword => uid.includes(keyword))
  ) {
    return 'supporter';
  }
  if (
    TRAINER_ITEM_KEYWORDS.some(keyword => name.includes(keyword)) ||
    TRAINER_ITEM_KEYWORDS.some(keyword => uid.includes(keyword))
  ) {
    return 'item';
  }

  return '';
}

function buildTrainerCategorySlug(card, baseCategory) {
  if (baseCategory !== 'trainer') {
    return '';
  }

  const parts = ['trainer'];
  const trainerType = inferTrainerSubtype(card);
  const normalizedTrainerType = trainerType === 'ace-spec' ? 'tool' : trainerType;

  if (normalizedTrainerType) {
    parts.push(normalizedTrainerType);
  }

  const hasAceSpec = Boolean(card?.aceSpec) || trainerType === 'ace-spec';
  if (hasAceSpec) {
    if (!parts.includes('tool')) {
      parts.push('tool');
    }
    parts.push('acespec');
  }

  return parts.join('/');
}

function buildEnergyCategorySlug(card, baseCategory) {
  if (baseCategory !== 'energy') {
    return '';
  }
  const energyType = toLower(card?.energyType);
  return energyType ? `energy/${energyType}` : 'energy';
}

function deriveCategorySlug(card) {
  const direct = normalizeCategoryValue(card?.category);
  if (direct) {
    if (direct.startsWith('trainer') && !direct.includes('/')) {
      return buildTrainerCategorySlug(card, 'trainer') || direct;
    }
    if (direct.startsWith('energy') && !direct.includes('/')) {
      return buildEnergyCategorySlug(card, 'energy') || direct;
    }
    return direct;
  }

  const baseCategory = inferPrimaryCategory(card);
  if (baseCategory === 'trainer') {
    return buildTrainerCategorySlug(card, baseCategory) || 'trainer';
  }
  if (baseCategory === 'energy') {
    return buildEnergyCategorySlug(card, baseCategory) || 'energy';
  }

  return baseCategory || 'pokemon';
}

function getCategorySortWeight(category) {
  if (!category) {
    return CARD_CATEGORY_SORT_PRIORITY.get('trainer') ?? 6;
  }
  const normalizedKey = category.replace(/-/g, '/');
  if (CARD_CATEGORY_SORT_PRIORITY.has(normalizedKey)) {
    return CARD_CATEGORY_SORT_PRIORITY.get(normalizedKey);
  }
  if (normalizedKey.startsWith('trainer')) {
    return 6;
  }
  if (normalizedKey.startsWith('energy')) {
    return 7;
  }
  return CARD_CATEGORY_SORT_PRIORITY.get('pokemon') ?? 0;
}

function sortItemsForDisplay(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const decorated = items.map((card, index) => {
    const categorySlug = deriveCategorySlug(card);
    const weight = getCategorySortWeight(categorySlug);
    const rank = Number.isFinite(card?.rank) ? Number(card.rank) : index;
    const usage = getUsagePercent(card);
    return {
      card,
      categorySlug,
      weight,
      rank,
      usage,
      index
    };
  });

  decorated.sort((left, right) => {
    if (left.weight !== right.weight) {
      return left.weight - right.weight;
    }
    if (left.rank !== right.rank) {
      return left.rank - right.rank;
    }
    if (right.usage !== left.usage) {
      return right.usage - left.usage;
    }
    const leftName = toLower(left.card?.name);
    const rightName = toLower(right.card?.name);
    if (leftName && rightName && leftName !== rightName) {
      return leftName.localeCompare(rightName);
    }
    return left.index - right.index;
  });

  return decorated.map(entry => {
    if (!entry.card) {
      return entry.card;
    }
    if (entry.card.category === entry.categorySlug) {
      return entry.card;
    }
    return { ...entry.card, category: entry.categorySlug };
  });
}

function syncGranularityOutput(threshold) {
  const safeValue = Number.isFinite(threshold) ? Math.max(GRANULARITY_MIN_PERCENT, threshold) : GRANULARITY_MIN_PERCENT;
  const step = elements.granularityRange
    ? Math.max(1, Number((elements.granularityRange as HTMLInputElement).step) || GRANULARITY_STEP_PERCENT)
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

  const desired = Number.isFinite(state.thresholdPercent) ? state.thresholdPercent : GRANULARITY_DEFAULT_PERCENT;
  const normalized = normalizeThreshold(desired, minValue, maxValue);
  state.thresholdPercent = normalized;
  syncGranularityOutput(normalized);
}

/**
 * Create a new filter row with card selector, operator, and count
 */
function createFilterRow() {
  const filterId = state.nextFilterId++;
  const filterRow = document.createElement('div');
  filterRow.className = 'archetype-filter-group';
  filterRow.dataset.filterId = String(filterId);

  // Card selector
  const cardSelect = document.createElement('select');
  cardSelect.className = 'filter-card-select';
  cardSelect.title = 'Select card to filter by';
  cardSelect.innerHTML = '<option value="">Choose card...</option>';

  // Operator selector (user-friendly labels, populated dynamically)
  const operatorSelect = document.createElement('select');
  operatorSelect.className = 'filter-operator-select';
  operatorSelect.title = 'Quantity condition';
  operatorSelect.hidden = true;

  // Count input
  const countInput = document.createElement('input');
  countInput.type = 'number';
  countInput.className = 'filter-count-input';
  countInput.title = 'Number of copies';
  countInput.min = '1';
  countInput.max = String(CARD_COUNT_DEFAULT_MAX);
  countInput.step = '1';
  countInput.value = '1';
  countInput.placeholder = '#';
  countInput.hidden = true;

  // Remove button (only show if there are multiple filters)
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'remove-filter-btn';
  removeButton.title = 'Remove this filter';
  removeButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

  filterRow.appendChild(cardSelect);
  filterRow.appendChild(operatorSelect);
  filterRow.appendChild(countInput);
  filterRow.appendChild(removeButton);

  // Add event listeners
  cardSelect.addEventListener('change', () => handleFilterChange(filterId));
  operatorSelect.addEventListener('change', () => handleFilterChange(filterId));
  countInput.addEventListener('change', () => handleFilterChange(filterId));
  countInput.addEventListener('input', () => handleFilterChange(filterId));
  removeButton.addEventListener('click', () => removeFilterRow(filterId));

  // Add to state
  state.filterRows.push({
    id: filterId,
    cardId: null,
    operator: null,
    count: null,
    elements: { cardSelect, operatorSelect, countInput, removeButton, container: filterRow }
  });

  updateFilterEmptyState();

  // Populate card options (excluding already-selected cards)
  populateFilterRowCards(filterId);

  return filterRow;
}

/**
 * Remove a filter row
 * @param filterId
 */
function removeFilterRow(filterId) {
  const index = state.filterRows.findIndex(row => row.id === filterId);
  if (index === -1) {
    return;
  }

  const row = state.filterRows[index];
  row.elements.container.remove();
  state.filterRows.splice(index, 1);
  updateFilterEmptyState();

  // Update remove button visibility - hide on first row if only one remains
  // if (state.filterRows.length === 1) {
  //   state.filterRows[0].elements.removeButton.hidden = true;
  // }

  // Update all dropdowns to reflect removed filter
  state.filterRows.forEach(r => populateFilterRowCards(r.id));

  // Update add button visibility
  updateAddFilterButtonVisibility();

  // Apply filters
  applyFilters().catch(error => {
    logger.debug('Filter removal failed', error?.message || error);
  });
}

/**
 * Populate card options for a specific filter row, excluding already-selected cards
 * @param filterId
 */
function populateFilterRowCards(filterId) {
  const row = state.filterRows.find(r => r.id === filterId);
  if (!row) {
    return;
  }

  const { cardSelect } = row.elements;
  const currentValue = cardSelect.value;

  // Get all selected card IDs (excluding this row's current selection)
  const selectedCards = new Set(state.filterRows.filter(r => r.id !== filterId && r.cardId).map(r => r.cardId));

  // Calculate deck total for sorting
  const deckTotal = state.defaultDeckTotal || state.archetypeDeckTotal || 0;

  // Sort cards by usage
  const sortedCards = [...state.allCards].sort((left, right) => {
    const leftFound = Number(left.found ?? 0);
    const leftTotal = Number(left.total ?? deckTotal);
    const leftPct = leftTotal > 0 ? (leftFound / leftTotal) * 100 : 0;

    const rightFound = Number(right.found ?? 0);
    const rightTotal = Number(right.total ?? deckTotal);
    const rightPct = rightTotal > 0 ? (rightFound / rightTotal) * 100 : 0;

    if (rightPct !== leftPct) {
      return rightPct - leftPct;
    }
    return (left.name || '').localeCompare(right.name || '');
  });

  // Clear and repopulate
  cardSelect.length = 1; // Keep the first "Choose card..." option

  const duplicateCounts = new Map();
  state.allCards.forEach(card => {
    const cardId = buildCardId(card);
    const baseName = card?.name;
    if (!cardId || !baseName) {
      return;
    }
    duplicateCounts.set(baseName, (duplicateCounts.get(baseName) || 0) + 1);
  });

  sortedCards.forEach(card => {
    const cardId = buildCardId(card);
    if (!cardId || selectedCards.has(cardId)) {
      return;
    }

    const option = document.createElement('option');
    option.value = cardId;
    option.textContent = formatCardOptionLabel(card, duplicateCounts);
    option.dataset.cardName = card.name || cardId;
    cardSelect.appendChild(option);
  });

  // Restore previous selection if still available
  if (currentValue) {
    cardSelect.value = currentValue;
  }
}

/**
 * Handle filter row changes
 * @param filterId
 */
function handleFilterChange(filterId) {
  const row = state.filterRows.find(r => r.id === filterId);
  if (!row) {
    return;
  }

  const { cardSelect, operatorSelect, countInput } = row.elements;
  const cardId = cardSelect.value || null;
  const operator = operatorSelect.value || null;
  let count = countInput.value ? parseInt(countInput.value, 10) : null;

  // Update state
  row.cardId = cardId;
  row.operator = operator;
  row.count = count;

  // Show/hide operator and count based on card selection
  const hasCard = cardId !== null && cardId !== '';

  if (hasCard) {
    // Populate operator options based on card characteristics
    const options = getOperatorOptionsForCard(cardId);
    const currentOperator = operatorSelect.value;
    operatorSelect.innerHTML = '';
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      operatorSelect.appendChild(option);
    });

    // Try to preserve current selection if still valid
    if (currentOperator && options.some(opt => opt.value === currentOperator)) {
      operatorSelect.value = currentOperator;
    } else {
      // Default to first option
      operatorSelect.value = options[0].value;
      row.operator = options[0].value;
    }

    operatorSelect.hidden = false;
  } else {
    operatorSelect.hidden = true;
  }

  const maxCopies = hasCard ? getMaxCopiesForCard(cardId) : CARD_COUNT_DEFAULT_MAX;
  countInput.max = String(maxCopies);
  if (count !== null && count > maxCopies) {
    count = maxCopies;
    countInput.value = String(count);
    row.count = count;
  }

  // Count input: hide if no operator selected, OR if operator is 'any' or ''
  const needsCount = hasCard && operator && operator !== 'any' && operator !== '';
  countInput.hidden = !needsCount;

  // If this is the last row and has a card selected, show add button
  updateAddFilterButtonVisibility();

  // Update all other filter rows to exclude this card
  if (hasCard) {
    state.filterRows.forEach(r => {
      if (r.id !== filterId) {
        populateFilterRowCards(r.id);
      }
    });
  }

  // Show remove button on all rows if there are multiple filters
  if (state.filterRows.length > 1) {
    state.filterRows.forEach(r => (r.elements.removeButton.hidden = false));
  }

  // Apply filters
  applyFilters().catch(error => {
    logger.debug('Filter change failed', error?.message || error);
  });
}

/**
 * Update add filter button visibility
 */
function updateAddFilterButtonVisibility() {
  if (!elements.addFilterButton) {
    return;
  }

  // Always show the button unless all cards have been selected
  const totalCards = state.allCards.length;
  const selectedCount = state.filterRows.filter(r => r.cardId).length;
  const hasMoreCards = selectedCount < totalCards;

  elements.addFilterButton.hidden = !hasMoreCards;
}

/**
 * Initialize filter rows (create the first one)
 */
function initializeFilterRows() {
  if (!elements.filterRowsContainer || !elements.addFilterButton) {
    return;
  }

  // Clear existing rows
  elements.filterRowsContainer.innerHTML = '';
  state.filterRows = [];
  state.nextFilterId = 1;

  // Create first row
  const firstRow = createFilterRow();
  elements.filterRowsContainer.appendChild(firstRow);

  // Add button click handler
  elements.addFilterButton.addEventListener('click', () => {
    const newRow = createFilterRow();
    elements.filterRowsContainer.appendChild(newRow);
    updateAddFilterButtonVisibility();
  });

  updateAddFilterButtonVisibility();
}

function populateCardDropdowns() {
  buildCardLookup();
  initializeFilterRows();
}

/**
 * Update card dropdowns based on current filter selections
 * Called on initial load and whenever a filter changes
 */
/**
 * Build the card lookup map from allCards
 */
function buildCardLookup() {
  state.cardLookup = new Map();

  const deckTotal = state.defaultDeckTotal || state.archetypeDeckTotal || 0;

  state.allCards.forEach(card => {
    const cardId = buildCardId(card);
    if (!cardId) {
      return;
    }

    const found = Number(card.found ?? 0);
    const total = Number(card.total ?? deckTotal);
    const pct = total > 0 ? (found / total) * 100 : 0;
    const alwaysIncluded = total > 0 && found === total;
    const normalizedNumber = normalizeCardNumber(card.number);
    const normalizedCategory = typeof card.category === 'string' ? card.category.toLowerCase() : null;
    const normalizedEnergyType = typeof card.energyType === 'string' ? card.energyType.toLowerCase() : null;

    state.cardLookup.set(cardId, {
      id: cardId,
      name: card.name || cardId,
      set: card.set || null,
      number: normalizedNumber || null,
      found,
      total,
      pct: Math.round(pct * 100) / 100,
      alwaysIncluded,
      category: normalizedCategory,
      energyType: normalizedEnergyType
    });
  });
}

function isBasicEnergyCard(cardInfo) {
  if (!cardInfo) {
    return false;
  }
  const energyType = typeof cardInfo.energyType === 'string' ? cardInfo.energyType : '';
  if (energyType === 'basic') {
    return true;
  }
  const category = typeof cardInfo.category === 'string' ? cardInfo.category : '';
  if (category.startsWith('energy/basic')) {
    return true;
  }
  const isSVEnergy = typeof cardInfo.set === 'string' && cardInfo.set.toUpperCase() === 'SVE';
  return category === 'energy' && isSVEnergy;
}

function getMaxCopiesForCard(cardId) {
  const info = state.cardLookup.get(cardId);
  return isBasicEnergyCard(info) ? CARD_COUNT_BASIC_ENERGY_MAX : CARD_COUNT_DEFAULT_MAX;
}

function resolveCardPrintInfo(card) {
  let setCode = typeof card?.set === 'string' ? card.set.trim().toUpperCase() : '';
  let numberValue = typeof card?.number === 'string' || typeof card?.number === 'number' ? card.number : '';

  if ((!setCode || !numberValue) && typeof card?.uid === 'string') {
    const segments = card.uid.split('::');
    if (segments.length >= 3) {
      if (!setCode) {
        setCode = segments[1].trim().toUpperCase();
      }
      if (!numberValue) {
        numberValue = segments[2].trim();
      }
    }
  }

  return {
    set: setCode,
    number: formatTcgliveCardNumber(numberValue)
  };
}

function pickCommonDistEntry(card) {
  if (!card || !Array.isArray(card.dist) || card.dist.length === 0) {
    return null;
  }

  return card.dist.reduce((best, candidate) => {
    if (!candidate) {
      return best;
    }
    if (!best) {
      return candidate;
    }

    const bestPercent = Number(best.percent) || 0;
    const candidatePercent = Number(candidate.percent) || 0;
    if (candidatePercent !== bestPercent) {
      return candidatePercent > bestPercent ? candidate : best;
    }

    const bestPlayers = Number(best.players) || 0;
    const candidatePlayers = Number(candidate.players) || 0;
    if (candidatePlayers !== bestPlayers) {
      return candidatePlayers > bestPlayers ? candidate : best;
    }

    const bestCopies = Number(best.copies) || 0;
    const candidateCopies = Number(candidate.copies) || 0;
    if (candidateCopies !== bestCopies) {
      return candidateCopies > bestCopies ? candidate : best;
    }

    return best;
  }, null);
}

function buildSkeletonExportEntries(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.reduce((entries, item) => {
    const mostCommon = pickCommonDistEntry(item);
    const copies = Number(mostCommon?.copies) || 0;
    if (copies <= 0) {
      return entries;
    }

    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name) {
      return entries;
    }

    const printInfo = resolveCardPrintInfo(item);
    const primaryCategory = inferPrimaryCategory(item);
    const normalizedCategory = ['pokemon', 'trainer', 'energy'].includes(primaryCategory) ? primaryCategory : 'pokemon';

    entries.push({
      name,
      copies,
      set: printInfo.set,
      number: printInfo.number,
      primaryCategory: normalizedCategory
    });
    return entries;
  }, /** @type {Array<{name:string,copies:number,set:string,number:string,primaryCategory:string}>} */([]));
}

function buildTcgliveExportString(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return '';
  }

  const sections = {
    pokemon: /** @type {typeof entries} */ ([]),
    trainer: /** @type {typeof entries} */ ([]),
    energy: /** @type {typeof entries} */ ([])
  };

  entries.forEach(entry => {
    if (!entry || !Number.isFinite(entry.copies) || entry.copies <= 0) {
      return;
    }
    const key =
      entry.primaryCategory === 'trainer' ? 'trainer' : entry.primaryCategory === 'energy' ? 'energy' : 'pokemon';
    sections[key].push(entry);
  });

  const lines = [];

  TCG_LIVE_SECTION_ORDER.forEach(({ key, label }) => {
    const cards = sections[key];
    if (!cards || cards.length === 0) {
      return;
    }
    const sectionTotal = cards.reduce((total, card) => total + card.copies, 0);
    lines.push(`${label}: ${sectionTotal}`);
    cards.forEach(card => {
      const parts = [String(card.copies), card.name];
      if (card.set) {
        parts.push(card.set);
      }
      if (card.number) {
        parts.push(card.number);
      }
      lines.push(parts.join(' '));
    });
    lines.push('');
  });

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}

function updateSkeletonExportStatus(message: string, tone: string = 'info') {
  if (!elements.skeletonExportStatus) {
    return;
  }
  if (!message) {
    elements.skeletonExportStatus.textContent = '';
    elements.skeletonExportStatus.hidden = true;
    elements.skeletonExportStatus.removeAttribute('data-tone');
    return;
  }
  elements.skeletonExportStatus.textContent = message;
  elements.skeletonExportStatus.hidden = false;
  if (tone) {
    elements.skeletonExportStatus.dataset.tone = tone;
  } else {
    elements.skeletonExportStatus.removeAttribute('data-tone');
  }
}

function syncSkeletonExportState() {
  const exportButton = document.getElementById('skeleton-export-live') as HTMLButtonElement | null;
  if (!exportButton) {
    return;
  }

  const hasCards = state.skeleton.exportEntries.length > 0;
  exportButton.disabled = !hasCards;
  if (!hasCards) {
    updateSkeletonExportStatus('');
  }
}

function attemptExecCommandCopy(text) {
  if (!globalThis.document || typeof globalThis.document.createElement !== 'function') {
    return false;
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch (error) {
    logger.warn('execCommand clipboard copy failed', error);
    return false;
  }
}

async function copyDecklistToClipboard(text) {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return 'clipboard';
    } catch (error) {
      logger.warn('navigator.clipboard.writeText failed, falling back', error);
    }
  }

  if (attemptExecCommandCopy(text)) {
    return 'execCommand';
  }

  const promptFn = typeof globalThis.window?.prompt === 'function' ? globalThis.window.prompt : null;
  if (promptFn) {
    const result = promptFn('Copy this TCG Live deck list:', text);
    if (result !== null) {
      return 'prompt';
    }
  }

  throw new Error('TCGLiveExportCopyCancelled');
}

async function handleSkeletonExport(event) {
  event.preventDefault();

  const { exportEntries, plainWarnings } = state.skeleton;
  if (!Array.isArray(exportEntries) || exportEntries.length === 0) {
    updateSkeletonExportStatus('No cards are available to export yet.', 'warning');
    return;
  }

  const exportText = buildTcgliveExportString(exportEntries);
  if (!exportText) {
    updateSkeletonExportStatus('Unable to build the TCG Live export.', 'error');
    return;
  }

  state.skeleton.lastExportText = exportText;

  try {
    const method = await copyDecklistToClipboard(exportText);
    const hasWarnings = Array.isArray(plainWarnings) && plainWarnings.length > 0;
    const warningNote = hasWarnings ? ` Warning: ${plainWarnings.join('; ')}` : '';
    const baseMessage =
      method === 'prompt' ? 'Deck list ready in a prompt for manual copy.' : 'Copied TCG Live deck list to clipboard.';
    const tone = hasWarnings ? 'warning' : 'success';
    updateSkeletonExportStatus(`${baseMessage}${warningNote}`, tone);
  } catch (error) {
    logger.warn('TCG Live export cancelled or failed', error);
    const isCancelled = error instanceof Error && error.message === 'TCGLiveExportCopyCancelled';
    const message = isCancelled
      ? 'Export cancelled before copy. Try again when you are ready.'
      : 'Unable to copy the deck list. Please try again.';
    updateSkeletonExportStatus(message, 'error');
  }
}

function setupSkeletonExport() {
  const exportButton = document.getElementById('skeleton-export-live');
  if (!exportButton) {
    return;
  }
  exportButton.addEventListener('click', handleSkeletonExport);
  syncSkeletonExportState();
}

/**
 * Check if a card name indicates it's an Ace Spec card.
 * @param {string} cardName
 * @returns {boolean}
 */
function isAceSpec(cardName) {
  const aceSpecKeywords = [
    'ace spec',
    'amulet of hope',
    'awakening drum',
    'brilliant blender',
    'computer search',
    'crystal edge',
    'crystal wall',
    'dangerous laser',
    'deluxe bomb',
    'dowsing machine',
    'energy search pro',
    'enriching energy',
    'g booster',
    'g scope',
    'gold potion',
    'grand tree',
    "hero's cape",
    'hyper aroma',
    'legacy energy',
    'life dew',
    'master ball',
    'max rod',
    'maximum belt',
    'megaton blower',
    'miracle headset',
    'neo upper energy',
    'neutralization zone',
    'poke vital a',
    'precious trolley',
    'prime catcher',
    'reboot pod',
    'rock guard',
    'scoop up cyclone',
    'scramble switch',
    'secret box',
    'sparkling crystal',
    'survival brace',
    'treasure tracker',
    'unfair stamp',
    'victory piece'
  ];
  const lowerName = (cardName || '').toLowerCase();
  return aceSpecKeywords.some(keyword => lowerName.includes(keyword));
}

/**
 * Build operator options based on card characteristics.
 * @param {string} cardId
 * @returns {Array<{value: string, label: string}>}
 */
function getOperatorOptionsForCard(cardId) {
  const cardInfo = state.cardLookup.get(cardId);
  if (!cardInfo) {
    return [
      { value: '', label: 'None' },
      { value: 'any', label: 'Any' },
      { value: '<', label: 'Less than' },
      { value: '>', label: 'More than' },
      { value: '=', label: 'Exactly' }
    ];
  }

  const isAlwaysIncluded = cardInfo.alwaysIncluded;
  const isAce = isAceSpec(cardInfo.name);

  // Ace Spec cards: only "None" or "Any"
  if (isAce) {
    return [
      { value: '', label: 'None' },
      { value: 'any', label: 'Any' }
    ];
  }

  // Cards in 100% of decks: no "None" option, but keep "Any" for flexibility
  if (isAlwaysIncluded) {
    return [
      { value: 'any', label: 'Any' },
      { value: '<', label: 'Less than' },
      { value: '>', label: 'More than' },
      { value: '=', label: 'Exactly' }
    ];
  }

  // Cards not in 100% of decks: full set including "Any"
  return [
    { value: '', label: 'None' },
    { value: 'any', label: 'Any' },
    { value: '<', label: 'Less than' },
    { value: '>', label: 'More than' },
    { value: '=', label: 'Exactly' }
  ];
}

/**
 * Update deck skeleton summary counts, warnings, and export readiness state.
 * @param {any[]} items
 */
/**
 * Update deck skeleton summary counts, warnings, and export readiness state.
 * @param {any[]} items
 */
function updateSkeletonSummary(items) {
  if (!elements.skeletonSummary || !elements.skeletonWarnings) {
    return;
  }

  updateSkeletonExportStatus('');

  const exportEntries = buildSkeletonExportEntries(items);

  let totalCount = 0;
  let aceSpecCount = 0;
  const aceSpecCards = [];

  exportEntries.forEach(entry => {
    totalCount += entry.copies;
    if (isAceSpec(entry.name)) {
      aceSpecCount += entry.copies;
      if (!aceSpecCards.includes(entry.name)) {
        aceSpecCards.push(entry.name);
      }
    }
  });

  // Generate warnings
  const displayWarnings = [];
  if (aceSpecCount > 1) {
    const warningText = `Multiple Ace Spec cards detected: ${aceSpecCards.join(', ')}`;
    displayWarnings.push(warningText);
  }
  if (totalCount > 60) {
    const warningText = `Deck exceeds 60 cards (${totalCount} cards)`;
    displayWarnings.push(warningText);
  }

  // Update warnings display
  if (displayWarnings.length > 0) {
    elements.skeletonWarnings.textContent = displayWarnings.join(' \u2022 ');
    elements.skeletonWarnings.hidden = false;
  } else {
    elements.skeletonWarnings.textContent = '';
    elements.skeletonWarnings.hidden = true;
  }

  // Construct detailed summary message
  // Format: "(X) decks and (Y) cards from (all/selected tournament finish type) (archetype name) decks (and optionally listing the filters)."
  const deckCount = state.archetypeDeckTotal || 0;
  const deckLabel = deckCount === 1 ? 'deck' : 'decks';
  const cardLabel = totalCount === 1 ? 'card' : 'cards';

  let finishLabel = SUCCESS_FILTER_LABELS[state.successFilter] || state.successFilter;
  if (finishLabel === 'all finishes') {
    finishLabel = 'all';
  } // "from all Gholdengo decks" reads better than "from all finishes Gholdengo decks"

  // Capitalize first letter of finish label if it's not 'all' or 'topX' which might be handled differently
  if (finishLabel !== 'all' && !finishLabel.startsWith('top')) {
    finishLabel = finishLabel.charAt(0).toUpperCase() + finishLabel.slice(1);
  } else if (finishLabel.startsWith('top')) {
    finishLabel = finishLabel.charAt(0).toUpperCase() + finishLabel.slice(1); // Ensure Top is capitalized
  }

  const archetypeName = state.archetypeLabel || 'Unknown';

  let message = `${deckCount} ${deckLabel} and ${totalCount} ${cardLabel} from ${finishLabel} ${archetypeName} decks`;

  // Append active filters description
  const activeFilters = state.filterRows.filter(r => r.cardId);
  if (activeFilters.length > 0) {
    const filterDescriptions = activeFilters.map(filter => {
      const cardName = state.cardLookup.get(filter.cardId)?.name || 'Unknown Card';
      const { operator } = filter;
      const { count } = filter;

      if (!operator || operator === 'any') {
        return `any ${cardName}`;
      }
      if (operator === '=') {
        return `${count} ${cardName}`;
      }
      if (operator === '>') {
        return `more than ${count} ${cardName}`;
      }
      if (operator === '<') {
        return `less than ${count} ${cardName}`;
      }
      return `${operator} ${count} ${cardName}`;
    });

    if (filterDescriptions.length === 1) {
      message += ` including ${filterDescriptions[0]}`;
    } else {
      const last = filterDescriptions.pop();
      message += ` including ${filterDescriptions.join(', ')} and ${last}`;
    }
  }

  message += '.';

  elements.skeletonSummary.textContent = message;
  elements.skeletonSummary.hidden = false;

  state.skeleton.totalCards = totalCount;
  state.skeleton.exportEntries = exportEntries;
  state.skeleton.displayWarnings = displayWarnings;

  syncSkeletonExportState();
}

// Track the last rendered threshold to avoid unnecessary re-renders
let lastRenderedThreshold: number | null = null;
let thresholdRenderPending = false;

/**
 * Render cards with threshold filtering.
 * Uses requestAnimationFrame to batch rapid threshold changes.
 */
function renderCardsWithThreshold(threshold: number) {
  // Skip if threshold hasn't actually changed from last render
  if (lastRenderedThreshold === threshold) {
    return;
  }
  
  if (thresholdRenderPending) {
    return; // Already have a pending render
  }
  
  thresholdRenderPending = true;
  
  // Use rAF to batch rapid slider movements into single renders
  requestAnimationFrame(() => {
    thresholdRenderPending = false;
    
    const currentThreshold = state.thresholdPercent;
    if (lastRenderedThreshold === currentThreshold) {
      return; // Threshold hasn't changed
    }
    
    const visibleItems = filterItemsByThreshold(state.items, currentThreshold);
    const sortedVisibleItems = sortItemsForDisplay(visibleItems);
    
    const grid = document.getElementById('grid') as GridElement | null;
    if (grid) {
      grid._visibleRows = 24;
    }
    
    render(sortedVisibleItems, state.overrides, RENDER_COMPACT_OPTIONS as any);
    lastRenderedThreshold = currentThreshold;
    
    syncGranularityOutput(currentThreshold);
    updateSkeletonSummary(sortedVisibleItems);
  });
}

function renderCards() {
  if (!Array.isArray(state.items)) {
    return;
  }

  configureGranularity(state.items);
  const threshold = Number.isFinite(state.thresholdPercent) ? state.thresholdPercent : GRANULARITY_DEFAULT_PERCENT;
  const visibleItems = filterItemsByThreshold(state.items, threshold);
  const sortedVisibleItems = sortItemsForDisplay(visibleItems);

  const grid = document.getElementById('grid') as GridElement | null;
  if (grid) {
    grid._visibleRows = 24;
  }
  render(sortedVisibleItems, state.overrides, RENDER_COMPACT_OPTIONS as any);
  lastRenderedThreshold = threshold;
  syncGranularityOutput(threshold);
  updateSkeletonSummary(sortedVisibleItems);
  // Note: updateLayout() call removed - render() already handles layout correctly
}

/**
 * Load filtered card data using client-side filtering.
 * @param {FilterDescriptor[]} filters
 * @returns {Promise<{deckTotal: number, items: any[], raw?: any}>}
 */
function loadFilterCombination(filters) {
  const key = getFilterKey(filters, state.successFilter);
  logger.info('loadFilterCombination called', {
    filterCount: filters?.length,
    filters,
    key,
    hasCached: state.filterCache.has(key)
  });

  if (state.filterCache.has(key)) {
    logger.debug('Using cached filter result', { key });
    return state.filterCache.get(key);
  }

  const promise = (async () => {
    try {
      // All filtering is performed client-side
      const { fetchAllDecks, generateReportForFilters, filterDecksBySuccess } = await import(
        './utils/clientSideFiltering.js'
      );

      logger.info('Loading decks for client-side filtering', {
        filterCount: filters.length,
        tournament: state.tournament,
        archetypeBase: state.archetypeBase,
        successFilter: state.successFilter
      });

      const allDecks = await fetchAllDecks(state.tournament);
      const eligibleDecks = filterDecksBySuccess(allDecks, state.successFilter);
      const report = generateReportForFilters(eligibleDecks, state.archetypeBase, filters);

      logger.info('Built filtered report', {
        itemsCount: report.items?.length || 0,
        deckTotal: report.deckTotal,
        filterCount: filters.length,
        successFilter: state.successFilter,
        eligibleDecks: eligibleDecks.length
      });

      return {
        deckTotal: report.deckTotal,
        items: report.items,
        raw: report.raw || { generatedClientSide: true }
      };
    } catch (error) {
      logger.error('Filter combination loading failed', error);
      state.filterCache.delete(key);
      throw error;
    }
  })();

  state.filterCache.set(key, promise);
  return promise;
}

/**
 * Count unique decks from filtered items
 * @param {Array} instances - Instance array
 * @param {Array} found - Found array
 * @returns {Array} Histogram distribution
 */
function _buildDistributionFromInstances(instances, found) {
  if (!Array.isArray(instances) || instances.length === 0) {
    return [];
  }
  const histogram = new Map();
  instances.forEach(entry => {
    const copies = Number(entry?.count) || 0;
    histogram.set(copies, (histogram.get(copies) || 0) + 1);
  });
  const totalFound = Array.isArray(found) ? found.length : Number(found) || 0;
  return Array.from(histogram.entries())
    .map(([copies, players]) => ({
      copies,
      players,
      percent: totalFound > 0 ? Math.round(((players / totalFound) * 100 + Number.EPSILON) * 100) / 100 : 0
    }))
    .sort((itemA, itemB) => {
      if (itemB.percent !== itemA.percent) {
        return itemB.percent - itemA.percent;
      }
      return itemB.copies - itemA.copies;
    });
}

/**
 * Apply additional filters client-side
 */
async function resetToDefaultData() {
  await applySuccessFilter();
  state.filterRows.forEach(row => {
    row.cardId = null;
    row.operator = null;
    row.count = null;
    row.elements.cardSelect.value = '';
    row.elements.operatorSelect.value = '';
    row.elements.operatorSelect.hidden = true;
    row.elements.countInput.value = '';
    row.elements.countInput.hidden = true;
  });
  updateFilterMessage('');
}

/**
 * Sync state with the currently selected filters and refresh the rendered card list.
 */
async function applyFilters() {
  if (!state.tournament || !state.archetypeBase) {
    return;
  }

  // Get all active filters (rows with a card selected)
  const activeFilters = state.filterRows
    .filter(row => row.cardId)
    .map(row => ({
      cardId: row.cardId,
      operator: row.operator || null,
      count: row.count || null
    }));

  logger.debug('Applying filters', { activeFilters, filterRowsCount: state.filterRows.length });

  // If no filters, reset to default
  if (activeFilters.length === 0) {
    await resetToDefaultData();
    return;
  }

  // Check for always-included cards with invalid operator combinations
  for (const filter of activeFilters) {
    const info = state.cardLookup.get(filter.cardId);
    // Always-included cards can't use empty operator (none) - they're in all decks
    if (info?.alwaysIncluded && (!filter.operator || filter.operator === '')) {
      updateFilterMessage(
        `${info.name} is in 100% of decks. Select "Any" or a quantity operator to filter by copy count.`,
        'info'
      );
      return;
    }
  }

  const successLabel = describeSuccessFilter(state.successFilter);
  const comboLabel = successLabel
    ? `${describeFilters(activeFilters)} (${successLabel})`
    : describeFilters(activeFilters);
  updateFilterMessage(`Crunching the numbers for decks ${comboLabel}...`, 'info');

  const requestKey = getFilterKey(activeFilters, state.successFilter);

  try {
    const result = await loadFilterCombination(activeFilters);

    logger.debug('Filter result', { deckTotal: result.deckTotal, itemsCount: result.items.length });

    // Check if the request is still current
    const currentActiveFilters = state.filterRows
      .filter(row => row.cardId)
      .map(row => ({
        cardId: row.cardId,
        operator: row.operator || null,
        count: row.count || null
      }));
    const activeKey = getFilterKey(currentActiveFilters, state.successFilter);
    if (activeKey !== requestKey) {
      logger.debug('Filter request outdated, ignoring');
      return;
    }

    // eslint-disable-next-line require-atomic-updates -- Guarded by requestKey check
    Object.assign(state, {
      items: result.items,
      archetypeDeckTotal: result.deckTotal
    });

    if (!result.deckTotal || result.items.length === 0) {
      updateFilterMessage(`No decks match ${comboLabel}.`, 'warning');
    } else {
      const deckLabel = result.deckTotal === 1 ? 'deck' : 'decks';
      updateFilterMessage(`${result.deckTotal} ${deckLabel} match ${comboLabel}.`, 'info');
    }
    renderCards();
  } catch (error) {
    logger.error('Filter application failed', error);

    if (error instanceof AppError && error.context?.status === 404) {
      updateFilterMessage(`No decks match ${comboLabel}.`, 'warning');
      // eslint-disable-next-line require-atomic-updates -- Selection validated above
      Object.assign(state, {
        items: [],
        archetypeDeckTotal: 0
      });
      renderCards();
      return;
    }

    // Check if this is a client-side filtering failure
    if (error.message && error.message.includes('timed out')) {
      updateFilterMessage(`Unable to load deck data for filtering. Request timed out.`, 'warning');
      // eslint-disable-next-line require-atomic-updates -- Selection validated above
      Object.assign(state, {
        items: [],
        archetypeDeckTotal: 0
      });
      renderCards();
      return;
    }

    logger.exception('Failed to apply filter', error);
    updateFilterMessage('We ran into an issue loading that combination. Please try again.', 'warning');
    // Clear the loading state
    Object.assign(state, {
      items: [],
      archetypeDeckTotal: 0
    });
    renderCards();
  }
}

/**
 * Build the baseline dataset for the current success filter (no card-level filters).
 * Falls back to the server-provided default data when showing all finishes.
 */
async function loadSuccessBaseline() {
  if (state.successFilter === 'all') {
    return {
      deckTotal: state.defaultDeckTotal,
      items: state.defaultItems
    };
  }

  const { fetchAllDecks, filterDecksBySuccess, generateReportForFilters } = await import(
    './utils/clientSideFiltering.js'
  );
  const allDecks = await fetchAllDecks(state.tournament);
  const eligible = filterDecksBySuccess(allDecks, state.successFilter);
  const report = generateReportForFilters(eligible, state.archetypeBase, []);

  return {
    deckTotal: report.deckTotal,
    items: report.items
  };
}

async function applySuccessFilter() {
  const baseline = await loadSuccessBaseline();
  Object.assign(state, {
    items: baseline.items,
    archetypeDeckTotal: baseline.deckTotal
  });
  const label = SUCCESS_FILTER_LABELS[state.successFilter] || 'selected finish';
  if (!baseline.deckTotal) {
    updateFilterMessage(`No decks found for ${label}.`, 'warning');
  } else {
    updateFilterMessage('');
  }
  renderCards();
}

function handleGranularityInput(event) {
  const target = /** @type {HTMLInputElement|null} */ (event.currentTarget || event.target);
  if (!target || !Array.isArray(state.items) || state.items.length === 0) {
    return;
  }

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
    // Use batched render to avoid multiple rapid re-renders
    renderCardsWithThreshold(normalized);
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

function setupSuccessFilter() {
  const select = elements.successFilter;
  if (!select) {
    return;
  }
  select.value = state.successFilter;
  select.addEventListener('change', async event => {
    const target = event.target as HTMLSelectElement | null;
    const next = String(target?.value || 'all');
    if (next === state.successFilter) {
      return;
    }
    state.successFilter = next;
    state.filterCache.clear();
    updateFilterMessage(`Loading ${SUCCESS_FILTER_LABELS[next] || 'selected finish'} decks...`, 'info');
    try {
      await applyFilters();
    } catch (error) {
      logger.exception('Failed to apply success filter', error);
      updateFilterMessage('Unable to apply placement filter. Showing all decks instead.', 'warning');
      state.successFilter = 'all';
      if (elements.successFilter) {
        elements.successFilter.value = 'all';
      }
      await applyFilters();
    }
  });
}

async function initialize() {
  const base = extractArchetypeFromLocation();
  if (!base) {
    showError('Choose an archetype from the archetypes page first.');
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

    // Archetype analysis always uses "Online - Last 14 Days" for include-exclude support
    // We don't need tournaments.json since we're only working with online meta
    const onlineMeta = 'Online - Last 14 Days';
    state.tournament = onlineMeta;

    const [overrides, tournamentReport, archetypeRaw] = await Promise.all([
      Promise.resolve({}),
      fetchReport(state.tournament),
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
      filterCache: new Map()
    });

    updateHero();
    ensureFilterMessageElement();
    updateFilterMessage('');
    setupSuccessFilter();
    populateCardDropdowns();
    renderCards();

    if (elements.loading) {
      elements.loading.hidden = true;
    }
    if (elements.error) {
      elements.error.hidden = true;
    }
    const simple = elements.simple as HTMLElement | null;
    const grid = elements.grid as HTMLElement | null;
    if (simple) {
      simple.hidden = false;
    }
    if (grid) {
      grid.hidden = false;
    }
    setPageState('ready');
  } catch (error) {
    logger.exception('Failed to load archetype detail', error);
    toggleLoading(false);
    showError("We couldn't load that archetype.");
    setPageState('error');
  }
}

// Throttle resize handler to improve performance
let resizeTicking = false;
window.addEventListener('resize', () => {
  if (resizeTicking || state.items.length === 0) {
    return;
  }
  resizeTicking = true;
  requestAnimationFrame(() => {
    updateLayout();
    resizeTicking = false;
  });
});

// Collapsible filters functionality
function setupFilterCollapse() {
  const filtersLabel = document.querySelector('.archetype-filters-label');
  const filtersContainer = document.querySelector('.archetype-filters');

  if (!filtersLabel || !filtersContainer) {
    return;
  }

  filtersLabel.addEventListener('click', () => {
    filtersContainer.classList.toggle('collapsed');
  });
}

function setupControlsToggle() {
  const toggleBtn = document.getElementById('controls-toggle');
  const body = document.getElementById('controls-body');

  if (!toggleBtn || !body) {
    return;
  }

  toggleBtn.addEventListener('click', () => {
    const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    toggleBtn.setAttribute('aria-expanded', String(!isExpanded));
    body.hidden = isExpanded;
  });
}

if (typeof document !== 'undefined') {
  setupGranularityListeners();
  setupSkeletonExport();
  setupFilterCollapse();
  setupControlsToggle();
  initialize();
}
