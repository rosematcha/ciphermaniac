import './utils/buildVersion.js';
import { findPlayerBySlug, loadPlayerDataset, type PlayerAppearance, type PlayerProfile } from './players/data.js';
import { applyPageSeo, buildWebPageSchema } from './utils/seo.js';
import { prettyTournamentName } from './utils/format.js';
import { logger } from './utils/logger.js';

const numberFormatter = new Intl.NumberFormat('en-US');

const elements = {
  loading: document.getElementById('player-loading') as HTMLElement | null,
  error: document.getElementById('player-error') as HTMLElement | null,
  content: document.getElementById('player-content') as HTMLElement | null,
  name: document.getElementById('player-name') as HTMLElement | null,
  subtitle: document.getElementById('player-subtitle') as HTMLElement | null,
  status: document.getElementById('player-status') as HTMLElement | null,
  statsEvents: document.getElementById('player-stat-events') as HTMLElement | null,
  statsEntries: document.getElementById('player-stat-entries') as HTMLElement | null,
  statsWins: document.getElementById('player-stat-wins') as HTMLElement | null,
  statsTop8: document.getElementById('player-stat-top8') as HTMLElement | null,
  statsTop16: document.getElementById('player-stat-top16') as HTMLElement | null,
  statsBest: document.getElementById('player-stat-best') as HTMLElement | null,
  statsAvg: document.getElementById('player-stat-avg') as HTMLElement | null,
  statsConsistency: document.getElementById('player-stat-consistency') as HTMLElement | null,
  insightsList: document.getElementById('player-insights-list') as HTMLUListElement | null,
  archetypeBody: document.getElementById('player-archetype-body') as HTMLTableSectionElement | null,
  historyBody: document.getElementById('player-history-body') as HTMLTableSectionElement | null,
  historyEmpty: document.getElementById('player-history-empty') as HTMLElement | null,
  breadcrumbName: document.getElementById('player-breadcrumb-name') as HTMLElement | null,
  backToPlayers: document.getElementById('player-back-link') as HTMLAnchorElement | null
};

function setLoading(isLoading: boolean): void {
  if (elements.loading) {
    elements.loading.hidden = !isLoading;
  }
}

