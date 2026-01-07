/**
 * UI utility functions for card page
 * @module card/ui
 */

// Re-export escapeHtml from shared utility for backward compatibility
export { escapeHtml } from '../utils/html.js';

import { getGraphTooltip } from '../utils/tooltip.js';

// Use shared tooltip manager for charts/histograms
const graphTooltip = getGraphTooltip();

/**
 * Ensure graph tooltip element exists
 * @returns Tooltip element
 * @deprecated Use getGraphTooltip() from utils/tooltip.js instead
 */
export function ensureGraphTooltip(): HTMLElement {
  // For backward compatibility, trigger tooltip creation and return a proxy element
  // This is deprecated - callers should use showGraphTooltip/hideGraphTooltip instead
  graphTooltip.show('', 0, 0);
  graphTooltip.hide();
  const el = document.querySelector('.graph-tooltip') as HTMLElement;
  return el || document.createElement('div');
}

/**
 * Show graph tooltip at specified position
 * @param html - Tooltip content HTML
 * @param x - X coordinate
 * @param y - Y coordinate
 */
export function showGraphTooltip(html: string, x: number, y: number): void {
  graphTooltip.show(html, x, y);
}

/**
 * Hide graph tooltip
 */
export function hideGraphTooltip(): void {
  graphTooltip.hide();
}
