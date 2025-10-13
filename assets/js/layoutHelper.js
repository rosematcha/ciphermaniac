/**
 * Layout computation and synchronization utilities
 * @module LayoutHelper
 */

import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';

/**
 * @typedef {object} LayoutMetrics
 * @property {number} gap - Gap between cards
 * @property {number} base - Base card width
 * @property {number} perRowBig - Cards per big row
 * @property {number} bigRowContentWidth - Content width of big rows
 * @property {number} targetMedium - Target cards per medium row
 * @property {number} mediumScale - Scale factor for medium rows
 * @property {number} targetSmall - Target cards per small row
 * @property {number} smallScale - Scale factor for small rows
 * @property {number} bigRows - Number of big rows
 * @property {number} mediumRows - Number of medium rows
 */

/**
 * Compute layout metrics for a given container width
 * @param {number} containerWidth
 * @returns {LayoutMetrics}
 */
export function computeLayout(containerWidth) {
  const { GAP, BASE_CARD_WIDTH, MIN_BASE_CARD_WIDTH, MIN_SCALE } = CONFIG.LAYOUT;

  const MIN_HORIZONTAL_PADDING = 20;
  const gap = GAP;
  const effectiveWidth = Math.max(0, containerWidth - MIN_HORIZONTAL_PADDING);
  const prefersCompact = typeof window !== 'undefined' && window.innerWidth <= 880;

  if (prefersCompact) {
    const columns = Math.max(1, Math.floor((effectiveWidth + gap) / (MIN_BASE_CARD_WIDTH + gap)));
    const computedBase = columns > 0
      ? Math.floor(((effectiveWidth + gap) / columns) - gap)
      : MIN_BASE_CARD_WIDTH;
    const base = Math.max(MIN_BASE_CARD_WIDTH, Math.min(BASE_CARD_WIDTH, computedBase || MIN_BASE_CARD_WIDTH));
    const contentWidth = columns * base + Math.max(0, columns - 1) * gap;

    const compactMetrics = {
      gap,
      base,
      perRowBig: Math.max(1, columns),
      bigRowContentWidth: contentWidth || base,
      targetMedium: Math.max(1, columns),
      mediumScale: 1,
      targetSmall: Math.max(1, columns),
      smallScale: 1,
      bigRows: 0,
      mediumRows: 0
    };

    logger.debug('Computed layout metrics (compact)', { containerWidth, ...compactMetrics });
    return compactMetrics;
  }

  if (effectiveWidth <= 0) {
    const fallbackMetrics = {
      gap,
      base: MIN_BASE_CARD_WIDTH,
      perRowBig: 1,
      bigRowContentWidth: MIN_BASE_CARD_WIDTH,
      targetMedium: 1,
      mediumScale: 1,
      targetSmall: 1,
      smallScale: 1,
      bigRows: 0,
      mediumRows: 0
    };
    logger.debug('Computed layout metrics (fallback)', { containerWidth, ...fallbackMetrics });
    return fallbackMetrics;
  }

  let base = BASE_CARD_WIDTH;

  const targetBaseForTwo = Math.floor(((effectiveWidth + gap) / 2) - gap);
  if (targetBaseForTwo >= MIN_BASE_CARD_WIDTH) {
    base = Math.min(BASE_CARD_WIDTH, targetBaseForTwo);
  }

  const cardOuter = base + gap;
  const perRowBig = Math.max(1, Math.floor((effectiveWidth + gap) / cardOuter));
  const bigRowContentWidth = perRowBig * base + Math.max(0, perRowBig - 1) * gap;

  let targetMedium = Math.max(1, perRowBig + 1);
  const rawMediumScale = (((bigRowContentWidth + gap) / targetMedium) - gap) / base;
  let mediumScale;

  if (rawMediumScale < MIN_SCALE) {
    targetMedium = perRowBig;
    mediumScale = 1;
  } else {
    mediumScale = Math.min(1, rawMediumScale);
  }

  let targetSmall = Math.max(1, perRowBig + 2);
  const rawSmallScale = (((bigRowContentWidth + gap) / targetSmall) - gap) / base;
  let smallScale;

  if (rawSmallScale < MIN_SCALE) {
    targetSmall = perRowBig;
    smallScale = 1;
  } else {
    smallScale = Math.min(1, rawSmallScale);
  }

  const metrics = {
    gap,
    base,
    perRowBig,
    bigRowContentWidth,
    targetMedium,
    mediumScale,
    targetSmall,
    smallScale,
    bigRows: 1,
    mediumRows: 1
  };

  logger.debug('Computed layout metrics (standard)', { containerWidth, ...metrics });

  return metrics;
}

/**
 * Synchronize controls width to match big row content width (desktop only)
 * @param {number} width - Target width for controls
 */
export function syncControlsWidth(width) {
  // Prefer toolbar controls if present (toolbar was added to separate header from filters)
  const controls = document.querySelector('.toolbar .controls') || document.querySelector('.controls');
  if (!controls) {return;}

  // On small screens, let CSS handle width (mobile override)
  if (window.innerWidth <= 520) {
    if (controls.style.width) {controls.style.width = '';}
    if (controls.style.margin) {controls.style.margin = '';}
    return;
  }

  // If there's a header-inner with a max width, cap controls width to that to avoid excessively wide controls
  const headerInner = document.querySelector('.header-inner');
  const cap = headerInner ? headerInner.clientWidth : width;
  const finalWidth = Math.min(width, cap || width);

  const targetWidth = `${finalWidth}px`;
  if (controls.style.width !== targetWidth) {
    controls.style.width = targetWidth;
  }
  if (controls.style.margin !== '0 auto') {
    controls.style.margin = '0 auto';
  }

  logger.debug(`Synced controls width to ${finalWidth}px`);
}
