import { fetchDecks, fetchTournamentsList, getCardPrice } from '../api.js';
import { analyzeEvents, type BinderDataset, buildBinderDataset } from './metaBinderData.js';
import { buildThumbCandidates } from '../thumbs.js';
import { debounce } from '../utils/performance.js';
import { storage } from '../utils/storage.js';
import { logger } from '../utils/logger.js';
import { CONFIG } from '../config.js';

const DEFAULT_RECENT_EVENTS = 6;
const CARDS_PER_PAGE = 12;
const STORAGE_KEY = 'binderSelections';
const DEFAULT_ONLINE_META = 'Online - Last 14 Days';

type AnalysisResult = ReturnType<typeof analyzeEvents>;
type _BinderSelections = { tournaments: string[]; archetypes: string[] };

interface BinderElements {
  tournamentsList: HTMLElement | null;
  tournamentsAll: HTMLElement | null;
  tournamentsRecent: HTMLElement | null;
  tournamentsClear: HTMLElement | null;
  archetypesList: HTMLElement | null;
  archetypesAll: HTMLElement | null;
  archetypesClear: HTMLElement | null;
  archetypeSearch: HTMLInputElement | null;
  stats: HTMLElement | null;
  loading: HTMLElement | null;
  error: HTMLElement | null;
  errorMessage: HTMLElement | null;
  content: HTMLElement | null;
  app: HTMLElement | null;
  generate: HTMLButtonElement | null;
  pendingMessage: HTMLElement | null;
  cardTemplate: HTMLTemplateElement | null;
  placeholderTemplate: HTMLTemplateElement | null;
  exportButton: HTMLButtonElement | null;
  importButton: HTMLButtonElement | null;
  importFile: HTMLInputElement | null;
}

const state: {
  tournaments: string[];
  selectedTournaments: Set<string>;
  decksCache: Map<string, any>;
  overrides: Record<string, any>;
  analysis: AnalysisResult | null;
  binderData: BinderDataset | null;
  selectedArchetypes: Set<string>;
  archetypeFilter: string;
  isLoading: boolean;
  isGenerating: boolean;
  isBinderDirty: boolean;
  selectionDecks: number;
  metrics: any;
} = {
  tournaments: [],
  selectedTournaments: new Set(),
  decksCache: new Map(),
  overrides: {},
  analysis: null,
  binderData: null,
  selectedArchetypes: new Set(),
  archetypeFilter: '',
  isLoading: false,
  isGenerating: false,
  isBinderDirty: true,
  selectionDecks: 0,
  metrics: null
};

let pendingArchetypeSelection: Set<string> | null = null;

const elements: BinderElements = {
  tournamentsList: document.getElementById('binder-tournaments'),
  tournamentsAll: document.getElementById('binder-tournaments-all'),
  tournamentsRecent: document.getElementById('binder-tournaments-recent'),
  tournamentsClear: document.getElementById('binder-tournaments-clear'),
  archetypesList: document.getElementById('binder-archetypes'),
  archetypesAll: document.getElementById('binder-archetypes-all'),
  archetypesClear: document.getElementById('binder-archetypes-clear'),
  archetypeSearch: document.getElementById('binder-archetype-search') as HTMLInputElement | null,
  stats: document.getElementById('binder-stats'),
  loading: document.getElementById('binder-loading'),
  error: document.getElementById('binder-error'),
  errorMessage: document.getElementById('binder-error-message'),
  content: document.getElementById('binder-content'),
  app: document.querySelector('.binder-app') as HTMLElement | null,
  generate: document.getElementById('binder-generate') as HTMLButtonElement | null,
  pendingMessage: document.getElementById('binder-pending'),
  cardTemplate: document.getElementById('binder-card-template') as HTMLTemplateElement | null,
  placeholderTemplate: document.getElementById('binder-card-placeholder') as HTMLTemplateElement | null,
  exportButton: document.getElementById('binder-export') as HTMLButtonElement | null,
  importButton: document.getElementById('binder-import') as HTMLButtonElement | null,
  importFile: document.getElementById('binder-import-file') as HTMLInputElement | null
};

function setLoading(isLoading) {
  state.isLoading = isLoading;
  if (!elements.app || !elements.loading || !elements.content) {
    return;
  }
  elements.app.dataset.state = isLoading ? 'loading' : 'ready';
  elements.loading.hidden = !isLoading;
  elements.content.hidden = isLoading;
  if (isLoading) {
    elements.content.setAttribute('aria-hidden', 'true');
  } else {
    elements.content.removeAttribute('aria-hidden');
  }
  updateGenerateState();
}

