/* eslint-env browser */
/**
 * Archetypes List Page - Re-optimized for performance
 *
 * Design principles:
 * 1. Performance first - no flashing, dimming, or visual bugs
 * 2. Single render pass - render once with stable DOM structure
 * 3. Native lazy loading - use browser's built-in loading="lazy"
 * 4. Simple state management - minimal class toggling
 * 5. Fallback always visible - image covers it when loaded
 */
import './utils/buildVersion.js';
import { fetchArchetypeReport, fetchArchetypesList, fetchReport } from './api.js';
import { parseReport } from './parse.js';
import { logger } from './utils/logger.js';
// Configuration
const CACHE_KEY = 'analysis/archetypes-index';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PREFETCH_BATCH = 5;
const PREFETCH_DELAY_MS = 150;
const ONLINE_META_TOURNAMENT = 'Online - Last 14 Days';
const { document } = globalThis;
// DOM references
const elements = {
    container: document.querySelector('.analysis-page'),
    archetypeList: document.getElementById('analysis-archetype-list'),
    listLoading: document.getElementById('analysis-list-loading'),
    listEmpty: document.getElementById('analysis-list-empty')
};
const templates = {
    listItem: document.getElementById('analysis-list-item')
};
// Simple state
const state = {
    archetypes: [],
    prefetched: new Set(),
    prefetchQueue: [],
    prefetchHandle: null,
    hoverTimer: null,
    rendered: false
};
// ============================================================================
// Cache Management
// ============================================================================
function readCache() {
    try {
        const raw = globalThis.localStorage?.getItem(CACHE_KEY);
        if (!raw)
            return null;
        const payload = JSON.parse(raw);
        if (!payload?.timestamp || Date.now() - payload.timestamp > CACHE_TTL_MS)
            return null;
        if (!Array.isArray(payload.data))
            return null;
        return payload.data;
    }
    catch {
        return null;
    }
}
function writeCache(data) {
    try {
        const payload = { timestamp: Date.now(), data };
        globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(payload));
    }
    catch {
        // Silently fail - cache is optional
    }
}
// ============================================================================
// Data Fetching
// ============================================================================
function normalizeSummary(entry) {
    return {
        name: entry.name,
        label: entry.label || entry.name.replace(/_/g, ' '),
        deckCount: Number.isFinite(entry.deckCount) ? Number(entry.deckCount) : null,
        percent: Number.isFinite(entry.percent) ? Number(entry.percent) : null,
        thumbnails: Array.isArray(entry.thumbnails) ? entry.thumbnails.filter(Boolean) : []
    };
}
async function fetchSummaries() {
    const list = await fetchArchetypesList(ONLINE_META_TOURNAMENT);
    const normalized = Array.isArray(list) ? list.filter(item => item?.name) : [];
    const summaries = normalized.map(normalizeSummary);
    // Sort by deck count (descending), then alphabetically
    summaries.sort((a, b) => {
        const aDeck = a.deckCount ?? 0;
        const bDeck = b.deckCount ?? 0;
        if (bDeck !== aDeck)
            return bDeck - aDeck;
        return a.label.localeCompare(b.label);
    });
    return summaries;
}
// ============================================================================
// Thumbnail URL Building
// ============================================================================
function formatCardNumber(raw) {
    if (raw === undefined || raw === null)
        return null;
    const str = String(raw).trim();
    if (!str)
        return null;
    const match = str.match(/^(\d+)([A-Za-z]*)$/);
    if (!match)
        return str.toUpperCase();
    const [, digits, suffix = ''] = match;
    return `${digits.padStart(3, '0')}${suffix.toUpperCase()}`;
}
function buildThumbnailUrl(setCode, number) {
    const set = String(setCode || '').toUpperCase().trim();
    if (!set)
        return null;
    const num = formatCardNumber(number);
    if (!num)
        return null;
    return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${set}/${set}_${num}_R_EN_SM.png`;
}
function getThumbnailUrls(thumbnails) {
    if (!Array.isArray(thumbnails) || !thumbnails.length)
        return [];
    return thumbnails
        .slice(0, 2) // Max 2 thumbnails for split view
        .map(entry => {
        const [set, number] = entry.split('/');
        return buildThumbnailUrl(set, number);
    })
        .filter((url) => url !== null);
}
function buildFallbackText(name) {
    const parts = name.replace(/_/g, ' ').split(/\s+/u).filter(Boolean).slice(0, 3);
    if (!parts.length)
        return '??';
    return parts.map(word => word[0].toUpperCase()).join('');
}
// ============================================================================
// List Item Creation - Simple, stable DOM structure
// ============================================================================
function createListItem(summary, index) {
    if (!templates.listItem?.content)
        return null;
    const node = templates.listItem.content.firstElementChild?.cloneNode(true);
    if (!node)
        return null;
    // Set link and data attributes
    const anchor = node.querySelector('.analysis-list-item__button');
    if (anchor) {
        anchor.href = `/archetype/${encodeURIComponent(summary.name)}`;
        anchor.dataset.archetype = summary.name;
    }
    // Set text content
    const nameEl = node.querySelector('.analysis-list-item__name');
    const pctEl = node.querySelector('.analysis-list-item__percent');
    const deckEl = node.querySelector('.analysis-list-item__count');
    if (nameEl)
        nameEl.textContent = summary.label;
    if (pctEl) {
        pctEl.textContent = summary.percent === null || Number.isNaN(summary.percent)
            ? '—'
            : `${(summary.percent * 100).toFixed(1)}%`;
    }
    if (deckEl) {
        deckEl.textContent = summary.deckCount === null
            ? 'Deck count unavailable'
            : `${summary.deckCount} deck${summary.deckCount === 1 ? '' : 's'}`;
    }
    // Setup thumbnail - simple approach
    const thumbnailContainer = node.querySelector('.analysis-list-item__thumbnail');
    const thumbnailImage = node.querySelector('.analysis-list-item__thumbnail-image');
    const thumbnailFallback = node.querySelector('.analysis-list-item__thumbnail-fallback');
    if (thumbnailContainer && thumbnailFallback) {
        const fallbackText = buildFallbackText(summary.label);
        thumbnailFallback.textContent = fallbackText;
        const urls = getThumbnailUrls(summary.thumbnails);
        if (urls.length === 0) {
            // No thumbnails - show fallback immediately
            thumbnailContainer.classList.add('is-placeholder');
        }
        else if (urls.length === 1 && thumbnailImage) {
            // Single thumbnail
            setupSingleThumbnail(thumbnailImage, thumbnailContainer, urls[0], index < 10);
        }
        else if (urls.length >= 2) {
            // Split thumbnail - create structure upfront
            setupSplitThumbnail(thumbnailContainer, thumbnailImage, thumbnailFallback, urls, index < 10);
        }
    }
    return node;
}
function setupSingleThumbnail(img, container, url, eager) {
    img.loading = eager ? 'eager' : 'lazy';
    img.decoding = 'async';
    img.alt = '';
    // Simple error handling - just show fallback on error
    img.onerror = () => {
        container.classList.add('is-placeholder');
        img.style.display = 'none';
    };
    img.src = url;
}
function setupSplitThumbnail(container, baseImg, fallback, urls, eager) {
    // Hide the base image for split view
    if (baseImg)
        baseImg.style.display = 'none';
    container.classList.add('analysis-list-item__thumbnail--split');
    // Create split wrapper
    const splitWrapper = document.createElement('div');
    splitWrapper.className = 'analysis-list-item__split';
    let loadedCount = 0;
    let errorCount = 0;
    const checkComplete = () => {
        if (errorCount === urls.length) {
            // All images failed - show fallback
            container.classList.remove('analysis-list-item__thumbnail--split');
            container.classList.add('is-placeholder');
            splitWrapper.remove();
        }
    };
    urls.slice(0, 2).forEach((url, i) => {
        const slice = document.createElement('div');
        slice.className = `analysis-list-item__slice analysis-list-item__slice--${i === 0 ? 'left' : 'right'}`;
        const img = document.createElement('img');
        img.className = 'analysis-list-item__thumbnail-image analysis-list-item__thumbnail-image--split';
        img.loading = eager ? 'eager' : 'lazy';
        img.decoding = 'async';
        img.alt = '';
        // Apply clip-path for split effect
        const clipLeft = i === 0 ? '0%' : '50%';
        const clipRight = i === 0 ? '50%' : '0%';
        img.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      clip-path: inset(0% ${clipRight} 0% ${clipLeft});
    `;
        img.onload = () => {
            loadedCount++;
        };
        img.onerror = () => {
            errorCount++;
            slice.style.display = 'none';
            checkComplete();
        };
        img.src = url;
        slice.appendChild(img);
        splitWrapper.appendChild(slice);
    });
    container.insertBefore(splitWrapper, fallback);
}
// ============================================================================
// Rendering - Single pass, no re-renders
// ============================================================================
function renderList(archetypes) {
    const listEl = elements.archetypeList;
    if (!listEl || state.rendered)
        return;
    // Clear any existing content
    listEl.innerHTML = '';
    if (archetypes.length === 0) {
        if (elements.listEmpty)
            elements.listEmpty.hidden = false;
        return;
    }
    // Build all items in a single fragment
    const fragment = document.createDocumentFragment();
    archetypes.forEach((summary, index) => {
        const item = createListItem(summary, index);
        if (item)
            fragment.appendChild(item);
    });
    listEl.appendChild(fragment);
    state.rendered = true;
    // Hide empty state
    if (elements.listEmpty)
        elements.listEmpty.hidden = true;
}
function showLoading(show) {
    if (elements.listLoading) {
        elements.listLoading.hidden = !show;
    }
    if (elements.archetypeList) {
        elements.archetypeList.hidden = show;
    }
}
function showError(message) {
    if (elements.listLoading) {
        elements.listLoading.textContent = message;
        elements.listLoading.hidden = false;
    }
    if (elements.archetypeList) {
        elements.archetypeList.hidden = true;
    }
}
// ============================================================================
// Prefetching - Hover to prefetch archetype data
// ============================================================================
async function prefetchArchetype(name) {
    if (state.prefetched.has(name))
        return;
    try {
        const raw = await fetchArchetypeReport(ONLINE_META_TOURNAMENT, name);
        parseReport(raw);
        state.prefetched.add(name);
    }
    catch (err) {
        logger.debug('Archetype prefetch failed', { name, message: err?.message });
    }
}
function schedulePrefetchBatch() {
    if (!state.archetypes.length)
        return;
    // Prefetch top archetypes
    const batch = state.archetypes.slice(0, PREFETCH_BATCH);
    for (const item of batch) {
        if (!state.prefetched.has(item.name)) {
            state.prefetchQueue.push(item.name);
        }
    }
    drainPrefetchQueue();
}
function drainPrefetchQueue() {
    if (!state.prefetchQueue.length || state.prefetchHandle !== null)
        return;
    const next = state.prefetchQueue.shift();
    if (!next)
        return;
    state.prefetchHandle = window.setTimeout(async () => {
        state.prefetchHandle = null;
        await prefetchArchetype(next);
        drainPrefetchQueue();
    }, PREFETCH_DELAY_MS);
}
function setupHoverPrefetch() {
    const listEl = elements.archetypeList;
    if (!listEl)
        return;
    listEl.addEventListener('pointerenter', (e) => {
        const target = e.target?.closest('.analysis-list-item__button');
        if (!target?.dataset.archetype)
            return;
        const archetype = target.dataset.archetype;
        // Cancel any existing timer
        if (state.hoverTimer) {
            clearTimeout(state.hoverTimer.id);
            state.hoverTimer = null;
        }
        // Start new timer
        const id = window.setTimeout(() => {
            prefetchArchetype(archetype);
            state.hoverTimer = null;
        }, PREFETCH_DELAY_MS);
        state.hoverTimer = { target: archetype, id };
    }, true);
    listEl.addEventListener('pointerleave', (e) => {
        const target = e.target?.closest('.analysis-list-item__button');
        if (!target?.dataset.archetype)
            return;
        if (state.hoverTimer?.target === target.dataset.archetype) {
            clearTimeout(state.hoverTimer.id);
            state.hoverTimer = null;
        }
    }, true);
}
// ============================================================================
// Initialization
// ============================================================================
async function initialize() {
    showLoading(true);
    try {
        // First, try to show cached data immediately
        const cached = readCache();
        if (cached?.length) {
            state.archetypes = cached;
            renderList(cached);
            showLoading(false);
        }
        // Verify tournament is available (required for the page)
        const tournamentReport = await fetchReport(ONLINE_META_TOURNAMENT);
        if (!tournamentReport || typeof tournamentReport.deckTotal !== 'number') {
            throw new Error(`Tournament data unavailable`);
        }
        // Fetch fresh data
        const freshData = await fetchSummaries();
        if (freshData.length) {
            writeCache(freshData);
            // Only re-render if we haven't rendered yet (no cache) or data changed
            if (!state.rendered) {
                state.archetypes = freshData;
                renderList(freshData);
            }
            else if (hasDataChanged(state.archetypes, freshData)) {
                // Data changed - update quietly without flashing
                state.archetypes = freshData;
                state.rendered = false;
                renderList(freshData);
            }
        }
        else if (!state.rendered) {
            // No data at all
            if (elements.listEmpty)
                elements.listEmpty.hidden = false;
        }
        showLoading(false);
        // Setup prefetching
        setupHoverPrefetch();
        schedulePrefetchBatch();
    }
    catch (err) {
        logger.exception('Failed to initialize archetypes page', err);
        // If we have cached data, keep showing it
        if (state.rendered) {
            showLoading(false);
        }
        else {
            showError('Unable to load archetypes. Please try again later.');
        }
    }
}
function hasDataChanged(oldData, newData) {
    if (oldData.length !== newData.length)
        return true;
    for (let i = 0; i < oldData.length; i++) {
        if (oldData[i].name !== newData[i].name)
            return true;
        if (oldData[i].deckCount !== newData[i].deckCount)
            return true;
        if (oldData[i].percent !== newData[i].percent)
            return true;
    }
    return false;
}
initialize();
