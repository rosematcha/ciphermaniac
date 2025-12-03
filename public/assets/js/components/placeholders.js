/**
 * Placeholder components to reduce Cumulative Layout Shift (CLS)
 * @module Placeholders
 */
import { computeLayout } from '../layoutHelper.js';
/**
 * Create a skeleton card placeholder
 * @param isLarge
 */
export function createCardSkeleton(isLarge = false) {
    const card = document.createElement('article');
    card.className = `card skeleton-card ${isLarge ? 'large' : 'small'}`;
    card.setAttribute('aria-hidden', 'true');
    card.innerHTML = `
        <div class="thumb">
            <div class="skeleton-img"></div>
            <div class="overlay">
                <div class="hist">
                    <div class="skeleton-bar"></div>
                    <div class="skeleton-bar"></div>
                    <div class="skeleton-bar"></div>
                    <div class="skeleton-bar"></div>
                </div>
                <div class="usagebar">
                    <div class="skeleton-usage-bar"></div>
                    <span class="skeleton-text small"></span>
                </div>
            </div>
        </div>
        <div class="titleRow">
            <div class="skeleton-text name"></div>
            <div class="skeleton-text counts"></div>
        </div>
    `;
    return card;
}
/**
 * Create a grid of skeleton cards using proper layout computation
 * @param containerWidth
 * @param rowCount
 */
export function createGridSkeleton(containerWidth = 1200, rowCount = 6) {
    const layout = computeLayout(containerWidth);
    const frag = document.createDocumentFragment();
    // First 2 rows are large cards (matches NUM_LARGE_ROWS from render.js)
    const NUM_LARGE_ROWS = 2;
    // Create a wrapper div to match the grid structure and add proper centering
    const gridWrapper = document.createElement('div');
    gridWrapper.className = 'skeleton-grid-wrapper';
    gridWrapper.style.cssText = `
        max-width: ${layout.bigRowContentWidth}px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--gap, 12px);
    `;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const row = document.createElement('div');
        row.className = 'row skeleton-row';
        row.dataset.rowIndex = String(rowIndex);
        const isLarge = rowIndex < NUM_LARGE_ROWS;
        const cardsPerRow = isLarge ? layout.perRowBig : layout.targetSmall;
        const scale = isLarge ? 1 : layout.smallScale;
        row.style.setProperty('--scale', String(scale));
        row.style.setProperty('--card-base', `${layout.base}px`);
        for (let cardIndex = 0; cardIndex < cardsPerRow; cardIndex++) {
            const skeletonCard = createCardSkeleton(isLarge);
            row.appendChild(skeletonCard);
        }
        gridWrapper.appendChild(row);
    }
    frag.appendChild(gridWrapper);
    return frag;
}
/**
 * Create skeleton for dropdown/select elements
 * @param width
 */
export function createSelectSkeleton(width = '200px') {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton-select';
    skeleton.style.width = width;
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.innerHTML = `<div class="skeleton-text select-text"></div>`;
    return skeleton;
}
/**
 * Create skeleton for network visualization
 */
export function createNetworkSkeleton() {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton-network';
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.innerHTML = `
        <div class="skeleton-nodes">
            <div class="skeleton-node large"></div>
            <div class="skeleton-node medium"></div>
            <div class="skeleton-node small"></div>
            <div class="skeleton-node medium"></div>
            <div class="skeleton-node large"></div>
            <div class="skeleton-node small"></div>
        </div>
        <div class="skeleton-edges">
            <div class="skeleton-edge"></div>
            <div class="skeleton-edge"></div>
            <div class="skeleton-edge"></div>
        </div>
    `;
    return skeleton;
}
/**
 * Create skeleton for charts/graphs
 * @param height
 */
export function createChartSkeleton(height = '300px') {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton-chart';
    skeleton.style.height = height;
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.innerHTML = `
        <div class="skeleton-axes">
            <div class="skeleton-y-axis"></div>
            <div class="skeleton-x-axis"></div>
            <div class="skeleton-y-label">Usage %</div>
            <div class="skeleton-x-label">Tournaments</div>
        </div>
        <div class="skeleton-line-graph">
            <div class="skeleton-line-path"></div>
            <div class="skeleton-dots">
                <div class="skeleton-dot" style="left: 15%; top: 40%;"></div>
                <div class="skeleton-dot" style="left: 25%; top: 20%;"></div>
                <div class="skeleton-dot" style="left: 40%; top: 55%;"></div>
                <div class="skeleton-dot" style="left: 60%; top: 30%;"></div>
                <div class="skeleton-dot" style="left: 75%; top: 10%;"></div>
                <div class="skeleton-dot" style="left: 85%; top: 35%;"></div>
            </div>
        </div>
    `;
    return skeleton;
}
/**
 * Create skeleton for card details section
 */
