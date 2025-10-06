// Dev-only: exposes a small Clear cache button when hash includes 'dev-cache'

import { logger } from '../utils/logger.js';

function shouldEnable() {
  return location.hash.includes('dev-cache');
}

export function initCacheDev() {
  if (!shouldEnable()) {return;}
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Clear cache';
  btn.className = 'btn';
  btn.style.marginLeft = 'auto';
  btn.title = 'Clear local caches (grid & per-card) and reload';
  btn.addEventListener('click', () => {
    try { localStorage.removeItem('gridCacheV1'); } catch (error) {
      logger.warn('Failed to clear gridCache:', error);
    }
    try { localStorage.removeItem('metaCacheV1'); } catch (error) {
      logger.warn('Failed to clear metaCache:', error);
    }
    location.reload();
  });
  const controls = document.querySelector('.controls');
  if (controls) { controls.appendChild(btn); }
}
