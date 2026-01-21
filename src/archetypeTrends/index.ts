import { fetchTrendsData } from './data/fetch.js';
import { getState } from './state.js';
import { renderCopyEvolution } from './charts/copyEvolution.js';
import { renderChart } from './charts/trendsChart.js';
import { renderCardList, updateCategoryCounts } from './ui/cards.js';
import { bindEvents } from './ui/controls.js';
import { renderInsights } from './ui/insights.js';
import { renderMatchups } from './ui/matchups.js';
import { renderNarrative } from './ui/narrative.js';
import { setPageState, updateTitle } from './ui/page.js';
import { renderStats } from './ui/stats.js';
import { elements } from './ui/elements.js';
import { buildAnalysisUrl, buildHomeUrl, extractArchetypeFromUrl } from './utils/url.js';
import { applyPageSeo, buildWebPageSchema } from '../utils/seo.js';

async function initialize(): Promise<void> {
  const state = getState();
  const archetypeName = extractArchetypeFromUrl();
  if (!archetypeName) {
    setPageState('error');
    return;
  }

  state.archetypeName = archetypeName;
  state.archetypeSlug = archetypeName.replace(/ /g, '_');
  updateTitle();

  const canonicalPath = `/${encodeURIComponent(state.archetypeSlug)}/trends`;
  const title = `${state.archetypeName} Meta Trends - Pokemon TCG Archetype | Ciphermaniac`;
  const description = `Meta share, card trends, and matchups for the ${state.archetypeName} Pokemon TCG archetype.`;
  const absoluteCanonical = new URL(canonicalPath, window.location.origin).toString();

  applyPageSeo({
    title,
    description,
    canonicalPath,
    structuredData: buildWebPageSchema(title, description, absoluteCanonical),
    breadcrumbs: [
      { name: 'Home', url: `${window.location.origin}/` },
      { name: 'Archetypes', url: `${window.location.origin}/archetypes` },
      { name: state.archetypeName, url: `${window.location.origin}/${encodeURIComponent(state.archetypeSlug)}` },
      { name: 'Trends', url: absoluteCanonical }
    ]
  });

  if (elements.tabHome) {
    elements.tabHome.href = buildHomeUrl(state.archetypeSlug);
  }
  if (elements.tabAnalysis) {
    elements.tabAnalysis.href = buildAnalysisUrl(state.archetypeSlug);
  }

  const data = await fetchTrendsData(state.archetypeSlug);

  if (!data || !data.weeks || data.weeks.length < 2) {
    setPageState('ready');
    if (elements.emptyState) {
      elements.emptyState.hidden = false;
    }
    return;
  }

  state.trendsData = data;

  const initialCards: string[] = [];
  const risingCards = data.insights.risers.slice(0, 2).map(r => r.uid);
  initialCards.push(...risingCards);

  const fallingCards = data.insights.fallers.slice(0, 2).map(f => f.uid);
  initialCards.push(...fallingCards);

  if (data.insights.flexSlots.length > 0) {
    initialCards.push(data.insights.flexSlots[0].uid);
  }

  if (initialCards.length < 5) {
    const allCards = Object.entries(data.cards)
      .filter(([uid]) => !initialCards.includes(uid))
      .sort((a, b) => b[1].currentPlayrate - a[1].currentPlayrate);

    if (allCards.length > 0) {
      initialCards.push(allCards[0][0]);
    }

    const midCard = allCards.find(([, card]) => card.currentPlayrate >= 40 && card.currentPlayrate <= 60);
    if (midCard && initialCards.length < 5) {
      initialCards.push(midCard[0]);
    }

    while (initialCards.length < 5 && allCards.length > initialCards.length) {
      const nextCard = allCards[initialCards.length];
      if (nextCard) {
        initialCards.push(nextCard[0]);
      } else {
        break;
      }
    }
  }

  state.selectedCards = new Set(initialCards.slice(0, 5));

  if (initialCards.length > 0) {
    state.activeCopyCard = initialCards[0];
  }

  setPageState('ready');
  if (elements.emptyState) {
    elements.emptyState.hidden = true;
  }

  renderStats();
  renderNarrative();
  renderInsights();
  renderMatchups();
  renderChart();
  updateCategoryCounts();
  renderCardList();
  renderCopyEvolution();
}

export function initArchetypeTrendsPage(): void {
  if (typeof document === 'undefined') {
    return;
  }

  bindEvents();
  initialize().catch(() => {
    setPageState('error');
  });
}
