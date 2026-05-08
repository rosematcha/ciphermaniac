import { buildThumbCandidates } from '../../thumbs.js';
import { escapeHtml } from '../../utils/html.js';
import {
  ARCHETYPES_MIN_DECK_COUNT,
  type BinderCard,
  type CardRenderOptions,
  CARDS_PER_PAGE,
  chunk,
  elements,
  ensureCardTemplate,
  ensurePlaceholderTemplate,
  formatCurrency,
  formatFractionUsage,
  formatPercent,
  getCardIncludeRatio,
  getEffectiveCopies,
  normalizeId,
  state,
  TOURNAMENTS_DEFAULT_VISIBLE,
  updateGenerateState
} from './state.js';

export function inflateCards(cards: BinderCard[]): Array<BinderCard & { copyIndex: number; copyTotal: number }> {
  const expanded: Array<BinderCard & { copyIndex: number; copyTotal: number }> = [];
  for (const card of cards) {
    const total = getEffectiveCopies(card);
    for (let copyIndex = 1; copyIndex <= total; copyIndex += 1) {
      expanded.push({ ...card, copyIndex, copyTotal: total });
    }
  }
  return expanded;
}

function applyCardImage(imageElement: HTMLImageElement, card: BinderCard): void {
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

function buildMetaLine(card: BinderCard, options: CardRenderOptions): string {
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

function buildTooltip(card: BinderCard, options: CardRenderOptions): string {
  const effective = getEffectiveCopies(card);
  const raw = Math.max(1, card.maxCopies || 1);
  const copiesLabel = effective < raw ? `Copies: ${effective} (max seen: ${raw})` : `Copies: ${effective}`;
  const lines = [copiesLabel];
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

export function createCardElement(
  card: BinderCard & { copyIndex?: number; copyTotal?: number },
  options: CardRenderOptions = {}
): HTMLElement {
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
    const totalCopies = Math.max(1, Number(card.copyTotal) || getEffectiveCopies(card));
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

export function createPlaceholderElement(): HTMLElement {
  const template = ensurePlaceholderTemplate();
  const node = template.content.firstElementChild;
  if (!node) {
    throw new Error('Placeholder template missing content');
  }
  return node.cloneNode(true) as HTMLElement;
}

export function renderBinderPages(cards: BinderCard[], container: HTMLElement, options: CardRenderOptions = {}): void {
  const targetContainer = container;
  targetContainer.innerHTML = '';
  const visibleCards =
    state.includeThreshold > 0
      ? cards.filter(card => getCardIncludeRatio(card, options) >= state.includeThreshold)
      : cards;
  const expandedCards = inflateCards(visibleCards);

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

export function renderBinderSections() {
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
    { key: 'frequentItems', title: 'Frequent Items', cards: sections.frequentItems },
    { key: 'nicheItems', title: 'Niche / Tech Items', cards: sections.nicheItems },
    { key: 'frequentSupporters', title: 'Frequent Supporters', cards: sections.frequentSupporters },
    { key: 'nicheSupporters', title: 'Niche / Archetype Supporters', cards: sections.nicheSupporters },
    { key: 'tools', title: 'Tools', cards: sections.tools },
    { key: 'stadiums', title: 'Stadiums', cards: sections.stadiums },
    { key: 'specialEnergy', title: 'Special Energy', cards: sections.specialEnergy },
    { key: 'staplePokemon', title: 'High-Usage Pokemon Across Archetypes', cards: sections.staplePokemon }
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

export function getTotalMetaDecks(): number {
  if (!state.analysis) {
    return 0;
  }
  let total = 0;
  for (const event of state.analysis.events) {
    total += event.decks.length;
  }
  return total;
}

export function updateStats(): void {
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
    const parts: string[] = [];
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

export function renderTournamentsControls(onToggle: (tournament: string, checked: boolean) => void): void {
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

  const visible = state.showAllTournaments
    ? state.tournaments
    : state.tournaments.slice(0, TOURNAMENTS_DEFAULT_VISIBLE);

  for (const tournament of visible) {
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
      onToggle(tournament, checkbox.checked);
    });

    const caption = document.createElement('span');
    caption.textContent = tournament;

    label.appendChild(checkbox);
    label.appendChild(caption);
    fragment.appendChild(label);
  }

  const hiddenCount = state.tournaments.length - TOURNAMENTS_DEFAULT_VISIBLE;
  if (!state.showAllTournaments && hiddenCount > 0) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'binder-show-more';
    btn.textContent = `Show ${hiddenCount} more`;
    btn.addEventListener('click', () => {
      state.showAllTournaments = true;
      renderTournamentsControls(onToggle);
    });
    fragment.appendChild(btn);
  }

  elements.tournamentsList.appendChild(fragment);
}

export function renderArchetypeControls(onToggle: (archetype: string, checked: boolean) => void): void {
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
  const isSearchActive = filter.length > 0;

  elements.archetypesList.innerHTML = '';
  const fragment = document.createDocumentFragment();

  let hiddenCount = 0;

  for (const archetype of archetypes) {
    if (filter && !archetype.displayName.toLowerCase().includes(filter)) {
      continue;
    }

    if (!state.showAllArchetypes && !isSearchActive && archetype.deckCount < ARCHETYPES_MIN_DECK_COUNT) {
      hiddenCount += 1;
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
      onToggle(archetype.canonical, checkbox.checked);
    });

    const caption = document.createElement('span');
    caption.innerHTML =
      `<strong>${escapeHtml(archetype.displayName)}</strong> ` +
      `<em>${archetype.deckCount} deck${archetype.deckCount === 1 ? '' : 's'}</em>`;

    label.appendChild(checkbox);
    label.appendChild(caption);
    fragment.appendChild(label);
  }

  if (!fragment.childElementCount && hiddenCount === 0) {
    const empty = document.createElement('p');
    empty.className = 'binder-empty';
    empty.textContent = isSearchActive ? 'No archetypes match your search.' : 'No archetypes available.';
    elements.archetypesList.appendChild(empty);
    return;
  }

  if (hiddenCount > 0) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'binder-show-more';
    btn.textContent = `Show ${hiddenCount} more`;
    btn.addEventListener('click', () => {
      state.showAllArchetypes = true;
      renderArchetypeControls(onToggle);
    });
    fragment.appendChild(btn);
  }

  elements.archetypesList.appendChild(fragment);
}

export function markBinderDirty() {
  state.isBinderDirty = true;
  state.metrics = null;
  updateGenerateState();
  renderBinderSections();
}

export function updateThresholdLabel(pct: number): void {
  if (!elements.thresholdValueLabel) {
    return;
  }
  elements.thresholdValueLabel.textContent = pct === 0 ? '0% — always show max' : `${pct}%`;
}

export function updateIncludeThresholdLabel(pct: number): void {
  if (!elements.includeThresholdValueLabel) {
    return;
  }
  elements.includeThresholdValueLabel.textContent = pct === 0 ? '0% — show all' : `${pct}%`;
}