function showError(message) {
  if (!elements.error || !elements.errorMessage || !elements.content || !elements.loading) {
    return;
  }
  elements.loading.hidden = true;
  elements.error.hidden = false;
  elements.content.hidden = true;
  elements.errorMessage.textContent = message;
  updateGenerateState();
}

function hideError() {
  if (elements.error) {
    elements.error.hidden = true;
  }
}

function setPendingMessage(message) {
  if (elements.pendingMessage) {
    elements.pendingMessage.textContent = message;
  }
}

function updateGenerateState() {
  if (elements.generate) {
    const hasSelection = state.selectedTournaments.size > 0;
    const actionable = !state.isLoading && !state.isGenerating && state.analysis && hasSelection;
    elements.generate.disabled = !actionable;
  }

  if (!elements.pendingMessage) {
    return;
  }

  if (state.isLoading) {
    setPendingMessage('Loading selection data...');
    return;
  }
  if (!state.selectedTournaments.size) {
    setPendingMessage('Select at least one event to enable layout generation.');
    return;
  }
  if (state.isBinderDirty) {
    setPendingMessage('Selections updated. Click "Generate Binder" to refresh the layout.');
    return;
  }
  if (state.binderData) {
    const decks = state.binderData.meta.totalDecks;
    setPendingMessage(`Layout generated for ${decks} deck${decks === 1 ? '' : 's'}.`);
    return;
  }
  setPendingMessage('Click "Generate Binder" to build your layout.');
}

function markBinderDirty() {
  state.isBinderDirty = true;
  state.metrics = null;
  updateGenerateState();
  renderBinderSections();
}

function computeSelectionDecks() {
  if (!state.analysis) {
    state.selectionDecks = 0;
    return;
  }
  const allowed = state.selectedArchetypes.size > 0 ? state.selectedArchetypes : null;
  let count = 0;
  for (const event of state.analysis.events) {
    for (const deck of event.decks) {
      if (!allowed || allowed.has(deck.canonicalArchetype)) {
        count += 1;
      }
    }
  }
  state.selectionDecks = count;
}

function formatPercent(value) {
  const percent = Math.round(value * 1000) / 10;
  return `${percent.toFixed(percent % 1 === 0 ? 0 : 1)}%`;
}

function formatFractionUsage(decks, total) {
  return `${decks}/${total} decks`;
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return '$0.00';
  }
  return `$${value.toFixed(2)}`;
}

function normalizeId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

function chunk(array, size) {
  const pages = [];
  for (let index = 0; index < array.length; index += size) {
    pages.push(array.slice(index, index + size));
  }
  return pages;
}

function ensureCardTemplate() {
  if (!elements.cardTemplate) {
    throw new Error('Card template missing');
  }
  return elements.cardTemplate;
}

function ensurePlaceholderTemplate() {
  if (!elements.placeholderTemplate) {
    throw new Error('Placeholder template missing');
  }
  return elements.placeholderTemplate;
}

function inflateCards(cards) {
  const expanded = [];
  for (const card of cards) {
    const total = Math.max(1, Number(card.maxCopies) || 1);
    for (let copyIndex = 1; copyIndex <= total; copyIndex += 1) {
      expanded.push({
        ...card,
        copyIndex,
        copyTotal: total
      });
    }
  }
  return expanded;
}

function createCardElement(card, options = {}) {
  const template = ensureCardTemplate();
  const root = template.content.firstElementChild;
  if (!root) {
    throw new Error('Card template missing content');
  }
  const clone = root.cloneNode(true) as HTMLElement;
  const img = clone.querySelector<HTMLImageElement>('img');
  const copies = clone.querySelector<HTMLElement>('.binder-card__copies');
  const nameEl = clone.querySelector<HTMLElement>('.binder-card__name');
  const metaEl = clone.querySelector<HTMLElement>('.binder-card__meta');

  if (copies) {
    const totalCopies = Math.max(1, Number(card.copyTotal) || Number(card.maxCopies) || 1);
    const copyIndex = Math.max(1, Number(card.copyIndex) || 1);
    if (totalCopies > 1) {
      copies.textContent = `${copyIndex}/${totalCopies}`;
      copies.hidden = false;
    } else {
      copies.textContent = '';
      copies.hidden = true;
    }
  }

  if (nameEl) {
    nameEl.textContent = card.name;
  }

  if (metaEl) {
    metaEl.textContent = buildMetaLine(card, options);
  }

  clone.title = buildTooltip(card, options);

  if (img) {
    applyCardImage(img, card);
  }

  return clone;
}

function createPlaceholderElement() {
  const template = ensurePlaceholderTemplate();
  return /** @type {HTMLElement} */ template.content.firstElementChild.cloneNode(true);
}

