/**
 * Card element creation and management for the grid renderer.
 * Contains all functions related to creating, populating, and managing individual card DOM elements.
 */
import { hideGridTooltip, showGridTooltip } from './cards/tooltip.js';

export { showGridTooltip, hideGridTooltip };

// Currency formatter for card prices
const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/**
 * Format a card price for display
 */
export function formatCardPrice(rawPrice: number | undefined | null): string | null {
  if (typeof rawPrice === 'number' && Number.isFinite(rawPrice)) {
    return USD_FORMATTER.format(rawPrice);
  }
  return null;
}
