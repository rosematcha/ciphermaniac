import './utils/buildVersion.js';
import {
  fetchArchetypeFiltersReport,
  fetchArchetypeReport,
  fetchOverrides,
  fetchReport,
  fetchTournamentsList
} from './api.js';
import { parseReport } from './parse.js';
import { render, updateLayout } from './render.js';
import { normalizeCardNumber } from './card/routing.js';
import { AppError, safeAsync } from './utils/errorHandler.js';
import { logger } from './utils/logger.js';

const GRANULARITY_MIN_PERCENT = 0;
const GRANULARITY_DEFAULT_PERCENT = 60; // Default granularity percent
const GRANULARITY_STEP_PERCENT = 5;
const RENDER_COMPACT_OPTIONS = { layoutMode: 'compact' };

const elements = {
  page: document.querySelector('.archetype-page'),
  loading: document.getElementById('archetype-loading'),
  error: document.getElementById('archetype-error'),
  simple: /** @type {HTMLElement|null} */ (
    document.querySelector('.archetype-simple')
  ),
  grid: /** @type {HTMLElement|null} */ (document.getElementById('grid')),
  title: document.getElementById('archetype-title'),
  granularityRange: /** @type {HTMLInputElement|null} */ (
    document.getElementById('archetype-granularity-range')
  ),
  granularityOutput: /** @type {HTMLOutputElement|null} */ (
    document.getElementById('archetype-granularity-output')
  ),
  includeCard: /** @type {HTMLSelectElement|null} */ (
    document.getElementById('archetype-include-card')
  ),
  excludeCard: /** @type {HTMLSelectElement|null} */ (
    document.getElementById('archetype-exclude-card')
  ),
  includeCount: /** @type {HTMLInputElement|null} */ (
    document.getElementById('archetype-include-count')
  ),
  excludeCount: /** @type {HTMLInputElement|null} */ (
    document.getElementById('archetype-exclude-count')
  ),
  includeCountFilter: /** @type {HTMLElement|null} */ (
    document.getElementById('include-count-filter')
  ),
  excludeCountFilter: /** @type {HTMLElement|null} */ (
    document.getElementById('exclude-count-filter')
  ),
  filtersContainer: /** @type {HTMLElement|null} */ (
    document.querySelector('.archetype-controls')
  ),
  filterMessage: /** @type {HTMLElement|null} */ (null),
  skeletonSummary: /** @type {HTMLElement|null} */ (
    document.getElementById('skeleton-summary')
  ),
  skeletonCountValue: /** @type {HTMLElement|null} */ (
    document.getElementById('skeleton-count-value')
  ),
  skeletonWarnings: /** @type {HTMLElement|null} */ (
    document.getElementById('skeleton-warnings')
  ),
  skeletonExportButton: /** @type {HTMLButtonElement|null} */ (
    document.getElementById('skeleton-export-live')
  ),
  skeletonExportStatus: /** @type {HTMLElement|null} */ (
    document.getElementById('skeleton-export-status')
  )
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
  currentFilters: {
    include: null,
    exclude: null,
    includeCount: 1,
    excludeCount: 0
  },
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
    lastExportText: '',
  }
};

const CARD_CATEGORY_SORT_PRIORITY = new Map([
  ['pokemon', 0],
  ['trainer-supporter', 1],
  ['trainer-item', 2],
  ['trainer-tool', 3],
  ['trainer-stadium', 4],
  ['trainer-other', 5],
  ['trainer', 5],
  ['energy-basic', 6],
  ['energy-special', 7],
  ['energy', 6]
]);

const WARNING_ICON = '\u26A0\uFE0F';

const TCG_LIVE_SECTION_ORDER = [
  { key: 'pokemon', label: 'Pok\u00E9mon' },
  { key: 'trainer', label: 'Trainer' },
  { key: 'energy', label: 'Energy' }
];

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
  'sparky',
]);

const TRAINER_SUPPORTER_KEYWORDS = [
  'professor\'',
  'professor ',
  'boss\'s orders',
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
  'n\'s ',
  'n\u2019s ',
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
  ' cave',
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
  ' anklet',
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
  'technical machine',
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
  'tool',
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
    logger.debug(
      'Failed to decode pathname when searching for archetype slug',
      {
        pathname,
        message: error?.message
      },
    );
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
  return fallbackId
    ? `${baseName} (${fallbackId.replace('~', ' ')})`
    : baseName;
}