function applyCardImage(imageElement, card) {
  const imgEl = imageElement;
  const variant = card.set && card.number ? { set: card.set, number: card.number } : undefined;
  const candidates = buildThumbCandidates(card.name, false, state.overrides, variant);
  const wrapper = imgEl.closest('.binder-card__thumb');

  if (!candidates.length) {
    imgEl.removeAttribute('src');
    if (wrapper) {
      wrapper.classList.add('binder-card__thumb--missing');
    }
    imgEl.alt = '';
    return;
  }

  let index = 0;

  const tryNext = () => {
    if (index >= candidates.length) {
      imgEl.removeAttribute('src');
      if (wrapper) {
        wrapper.classList.add('binder-card__thumb--missing');
      }
      return;
    }
    imgEl.src = candidates[index++];
  };

  const handleError = () => {
    tryNext();
  };

  imgEl.alt = `${card.name} card art`;
  imgEl.addEventListener('error', handleError);
  imgEl.addEventListener(
    'load',
    () => {
      imgEl.removeEventListener('error', handleError);
      if (wrapper) {
        wrapper.classList.remove('binder-card__thumb--missing');
      }
    },
    { once: true }
  );
  tryNext();
}

function buildMetaLine(card, options) {
  if (options.mode === 'archetype' && options.archetype) {
    const usage = card.usageByArchetype.find(entry => entry.archetype === options.archetype);
    if (usage) {
      return `${formatPercent(usage.ratio)} | ${formatFractionUsage(usage.decks, usage.totalDecks)}`;
    }
  }

  const parts = [`${formatPercent(card.deckShare)} of decks`, `${card.totalDecksWithCard} decks`];

  if (card.usageByArchetype.length > 0) {
    const top = card.usageByArchetype[0];
    parts.push(`${formatPercent(top.ratio)} of ${top.displayName}`);
  }

  return parts.join(' | ');
}

function buildTooltip(card, options) {
  const lines = [`Max copies: ${Math.max(1, Number(card.maxCopies) || 1)}`];
  if (options.mode === 'archetype' && options.archetype) {
    const usage = card.usageByArchetype.find(entry => entry.archetype === options.archetype);
    if (usage) {
      lines.push(
        `Primary usage: ${formatPercent(usage.ratio)} in ${usage.displayName} ` +
          `(${formatFractionUsage(usage.decks, usage.totalDecks)})`
      );
    }
  } else {
    lines.push(`Overall usage: ${formatPercent(card.deckShare)} (${card.totalDecksWithCard} decks)`);
  }

  const spill = card.usageByArchetype
    .filter(entry => !options.archetype || entry.archetype !== options.archetype)
    .slice(0, 3)
    .map(entry => `${formatPercent(entry.ratio)} in ${entry.displayName}`);

  if (spill.length) {
    lines.push(`Also seen: ${spill.join(', ')}`);
  }

  return lines.join('\n');
}

function renderBinderPages(cards, container, options = {}) {
  const targetContainer = container;
  targetContainer.innerHTML = '';
  const expandedCards = inflateCards(cards);

  if (!expandedCards.length) {
    const empty = document.createElement('p');
    empty.className = 'binder-empty';
    empty.textContent = 'No cards meet the criteria.';
    targetContainer.appendChild(empty);
    return;
  }

  const pages = chunk(expandedCards, CARDS_PER_PAGE);
  let pageIndex = 1;

  for (const page of pages) {
    const pageEl = document.createElement('div');
    pageEl.className = 'binder-page';
    pageEl.dataset.page = String(pageIndex);
    pageEl.setAttribute('role', 'list');

    const fragment = document.createDocumentFragment();
    for (const card of page) {
      fragment.appendChild(createCardElement(card, options));
    }

    const remainder = CARDS_PER_PAGE - page.length;
    for (let index = 0; index < remainder; index += 1) {
      fragment.appendChild(createPlaceholderElement());
    }

    pageEl.appendChild(fragment);
    targetContainer.appendChild(pageEl);
    pageIndex += 1;
  }
}

