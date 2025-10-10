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
  const { GAP, BASE_CARD_WIDTH, MIN_BASE_CARD_WIDTH, BIG_ROWS_COUNT, MIN_SCALE } = CONFIG.LAYOUT;

  // Reserve minimum 20px padding (10px each side) to prevent horizontal scroll
  const MIN_HORIZONTAL_PADDING = 20;
  const effectiveWidth = Math.max(0, containerWidth - MIN_HORIZONTAL_PADDING);

  const gap = GAP;
  let base = BASE_CARD_WIDTH;

  if (effectiveWidth > 0) {
    const targetBaseForTwo = Math.floor(((effectiveWidth + gap) / 2) - gap);
    if (targetBaseForTwo >= MIN_BASE_CARD_WIDTH) {
      base = Math.min(BASE_CARD_WIDTH, targetBaseForTwo);
    } else {
      base = BASE_CARD_WIDTH;
    }
  }

  const cardOuter = base + gap;
  const perRowBig = Math.max(1, Math.floor((effectiveWidth + gap) / cardOuter));
  const bigRowContentWidth = perRowBig * base + Math.max(0, perRowBig - 1) * gap;

  // Calculate medium row (perRowBig + 1 cards)
  let targetMedium = Math.max(1, perRowBig + 1);
  const rawMediumScale = (((bigRowContentWidth + gap) / targetMedium) - gap) / base;
  let mediumScale;

  if (rawMediumScale < MIN_SCALE) {
    targetMedium = perRowBig;
    mediumScale = 1;
  } else {
    mediumScale = Math.min(1, rawMediumScale);
  }

  // Calculate small row (perRowBig + 2 cards)
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
    bigRows: 1, // Only first row is large
    mediumRows: 1 // Only second row is medium
  };

  logger.debug('Computed layout metrics', { containerWidth, ...metrics });

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
