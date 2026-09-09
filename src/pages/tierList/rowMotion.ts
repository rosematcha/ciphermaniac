/**
 * Board rows in motion.
 *
 * Reordering and deleting move rows, and a row that teleports is hard to
 * follow — with six identical-height rows, a swap read as nothing happening at
 * all. Both effects are FLIP: measure where the rows are, let state change
 * them, measure again, then put each row back where it was and release it, so
 * the reflow reads as travel. Transforms and heights only; layout is never
 * animated except the one height a collapse needs.
 *
 * State is still the authority. These take a callback that does the real work
 * and only arrange for it to be watchable.
 * @module pages/tierList/rowMotion
 */

/** How long a reordered row takes to travel. Long enough to follow, short enough to keep clicking. */
export const ROW_MOVE_MS = 140;

const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.tl-board .tl-row[data-row]')];

/**
 * Run `mutate`, then let every row that moved travel from where it was.
 * @param mutate - The state change that reorders the board.
 */
export function animateRows(mutate: () => void): void {
  const before = new Map<string, number>();
  for (const row of rows()) {
    before.set(row.dataset.row!, row.getBoundingClientRect().top);
  }
  mutate();
  queueMicrotask(() => {
    const after = rows();
    for (const row of after) {
      const was = before.get(row.dataset.row!);
      const delta = was === undefined ? 0 : was - row.getBoundingClientRect().top;
      if (!delta) {
        continue;
      }
      row.style.transition = 'none';
      row.style.transform = `translateY(${delta}px)`;
    }
    requestAnimationFrame(() => {
      for (const row of after) {
        row.style.transition = `transform ${ROW_MOVE_MS}ms var(--ease-base)`;
        row.style.transform = '';
      }
    });
  });
}

/**
 * Collapse a row to nothing, then commit. The row goes first so the rows below
 * it have something to follow; committing straight away would delete the thing
 * the eye was tracking.
 * @param id - The tier whose row is going.
 * @param commit - Applies the deletion to state. Called either way — a row that
 * is not on screen still has to be deletable.
 */
export function collapseRow(id: string, commit: () => void): void {
  const row = document.querySelector<HTMLElement>(`.tl-board .tl-row[data-row="${CSS.escape(id)}"]`);
  if (!row) {
    commit();
    return;
  }
  row.style.overflow = 'hidden';
  row.style.height = `${row.getBoundingClientRect().height}px`;
  requestAnimationFrame(() => {
    row.style.transition = `height ${ROW_MOVE_MS}ms var(--ease-base), opacity ${ROW_MOVE_MS}ms var(--ease-base)`;
    row.style.height = '0px';
    row.style.opacity = '0';
  });
  setTimeout(commit, ROW_MOVE_MS);
}