function renderBinderSections() {
  if (!elements.content) {
    return;
  }

  if (!state.binderData || state.isBinderDirty || state.binderData.meta.totalDecks === 0) {
    const prompt =
      state.isBinderDirty && state.binderData
        ? 'Selections changed. Click "Generate Binder" to refresh the layout.'
        : 'Select events and archetypes, then click "Generate Binder" to build a layout.';
    elements.content.hidden = false;
    elements.content.innerHTML = `<p class="binder-empty binder-empty--global">${prompt}</p>`;
    return;
  }

  const { sections, meta } = state.binderData;
  const fragment = document.createDocumentFragment();

  const staticSections = [
    { key: 'aceSpecs', title: 'Ace Specs', cards: sections.aceSpecs },
    {
      key: 'frequentItems',
      title: 'Frequent Items',
      cards: sections.frequentItems
    },
    {
      key: 'nicheItems',
      title: 'Niche / Tech Items',
      cards: sections.nicheItems
    },
    {
      key: 'frequentSupporters',
      title: 'Frequent Supporters',
      cards: sections.frequentSupporters
    },
    {
      key: 'nicheSupporters',
      title: 'Niche / Archetype Supporters',
      cards: sections.nicheSupporters
    },
    { key: 'tools', title: 'Tools', cards: sections.tools },
    { key: 'stadiums', title: 'Stadiums', cards: sections.stadiums },
    {
      key: 'specialEnergy',
      title: 'Special Energy',
      cards: sections.specialEnergy
    },
    {
      key: 'staplePokemon',
      title: 'High-Usage Pokemon Across Archetypes',
      cards: sections.staplePokemon
    }
  ];

  for (const info of staticSections) {
    if (!info.cards.length) {
      continue;
    }
    const section = document.createElement('section');
    section.className = 'binder-section';
    section.id = `section-${info.key}`;

    const heading = document.createElement('h2');
    heading.textContent = info.title;
    section.appendChild(heading);

    const pagesContainer = document.createElement('div');
    pagesContainer.className = 'binder-pages';
    renderBinderPages(info.cards, pagesContainer);
    section.appendChild(pagesContainer);

    fragment.appendChild(section);
  }

  const archetypeSection = document.createElement('section');
  archetypeSection.className = 'binder-section binder-section--archetypes';
  const archetypeHeading = document.createElement('h2');
  archetypeHeading.textContent = 'Archetype Cores';
  archetypeSection.appendChild(archetypeHeading);

  if (sections.archetypePokemon.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'binder-empty';
    empty.textContent = 'No archetype-specific Pokemon meet the current criteria.';
    archetypeSection.appendChild(empty);
  } else {
    for (const group of sections.archetypePokemon) {
      const article = document.createElement('article');
      article.className = 'binder-archetype';

      const header = document.createElement('header');
      header.className = 'binder-archetype__header';

      const title = document.createElement('h3');
      title.textContent = group.displayName;
      header.appendChild(title);

      const stat = meta.archetypeStats.find(entry => entry.canonical === group.canonical);
      const summary = document.createElement('p');
      summary.className = 'binder-archetype__summary';
      const deckCount = stat ? stat.deckCount : 0;
      summary.textContent = `${deckCount} deck${deckCount === 1 ? '' : 's'}`;
      header.appendChild(summary);

      article.appendChild(header);

      const pagesContainer = document.createElement('div');
      pagesContainer.className = 'binder-pages';
      renderBinderPages(group.cards, pagesContainer, {
        mode: 'archetype',
        archetype: group.canonical
      });
      article.appendChild(pagesContainer);

      archetypeSection.appendChild(article);
    }
  }

  fragment.appendChild(archetypeSection);

  elements.content.hidden = false;
  elements.content.innerHTML = '';
  elements.content.appendChild(fragment);
}

function getTotalMetaDecks() {
  if (!state.analysis) {
    return 0;
  }
  let total = 0;
  for (const event of state.analysis.events) {
    total += event.decks.length;
  }
  return total;
}

function updateStats() {
  if (!elements.stats) {
    return;
  }

  if (!state.analysis) {
    elements.stats.textContent = 'Select tournaments to get started.';
    return;
  }

  const { selectedTournaments, selectionDecks, metrics, binderData } = state;
  const eventCount = selectedTournaments.size;
  const metaDecks = getTotalMetaDecks();

  if (!binderData || state.isBinderDirty) {
    const parts = [];
    parts.push(`${eventCount} event${eventCount === 1 ? '' : 's'} selected`);
    parts.push(`${selectionDecks} deck${selectionDecks === 1 ? '' : 's'} available`);
    if (state.isBinderDirty && binderData) {
      parts.push('Re-generate binder to update the layout');
    }
    elements.stats.textContent = parts.join(' | ');
    return;
  }

  const binderDecks = binderData.meta.totalDecks;
  const coverageSelected = metrics
    ? metrics.coverageSelected
    : selectionDecks
      ? Math.min(1, binderDecks / selectionDecks)
      : 0;
  const coverageMeta = metrics ? metrics.coverageMeta : metaDecks ? Math.min(1, binderDecks / metaDecks) : 0;
  const priceText = metrics ? formatCurrency(metrics.priceTotal) : '$0.00';
  const missingText =
    metrics && metrics.missingPrices
      ? ` (${metrics.missingPrices} card${metrics.missingPrices === 1 ? '' : 's'} missing prices)`
      : '';

  elements.stats.textContent = [
    `${binderDecks} deck${binderDecks === 1 ? '' : 's'} covered`,
    `${formatPercent(coverageSelected)} of selected archetype decks`,
    `${formatPercent(coverageMeta)} of selected meta decks`,
    `Estimated price: ${priceText}${missingText}`
  ].join(' | ');
}

