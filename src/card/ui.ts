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
