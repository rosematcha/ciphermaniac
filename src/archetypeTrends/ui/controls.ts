import { logger } from '../../utils/logger.js';
import { getState } from '../state.js';
import type { AppState } from '../types.js';
import { elements } from './elements.js';
import { buildAnalysisUrl, buildHomeUrl } from '../utils/url.js';
import { renderChart } from '../charts/trendsChart.js';
import { renderCardList, setupCategoryTabs } from './cards.js';
import { renderStats } from './stats.js';
import { renderCopyEvolution } from '../charts/copyEvolution.js';
import { renderMatchups, setupMatchupSorting } from './matchups.js';

export function bindEvents(): void {
  const state = getState();
  if (elements.tabHome) {
    elements.tabHome.addEventListener('click', e => {
      e.preventDefault();
      window.location.href = buildHomeUrl(state.archetypeSlug);
    });
  }
  if (elements.tabAnalysis) {
    elements.tabAnalysis.addEventListener('click', e => {
      e.preventDefault();
      window.location.href = buildAnalysisUrl(state.archetypeSlug);
    });
  }

  if (elements.performanceFilter) {
    elements.performanceFilter.addEventListener('change', () => {
      state.selectedTier = elements.performanceFilter?.value || 'top8';
      renderChart();
      renderCardList();
      renderStats();
    });
  }

  setupCategoryTabs();

  if (elements.cardSortSelect) {
    elements.cardSortSelect.addEventListener('change', () => {
      state.sortBy = elements.cardSortSelect?.value as AppState['sortBy'];
      renderCardList();
    });
  }

  if (elements.copyCardSelect) {
    elements.copyCardSelect.addEventListener('change', () => {
      state.activeCopyCard = elements.copyCardSelect?.value || null;
      renderCopyEvolution();
    });
  }

  if (elements.toggleWeekly && elements.toggleDaily) {
    elements.toggleWeekly.addEventListener('click', () => {
      if (state.timeScale === 'weekly') {
        return;
      }
      state.timeScale = 'weekly';
      elements.toggleWeekly?.classList.add('active');
      elements.toggleDaily?.classList.remove('active');
      renderChart();
      renderCardList();
    });
    elements.toggleDaily.addEventListener('click', () => {
      if (state.timeScale === 'daily') {
        return;
      }
      if (!state.trendsData?.days || state.trendsData.days.length === 0) {
        logger.warn('No daily data available for trends view');
        return;
      }

      state.timeScale = 'daily';
      elements.toggleDaily?.classList.add('active');
      elements.toggleWeekly?.classList.remove('active');
      renderChart();
      renderCardList();
    });
  }

  if (elements.matchupsToggle) {
    elements.matchupsToggle.addEventListener('click', () => {
      state.showAllMatchups = !state.showAllMatchups;
      renderMatchups();
    });
  }

  setupMatchupSorting();

  window.addEventListener('resize', () => {
    if (state.resizeTimer) {
      clearTimeout(state.resizeTimer);
    }
    state.resizeTimer = window.setTimeout(() => {
      renderChart();
      renderCopyEvolution();
    }, 200);
  });
}
