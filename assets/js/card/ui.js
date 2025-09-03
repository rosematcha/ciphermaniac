/**
 * UI utility functions for card page
 * @module card/ui
 */

// Lightweight floating tooltip used for charts/histograms
let graphTooltipElement = null;

/**
 * Ensure graph tooltip element exists
 * @returns {HTMLElement} Tooltip element
 */
export function ensureGraphTooltip() {
  if (graphTooltipElement) {
    return graphTooltipElement;
  }

  const tooltip = document.createElement('div');
  tooltip.className = 'graph-tooltip';
  tooltip.setAttribute('role', 'status');
  tooltip.style.position = 'fixed';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.zIndex = 9999;
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);
  graphTooltipElement = tooltip;
  return tooltip;
}

/**
 * Show graph tooltip at specified position
 * @param {string} html - Tooltip content HTML
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 */
export function showGraphTooltip(html, x, y) {
  const tooltip = ensureGraphTooltip();
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';

  // Offset so pointer doesn't overlap
  const offsetX = 12;
  const offsetY = 12;

  // Clamp to viewport
  const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  let left = x + offsetX;
  let top = y + offsetY;

  // If overflowing right, move left
  const rect = tooltip.getBoundingClientRect();
  if (left + rect.width > viewportWidth) {
    left = Math.max(8, x - rect.width - offsetX);
  }
  if (top + rect.height > viewportHeight) {
    top = Math.max(8, y - rect.height - offsetY);
  }

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

/**
 * Hide graph tooltip
 */
export function hideGraphTooltip() {
  if (!graphTooltipElement) {
    return;
  }
  graphTooltipElement.style.display = 'none';
}

/**
 * Simple HTML escaper for tooltip content
 * @param {string} str - String to escape
 * @returns {string} Escaped HTML string
 */
export function escapeHtml(str) {
  if (!str) {
    return '';
  }

  return String(str).replace(/[&<>"]/g, character => {
    const htmlEntities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    };
    return htmlEntities[character];
  });
}
