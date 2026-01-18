let gridTooltip: HTMLElement | null = null;

function ensureGridTooltip(): HTMLElement {
  if (gridTooltip) {
    return gridTooltip;
  }
  const tooltip = document.createElement('div');
  tooltip.className = 'graph-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('aria-live', 'polite');
  tooltip.id = 'grid-tooltip';
  tooltip.style.position = 'fixed';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.zIndex = '9999';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);
  gridTooltip = tooltip;
  return tooltip;
}

/**
 * Show the grid tooltip at a viewport position.
 * @param html - Tooltip HTML.
 * @param x - Client X coordinate.
 * @param y - Client Y coordinate.
 */
export function showGridTooltip(html: string, x: number, y: number): void {
  const tooltip = ensureGridTooltip();
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  const offsetX = 12;
  const offsetY = 12;
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  let left = x + offsetX;
  let top = y + offsetY;
  const rect = tooltip.getBoundingClientRect();
  if (left + rect.width > vw) {
    left = Math.max(8, x - rect.width - offsetX);
  }
  if (top + rect.height > vh) {
    top = Math.max(8, y - rect.height - offsetY);
  }
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

/**
 * Hide the grid tooltip.
 */
export function hideGridTooltip(): void {
  if (gridTooltip) {
    gridTooltip.style.display = 'none';
  }
}
