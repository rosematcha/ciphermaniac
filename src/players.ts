import './utils/buildVersion.js';
import { loadPlayerDataset, type PlayerDataset, type PlayerProfile } from './players/data.js';
import { applyPageSeo, buildWebPageSchema } from './utils/seo.js';
import { logger } from './utils/logger.js';

const MAX_RENDERED_PLAYERS = 250;

type SortMode =
  | 'consistency-desc'
  | 'top16-rate-desc'
  | 'top8-rate-desc'
  | 'events-desc'
  | 'best-asc'
  | 'recent-desc';

interface PlayersState {
  dataset: PlayerDataset | null;
  query: string;
  minEvents: number;
  sortMode: SortMode;
}

const state: PlayersState = {
  dataset: null,
  query: '',
  minEvents: 2,
  sortMode: 'consistency-desc'
};

const numberFormatter = new Intl.NumberFormat('en-US');

const elements = {
  loading: document.getElementById('players-list-loading') as HTMLElement | null,
  empty: document.getElementById('players-list-empty') as HTMLElement | null,
  emptyResults: document.getElementById('players-list-empty-results') as HTMLElement | null,
  list: document.getElementById('players-list') as HTMLUListElement | null,
  status: document.getElementById('players-status') as HTMLElement | null,
  summaryRegionals: document.getElementById('players-summary-regionals') as HTMLElement | null,
  summaryDecks: document.getElementById('players-summary-decks') as HTMLElement | null,
  summaryPlayers: document.getElementById('players-summary-players') as HTMLElement | null,
  summaryRepeat: document.getElementById('players-summary-repeat') as HTMLElement | null,
  summaryGenerated: document.getElementById('players-summary-generated') as HTMLElement | null,
  search: document.getElementById('players-search') as HTMLInputElement | null,
  minEvents: document.getElementById('players-min-events') as HTMLSelectElement | null,
  sort: document.getElementById('players-sort') as HTMLSelectElement | null,
  results: document.getElementById('players-results') as HTMLElement | null,
  insightsConsistency: document.getElementById('players-insight-consistency') as HTMLUListElement | null,
  insightsConversion: document.getElementById('players-insight-conversion') as HTMLUListElement | null,
  insightsSpecialists: document.getElementById('players-insight-specialists') as HTMLUListElement | null
};

function setLoading(isLoading: boolean): void {
  if (!elements.loading) {
    return;
  }
  elements.loading.hidden = !isLoading;
}

function setStatus(text: string): void {
  if (!elements.status) {
    return;
  }
  elements.status.textContent = text;
}

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function formatDate(value: string | null): string {
  if (!value) {
    return '--';
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '--';
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatPlacement(value: number | null): string {
  if (!value) {
    return '--';
  }
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return `${value}st`;
  }
  if (mod10 === 2 && mod100 !== 12) {
    return `${value}nd`;
  }
  if (mod10 === 3 && mod100 !== 13) {
    return `${value}rd`;
  }
  return `${value}th`;
}

function formatPercent(value: number): string {
  const pct = Math.round(value * 1000) / 10;
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
}

function formatScore(value: number): string {
  return `${Math.round(value * 100)}`;
}

function normalizeSortMode(value: string | null | undefined): SortMode {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'top16-rate-desc' ||
    normalized === 'top8-rate-desc' ||
    normalized === 'events-desc' ||
    normalized === 'best-asc' ||
    normalized === 'recent-desc'
  ) {
    return normalized;
  }
  return 'consistency-desc';
}

function compareNullableNumberAsc(a: number | null, b: number | null): number {
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return a - b;
}

function compareNullableDateDesc(a: string | null, b: string | null): number {
  const aTs = a ? Date.parse(a) : 0;
  const bTs = b ? Date.parse(b) : 0;
  if (!Number.isFinite(aTs) && !Number.isFinite(bTs)) {
    return 0;
  }
  if (!Number.isFinite(aTs)) {
    return 1;
  }
  if (!Number.isFinite(bTs)) {
    return -1;
  }
  return bTs - aTs;
}

