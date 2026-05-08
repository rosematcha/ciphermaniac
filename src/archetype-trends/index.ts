import { fetchTrendsData } from './data/fetch.js';
import { getState } from './state.js';
import { renderCopyEvolution } from './charts/copyEvolution.js';
import { renderChart } from './charts/trendsChart.js';
import { renderCardList, updateCategoryCounts } from './ui/cards.js';
import { bindEvents } from './ui/controls.js';
import { renderInsights } from './ui/insights.js';
import { renderMatchups } from './ui/matchups.js';
import { setPageState, updateTitle } from './ui/page.js';
import { renderStats } from './ui/stats.js';
import { elements } from './ui/elements.js';
import { buildAnalysisUrl, buildHomeUrl, extractArchetypeFromUrl } from './utils/url.js';
import { applyPageSeo, buildWebPageSchema } from '../utils/seo.js';
import { shouldHideUnreadyFeatures } from '../utils/releaseChannel.js';
import type { EnhancedCardEntry, TrendsData } from './types.js';

const TIER_PREFERENCE = ['all', 'top50', 'top25', 'top16', 'top10', 'top8', 'top4', 'top2', 'winner'] as const;
const MIN_LISTS_FOR_TIER = 30;

function selectBestTier(data: TrendsData): string {
  const tierTotals: Record<string, number> = {};

  for (const tier of TIER_PREFERENCE) {
    tierTotals[tier] = 0;
    for (const day of data.days) {
      tierTotals[tier] += day.totals[tier] || 0;
    }
  }

  for (const tier of ['top8', 'top4', 'top2', 'winner'] as const) {
    if (tierTotals[tier] >= MIN_LISTS_FOR_TIER) {
      return tier;
    }
  }

  for (const tier of ['top16', 'top25', 'top50'] as const) {
    if (tierTotals[tier] >= MIN_LISTS_FOR_TIER) {
      return tier;
    }
  }

  return 'all';
}

function findBestCopyEvolutionCard(data: TrendsData): string | null {
  let bestUid: string | null = null;
  let bestScore = -1;

  for (const [uid, card] of Object.entries(data.cards)) {
    if (card.currentPlayrate < 10 || card.copyTrend.length < 2) {
      continue;
    }

    const score = scoreCopyDebate(card);
    if (score > bestScore) {
      bestScore = score;
      bestUid = uid;
    }
  }

  return bestUid;
}

function scoreCopyDebate(card: EnhancedCardEntry): number {
  const validWeeks = card.copyTrend.filter(wk => wk.dist.reduce((a, b) => a + b, 0) > 0);
  if (validWeeks.length < 2) {
    return 0;
  }

  let totalEntropy = 0;
  for (const week of validWeeks) {
    const total = week.dist.reduce((a, b) => a + b, 0);
    if (total === 0) {
      continue;
    }
    let entropy = 0;
    for (const count of week.dist) {
      if (count > 0) {
        const p = count / total;
        entropy -= p * Math.log2(p);
      }
    }
    totalEntropy += entropy;
  }

  const avgEntropy = totalEntropy / validWeeks.length;

  const avgs = validWeeks.map(wk => wk.avg);
  const mean = avgs.reduce((a, b) => a + b, 0) / avgs.length;
  const avgVariance = avgs.reduce((sum, val) => sum + (val - mean) ** 2, 0) / avgs.length;

  return (avgEntropy * 3 + Math.sqrt(avgVariance)) * (card.currentPlayrate / 100);
}

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

  const bestTier = selectBestTier(data);
  state.selectedTier = bestTier;
  if (elements.performanceFilter) {
    elements.performanceFilter.value = bestTier;
  }

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

  const bestCopyCard = findBestCopyEvolutionCard(data);
  state.activeCopyCard = bestCopyCard || (initialCards.length > 0 ? initialCards[0] : null);

  setPageState('ready');
  if (elements.emptyState) {
    elements.emptyState.hidden = true;
  }

  renderStats();
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

  if (shouldHideUnreadyFeatures()) {
    const archetypeName = extractArchetypeFromUrl();
    const archetypeSlug = archetypeName ? archetypeName.replace(/ /g, '_') : '';
    const fallbackUrl = archetypeSlug ? buildAnalysisUrl(archetypeSlug) : '/archetypes';
    window.location.replace(fallbackUrl);
    return;
  }

  bindEvents();
  initialize().catch(() => {
    setPageState('error');
  });
}