function renderTournamentsControls() {
  if (!elements.tournamentsList) {
    return;
  }

  elements.tournamentsList.innerHTML = '';

  if (!state.tournaments.length) {
    const empty = document.createElement('p');
    empty.className = 'binder-empty';
    empty.textContent = 'No tournaments available.';
    elements.tournamentsList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const tournament of state.tournaments) {
    const id = `tournament-${normalizeId(tournament)}`;
    const label = document.createElement('label');
    label.className = 'binder-checkbox';
    label.htmlFor = id;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.name = 'tournaments';
    checkbox.value = tournament;
    checkbox.checked = state.selectedTournaments.has(tournament);
    checkbox.addEventListener('change', () => {
      handleTournamentToggle(tournament, checkbox.checked);
    });

    const caption = document.createElement('span');
    caption.textContent = tournament;

    label.appendChild(checkbox);
    label.appendChild(caption);
    fragment.appendChild(label);
  }

  elements.tournamentsList.appendChild(fragment);
}

function renderArchetypeControls() {
  if (!elements.archetypesList) {
    return;
  }

  if (!state.analysis) {
    elements.archetypesList.innerHTML = '<p class="binder-empty">Select events to load archetypes.</p>';
    return;
  }

  const archetypes = Array.from(state.analysis.archetypeStats.values())
    .map(entry => ({
      canonical: entry.canonical,
      displayName: entry.displayName,
      deckCount: entry.deckCount
    }))
    .sort((first, second) => {
      if (second.deckCount !== first.deckCount) {
        return second.deckCount - first.deckCount;
      }
      return first.displayName.localeCompare(second.displayName);
    });

  const filter = state.archetypeFilter.trim().toLowerCase();

  elements.archetypesList.innerHTML = '';
  const fragment = document.createDocumentFragment();

  for (const archetype of archetypes) {
    if (filter && !archetype.displayName.toLowerCase().includes(filter)) {
      continue;
    }

    const id = `archetype-${normalizeId(archetype.canonical)}`;
    const label = document.createElement('label');
    label.className = 'binder-checkbox binder-checkbox--archetype';
    label.htmlFor = id;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.value = archetype.canonical;
    checkbox.checked = state.selectedArchetypes.size === 0 ? true : state.selectedArchetypes.has(archetype.canonical);
    checkbox.addEventListener('change', () => {
      handleArchetypeToggle(archetype.canonical, checkbox.checked);
    });

    const caption = document.createElement('span');
    caption.innerHTML =
      `<strong>${archetype.displayName}</strong> ` +
      `<em>${archetype.deckCount} deck${archetype.deckCount === 1 ? '' : 's'}</em>`;

    label.appendChild(checkbox);
    label.appendChild(caption);
    fragment.appendChild(label);
  }

  if (!fragment.childElementCount) {
    const empty = document.createElement('p');
    empty.className = 'binder-empty';
    empty.textContent = filter ? 'No archetypes match your search.' : 'No archetypes available.';
    elements.archetypesList.appendChild(empty);
    return;
  }

  elements.archetypesList.appendChild(fragment);
}

function handleTournamentToggle(tournament, isSelected) {
  if (isSelected) {
    state.selectedTournaments.add(tournament);
  } else {
    state.selectedTournaments.delete(tournament);
  }
  saveSelections();
  recomputeFromSelection();
}

function handleSelectAllTournaments() {
  state.selectedTournaments = new Set(state.tournaments);
  renderTournamentsControls();
  saveSelections();
  recomputeFromSelection();
}

function handleSelectRecentTournaments() {
  const recent = state.tournaments.slice(0, DEFAULT_RECENT_EVENTS);
  state.selectedTournaments = recent.length ? new Set(recent) : new Set(state.tournaments);
  renderTournamentsControls();
  saveSelections();
  recomputeFromSelection();
}

function handleClearTournaments() {
  state.selectedTournaments.clear();
  renderTournamentsControls();
  saveSelections();
  recomputeFromSelection();
}

