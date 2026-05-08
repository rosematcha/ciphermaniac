import { normalizeCardNumber } from '../../../shared/cardUtils.js';
import type { CardItem } from '../../types/index.js';

export function getCardIdentityKey(item: CardItem): string | null {
  const { uid } = item;
  const setCode = item.set ? String(item.set).toUpperCase() : '';
  const number = item.number ? normalizeCardNumber(item.number) : '';
  const cardId = setCode && number ? `${setCode}~${number}` : null;
  const name = item.name ? item.name.toLowerCase() : null;
  return uid || cardId || name;
}

export interface RowScaleMetrics {
  largeRows: number;
  mediumRows: number;
  useSmallRows: boolean;
  forceCompact: boolean;
  perRowBig: number;
  targetMedium: number;
  targetSmall: number;
  mediumScale: number;
  smallScale: number;
}

/**
 * Determine the scale and max card count for a row based on its index.
 * Shared by renderGrid, expandRows, and layout.
 */
export function getRowScale(rowIndex: number, metrics: RowScaleMetrics): { scale: number; maxCount: number } {
  const { largeRows, mediumRows, useSmallRows, forceCompact } = metrics;
  const { perRowBig, targetMedium, targetSmall, mediumScale, smallScale } = metrics;

  const isLarge = !forceCompact && rowIndex < largeRows;
  const isMedium = !forceCompact && !isLarge && rowIndex < largeRows + mediumRows;
  const isSmall = forceCompact || (!isLarge && !isMedium && useSmallRows);

  if (forceCompact || isSmall) {
    return { scale: smallScale, maxCount: targetSmall };
  }
  if (isLarge) {
    return { scale: 1, maxCount: perRowBig };
  }
  if (isMedium) {
    return { scale: mediumScale, maxCount: targetMedium };
  }
  return { scale: mediumScale, maxCount: targetMedium };
}
