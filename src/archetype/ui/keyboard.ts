import { getState } from '../state.js';
import { elements } from './elements.js';
import { shouldHideUnreadyFeatures } from '../../utils/releaseChannel.js';

/**
 * Set up keyboard tab navigation for the archetype view.
 */
export function setupTabNavigation(): void {
  const { tabHome, tabTrends } = elements;
  const state = getState();
  const hideUnreadyFeatures = shouldHideUnreadyFeatures();

  if (hideUnreadyFeatures && tabTrends) {
    tabTrends.remove();
  }

  const updateLinks = (): void => {
    if (state.archetypeBase) {
      const encodedName = encodeURIComponent(state.archetypeBase.replace(/ /g, '_'));

      if (tabHome) {
        tabHome.href = `/${encodedName}`;
      }

      if (!hideUnreadyFeatures && tabTrends) {
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
  keepHrefFresh(hideUnreadyFeatures ? null : tabTrends);

  updateLinks();
}
