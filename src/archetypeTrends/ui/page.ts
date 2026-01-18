import { getState } from '../state.js';
import { elements } from './elements.js';

export function setPageState(status: 'loading' | 'ready' | 'error'): void {
  if (elements.page) {
    elements.page.setAttribute('data-state', status);
  }
  if (elements.loading) {
    elements.loading.hidden = status !== 'loading';
  }
  if (elements.error) {
    elements.error.hidden = status !== 'error';
  }
  if (elements.simple) {
    elements.simple.hidden = status !== 'ready';
  }
}

export function updateTitle(): void {
  const state = getState();
  if (elements.title) {
    elements.title.textContent = `${state.archetypeName} Trends`;
  }
  document.title = `${state.archetypeName} Trends - Ciphermaniac`;
}