function compareByConsistency(a: PlayerProfile, b: PlayerProfile): number {
  return (
    b.consistency - a.consistency ||
    b.top16Rate - a.top16Rate ||
    b.top8Rate - a.top8Rate ||
    b.events - a.events ||
    compareNullableNumberAsc(a.bestFinish, b.bestFinish) ||
    a.name.localeCompare(b.name)
  );
}

function sortPlayers(players: PlayerProfile[], sortMode: SortMode): PlayerProfile[] {
  const sorted = [...players];
  sorted.sort((a, b) => {
    if (sortMode === 'top16-rate-desc') {
      return (
        b.top16Rate - a.top16Rate ||
        b.top8Rate - a.top8Rate ||
        b.events - a.events ||
        compareNullableNumberAsc(a.bestFinish, b.bestFinish) ||
        a.name.localeCompare(b.name)
      );
    }
    if (sortMode === 'top8-rate-desc') {
      return (
        b.top8Rate - a.top8Rate ||
        b.top16Rate - a.top16Rate ||
        b.events - a.events ||
        compareNullableNumberAsc(a.bestFinish, b.bestFinish) ||
        a.name.localeCompare(b.name)
      );
    }
    if (sortMode === 'events-desc') {
      return (
        b.events - a.events ||
        b.entries - a.entries ||
        b.top16Rate - a.top16Rate ||
        compareNullableNumberAsc(a.bestFinish, b.bestFinish) ||
        a.name.localeCompare(b.name)
      );
    }
    if (sortMode === 'best-asc') {
      return (
        compareNullableNumberAsc(a.bestFinish, b.bestFinish) ||
        b.top16Rate - a.top16Rate ||
        b.events - a.events ||
        a.name.localeCompare(b.name)
      );
    }
    if (sortMode === 'recent-desc') {
      return (
        compareNullableDateDesc(a.lastEvent, b.lastEvent) ||
        b.consistency - a.consistency ||
        b.events - a.events ||
        a.name.localeCompare(b.name)
      );
    }
    return compareByConsistency(a, b);
  });
  return sorted;
}

function matchesQuery(player: PlayerProfile, query: string): boolean {
  if (!query) {
    return true;
  }
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (player.name.toLowerCase().includes(normalized)) {
    return true;
  }

  if (player.archetypes.some(entry => entry.name.toLowerCase().includes(normalized))) {
    return true;
  }

  return false;
}

function createArchetypeBadge(name: string, count: number): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'analysis-signature-card';

  const nameNode = document.createElement('span');
  nameNode.className = 'analysis-signature-card__name';
  nameNode.textContent = name;

  const countNode = document.createElement('span');
  countNode.className = 'analysis-signature-card__pct';
  countNode.textContent = `${count}`;

  badge.append(nameNode, countNode);
  return badge;
}

