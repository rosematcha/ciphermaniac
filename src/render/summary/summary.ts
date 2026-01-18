import { getGridElement } from '../grid/elements.js';

/**
 * Render the summary text for the grid.
 * @param container - Summary container.
 * @param deckTotal - Total deck count.
 * @param count - Card count.
 * @param visibleRows - Visible row count.
 * @param totalRows - Total row count.
 */
export function renderSummary(
  container: HTMLElement | null,
  deckTotal: number,
  count: number,
  visibleRows: number | null = null,
  totalRows: number | null = null
): void {
  if (!container) {
    return;
  }
  const parts: string[] = [];
  if (deckTotal) {
    parts.push(`${deckTotal} decklists`);
  }
  parts.push(`${count} cards`);

  if (
    visibleRows !== null &&
    totalRows !== null &&
    Number.isFinite(visibleRows) &&
    Number.isFinite(totalRows) &&
    totalRows > visibleRows
  ) {
    parts.push(`showing ${visibleRows} of ${totalRows} rows`);
  }

  container.textContent = parts.join(' - ');
}

/**
 * Update the summary using current grid row counts.
 * @param deckTotal - Total deck count.
 * @param cardCount - Total card count.
 */
export function updateSummaryWithRowCounts(deckTotal: number, cardCount: number): void {
  const grid = getGridElement();
  const summaryEl = document.getElementById('summary');

  if (!grid || !summaryEl) {
    return;
  }

  const currentVisibleRows = grid.querySelectorAll('.row').length;
  const totalRows = grid._totalRows || currentVisibleRows;

  renderSummary(summaryEl, deckTotal, cardCount, currentVisibleRows, totalRows);
}
