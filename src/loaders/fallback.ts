import { logger } from '../utils/logger.js';

const GENERIC_MESSAGE = 'We could not load this page. Please refresh and try again.';

function hideKnownLoadingIndicators(): void {
  const loadingIds = [
    'archetype-loading',
    'trends-loading',
    'trends-loading-arch',
    'analysis-list-loading',
    'players-list-loading',
    'player-loading',
    'binder-loading',
    'player-connections-loading'
  ];
  loadingIds.forEach(id => {
    const element = document.getElementById(id);
    if (!element) {
      return;
    }
    element.setAttribute('hidden', 'true');
    if (element instanceof HTMLElement) {
      element.style.display = 'none';
    }
  });
}

function revealKnownErrorBlocks(message: string): void {
  const archetypeError = document.getElementById('archetype-error');
  if (archetypeError) {
    archetypeError.removeAttribute('hidden');
    const paragraph = archetypeError.querySelector('p');
    if (paragraph) {
      paragraph.textContent = message;
    }
  }

  const binderError = document.getElementById('binder-error');
  if (binderError) {
    binderError.removeAttribute('hidden');
    const binderErrorMessage = document.getElementById('binder-error-message');
    if (binderErrorMessage) {
      binderErrorMessage.textContent = message;
    }
  }
}

function renderGlobalErrorBanner(message: string): void {
  const existing = document.getElementById('cm-loader-error');
  if (existing) {
    const text = existing.querySelector('[data-cm-loader-text]');
    if (text) {
      text.textContent = message;
    }
    return;
  }

  const container = document.getElementById('main-content') || document.querySelector('main') || document.body;
  if (!container) {
    return;
  }

  const banner = document.createElement('section');
  banner.id = 'cm-loader-error';
  banner.setAttribute('role', 'alert');
  banner.setAttribute('aria-live', 'assertive');
  banner.style.cssText =
    'margin:12px 0;padding:12px;border:1px solid rgba(239,68,68,0.5);border-radius:10px;background:rgba(127,29,29,0.2);display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;';

  const text = document.createElement('p');
  text.setAttribute('data-cm-loader-text', 'true');
  text.style.cssText = 'margin:0;color:#f8d7da;font-size:14px;';
  text.textContent = message;

  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.textContent = 'Retry';
  retryButton.style.cssText =
    'padding:8px 12px;border-radius:8px;border:1px solid rgba(248,113,113,0.7);background:rgba(127,29,29,0.35);color:#ffe4e6;font-weight:600;cursor:pointer;';
  retryButton.addEventListener('click', () => {
    window.location.reload();
  });

  banner.append(text, retryButton);
  if (container.firstChild) {
    container.insertBefore(banner, container.firstChild);
  } else {
    container.appendChild(banner);
  }
}

export function handleLoaderFailure(contextLabel: string, error: unknown): void {
  logger.exception(`${contextLabel} failed to load`, error);
  hideKnownLoadingIndicators();
  revealKnownErrorBlocks(GENERIC_MESSAGE);
  renderGlobalErrorBanner(GENERIC_MESSAGE);
}
