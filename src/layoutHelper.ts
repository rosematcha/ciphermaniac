/**
 * Layout computation and synchronization utilities
 * @module LayoutHelper
 */

import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';

// Match the header CSS breakpoint where the hamburger menu appears
const HAMBURGER_BREAKPOINT = 720;

export interface LayoutMetrics {
  gap: number;
  base: number;
  perRowBig: number;
  bigRowContentWidth: number;
  targetMedium: number;
  mediumScale: number;
  targetSmall: number;
  smallScale: number;
  bigRows: number;
  mediumRows: number;
}

/**
 * Compute layout metrics for a given container width
 * @param containerWidth
 * @returns LayoutMetrics
 */
export function computeLayout(containerWidth: number): LayoutMetrics {
  const { GAP, BASE_CARD_WIDTH, MIN_BASE_CARD_WIDTH, MOBILE_MIN_CARD_WIDTH, MOBILE_GAP, MOBILE_PADDING, MIN_SCALE } =
    CONFIG.LAYOUT;

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : containerWidth;
  const prefersCompact = viewportWidth <= 880;
  const isHamburgerWidth = viewportWidth <= HAMBURGER_BREAKPOINT;

  // Use mobile-optimized values for small screens
  const gap = isHamburgerWidth ? MOBILE_GAP : GAP;
  const minHorizontalPadding = isHamburgerWidth ? MOBILE_PADDING : 20;
  const minCardWidth = isHamburgerWidth ? MOBILE_MIN_CARD_WIDTH : MIN_BASE_CARD_WIDTH;

  const effectiveWidth = Math.max(0, containerWidth - minHorizontalPadding);

  if (prefersCompact) {
    // Target 3 cards per row on mobile devices
    const targetCardsPerRow = isHamburgerWidth
      ? 3
      : Math.max(1, Math.floor((effectiveWidth + gap) / (minCardWidth + gap)));

    // Calculate optimal card width for target number of cards
    const computedBase =
      targetCardsPerRow > 0 ? Math.floor((effectiveWidth + gap) / targetCardsPerRow - gap) : minCardWidth;

    // Ensure cards don't get too large or too small
    const base = Math.max(minCardWidth, Math.min(BASE_CARD_WIDTH, computedBase));
    const contentWidth = targetCardsPerRow * base + Math.max(0, targetCardsPerRow - 1) * gap;

    // Use a more permissive scale for mobile to maximize space usage
    const MIN_MOBILE_SCALE = 0.75;
    const columns = targetCardsPerRow;
    let targetSmall = columns;
    let rawSmallScale = ((contentWidth + gap) / targetSmall - gap) / base;

    // If we can't fit the target at the minimum scale, reduce card count
    if (rawSmallScale < MIN_MOBILE_SCALE && targetSmall > 1) {
      targetSmall -= 1;
      rawSmallScale = ((contentWidth + gap) / targetSmall - gap) / base;
    }

    const smallScale = Math.max(MIN_MOBILE_SCALE, Math.min(1, rawSmallScale));

    const compactMetrics: LayoutMetrics = {
      gap,
      base,
      perRowBig: Math.max(1, columns),
      bigRowContentWidth: contentWidth || base,
      targetMedium: Math.max(1, columns),
      mediumScale: smallScale,
      targetSmall,
      smallScale,
      bigRows: 0,
      mediumRows: 0
    };

    logger.debug('Computed layout metrics (compact)', {
      containerWidth,
      viewportWidth,
      targetCardsPerRow,
      ...compactMetrics
    });
    return compactMetrics;
  }

  if (effectiveWidth <= 0) {
    const fallbackGap = GAP; // Use default gap for fallback
    const fallbackMetrics: LayoutMetrics = {
      gap: fallbackGap,
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
    logger.debug('Computed layout metrics (fallback)', {
      containerWidth,
      ...fallbackMetrics
    });
    return fallbackMetrics;
  }

  // Desktop mode - use default gap
  const desktopGap = GAP;
  let base = BASE_CARD_WIDTH;

  const targetBaseForTwo = Math.floor((effectiveWidth + desktopGap) / 2 - desktopGap);
  if (targetBaseForTwo >= MIN_BASE_CARD_WIDTH) {
    base = Math.min(BASE_CARD_WIDTH, targetBaseForTwo);
  }

  const cardOuter = base + desktopGap;
  const perRowBig = Math.max(1, Math.floor((effectiveWidth + desktopGap) / cardOuter));
  const bigRowContentWidth = perRowBig * base + Math.max(0, perRowBig - 1) * desktopGap;

  let targetMedium = Math.max(1, perRowBig + 1);
  const rawMediumScale = ((bigRowContentWidth + desktopGap) / targetMedium - desktopGap) / base;
  let mediumScale;

  if (rawMediumScale < MIN_SCALE) {
    targetMedium = perRowBig;
    mediumScale = 1;
  } else {
    mediumScale = Math.min(1, rawMediumScale);
  }

  let targetSmall = Math.max(1, perRowBig + 2);
  const rawSmallScale = ((bigRowContentWidth + desktopGap) / targetSmall - desktopGap) / base;
  let smallScale;

  if (rawSmallScale < MIN_SCALE) {
    targetSmall = perRowBig;
    smallScale = 1;
  } else {
    smallScale = Math.min(1, rawSmallScale);
  }
  const metrics: LayoutMetrics = {
    gap: desktopGap,
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

  logger.debug('Computed layout metrics (standard)', {
    containerWidth,
    ...metrics
  });

  return metrics;
}

/**
 * Synchronize controls width to match big row content width (desktop only)
 * @param _width - Target width for controls
 */
export function syncControlsWidth(_width: number): void {
  const controls = (document.querySelector('.toolbar .controls') ||
    document.querySelector('.controls')) as HTMLElement | null;
  if (!controls) {
    return;
  }

  if (controls.style.width) {
    controls.style.width = '';
  }
  if (controls.style.margin) {
    controls.style.margin = '';
  }
}