function handleArchetypeToggle(archetype, isSelected) {
  if (isSelected) {
    state.selectedArchetypes.add(archetype);
  } else {
    state.selectedArchetypes.delete(archetype);
  }
  computeSelectionDecks();
  markBinderDirty();
  updateStats();
  saveSelections();
}

function handleSelectAllArchetypes() {
  if (!state.analysis) {
    return;
  }
  // Empty set means "all selected" in our logic
  state.selectedArchetypes.clear();
  renderArchetypeControls();
  computeSelectionDecks();
  markBinderDirty();
  updateStats();
  saveSelections();
}

function handleClearArchetypes() {
  if (!state.analysis) {
    return;
  }
  // Create a set with a sentinel value that won't match any real archetype
  // This ensures no archetypes are selected
  state.selectedArchetypes = new Set(['__NONE__']);
  renderArchetypeControls();
  computeSelectionDecks();
  markBinderDirty();
  updateStats();
  saveSelections();
}

async function ensureDecksLoaded(tournaments) {
  const missing = tournaments.filter(name => !state.decksCache.has(name));
  if (!missing.length) {
    return;
  }

  const loaders = missing.map(async tournament => {
    const decks = await fetchDecks(tournament);
    const deckList = Array.isArray(decks) ? decks : [];
    state.decksCache.set(tournament, deckList);
    logger.debug('Loaded decks for binder', {
      tournament,
      decks: deckList.length
    });
  });

  await Promise.all(loaders);
}

function loadSelections() {
  if (!storage.isAvailable) {
    return null;
  }

  try {
    const stored = storage.get(STORAGE_KEY);
    if (!stored || typeof stored !== 'object') {
      return null;
    }
    const tournaments = Array.isArray(stored.tournaments)
      ? stored.tournaments.filter(item => typeof item === 'string')
      : [];
    const archetypes = Array.isArray(stored.archetypes)
      ? stored.archetypes.filter(item => typeof item === 'string')
      : [];
    return { tournaments, archetypes };
  } catch (error) {
    logger.debug('Failed to load binder selections', error);
    return null;
  }
}

function saveSelections() {
  if (!storage.isAvailable) {
    return;
  }
  const payload = {
    tournaments: Array.from(state.selectedTournaments),
    archetypes: Array.from(state.selectedArchetypes)
  };
  storage.set(STORAGE_KEY, payload);
}

function collectAllCards(sections) {
  const lists = [
    sections.aceSpecs,
    sections.staplePokemon,
    sections.frequentSupporters,
    sections.nicheSupporters,
    sections.stadiums,
    sections.tools,
    sections.frequentItems,
    sections.nicheItems,
    sections.specialEnergy,
    sections.basicEnergy
  ];
  for (const group of sections.archetypePokemon) {
    lists.push(group.cards);
  }
  return lists.flat();
}

async function computeBinderMetrics(binderData, context) {
  const allCards = collectAllCards(binderData.sections);
  const unique = new Map();

  for (const card of allCards) {
    const quantity = Math.max(1, Number(card.maxCopies) || 1);
    const priceKey = card.priceKey || (card.set && card.number ? `${card.name}::${card.set}::${card.number}` : null);
    const mapKey = priceKey || card.name;
    if (!unique.has(mapKey)) {
      unique.set(mapKey, { card, quantity });
    } else {
      const entry = unique.get(mapKey);
      entry.quantity = Math.max(entry.quantity, quantity);
    }
  }

  const priceEntries = await Promise.all(
    Array.from(unique.values()).map(async entry => {
      const { card, quantity } = entry;
      const lookupId = card.priceKey || (card.set && card.number ? `${card.name}::${card.set}::${card.number}` : null);
      let price = null;
      if (lookupId) {
        try {
          price = await getCardPrice(lookupId);
        } catch (error) {
          logger.debug('Price lookup failed', {
            id: lookupId,
            error: error.message
          });
        }
      }
      if (price == null && !lookupId) {
        try {
          price = await getCardPrice(card.name);
        } catch (error) {
          logger.debug('Fallback price lookup failed', {
            name: card.name,
            error: error.message
          });
        }
      }
      const numericPrice = typeof price === 'number' ? price : Number(price);
      return {
        quantity,
        price: Number.isFinite(numericPrice) ? numericPrice : null
      };
    })
  );

  let priceTotal = 0;
  let missingPrices = 0;

  for (const entry of priceEntries) {
    if (entry.price == null) {
      missingPrices += 1;
      continue;
    }
    priceTotal += entry.price * entry.quantity;
  }

  const selectedDecks = context.selectedDecks || 0;
  const metaDecks = context.metaDecks || 0;

  return {
    priceTotal,
    missingPrices,
    coverageSelected: selectedDecks ? Math.min(1, binderData.meta.totalDecks / selectedDecks) : 0,
    coverageMeta: metaDecks ? Math.min(1, binderData.meta.totalDecks / metaDecks) : 0
  };
}

