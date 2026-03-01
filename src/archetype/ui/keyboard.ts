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

  const keepHrefFresh = (link: HTMLAnchorElement | null): void => {
    if (!link) {
      return;
    }
    link.addEventListener('pointerenter', updateLinks);
    link.addEventListener('focus', updateLinks);
    link.addEventListener('click', updateLinks);
  };

  keepHrefFresh(tabHome);
  keepHrefFresh(tabTrends);

  updateLinks();
}
