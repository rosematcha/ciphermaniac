import { elements } from './elements.js';
import { getState } from '../state.js';
import { formatEventName } from '../utils/format.js';

export function setPageState(status: string): void {
  if (!elements.page) {
    return;
  }
  elements.page.setAttribute('data-state', status);
}

export function toggleLoading(isLoading: boolean): void {
  if (elements.loading) {
    elements.loading.hidden = !isLoading;
  }
}

export function showError(message: string): void {
  if (elements.error) {
    elements.error.hidden = false;
    const heading = elements.error.querySelector('h2');
    if (heading) {
      heading.textContent = message || "We couldn't load that archetype.";
    }
  }
}

export function updateHero(): void {
  const state = getState();
  if (elements.title) {
    elements.title.textContent = state.archetypeLabel;
  }
  document.title = `${state.archetypeLabel} \u00B7 ${formatEventName(state.tournament)} \u2013 Ciphermaniac`;
}