async function recomputeFromSelection() {
  setLoading(true);
  hideError();

  try {
    const tournaments = Array.from(state.selectedTournaments);
    if (tournaments.length === 0) {
      state.analysis = null;
      state.selectedArchetypes.clear();
      computeSelectionDecks();
      markBinderDirty();
      renderArchetypeControls();
      updateStats();
      renderBinderSections();
      setLoading(false);
      return;
    }

    await ensureDecksLoaded(tournaments);

    const events = tournaments.map(tournament => ({
      tournament,
      decks: state.decksCache.get(tournament) || []
    }));

    const analysis = analyzeEvents(events);
    const availableArchetypes = new Set<string>(Array.from(analysis.archetypeStats.keys()));

    let nextSelectedArchetypes;
    if (pendingArchetypeSelection) {
      nextSelectedArchetypes = new Set(
        Array.from(pendingArchetypeSelection).filter(archetype => availableArchetypes.has(archetype as string))
      );
      pendingArchetypeSelection = null;
      if (!nextSelectedArchetypes.size) {
        nextSelectedArchetypes = new Set(availableArchetypes);
      }
    } else {
      nextSelectedArchetypes = new Set(state.selectedArchetypes);
      if (nextSelectedArchetypes.size === 0) {
        nextSelectedArchetypes = new Set(availableArchetypes);
      } else {
        nextSelectedArchetypes = new Set(
          Array.from(nextSelectedArchetypes).filter(archetype => availableArchetypes.has(archetype as string))
        );
        if (!nextSelectedArchetypes.size) {
          nextSelectedArchetypes = new Set(availableArchetypes);
        }
      }
    }

    state.analysis = analysis;
    state.selectedArchetypes = nextSelectedArchetypes;
    computeSelectionDecks();
    markBinderDirty();
    renderArchetypeControls();
    updateStats();
    saveSelections();
    setLoading(false);
    updateGenerateState();
  } catch (error) {
    logger.error('Failed to recompute binder', error);
    showError('Unable to generate binder data. Please refresh the page.');
  }
}

async function generateBinder() {
  if (state.isLoading || state.isGenerating || !state.analysis || !state.selectedTournaments.size) {
    return;
  }

  try {
    state.isGenerating = true;
    updateGenerateState();
    setPendingMessage('Generating binder layout...');

    const filterSet = state.selectedArchetypes.size > 0 ? new Set(state.selectedArchetypes) : null;
    const binderData = buildBinderDataset(state.analysis, filterSet);
    const metrics = await computeBinderMetrics(binderData, {
      selectedDecks: state.selectionDecks,
      metaDecks: getTotalMetaDecks()
    });

    state.binderData = binderData;
    state.metrics = metrics;
    state.isBinderDirty = false;

    renderBinderSections();
    updateStats();
    updateGenerateState();
  } catch (error) {
    logger.error('Failed to generate binder layout', error);
    showError('Unable to generate binder layout.');
  } finally {
    state.isGenerating = false;
    updateGenerateState();
  }
}

function bindControlEvents() {
  elements.tournamentsAll?.addEventListener('click', () => {
    handleSelectAllTournaments();
  });
  elements.tournamentsRecent?.addEventListener('click', () => {
    handleSelectRecentTournaments();
  });
  elements.tournamentsClear?.addEventListener('click', () => {
    handleClearTournaments();
  });

  elements.archetypesAll?.addEventListener('click', () => {
    handleSelectAllArchetypes();
  });
  elements.archetypesClear?.addEventListener('click', () => {
    handleClearArchetypes();
  });

  if (elements.archetypeSearch) {
    elements.archetypeSearch.addEventListener(
      'input',
      debounce(event => {
        const { value } = /** @type {HTMLInputElement} */ event.target;
        state.archetypeFilter = value;
        renderArchetypeControls();
      }, 150)
    );
  }

  elements.generate?.addEventListener('click', () => {
    generateBinder();
  });

  elements.exportButton?.addEventListener('click', () => {
    handleExportLayout();
  });

  elements.importButton?.addEventListener('click', () => {
    elements.importFile?.click();
  });

  elements.importFile?.addEventListener('change', event => {
    handleImportLayout(event);
  });
}

