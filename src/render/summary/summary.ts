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
