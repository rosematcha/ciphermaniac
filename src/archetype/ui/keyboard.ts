import { getState } from '../state.js';
import { elements } from './elements.js';

/**
 * Set up keyboard tab navigation for the archetype view.
 */
export function setupTabNavigation(): void {
  const { tabHome, tabTrends } = elements;
  const state = getState();

  const updateLinks = (): void => {
    if (state.archetypeBase) {
      const encodedName = encodeURIComponent(state.archetypeBase.replace(/ /g, '_'));

      if (tabHome) {
        tabHome.href = `/${encodedName}`;
      }

      if (tabTrends) {
        tabTrends.href = `/${encodedName}/trends`;
      }
    }
  };

  if (tabTrends) {
    tabTrends.addEventListener('click', e => {
      e.preventDefault();
      updateLinks();
      if (tabTrends.href) {
        window.location.href = tabTrends.href;
      }
    });
  }

  if (tabHome) {
    tabHome.addEventListener('click', e => {
      e.preventDefault();
      updateLinks();
      if (tabHome.href) {
        window.location.href = tabHome.href;
      }
    });
  }

  updateLinks();
}