function handleExportLayout() {
  logger.info('Export layout clicked', {
    hasBinderData: Boolean(state.binderData)
  });

  if (!state.binderData) {
    const message = 'Please generate a binder layout first before exporting.';
    alert(message); // eslint-disable-line no-alert
    logger.warn(message);
    return;
  }

  try {
    const exportData = {
      version: 1,
      timestamp: new Date().toISOString(),
      tournaments: Array.from(state.selectedTournaments),
      archetypes: Array.from(state.selectedArchetypes).filter(arch => arch !== '__NONE__'),
      binderData: state.binderData,
      metrics: state.metrics
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = `meta-binder-${new Date().toISOString().slice(0, 10)}.json`;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    // Clean up after a delay to ensure download starts
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);

    logger.info('Exported binder layout', {
      filename,
      tournaments: exportData.tournaments.length,
      archetypes: exportData.archetypes.length,
      size: json.length
    });
  } catch (error) {
    logger.error('Failed to export binder layout', error);
    alert('Failed to export layout. Check the console for details.'); // eslint-disable-line no-alert
  }
}

async function handleImportLayout(event) {
  const input = /** @type {HTMLInputElement} */ event.target;
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const importData = JSON.parse(text);

    if (!importData.version || !importData.binderData) {
      throw new Error('Invalid binder export file format');
    }

    // Validate tournaments exist
    const validTournaments = importData.tournaments.filter(tournament => state.tournaments.includes(tournament));
    if (validTournaments.length === 0) {
      // eslint-disable-next-line no-alert
      alert(
        'None of the tournaments in this export are currently available. Please ensure the same tournaments are loaded.'
      );
      return;
    }

    // Set state from import
    state.selectedTournaments = new Set(validTournaments);
    state.selectedArchetypes = new Set(importData.archetypes || []);
    state.binderData = importData.binderData;
    state.metrics = importData.metrics || null;
    state.isBinderDirty = false;

    // Re-analyze to ensure data consistency
    await recomputeFromSelection();

    // Update UI
    renderTournamentsControls();
    renderArchetypeControls();
    renderBinderSections();
    updateStats();
    saveSelections();

    logger.info('Imported binder layout', {
      tournaments: validTournaments.length,
      archetypes: importData.archetypes?.length || 0
    });

    alert('Binder layout imported successfully!'); // eslint-disable-line no-alert
  } catch (error) {
    logger.error('Failed to import binder layout', error);
    alert('Failed to import binder layout. Please ensure the file is valid.'); // eslint-disable-line no-alert
  } finally {
    // Reset file input
    input.value = '';
  }
}

async function checkOnlineMetaAvailability() {
  try {
    const response = await fetch(
      `${CONFIG.API.R2_BASE}/reports/${encodeURIComponent(DEFAULT_ONLINE_META)}/master.json`,
      {
        method: 'HEAD'
      }
    );
    return response.ok;
  } catch (error) {
    logger.debug('Online meta availability check failed', error);
    return false;
  }
}

async function initialize() {
  try {
    bindControlEvents();
    setLoading(true);
    hideError();
    setPendingMessage('Select events, then click "Generate Binder" to begin.');

    const [tournaments, overrides, hasOnlineMeta] = await Promise.all([
      fetchTournamentsList(),
      Promise.resolve({}),
      checkOnlineMetaAvailability()
    ]);

    state.tournaments = tournaments;
    state.overrides = overrides || {};

    // Add online meta at the top if it exists
    if (hasOnlineMeta && !state.tournaments.includes(DEFAULT_ONLINE_META)) {
      state.tournaments.unshift(DEFAULT_ONLINE_META);
    }

    if (!state.tournaments.length) {
      showError(
        'No tournaments are available. This may be a temporary network issue. Please refresh the page to try again.'
      );
      return;
    }

    const savedSelections = loadSelections();
    if (savedSelections && savedSelections.tournaments.length) {
      state.selectedTournaments = new Set(
        savedSelections.tournaments.filter(tournament => state.tournaments.includes(tournament))
      );
      if (savedSelections.archetypes.length) {
        pendingArchetypeSelection = new Set(savedSelections.archetypes);
      }
    }

    if (!state.selectedTournaments.size) {
      const defaults = state.tournaments.slice(0, DEFAULT_RECENT_EVENTS);
      state.selectedTournaments = defaults.length ? new Set(defaults) : new Set(state.tournaments);
    }

    renderTournamentsControls();
    await recomputeFromSelection();
    renderBinderSections();
    updateStats();
    updateGenerateState();
    setLoading(false);
  } catch (error) {
    logger.error('Failed to initialize meta binder', error);
    showError('Something went wrong while loading the meta binder.');
  }
}

if (typeof document !== 'undefined') {
  initialize();
}