function createPlayerListItem(player: PlayerProfile): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'analysis-list-item';

  const link = document.createElement('a');
  link.className = 'analysis-list-item__button';
  link.href = `/players/${encodeURIComponent(player.slug)}`;

  const preview = document.createElement('div');
  preview.className = 'analysis-list-item__preview';

  const main = document.createElement('div');
  main.className = 'analysis-list-item__main';

  const header = document.createElement('div');
  header.className = 'analysis-list-item__header';

  const nameNode = document.createElement('span');
  nameNode.className = 'analysis-list-item__name';
  nameNode.textContent = player.name;
  header.appendChild(nameNode);

  const primaryArchetype = player.primaryArchetype
    ? `${player.primaryArchetype.name} (${formatPercent(player.primaryArchetype.share)})`
    : 'No archetype data';

  const countNode = document.createElement('span');
  countNode.className = 'analysis-list-item__count';
  countNode.textContent = `${formatNumber(player.events)} events | Top 16 rate ${formatPercent(player.top16Rate)} | Best ${formatPlacement(player.bestFinish)} | ${primaryArchetype}`;

  const signature = document.createElement('div');
  signature.className = 'analysis-list-item__signature';

  const signatureLabel = document.createElement('span');
  signatureLabel.className = 'analysis-list-item__signature-label';
  signatureLabel.textContent = 'Frequent archetypes';

  const signatureList = document.createElement('div');
  signatureList.className = 'analysis-list-item__signature-list';
  const topArchetypes = player.archetypes.slice(0, 3);
  if (topArchetypes.length > 0) {
    topArchetypes.forEach(archetype => {
      signatureList.appendChild(createArchetypeBadge(archetype.name, archetype.count));
    });
  } else {
    signatureList.textContent = 'No archetype data';
  }

  signature.append(signatureLabel, signatureList);
  main.append(header, countNode, signature);
  preview.appendChild(main);

  const stats = document.createElement('div');
  stats.className = 'analysis-list-item__stats';

  const scoreNode = document.createElement('span');
  scoreNode.className = 'analysis-list-item__percent';
  scoreNode.textContent = `C${formatScore(player.consistency)}`;

  const chevron = document.createElement('span');
  chevron.className = 'analysis-list-item__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '→';

  stats.append(scoreNode, chevron);
  link.append(preview, stats);
  item.appendChild(link);

  return item;
}

function renderSummary(dataset: PlayerDataset): void {
  if (elements.summaryRegionals) {
    elements.summaryRegionals.textContent = formatNumber(dataset.regionals.length);
  }
  if (elements.summaryDecks) {
    elements.summaryDecks.textContent = formatNumber(dataset.decksAnalyzed);
  }
  if (elements.summaryPlayers) {
    elements.summaryPlayers.textContent = formatNumber(dataset.playerCount);
  }
  if (elements.summaryRepeat) {
    elements.summaryRepeat.textContent = formatNumber(dataset.repeatPlayerCount);
  }
  if (elements.summaryGenerated) {
    elements.summaryGenerated.textContent = formatDate(dataset.generatedAt);
  }
}

function createInsightItem(player: PlayerProfile, value: string, meta: string): HTMLLIElement {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.href = `/players/${encodeURIComponent(player.slug)}`;
  link.textContent = player.name;

  const detail = document.createElement('span');
  detail.className = 'analysis-list-item__count';
  detail.textContent = `${value} | ${meta}`;

  item.append(link, document.createTextNode(' '), detail);
  return item;
}

function renderInsights(dataset: PlayerDataset): void {
  const stablePlayers = dataset.players.filter(player => player.events >= 3);

  if (elements.insightsConsistency) {
    elements.insightsConsistency.innerHTML = '';
    const leaders = [...stablePlayers].sort(compareByConsistency).slice(0, 5);
    const fragment = document.createDocumentFragment();
    leaders.forEach(player => {
      fragment.appendChild(
        createInsightItem(
          player,
          `Consistency ${formatScore(player.consistency)}`,
          `${formatPercent(player.top16Rate)} top 16 rate across ${player.events} events`
        )
      );
    });
    elements.insightsConsistency.appendChild(fragment);
  }

  if (elements.insightsConversion) {
    elements.insightsConversion.innerHTML = '';
    const converters = dataset.players
      .filter(player => player.events >= 4)
      .sort(
        (a, b) =>
          b.top16Rate - a.top16Rate ||
          b.top8Rate - a.top8Rate ||
          b.events - a.events ||
          compareNullableNumberAsc(a.bestFinish, b.bestFinish) ||
          a.name.localeCompare(b.name)
      )
      .slice(0, 5);

    const fragment = document.createDocumentFragment();
    converters.forEach(player => {
      fragment.appendChild(
        createInsightItem(
          player,
          `Top 16 ${formatPercent(player.top16Rate)}`,
          `Top 8 ${formatPercent(player.top8Rate)} | ${player.events} events`
        )
      );
    });
    elements.insightsConversion.appendChild(fragment);
  }

  if (elements.insightsSpecialists) {
    elements.insightsSpecialists.innerHTML = '';
    const specialists = dataset.players
      .filter(player => player.entries >= 4 && player.primaryArchetype && player.primaryArchetype.share >= 0.5)
      .sort((a, b) => {
        const aShare = a.primaryArchetype?.share ?? 0;
        const bShare = b.primaryArchetype?.share ?? 0;
        return bShare - aShare || b.events - a.events || compareByConsistency(a, b);
      })
      .slice(0, 5);

    const fragment = document.createDocumentFragment();
    specialists.forEach(player => {
      const primary = player.primaryArchetype;
      if (!primary) {
        return;
      }
      fragment.appendChild(
        createInsightItem(
          player,
          `${primary.name} ${formatPercent(primary.share)}`,
          `${primary.count} of ${player.entries} entries`
        )
      );
    });
    elements.insightsSpecialists.appendChild(fragment);
  }
}

