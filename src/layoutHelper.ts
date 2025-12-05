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
    const { GAP, BASE_CARD_WIDTH, MIN_BASE_CARD_WIDTH, MIN_SCALE } = CONFIG.LAYOUT;

    const MIN_HORIZONTAL_PADDING = 20;
    const gap = GAP;
    const effectiveWidth = Math.max(0, containerWidth - MIN_HORIZONTAL_PADDING);
    const prefersCompact = typeof window !== 'undefined' && window.innerWidth <= 880;
    const isHamburgerWidth = typeof window !== 'undefined' && window.innerWidth <= HAMBURGER_BREAKPOINT;

    if (prefersCompact) {
        const columns = Math.max(1, Math.floor((effectiveWidth + gap) / (MIN_BASE_CARD_WIDTH + gap)));
        const computedBase = columns > 0 ? Math.floor((effectiveWidth + gap) / columns - gap) : MIN_BASE_CARD_WIDTH;
        // On hamburger-sized screens, stick to the normal computed base width (not the absolute minimum) for a "medium" feel
        const base = Math.max(MIN_BASE_CARD_WIDTH, Math.min(BASE_CARD_WIDTH, computedBase || MIN_BASE_CARD_WIDTH));
        const contentWidth = columns * base + Math.max(0, columns - 1) * gap;

        // Allow a modest downscale on hamburger breakpoint to fit an extra card without overflowing the row.
        const MIN_HAMBURGER_SCALE = 0.8;
        let targetSmall = isHamburgerWidth ? Math.max(columns, columns + 1) : Math.max(1, columns);
        let rawSmallScale = ((contentWidth + gap) / targetSmall - gap) / base;

        // If adding the extra card would force the scale below our minimum, drop back to the default columns to avoid clipping.
        if (isHamburgerWidth && rawSmallScale < MIN_HAMBURGER_SCALE) {
            targetSmall = columns;
            rawSmallScale = ((contentWidth + gap) / targetSmall - gap) / base;
        }

        const smallScale = isHamburgerWidth ? Math.min(1, rawSmallScale) : 1;

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
            ...compactMetrics
        });
        return compactMetrics;
    }

    if (effectiveWidth <= 0) {
        const fallbackMetrics: LayoutMetrics = {
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
        logger.debug('Computed layout metrics (fallback)', {
            containerWidth,
            ...fallbackMetrics
        });
        return fallbackMetrics;
    }

    let base = BASE_CARD_WIDTH;

    const targetBaseForTwo = Math.floor((effectiveWidth + gap) / 2 - gap);
    if (targetBaseForTwo >= MIN_BASE_CARD_WIDTH) {
        base = Math.min(BASE_CARD_WIDTH, targetBaseForTwo);
    }

    const cardOuter = base + gap;
    const perRowBig = Math.max(1, Math.floor((effectiveWidth + gap) / cardOuter));
    const bigRowContentWidth = perRowBig * base + Math.max(0, perRowBig - 1) * gap;

    let targetMedium = Math.max(1, perRowBig + 1);
    const rawMediumScale = ((bigRowContentWidth + gap) / targetMedium - gap) / base;
    let mediumScale;

    if (rawMediumScale < MIN_SCALE) {
        targetMedium = perRowBig;
        mediumScale = 1;
    } else {
        mediumScale = Math.min(1, rawMediumScale);
    }

    let targetSmall = Math.max(1, perRowBig + 2);
    const rawSmallScale = ((bigRowContentWidth + gap) / targetSmall - gap) / base;
    let smallScale;

    if (rawSmallScale < MIN_SCALE) {
        targetSmall = perRowBig;
        smallScale = 1;
    } else {
        smallScale = Math.min(1, rawSmallScale);
    }
    const metrics: LayoutMetrics = {
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

    logger.debug('Computed layout metrics (standard)', {
        containerWidth,
        ...metrics
    });

    return metrics;
}

/**
 * Synchronize controls width to match big row content width (desktop only)
 * @param width - Target width for controls
 */
export function syncControlsWidth(_width: number): void {
    const controls = (document.querySelector('.toolbar .controls') || document.querySelector('.controls')) as HTMLElement | null;
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
