import { computeLayout, syncControlsWidth } from '../../layoutHelper.js';
import { perf } from '../../utils/performance.js';
import { MOBILE_MAX_WIDTH } from '../constants.js';
import { getGridElement } from './elements.js';

function getExpectedCardsForRow(
  rowIndex: number,
  forceCompact: boolean,
  effectiveBigRows: number,
  effectiveMediumRows: number,
  useSmallRows: boolean,
  perRowBig: number,
  targetMedium: number,
  targetSmall: number
): number {
  if (forceCompact) {
    return targetSmall;
  }

  const isLarge = rowIndex < effectiveBigRows;
  const isMedium = !isLarge && rowIndex < effectiveBigRows + effectiveMediumRows;
  const isSmall = !isLarge && !isMedium && useSmallRows;

  if (isLarge) {
    return perRowBig;
  }
  if (isMedium) {
    return targetMedium;
  }
  if (isSmall) {
    return targetSmall;
  }
  return targetMedium;
}

function computeTotalRows(
  cardCount: number,
  forceCompact: boolean,
  effectiveBigRows: number,
  effectiveMediumRows: number,
  useSmallRows: boolean,
  perRowBig: number,
  targetMedium: number,
  targetSmall: number
): number {
  let cnt = 0;
  let idx = 0;
  while (idx < cardCount) {
    const maxCount = getExpectedCardsForRow(
      cnt,
      forceCompact,
      effectiveBigRows,
      effectiveMediumRows,
      useSmallRows,
      perRowBig,
      targetMedium,
      targetSmall
    );
    idx += maxCount;
    cnt++;
  }
  return cnt;
}

/**
 * Recalculate layout and apply the grid layout changes.
 */
