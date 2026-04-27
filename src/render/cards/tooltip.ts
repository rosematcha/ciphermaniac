let gridTooltip: HTMLElement | null = null;
let lastTooltipHtml = '';

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
  tooltip.style.zIndex = '9999';
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
  if (lastTooltipHtml !== html) {
    tooltip.innerHTML = html;
    lastTooltipHtml = html;
  }
  tooltip.classList.add('is-visible');
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
    gridTooltip.classList.remove('is-visible');
    lastTooltipHtml = '';
  }
}
