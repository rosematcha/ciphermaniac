/**
 * The cards a section shows around its usage cut-off. Opened, the section shows
 * every card in its own order, so an evolution line under the cut-off rejoins
 * the cards it sits between.
 * @param items - The section's cards, in order
 * @param cutPct - The inclusion % under which cards wait behind the end cell; none hides nothing
 * @param open - Whether the reader has opened the cards under the cut-off
 * @returns The cards to show and how many sit under the cut-off
 */
export function cutCards<T extends { pct: number }>(
  items: readonly T[],
  cutPct: number | undefined,
  open: boolean
): { shown: readonly T[]; under: number } {
  const cut = cutPct ?? 0;
  const under = items.filter(item => item.pct < cut).length;
  return { shown: open ? items : items.filter(item => item.pct >= cut), under };
}