export function createCardDetailsSkeleton() {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton-card-details';
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.innerHTML = `
        <div class="skeleton-text title large"></div>
        <div class="skeleton-text sets"></div>
        <div class="skeleton-hero"></div>
        <div class="skeleton-chart" style="height: 200px;">
            <div class="skeleton-bars">
                <div class="skeleton-bar" style="height: 60%"></div>
                <div class="skeleton-bar" style="height: 80%"></div>
                <div class="skeleton-bar" style="height: 45%"></div>
                <div class="skeleton-bar" style="height: 70%"></div>
            </div>
        </div>
    `;
    return skeleton;
}
/**
 * Create skeleton for histogram/copies chart
 */
export function createHistogramSkeleton() {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton-histogram';
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.innerHTML = `
        <div class="skeleton-text summary small"></div>
        <div class="hist skeleton-hist">
            <div class="col skeleton-col">
                <div class="bar skeleton-bar" style="height: 30px"></div>
                <div class="lbl skeleton-text small">1</div>
            </div>
            <div class="col skeleton-col">
                <div class="bar skeleton-bar" style="height: 54px"></div>
                <div class="lbl skeleton-text small">2</div>
            </div>
            <div class="col skeleton-col">
                <div class="bar skeleton-bar" style="height: 22px"></div>
                <div class="lbl skeleton-text small">3</div>
            </div>
            <div class="col skeleton-col">
                <div class="bar skeleton-bar" style="height: 8px"></div>
                <div class="lbl skeleton-text small">4</div>
            </div>
        </div>
    `;
    return skeleton;
}
/**
 * Create skeleton for events table
 */
export function createEventsTableSkeleton() {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton-events-table';
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.innerHTML = `
        <table style="width: 80%; margin: 8px auto; border-collapse: collapse; background: var(--panel); border: 1px solid #242a4a; border-radius: 8px;">
            <thead>
                <tr>
                    <th style="padding: 10px 12px; border-bottom: 1px solid #2c335a; text-align: left;">
                        <div class="skeleton-text small">Tournament</div>
                    </th>
                    <th style="padding: 10px 12px; border-bottom: 1px solid #2c335a; text-align: right;">
                        <div class="skeleton-text small">Usage %</div>
                    </th>
                </tr>
            </thead>
            <tbody>
                ${Array(6)
        .fill(0)
        .map(() => `
                    <tr>
                        <td style="padding: 10px 12px;">
                            <div class="skeleton-text medium"></div>
                        </td>
                        <td style="padding: 10px 12px; text-align: right;">
                            <div class="skeleton-text small"></div>
                        </td>
                    </tr>
                `)
        .join('')}
            </tbody>
        </table>
    `;
    return skeleton;
}
/**
 * Show skeleton placeholder in target element
 * @param target
 * @param skeletonElement
 */
export function showSkeleton(target, skeletonElement) {
    if (!target || !skeletonElement) {
        return;
    }
    // Store original content
    if (!target._originalContent) {
        target._originalContent = target.innerHTML;
    }
    target.innerHTML = '';
    target.appendChild(skeletonElement);
    target.classList.add('showing-skeleton');
    target.classList.remove('skeleton-loading');
}
/**
 * Hide skeleton and restore original content or show new content
 * Synchronously removes skeleton so caller can immediately populate content
 * @param target
 * @param newContent
 */
export function hideSkeleton(target, newContent = null) {
    if (!target) {
        return;
    }
    // Synchronously remove skeleton classes
    target.classList.remove('showing-skeleton');
    target.classList.remove('skeleton-loading');
    // If new content is provided, swap it in
    if (newContent !== null) {
        target.innerHTML = '';
        if (typeof newContent === 'string') {
            target.innerHTML = newContent;
        }
        else if (newContent instanceof Node) {
            target.appendChild(newContent);
        }
    }
    else if (target._originalContent) {
        // Restore original content if stored
        target.innerHTML = target._originalContent;
        delete target._originalContent;
    }
    else {
        // Just clear skeleton content so caller can populate
        target.innerHTML = '';
    }
}
/**
 * Utility to show grid skeleton
 */
export function showGridSkeleton() {
    const grid = document.getElementById('grid');
    if (!grid) {
        return;
    }
    // Get the actual available width for the grid content
    // This should match how the real render calculates container width
    let containerWidth = grid.clientWidth || grid.getBoundingClientRect().width;
    // If we can't get the width, use the main element or window width as fallback
    if (!containerWidth || containerWidth === 0) {
        const main = document.querySelector('main');
        if (main) {
            containerWidth = main.clientWidth;
        }
        else {
            // Account for typical padding on main (12px each side)
            containerWidth = (window.innerWidth || 1200) - 24;
        }
    }
    // Create skeleton with computed layout
    const gridSkeleton = createGridSkeleton(containerWidth, 6);
    showSkeleton(grid, gridSkeleton);
}
/**
 * Utility to hide grid skeleton
 * @param newContent
 */
export function hideGridSkeleton(newContent = null) {
    const grid = document.getElementById('grid');
    if (!grid) {
        return;
    }
    hideSkeleton(grid, newContent);
}
/**
 * Update skeleton layout when window resizes (if skeleton is currently shown)
 */
export function updateSkeletonLayout() {
    const grid = document.getElementById('grid');
    if (!grid || !grid.classList.contains('showing-skeleton')) {
        return;
    }
    // Re-create skeleton with new dimensions
    showGridSkeleton();
}