function setError(isError: boolean): void {
  if (elements.error) {
    elements.error.hidden = !isError;
  }
  if (elements.content) {
    elements.content.hidden = isError;
  }
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
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}%`;
}

function formatRate(value: number): string {
  return formatPercent(value * 100);
}

function extractPlayerSlugFromPath(): string | null {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  if (parts[0]?.toLowerCase() !== 'players') {
    return null;
  }
  try {
    return decodeURIComponent(parts[1]);
  } catch {
    return parts[1];
  }
}

function renderStats(player: PlayerProfile): void {
  if (elements.statsEvents) {
    elements.statsEvents.textContent = formatNumber(player.events);
  }
  if (elements.statsEntries) {
    elements.statsEntries.textContent = formatNumber(player.entries);
  }
  if (elements.statsWins) {
    elements.statsWins.textContent = formatNumber(player.wins);
  }
  if (elements.statsTop8) {
    elements.statsTop8.textContent = formatNumber(player.top8);
  }
  if (elements.statsTop16) {
    elements.statsTop16.textContent = formatNumber(player.top16);
  }
  if (elements.statsBest) {
    elements.statsBest.textContent = formatPlacement(player.bestFinish);
  }
  if (elements.statsAvg) {
    elements.statsAvg.textContent = player.avgFinish === null ? '--' : `${player.avgFinish.toFixed(1)}`;
  }
  if (elements.statsConsistency) {
    elements.statsConsistency.textContent = `${Math.round(player.consistency * 100)}`;
  }
}

function renderInsights(player: PlayerProfile): void {
  if (!elements.insightsList) {
    return;
  }

  const insights: string[] = [];
  insights.push(`Top 16 conversion: ${formatRate(player.top16Rate)} across ${formatNumber(player.events)} events.`);
  insights.push(`Top 8 conversion: ${formatRate(player.top8Rate)} across ${formatNumber(player.events)} events.`);

  if (player.primaryArchetype) {
    insights.push(
      `Primary archetype: ${player.primaryArchetype.name} in ${formatRate(player.primaryArchetype.share)} of entries (${formatNumber(player.primaryArchetype.count)} of ${formatNumber(player.entries)}).`
    );
  } else {
    insights.push('Primary archetype: not enough data.');
  }

  if (player.bestFinish !== null) {
    insights.push(`Best finish: ${formatPlacement(player.bestFinish)}. Average finish: ${player.avgFinish?.toFixed(1) ?? '--'}.`);
  }

  elements.insightsList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  insights.forEach(text => {
    const item = document.createElement('li');
    item.textContent = text;
    fragment.appendChild(item);
  });
  elements.insightsList.appendChild(fragment);
}

function createArchetypeRow(player: PlayerProfile, archetype: { name: string; count: number }): HTMLTableRowElement {
  const row = document.createElement('tr');

  const nameCell = document.createElement('td');
  nameCell.textContent = archetype.name;

  const entriesCell = document.createElement('td');
  entriesCell.textContent = formatNumber(archetype.count);

  const shareCell = document.createElement('td');
  const share = player.entries > 0 ? (archetype.count / player.entries) * 100 : 0;

  const usageBar = document.createElement('div');
  usageBar.className = 'usagebar';

  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.style.width = `${Math.max(0, Math.min(100, share))}%`;

  const pct = document.createElement('span');
  pct.className = 'pct';
  pct.textContent = formatPercent(share);

  usageBar.append(bar, pct);
  shareCell.appendChild(usageBar);

  row.append(nameCell, entriesCell, shareCell);
  return row;
}

function createHistoryRow(appearance: PlayerAppearance): HTMLTableRowElement {
  const row = document.createElement('tr');

  const dateCell = document.createElement('td');
  dateCell.textContent = formatDate(appearance.date);

  const eventCell = document.createElement('td');
  eventCell.textContent = prettyTournamentName(appearance.tournament);

  const placeCell = document.createElement('td');
  placeCell.textContent = formatPlacement(appearance.placement);

  const fieldCell = document.createElement('td');
  fieldCell.textContent = appearance.tournamentPlayers ? formatNumber(appearance.tournamentPlayers) : '--';

  const archetypeCell = document.createElement('td');
  archetypeCell.textContent = appearance.archetype;

  row.append(dateCell, eventCell, placeCell, fieldCell, archetypeCell);
  return row;
}

function renderPlayer(player: PlayerProfile): void {
  if (elements.name) {
    elements.name.textContent = player.name;
  }

  if (elements.subtitle) {
    const avg = player.avgFinish === null ? '--' : player.avgFinish.toFixed(1);
    elements.subtitle.textContent = `${formatNumber(player.entries)} entries across ${formatNumber(player.events)} regionals | Top 16 ${formatRate(player.top16Rate)} | Top 8 ${formatRate(player.top8Rate)} | Avg finish ${avg}`;
  }

  if (elements.breadcrumbName) {
    elements.breadcrumbName.textContent = player.name;
  }

  renderStats(player);
  renderInsights(player);

  if (elements.archetypeBody) {
    elements.archetypeBody.innerHTML = '';
    const archetypes = player.archetypes.slice(0, 12);
    const fragment = document.createDocumentFragment();
    archetypes.forEach(archetype => {
      fragment.appendChild(createArchetypeRow(player, archetype));
    });
    elements.archetypeBody.appendChild(fragment);
  }

  if (elements.historyBody) {
    elements.historyBody.innerHTML = '';
    const fragment = document.createDocumentFragment();
    player.history.forEach(appearance => {
      fragment.appendChild(createHistoryRow(appearance));
    });
    elements.historyBody.appendChild(fragment);
  }

  if (elements.historyEmpty) {
    elements.historyEmpty.hidden = player.history.length > 0;
  }

  applyPageSeo({
    title: `${player.name} - Regional Player Profile | Ciphermaniac`,
    description: `${player.name} regional profile: ${formatRate(player.top16Rate)} top 16 conversion and ${formatRate(player.top8Rate)} top 8 conversion across ${player.events} tracked events.`,
    canonicalPath: `/players/${encodeURIComponent(player.slug)}`,
    structuredData: buildWebPageSchema(
      `${player.name} Regional Profile`,
      `Regional event history and archetype trends for ${player.name}.`,
      `${window.location.origin}/players/${encodeURIComponent(player.slug)}`
    ),
    breadcrumbs: [
      { name: 'Players', url: `${window.location.origin}/players` },
      { name: player.name, url: `${window.location.origin}/players/${encodeURIComponent(player.slug)}` }
    ]
  });
}

async function init(): Promise<void> {
  setLoading(true);
  setError(false);

  if (elements.backToPlayers) {
    elements.backToPlayers.href = '/players';
  }

  const slug = extractPlayerSlugFromPath();
  if (!slug) {
    setLoading(false);
    setError(true);
    setStatus('Missing player slug in URL.');
    return;
  }

  try {
    const dataset = await loadPlayerDataset();
    const player = findPlayerBySlug(dataset, slug);
    if (!player) {
      setError(true);
      setStatus('Player not found in the tracked regional dataset.');
      return;
    }

    renderPlayer(player);
    setStatus(`Profile generated from ${formatNumber(dataset.regionals.length)} regionals and ${formatNumber(dataset.decksAnalyzed)} decklists.`);
  } catch (error) {
    logger.exception('Failed to initialize player profile', error);
    setError(true);
    setStatus('Unable to load player profile right now.');
  } finally {
    setLoading(false);
  }
}

void init();