function ensureFilterMessageElement() {
  if (elements.filterMessage instanceof HTMLElement) {
    return elements.filterMessage;
  }
  const container = elements.filtersContainer;
  if (!container) {
    return null;
  }
  const message = document.createElement('p');
  message.className = 'archetype-filter-message';
  message.hidden = true;
  container.appendChild(message);
  elements.filterMessage = message;
  return message;
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

function getFilterKey(
  includeId,
  excludeId,
  includeCount = 1,
  excludeCount = 0
) {
  return `${includeId || 'null'}::${excludeId || 'null'}::${includeCount}::${excludeCount}`;
}

function normalizeThreshold(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (max <= min) {
    return min;
  }

  const clamped = Math.max(min, Math.min(max, value));
  const rounded =
    min +
    Math.round((clamped - min) / GRANULARITY_STEP_PERCENT) *
      GRANULARITY_STEP_PERCENT;
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
      heading.textContent = message || 'We couldn\'t load that archetype.';
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
  if (
    Number.isFinite(card.found) &&
    Number.isFinite(card.total) &&
    card.total > 0
  ) {
    return (card.found / card.total) * 100;
  }
  return 0;
}

function toLower(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function inferPrimaryCategory(card) {
  const directDisplay = toLower(card?.displayCategory);
  if (directDisplay.startsWith('trainer')) {
    return 'trainer';
  }
  if (directDisplay.startsWith('energy')) {
    return 'energy';
  }
  if (directDisplay === 'pokemon') {
    return 'pokemon';
  }
  const rawCategory = toLower(card?.category);
  if (
    rawCategory === 'pokemon' ||
    rawCategory === 'trainer' ||
    rawCategory === 'energy'
  ) {
    return rawCategory;
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
  if (
    !endsWithEnergy &&
    uid &&
    (uid.endsWith(' energy') || uid.includes(' energy::'))
  ) {
    return 'energy';
  }
  if (
    name &&
    name.includes(' energy ') &&
    !TRAINER_HINT_KEYWORDS.some(keyword => name.includes(keyword))
  ) {
    return 'energy';
  }
  return 'pokemon';
}

function inferTrainerSubtype(card) {
  const name = toLower(card?.name);
  const uid = toLower(card?.uid);

  if (
    TRAINER_SUPPORTER_OVERRIDES.has(name) ||
    TRAINER_SUPPORTER_OVERRIDES.has(uid)
  ) {
    return 'trainer-supporter';
  }

  if (
    name.startsWith('technical machine') ||
    uid.includes('technical_machine')
  ) {
    return 'trainer-item';
  }

  if (name.includes('ace spec') || uid.includes('ace_spec')) {
    return 'trainer-item';
  }

  if (
    TRAINER_STADIUM_KEYWORDS.some(keyword => name.includes(keyword)) ||
    TRAINER_STADIUM_KEYWORDS.some(keyword => uid.includes(keyword))
  ) {
    return 'trainer-stadium';
  }

  if (
    TRAINER_TOOL_KEYWORDS.some(keyword => name.includes(keyword)) ||
    TRAINER_TOOL_KEYWORDS.some(keyword => uid.includes(keyword))
  ) {
    return 'trainer-tool';
  }

  if (
    TRAINER_SUPPORTER_KEYWORDS.some(keyword => name.includes(keyword)) ||
    TRAINER_SUPPORTER_KEYWORDS.some(keyword => uid.includes(keyword))
  ) {
    return 'trainer-supporter';
  }

  if (
    TRAINER_ITEM_KEYWORDS.some(keyword => name.includes(keyword)) ||
    TRAINER_ITEM_KEYWORDS.some(keyword => uid.includes(keyword))
  ) {
    return 'trainer-item';
  }

  return 'trainer-other';
}

function deriveDisplayCategory(card) {
  const direct = toLower(card?.displayCategory);
  if (direct) {
    return direct;
  }
  const baseCategory = toLower(card?.category);
  const trainerType = toLower(card?.trainerType);
  if (baseCategory === 'trainer' && trainerType) {
    return `trainer-${trainerType}`;
  }
  const energyType = toLower(card?.energyType);
  if (baseCategory === 'energy' && energyType) {
    return `energy-${energyType}`;
  }
  const primary = inferPrimaryCategory(card);
  if (primary === 'trainer') {
    const inferred = inferTrainerSubtype(card);
    if (inferred && inferred !== 'trainer') {
      return inferred;
    }
    return 'trainer-other';
  }
  if (primary === 'energy') {
    return energyType ? `energy-${energyType}` : 'energy';
  }
  return primary || 'pokemon';
}

function getCategorySortWeight(category) {
  if (!category) {
    return CARD_CATEGORY_SORT_PRIORITY.get('trainer') ?? 5;
  }
  return (
    CARD_CATEGORY_SORT_PRIORITY.get(category) ??
    (category.startsWith('trainer') ? 5 : 6)
  );
}

function sortItemsForDisplay(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const decorated = items.map((card, index) => {
    const displayCategory = deriveDisplayCategory(card);
    const weight = getCategorySortWeight(displayCategory);
    const rank = Number.isFinite(card?.rank) ? Number(card.rank) : index;
    const usage = getUsagePercent(card);
    return {
      card,
      displayCategory,
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
    if (entry.card.displayCategory === entry.displayCategory) {
      return entry.card;
    }
    return { ...entry.card, displayCategory: entry.displayCategory };
  });
}

function syncGranularityOutput(threshold) {
  const safeValue = Number.isFinite(threshold)
    ? Math.max(GRANULARITY_MIN_PERCENT, threshold)
    : GRANULARITY_MIN_PERCENT;
  const step = elements.granularityRange
    ? Math.max(
      1,
      Number(elements.granularityRange.step) || GRANULARITY_STEP_PERCENT
      )
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
  const numericThreshold = Number.isFinite(threshold)
    ? threshold
    : GRANULARITY_MIN_PERCENT;
  const filtered = items.filter(
    item => getUsagePercent(item) >= numericThreshold
  );
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
  const maxValue = Math.min(
    100,
    Math.ceil(computedMax / GRANULARITY_STEP_PERCENT) *
      GRANULARITY_STEP_PERCENT
  );
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
    (left.name || '').localeCompare(right.name || ''),
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

function resolveCardPrintInfo(card) {
  let setCode =
    typeof card?.set === 'string' ? card.set.trim().toUpperCase() : '';
  let numberValue =
    typeof card?.number === 'string' || typeof card?.number === 'number'
      ? card.number
      : '';

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
    const normalizedCategory = ['pokemon', 'trainer', 'energy'].includes(
      primaryCategory
    )
      ? primaryCategory
      : 'pokemon';

    entries.push({
      name,
      copies,
      set: printInfo.set,
      number: printInfo.number,
      primaryCategory: normalizedCategory
    });
    return entries;
  }, /** @type {Array<{name:string,copies:number,set:string,number:string,primaryCategory:string}>} */ ([]));
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
      entry.primaryCategory === 'trainer'
        ? 'trainer'
        : entry.primaryCategory === 'energy'
          ? 'energy'
          : 'pokemon';
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

function updateSkeletonExportStatus(message, tone) {
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
  if (!elements.skeletonExportButton) {
    return;
  }

  const hasCards = state.skeleton.exportEntries.length > 0;
  elements.skeletonExportButton.disabled = !hasCards;
  if (!hasCards) {
    updateSkeletonExportStatus('');
  }
}

function attemptExecCommandCopy(text) {
  if (
    !globalThis.document ||
    typeof globalThis.document.createElement !== 'function'
  ) {
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

  const promptFn =
    typeof globalThis.window?.prompt === 'function'
      ? globalThis.window.prompt
      : null;
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
    updateSkeletonExportStatus(
      'No cards are available to export yet.',
      'warning',
    );
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
    const hasWarnings =
      Array.isArray(plainWarnings) && plainWarnings.length > 0;
    const warningNote = hasWarnings
      ? ` Warning: ${plainWarnings.join('; ')}`
      : '';
    const baseMessage =
      method === 'prompt'
        ? 'Deck list ready in a prompt for manual copy.'
        : 'Copied TCG Live deck list to clipboard.';
    const tone = hasWarnings ? 'warning' : 'success';
    updateSkeletonExportStatus(`${baseMessage}${warningNote}`, tone);
  } catch (error) {
    logger.warn('TCG Live export cancelled or failed', error);
    const isCancelled =
      error instanceof Error && error.message === 'TCGLiveExportCopyCancelled';
    const message = isCancelled
      ? 'Export cancelled before copy. Try again when you are ready.'
      : 'Unable to copy the deck list. Please try again.';
    updateSkeletonExportStatus(message, 'error');
  }
}

function setupSkeletonExport() {
  if (!elements.skeletonExportButton) {
    return;
  }
  elements.skeletonExportButton.addEventListener('click', handleSkeletonExport);
  syncSkeletonExportState();
}

function isAceSpec(cardName) {
  // Common Ace Spec card names - you can expand this list
  const aceSpecKeywords = [
    'ace spec',
    'computer search',
    'dowsing machine',
    'scramble switch',
    'master ball',
    'legacy energy',
    'prime catcher',
    'reboot pod',
    'secret box',
  ];
  const lowerName = cardName.toLowerCase();
  return aceSpecKeywords.some(keyword => lowerName.includes(keyword));
}

function updateSkeletonSummary(items) {
  if (
    !elements.skeletonSummary ||
    !elements.skeletonCountValue ||
    !elements.skeletonWarnings
  ) {
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

  // Update the count display
  elements.skeletonCountValue.textContent = String(totalCount);

  // Generate warnings
  const plainWarnings = [];
  const displayWarnings = [];
  if (aceSpecCount > 1) {
    const warningText = `Multiple Ace Spec cards detected: ${aceSpecCards.join(', ')}`;
    plainWarnings.push(warningText);
    displayWarnings.push(`${WARNING_ICON} ${warningText}`);
  }
  if (totalCount > 60) {
    const warningText = `Deck exceeds 60 cards (${totalCount} cards)`;
    plainWarnings.push(warningText);
    displayWarnings.push(`${WARNING_ICON} ${warningText}`);
  }

  // Update warnings display
  if (displayWarnings.length > 0) {
    elements.skeletonWarnings.textContent = displayWarnings.join(' \u2022 ');
    elements.skeletonWarnings.hidden = false;
  } else {
    elements.skeletonWarnings.textContent = '';
    elements.skeletonWarnings.hidden = true;
  }

  elements.skeletonSummary.hidden = false;

  state.skeleton.totalCards = totalCount;
  state.skeleton.exportEntries = exportEntries;
  state.skeleton.plainWarnings = plainWarnings;
  state.skeleton.displayWarnings = displayWarnings;

  syncSkeletonExportState();
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
  const sortedVisibleItems = sortItemsForDisplay(visibleItems);

  const grid = document.getElementById('grid');
  if (grid) {
    grid._visibleRows = 24;
  }
  render(sortedVisibleItems, state.overrides, RENDER_COMPACT_OPTIONS);
  syncGranularityOutput(threshold);
  updateSkeletonSummary(sortedVisibleItems);
  requestAnimationFrame(() => {
    updateLayout();
  });
}

function loadFilterCombination(
  includeId,
  excludeId,
  includeCount = 1,
  excludeCount = 0
) {
  const key = getFilterKey(includeId, excludeId, includeCount, excludeCount);
  if (state.filterCache.has(key)) {
    return state.filterCache.get(key);
  }

  const promise = (async () => {
    try {
      const raw = await fetchArchetypeFiltersReport(
        state.tournament,
        state.archetypeBase,
        includeId,
        excludeId,
        includeCount,
        excludeCount
      );
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
  state.currentFilters = {
    include: null,
    exclude: null,
    includeCount: 1,
    excludeCount: 0
  };
  updateFilterMessage('');
  renderCards();
}

function applyAlwaysIncludedGuard(includeId) {
  if (!includeId) {
    return null;
  }
  const info = state.cardLookup.get(includeId);
  if (info?.alwaysIncluded) {
    return null;
  }
  return includeId;
}

function handleImpossibleExclusion(excludeId) {
  if (!excludeId) {
    return false;
  }
  const info = state.cardLookup.get(excludeId);
  if (!info?.alwaysIncluded) {
    return false;
  }
  updateFilterMessage(
    `${state.archetypeLabel} decks always play ${info.name}. Try a different exclusion.`,
    'warning',
  );
  state.items = [];
  state.archetypeDeckTotal = 0;
  state.currentFilters = {
    include: null,
    exclude: excludeId,
    includeCount: 1,
    excludeCount: 0
  };
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

  // Get count values
  const includeCount =
    includeId && elements.includeCount
      ? parseInt(elements.includeCount.value, 10) || 1
      : 1;
  const excludeCount =
    excludeId && elements.excludeCount
      ? parseInt(elements.excludeCount.value, 10) || 0
      : 0;

  // Show/hide count filters based on card selection
  if (elements.includeCountFilter) {
    elements.includeCountFilter.hidden = !includeId;
  }
  if (elements.excludeCountFilter) {
    elements.excludeCountFilter.hidden = !excludeId;
  }

  includeId = applyAlwaysIncludedGuard(includeId);
  if (!includeId && originalIncludeValue) {
    elements.includeCard.value = '';
  }

  if (!includeId && !excludeId) {
    resetToDefaultData();
    return;
  }

  if (includeId && excludeId && includeId === excludeId) {
    updateFilterMessage(
      'Choose different cards to include and exclude.',
      'warning',
    );
    state.items = [];
    state.archetypeDeckTotal = 0;
    state.currentFilters = {
      include: includeId,
      exclude: excludeId,
      includeCount,
      excludeCount
    };
    renderCards();
    return;
  }

  if (handleImpossibleExclusion(excludeId)) {
    return;
  }

  const comboLabel = describeFilters(includeId, excludeId);
  updateFilterMessage(
    `Crunching the numbers for decks ${comboLabel}...`,
    'info',
  );

  const requestKey = getFilterKey(
    includeId,
    excludeId,
    includeCount,
    excludeCount
  );

  try {
    const result = await loadFilterCombination(
      includeId,
      excludeId,
      includeCount,
      excludeCount
    );

    const currentInclude = applyAlwaysIncludedGuard(
      elements.includeCard ? elements.includeCard.value || null : null
    );
    const currentExclude = elements.excludeCard
      ? elements.excludeCard.value || null
      : null;
    const currentIncludeCount =
      currentInclude && elements.includeCount
        ? parseInt(elements.includeCount.value, 10) || 1
        : 1;
    const currentExcludeCount =
      currentExclude && elements.excludeCount
        ? parseInt(elements.excludeCount.value, 10) || 0
        : 0;
    const activeKey = getFilterKey(
      currentInclude,
      currentExclude,
      currentIncludeCount,
      currentExcludeCount
    );
    if (activeKey !== requestKey) {
      return;
    }

    // eslint-disable-next-line require-atomic-updates -- Guarded by requestKey check
    Object.assign(state, {
      items: result.items,
      archetypeDeckTotal: result.deckTotal,
      currentFilters: {
        include: includeId,
        exclude: excludeId,
        includeCount,
        excludeCount
      },
    });

    if (!result.deckTotal || result.items.length === 0) {
      updateFilterMessage(
        `No decks match the combination ${comboLabel}.`,
        'warning',
      );
    } else {
      const deckLabel = result.deckTotal === 1 ? 'deck' : 'decks';
      updateFilterMessage(
        `${result.deckTotal} ${deckLabel} match the combination ${comboLabel}.`,
        'info',
      );
    }
    renderCards();
  } catch (error) {
    if (error instanceof AppError && error.context?.status === 404) {
      updateFilterMessage(
        `No decks match the combination ${comboLabel}.`,
        'warning',
      );
      // eslint-disable-next-line require-atomic-updates -- Selection validated above
      Object.assign(state, {
        items: [],
        archetypeDeckTotal: 0,
        currentFilters: {
          include: includeId,
          exclude: excludeId,
          includeCount,
          excludeCount
        },
      });
      renderCards();
      return;
    }
    logger.exception('Failed to apply include/exclude filters', error);
    updateFilterMessage(
      'We ran into an issue loading that combination. Please try again.',
      'warning',
    );
  }
}

function setupFilterListeners() {
  if (elements.includeCard) {
    elements.includeCard.addEventListener('change', () => {
      applyFilters().catch(error => {
        logger.debug('Include filter change failed', error?.message || error);
      });
    });

    // Add hover listeners for aggressive pre-caching
    setupFilterHoverHandler(elements.includeCard, 'include');
  }
  if (elements.excludeCard) {
    elements.excludeCard.addEventListener('change', () => {
      applyFilters().catch(error => {
        logger.debug('Exclude filter change failed', error?.message || error);
      });
    });

    // Add hover listeners for aggressive pre-caching
    setupFilterHoverHandler(elements.excludeCard, 'exclude');
  }

  // Add event listeners for count inputs
  if (elements.includeCount) {
    elements.includeCount.addEventListener('change', () => {
      applyFilters().catch(error => {
        logger.debug(
          'Include count filter change failed',
          error?.message || error
        );
      });
    });
  }
  if (elements.excludeCount) {
    elements.excludeCount.addEventListener('change', () => {
      applyFilters().catch(error => {
        logger.debug(
          'Exclude count filter change failed',
          error?.message || error
        );
      });
    });
  }
}

/**
 * Setup hover event handlers for filter dropdowns
 * Pre-resolves filter combinations when user hovers over options
 * @param {HTMLSelectElement} selectElement
 * @param {string} filterType - 'include' or 'exclude'
 */
function setupFilterHoverHandler(selectElement, filterType) {
  /** @type {Promise<any>|null} */
  let cacheInstancePromise = null;

  const loadCacheInstance = () => {
    if (!cacheInstancePromise) {
      cacheInstancePromise = import('./utils/archetypeCache.js')
        .then(module => module.archetypeCache)
        .catch(error => {
          cacheInstancePromise = null;
          throw error;
        });
    }
    return cacheInstancePromise;
  };

  // Track when dropdown is focused/opened
  selectElement.addEventListener('focus', async () => {
    try {
      const cache = await loadCacheInstance();

      // Pre-cache the index when dropdown opens
      if (state.tournament && state.archetypeBase) {
        await cache.preCacheIndex(state.tournament, state.archetypeBase);
      }
    } catch (error) {
      logger.debug(
        'Failed to pre-cache index on dropdown focus',
        error.message
      );
    }
  });

  // Track hover over individual options (if supported by browser)
  selectElement.addEventListener('mousemove', async event => {
    if (!state.tournament || !state.archetypeBase) {
      return;
    }

    const { target } = event;
    if (target instanceof HTMLOptionElement && target.value) {
      try {
        const cache = await loadCacheInstance();
        const hoveredCardId = target.value;

        // Get the current value from the other dropdown
        const includeId =
          filterType === 'include'
            ? hoveredCardId
            : elements.includeCard
              ? elements.includeCard.value || null
              : null;
        const excludeId =
          filterType === 'exclude'
            ? hoveredCardId
            : elements.excludeCard
              ? elements.excludeCard.value || null
              : null;

        // Start timer to pre-resolve this filter combination
        cache.startFilterHoverTimer(
          state.tournament,
          state.archetypeBase,
          includeId,
          excludeId
        );
      } catch (error) {
        logger.debug('Failed to pre-cache combination on hover', error.message);
      }
    }
  });
}

function handleGranularityInput(event) {
  const target = /** @type {HTMLInputElement|null} */ (
    event.currentTarget || event.target
  );
  if (!target || !Array.isArray(state.items) || state.items.length === 0) {
    return;
  }

  const percents = state.items.map(getUsagePercent);
  const computedMax = Math.max(...percents, GRANULARITY_MIN_PERCENT);

  if (computedMax <= GRANULARITY_STEP_PERCENT) {
    syncGranularityOutput(computedMax);
    return;
  }

  const maxPercent = Math.min(
    100,
    Math.ceil(computedMax / GRANULARITY_STEP_PERCENT) *
      GRANULARITY_STEP_PERCENT
  );
  const rawValue = Number(target.value);
  const normalized = normalizeThreshold(
    rawValue,
    GRANULARITY_MIN_PERCENT,
    maxPercent
  );

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
  logger.warn(
    `Preferred tournament ${preferredTournament} not found, falling back to ${defaultTournament}`
  );
  return defaultTournament;
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

    const tournaments = await safeAsync(
      () => fetchTournamentsList(),
      'fetching tournaments list',
      []
    );
    if (!Array.isArray(tournaments) || tournaments.length === 0) {
      throw new Error('No tournaments available for archetype analysis.');
    }
    // Always prefer "Online - Last 14 Days" as the default for archetype analysis
    // since include-exclude filtering is only available for the online meta aggregation
    const onlineMeta = 'Online - Last 14 Days';
    const latestTournament = tournaments[0];
    state.tournament = resolveTournamentPreference(onlineMeta, [
      onlineMeta,
      ...tournaments
    ]);

    const [overrides, tournamentReport, archetypeRaw] = await Promise.all([
      safeAsync(() => fetchOverrides(), 'fetching thumbnail overrides', {}),
      safeAsync(
        () => fetchReport(state.tournament),
        `fetching ${state.tournament} report`,
        null
      ),
      fetchArchetypeReport(state.tournament, state.archetypeBase)
    ]);

    if (!tournamentReport || typeof tournamentReport.deckTotal !== 'number') {
      throw new Error(
        `Tournament report for ${state.tournament} is missing deck totals.`
      );
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
    showError('We couldn\'t load that archetype.');
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

setupGranularityListeners();
setupFilterListeners();
setupSkeletonExport();

initialize();
