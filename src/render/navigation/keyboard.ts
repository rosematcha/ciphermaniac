import type { GridElement } from '../types.js';

export function attachGridKeyboardNavigation(grid: GridElement): void {
  if (grid._kbNavAttached) {
    return;
  }

  grid.addEventListener('keydown', event => {
    const active = document.activeElement;

    if (event.key === 'm' || event.key === 'M') {
      const activeTag = active?.tagName?.toLowerCase();
      const isInputFocused = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

      if (!isInputFocused) {
        const moreBtn = grid.querySelector('.more-rows .btn') as HTMLButtonElement | null;
        if (moreBtn && !moreBtn.disabled) {
          event.preventDefault();
          moreBtn.click();
          moreBtn.style.outline = '2px solid var(--primary, #4a9eff)';
          moreBtn.style.outlineOffset = '2px';
          setTimeout(() => {
            moreBtn.style.outline = '';
            moreBtn.style.outlineOffset = '';
          }, 200);
          return;
        }
      }
    }

    if (!active || !active.classList || !active.classList.contains('card')) {
      return;
    }
    const activeEl = active as HTMLElement;
    const rowEl = activeEl.closest('.row') as HTMLElement;
    const rowIdx = Number(activeEl.dataset.row ?? rowEl?.dataset.rowIndex ?? 0);
    const colIdx = Number(activeEl.dataset.col ?? 0);
    const move = (dr: number, dc: number) => {
      const rowsEls = Array.from(grid.querySelectorAll('.row'));
      const targetRowIndex = Math.max(0, Math.min(rowsEls.length - 1, rowIdx + dr));
      const targetRow = rowsEls[targetRowIndex];
      if (!targetRow) {
        return;
      }
      const cards = Array.from(targetRow.querySelectorAll('.card'));
      const targetColIndex = Math.max(0, Math.min(cards.length - 1, colIdx + dc));
      const next = cards[targetColIndex] as HTMLElement | undefined;
      next?.focus();
    };
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        move(0, +1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        move(0, -1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        move(+1, 0);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1, 0);
        break;
      default:
    }
  });

  grid._kbNavAttached = true;
}