export function updateLayout(): void {
  perf.start('updateLayout');
  const grid = getGridElement();
  if (!grid) {
    perf.end('updateLayout');
    return;
  }
  const cards = Array.from(grid.querySelectorAll('.card')) as HTMLElement[];
  if (cards.length === 0) {
    perf.end('updateLayout');
    return;
  }

  const containerWidth = grid.clientWidth || grid.getBoundingClientRect().width || 0;
  if (containerWidth <= 0) {
    perf.end('updateLayout');
    return;
  }

  const {
    base,
    perRowBig,
    bigRowContentWidth,
    targetMedium,
    mediumScale,
    targetSmall,
    smallScale,
    bigRows,
    mediumRows
  } = computeLayout(containerWidth);
  syncControlsWidth(bigRowContentWidth);

  const prefersCompact = typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX_WIDTH;
  const forceCompact = prefersCompact || grid._renderOptions?.layoutMode === 'compact';
  grid._autoCompact = prefersCompact;
  const effectiveBigRows = forceCompact ? 0 : bigRows;
  const effectiveMediumRows = forceCompact ? 0 : mediumRows;

  const useSmallRows = forceCompact || (perRowBig >= 6 && targetSmall > targetMedium);

  const prev = grid._layoutMetrics;
  const groupingUnchanged =
    prev &&
    prev.perRowBig === perRowBig &&
    prev.forceCompact === forceCompact &&
    prev.targetMedium === targetMedium &&
    prev.targetSmall === targetSmall &&
    prev.bigRows === effectiveBigRows &&
    prev.mediumRows === effectiveMediumRows &&
    prev.useSmallRows === useSmallRows;

  let rowsHaveCorrectCounts = true;
  if (groupingUnchanged) {
    const existingRows = Array.from(grid.querySelectorAll('.row')) as HTMLElement[];
    for (let rowIdx = 0; rowIdx < existingRows.length; rowIdx++) {
      const row = existingRows[rowIdx];
      const actualCardCount = row.querySelectorAll('.card').length;
      const expectedCount = getExpectedCardsForRow(
        rowIdx,
        forceCompact,
        effectiveBigRows,
        effectiveMediumRows,
        useSmallRows,
        perRowBig,
        targetMedium,
        targetSmall
      );

      const isLastRow = rowIdx === existingRows.length - 1;
      const isValidCount = isLastRow ? actualCardCount <= expectedCount : actualCardCount === expectedCount;

      if (!isValidCount) {
        rowsHaveCorrectCounts = false;
        break;
      }
    }
  }

  if (groupingUnchanged && rowsHaveCorrectCounts) {
    const rows = Array.from(grid.querySelectorAll('.row')) as HTMLElement[];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const isLarge = !forceCompact && rowIndex < effectiveBigRows;
      const isMedium = !forceCompact && !isLarge && rowIndex < effectiveBigRows + effectiveMediumRows;
      const isSmall = forceCompact || (!isLarge && !isMedium && useSmallRows);

      let scale;
      if (forceCompact) {
        scale = smallScale;
      } else if (isLarge) {
        scale = 1;
      } else if (isMedium) {
        scale = mediumScale;
      } else if (isSmall) {
        scale = smallScale;
      } else {
        scale = mediumScale;
      }

      row.style.setProperty('--scale', String(scale));
      row.style.setProperty('--card-base', `${base}px`);
      row.style.width = `${bigRowContentWidth}px`;
      row.style.margin = '0 auto';
    }
    grid._layoutMetrics = {
      base,
      perRowBig,
      bigRowContentWidth,
      targetMedium,
      mediumScale,
      targetSmall,
      smallScale,
      bigRows: effectiveBigRows,
      mediumRows: effectiveMediumRows,
      useSmallRows,
      forceCompact
    };
    perf.end('updateLayout');
    return;
  }

  const savedMore = (grid.querySelector('.more-rows') as HTMLElement | null) || grid._moreWrapRef || null;
  const frag = document.createDocumentFragment();
  let i = 0;
  let rowIndex = 0;

  const totalCards = Number.isInteger(grid._totalCards) ? grid._totalCards! : cards.length;
  const newTotalRows = computeTotalRows(
    totalCards,
    forceCompact,
    effectiveBigRows,
    effectiveMediumRows,
    useSmallRows,
    perRowBig,
    targetMedium,
    targetSmall
  );

  while (i < cards.length) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.rowIndex = String(rowIndex);

    const maxCount = getExpectedCardsForRow(
      rowIndex,
      forceCompact,
      effectiveBigRows,
      effectiveMediumRows,
      useSmallRows,
      perRowBig,
      targetMedium,
      targetSmall
    );

    const isLarge = !forceCompact && rowIndex < effectiveBigRows;
    const isMedium = !forceCompact && !isLarge && rowIndex < effectiveBigRows + effectiveMediumRows;
    const isSmall = forceCompact || (!isLarge && !isMedium && useSmallRows);

    let scale;
    if (forceCompact) {
      scale = smallScale;
    } else if (isLarge) {
      scale = 1;
    } else if (isMedium) {
      scale = mediumScale;
    } else if (isSmall) {
      scale = smallScale;
    } else {
      scale = mediumScale;
    }

    row.style.setProperty('--scale', String(scale));
    row.style.setProperty('--card-base', `${base}px`);
    row.style.width = `${bigRowContentWidth}px`;
    row.style.margin = '0 auto';

    const count = Math.min(maxCount, cards.length - i);
    for (let j = 0; j < count && i < cards.length; j++, i++) {
      const cardEl = cards[i];
      if (cardEl) {
        cardEl.dataset.row = String(rowIndex);
        cardEl.dataset.col = String(j);
      }
      row.appendChild(cardEl);
    }
    frag.appendChild(row);
    rowIndex++;
  }

  grid._visibleRows = rowIndex;

  if (savedMore && rowIndex < newTotalRows) {
    frag.appendChild(savedMore);
    grid._moreWrapRef = savedMore;
  } else if (savedMore && rowIndex >= newTotalRows) {
    grid._moreWrapRef = null;
  }

  requestAnimationFrame(() => {
    grid.replaceChildren(frag);
  });

  grid._layoutMetrics = {
    base,
    perRowBig,
    bigRowContentWidth,
    targetMedium,
    mediumScale,
    targetSmall,
    smallScale,
    bigRows: effectiveBigRows,
    mediumRows: effectiveMediumRows,
    useSmallRows,
    forceCompact
  };
  grid._totalRows = newTotalRows;
  perf.end('updateLayout');
}
