/* eslint-disable id-length, no-param-reassign, no-unused-vars */
import '../utils/buildVersion.js';
import { elements, state } from './state';
import { renderMetaChart } from './charts/metaChart';
import type { TrendsMode } from './types';
import { hydrateFromDecks, init, rebuildWithFilter } from './fetch';

function setMode(mode: TrendsMode): void {
  state.mode = mode;
  if (elements.modeMeta && elements.modeArchetypes) {
    elements.modeMeta.classList.toggle('is-active', mode === 'meta');
    elements.modeArchetypes.classList.toggle('is-active', mode === 'archetypes');
    elements.modeMeta.setAttribute('aria-pressed', String(mode === 'meta'));
    elements.modeArchetypes.setAttribute('aria-pressed', String(mode === 'archetypes'));
  }
  if (elements.metaPanel) {
    elements.metaPanel.hidden = mode !== 'meta';
  }
  if (elements.archetypePanel) {
    elements.archetypePanel.hidden = mode !== 'archetypes';
  }
}

function bindControls() {
  if (elements.minSlider && elements.minValue) {
    elements.minSlider.disabled = true;
  }

  if (elements.refresh) {
    elements.refresh.addEventListener('click', () => {
      if (state.isHydrating) {
        return;
      }
      hydrateFromDecks();
    });
  }

  if (elements.modeMeta) {
    elements.modeMeta.addEventListener('click', () => {
      setMode('meta');
    });
  }
  if (elements.modeArchetypes) {
    elements.modeArchetypes.addEventListener('click', () => {
      setMode('archetypes');
    });
  }

  // Performance filter dropdown
  if (elements.performanceFilter) {
    elements.performanceFilter.addEventListener('change', () => {
      const newFilter = elements.performanceFilter!.value;
      if (newFilter === state.performanceFilter) {
        return;
      }
      state.performanceFilter = newFilter;

      if (!state.rawDecks || !state.rawTournaments) {
        hydrateFromDecks();
      } else {
        rebuildWithFilter();
      }
    });
  }

  // Density filter dropdown
  if (elements.densityFilter) {
    elements.densityFilter.addEventListener('change', () => {
      const newDensity = parseInt(elements.densityFilter!.value, 10);
      if (newDensity === state.chartDensity || isNaN(newDensity)) {
        return;
      }
      state.chartDensity = newDensity;
      renderMetaChart();
    });
  }

  // Time range filter dropdown
  if (elements.timeFilter) {
    elements.timeFilter.addEventListener('change', () => {
      const newTimeRange = parseInt(elements.timeFilter!.value, 10);
      if (newTimeRange === state.timeRangeDays || isNaN(newTimeRange)) {
        return;
      }
      state.timeRangeDays = newTimeRange;
      renderMetaChart();
    });
  }
}

bindControls();
setMode('meta');
init();

window.addEventListener('resize', () => {
  if (state.resizeTimer) {
    window.clearTimeout(state.resizeTimer);
  }
  state.resizeTimer = window.setTimeout(() => {
    renderMetaChart();
  }, 150);
});