function renderList(): void {
  if (!state.dataset || !elements.list) {
    return;
  }

  const filtered = state.dataset.players.filter(
    player => player.events >= state.minEvents && matchesQuery(player, state.query)
  );
  const sorted = sortPlayers(filtered, state.sortMode);
  const visible = sorted.slice(0, MAX_RENDERED_PLAYERS);

  elements.list.innerHTML = '';
  const fragment = document.createDocumentFragment();
  visible.forEach(player => {
    fragment.appendChild(createPlayerListItem(player));
  });
  elements.list.appendChild(fragment);

  const hasAnyPlayers = state.dataset.players.length > 0;
  const hasResults = visible.length > 0;

  if (elements.empty) {
    elements.empty.hidden = hasAnyPlayers;
  }
  if (elements.emptyResults) {
    elements.emptyResults.hidden = hasResults || !hasAnyPlayers;
  }

  elements.list.hidden = !hasResults;

  if (elements.results) {
    const shownText = formatNumber(visible.length);
    const totalText = formatNumber(filtered.length);
    if (filtered.length > MAX_RENDERED_PLAYERS) {
      elements.results.textContent = `Showing ${shownText} of ${totalText} matching players`;
    } else {
      elements.results.textContent = `${totalText} matching players`;
    }
  }
}

function bindControls(): void {
  if (elements.search) {
    elements.search.addEventListener('input', event => {
      const target = event.target as HTMLInputElement;
      state.query = target.value || '';
      renderList();
    });
  }

  if (elements.minEvents) {
    elements.minEvents.addEventListener('change', event => {
      const target = event.target as HTMLSelectElement;
      const parsed = Number(target.value);
      state.minEvents = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
      renderList();
    });
  }

  if (elements.sort) {
    elements.sort.addEventListener('change', event => {
      const target = event.target as HTMLSelectElement;
      state.sortMode = normalizeSortMode(target.value);
      renderList();
    });
  }
}

async function init(): Promise<void> {
  setLoading(true);
  setStatus('Loading regional player dataset...');

  applyPageSeo({
    title: 'Regional Player Trends - Pokemon TCG Regionals | Ciphermaniac',
    description:
      'Track recurring Pokemon TCG Regional players with consistency metrics, top-finish conversion, and archetype preferences.',
    canonicalPath: '/players',
    structuredData: buildWebPageSchema(
      'Regional Player Trends',
      'Profiles and stats for players appearing at Pokemon TCG Regional events.',
      `${window.location.origin}/players`
    )
  });

  try {
    const dataset = await loadPlayerDataset();
    state.dataset = dataset;
    renderSummary(dataset);
    renderInsights(dataset);
    renderList();
    setStatus(
      `Analyzed ${formatNumber(dataset.decksAnalyzed)} decklists from ${formatNumber(dataset.regionals.length)} regionals. Rankings emphasize consistency and conversion, not raw wins.`
    );
  } catch (error) {
    logger.exception('Failed to initialize regional players page', error);
    setStatus('Unable to load regional player data right now.');
    if (elements.emptyResults) {
      elements.emptyResults.hidden = false;
    }
  } finally {
    setLoading(false);
  }
}

bindControls();
void init();
