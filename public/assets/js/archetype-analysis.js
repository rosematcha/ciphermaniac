/* eslint-env browser */
import './utils/buildVersion.js';
import { fetchArchetypeReport, fetchArchetypesList, fetchReport } from './api.js';
import { parseReport } from './parse.js';
import { logger } from './utils/logger.js';
const CACHE_KEY = 'analysis/archetypes-index';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PREFETCH_BATCH = 5;
const INITIAL_VISIBLE = 14;
const VISIBLE_STEP = 12;
const PREFETCH_DELAY_MS = 150;
const PRIORITY_THUMBNAIL_COUNT = 10;
const ONLINE_META_TOURNAMENT = 'Online - Last 14 Days';
const { document } = globalThis;
const templates = {
    listItem: document.getElementById('analysis-list-item')
};
const elements = {
    container: document.querySelector('.analysis-page'),
    eventName: document.getElementById('analysis-event-name'),
    archetypeList: document.getElementById('analysis-archetype-list'),
    listLoading: document.getElementById('analysis-list-loading'),
    listEmpty: document.getElementById('analysis-list-empty'),
    loadMore: document.createElement('div')
};
const state = {
    archetypes: [],
    tournamentDeckTotal: 0,
    tournament: ONLINE_META_TOURNAMENT,
    visibleCount: INITIAL_VISIBLE,
    hoverTimer: null,
    prefetched: new Set(),
    prefetchQueue: [],
    prefetchHandle: null
};
function setPageState(status) {
    elements.container?.setAttribute('data-state', status);
}
function toggleLoading(isLoading) {
    if (elements.listLoading) {
        elements.listLoading.hidden = !isLoading;
    }
    if (elements.archetypeList) {
        elements.archetypeList.hidden = isLoading;
    }
    if (isLoading && elements.listEmpty) {
        elements.listEmpty.hidden = true;
    }
}
function ensureLoadMoreSentinel() {
    elements.loadMore.id = 'analysis-load-more';
    elements.loadMore.className = 'analysis-list__load-more';
    elements.loadMore.textContent = 'Loading more archetypes…';
    elements.loadMore.hidden = true;
    if (!elements.loadMore.parentElement && elements.archetypeList?.parentElement) {
        elements.archetypeList.parentElement.appendChild(elements.loadMore);
    }
}
function readCache() {
    try {
        const raw = globalThis.localStorage?.getItem(CACHE_KEY);
        if (!raw) {
            return null;
        }
        const payload = JSON.parse(raw);
        if (!payload?.timestamp || Date.now() - payload.timestamp > CACHE_TTL_MS) {
            return null;
        }
        if (!Array.isArray(payload.data)) {
            return null;
        }
        return payload.data;
    }
    catch (error) {
        logger.warn('Failed to read archetype cache', error);
        return null;
    }
}
function writeCache(data) {
    try {
        const payload = {
            timestamp: Date.now(),
            data
        };
        globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(payload));
    }
    catch (error) {
        logger.debug('Unable to persist archetype cache', error);
    }
}
function normalizeSummary(entry) {
    const label = entry.label || entry.name.replace(/_/g, ' ');
    const deckCount = Number.isFinite(entry.deckCount) ? Number(entry.deckCount) : null;
    const percent = Number.isFinite(entry.percent) ? Number(entry.percent) : null;
    const thumbnails = Array.isArray(entry.thumbnails) ? entry.thumbnails.filter(Boolean) : [];
    return {
        name: entry.name,
        label,
        deckCount,
        percent,
        thumbnails
    };
}
async function fetchSummaries() {
    const list = await fetchArchetypesList(ONLINE_META_TOURNAMENT);
    const normalized = Array.isArray(list) ? list.filter(item => item && item.name) : [];
    const summaries = normalized.map(normalizeSummary);
    summaries.sort((left, right) => {
        const leftDecks = left.deckCount ?? 0;
        const rightDecks = right.deckCount ?? 0;
        if (rightDecks !== leftDecks) {
            return rightDecks - leftDecks;
        }
        return left.label.localeCompare(right.label);
    });
    return summaries;
}
function updateListEmptyState() {
    if (!elements.listEmpty) {
        return;
    }
    elements.listEmpty.hidden = state.archetypes.length !== 0;
}
function createListItem(summary, index) {
    if (!templates.listItem?.content) {
        return null;
    }
    const node = templates.listItem.content.firstElementChild?.cloneNode(true);
    if (!node) {
        return null;
    }
    const anchor = node.querySelector('.analysis-list-item__button');
    const preview = node.querySelector('.analysis-list-item__preview');
    const thumbnailContainer = node.querySelector('.analysis-list-item__thumbnail');
    const thumbnailImage = node.querySelector('.analysis-list-item__thumbnail-image');
    const thumbnailFallback = node.querySelector('.analysis-list-item__thumbnail-fallback');
    const nameEl = node.querySelector('.analysis-list-item__name');
    const pctEl = node.querySelector('.analysis-list-item__percent');
    const deckEl = node.querySelector('.analysis-list-item__count');
    if (anchor) {
        anchor.setAttribute('href', `/archetype/${encodeURIComponent(summary.name)}`);
        anchor.dataset.index = String(index);
        anchor.dataset.archetype = summary.name;
    }
    if (nameEl) {
        nameEl.textContent = summary.label;
    }
    if (pctEl) {
        pctEl.textContent =
            summary.percent === null || Number.isNaN(summary.percent)
                ? '—'
                : `${(summary.percent * 100).toFixed(1)}%`;
    }
    if (deckEl) {
        if (summary.deckCount === null) {
            deckEl.textContent = 'Deck count unavailable';
        }
        else {
            deckEl.textContent = `${summary.deckCount} deck${summary.deckCount === 1 ? '' : 's'}`;
        }
    }
    const shouldPrioritize = index < PRIORITY_THUMBNAIL_COUNT;
    if (preview &&
        thumbnailContainer instanceof HTMLElement &&
        thumbnailImage instanceof HTMLImageElement &&
        thumbnailFallback instanceof HTMLElement) {
        thumbnailContainer.dataset.index = String(index);
        thumbnailImage.dataset.index = String(index);
        thumbnailImage.loading = 'lazy';
        thumbnailImage.dataset.thumbnails = (summary.thumbnails || []).join(',');
        thumbnailFallback.textContent = buildFallback(summary.label);
        setupThumbnailObserver(thumbnailImage, thumbnailContainer, thumbnailFallback, summary.label, shouldPrioritize);
    }
    else if (preview) {
        preview.classList.add('analysis-list-item__preview--no-thumb');
    }
    return node;
}
function buildFallback(name) {
    const parts = name
        .replace(/_/g, ' ')
        .split(/\s+/u)
        .filter(Boolean)
        .slice(0, 3);
    if (!parts.length) {
        return '??';
    }
    return parts.map(word => word[0].toUpperCase()).join('');
}
function renderList(reset = false) {
    const listEl = elements.archetypeList;
    if (!listEl) {
        return;
    }
    if (reset) {
        listEl.innerHTML = '';
    }
    ensureLoadMoreSentinel();
    const existing = listEl.children.length;
    const target = Math.min(state.visibleCount, state.archetypes.length);
    const fragment = document.createDocumentFragment();
    for (let index = existing; index < target; index += 1) {
        const summary = state.archetypes[index];
        const item = createListItem(summary, index);
        if (item) {
            fragment.appendChild(item);
        }
    }
    if (fragment.childNodes.length) {
        listEl.appendChild(fragment);
    }
    elements.loadMore.hidden = state.visibleCount >= state.archetypes.length;
    updateListEmptyState();
}
function expandVisibleCount() {
    if (state.visibleCount >= state.archetypes.length) {
        return;
    }
    state.visibleCount = Math.min(state.visibleCount + VISIBLE_STEP, state.archetypes.length);
    renderList();
}
function installListObserver() {
    if (!('IntersectionObserver' in globalThis) || !elements.loadMore) {
        return;
    }
    if (state.observer) {
        state.observer.disconnect();
    }
    state.observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                expandVisibleCount();
            }
        });
    });
    state.observer.observe(elements.loadMore);
}
function schedulePrefetchHotset() {
    if (!state.archetypes.length) {
        return;
    }
    const hotset = state.archetypes.slice(0, PREFETCH_BATCH);
    for (const item of hotset) {
        if (!state.prefetched.has(item.name)) {
            state.prefetchQueue.push(item.name);
        }
    }
    drainPrefetchQueue();
}
function drainPrefetchQueue() {
    if (!state.prefetchQueue.length || state.prefetchHandle !== null) {
        return;
    }
    const next = state.prefetchQueue.shift();
    if (!next) {
        return;
    }
    state.prefetchHandle = window.setTimeout(async () => {
        state.prefetchHandle = null;
        await prefetchArchetype(next);
        drainPrefetchQueue();
    }, PREFETCH_DELAY_MS);
}
async function prefetchArchetype(name) {
    if (state.prefetched.has(name)) {
        return;
    }
    try {
        const raw = await fetchArchetypeReport(state.tournament, name);
        parseReport(raw);
        state.prefetched.add(name);
    }
    catch (error) {
        logger.debug('Archetype prefetch failed', { name, message: error?.message });
    }
}
function handlePointerEnter(event) {
    const target = event.target?.closest('.analysis-list-item__button');
    if (!target || !target.dataset.archetype) {
        return;
    }
    const archetype = target.dataset.archetype;
    cancelHoverTimer();
    const timer = window.setTimeout(() => {
        prefetchArchetype(archetype);
        state.hoverTimer = null;
    }, PREFETCH_DELAY_MS);
    state.hoverTimer = { target: archetype, id: timer };
}
function cancelHoverTimer() {
    if (state.hoverTimer) {
        window.clearTimeout(state.hoverTimer.id);
        state.hoverTimer = null;
    }
}
function handlePointerLeave(event) {
    const target = event.target?.closest('.analysis-list-item__button');
    if (!target?.dataset?.archetype) {
        return;
    }
    if (state.hoverTimer?.target === target.dataset.archetype) {
        cancelHoverTimer();
    }
}
function setupPrefetchHandlers() {
    const listEl = elements.archetypeList;
    if (!listEl) {
        return;
    }
    listEl.addEventListener('pointerenter', handlePointerEnter, true);
    listEl.addEventListener('pointerleave', handlePointerLeave, true);
}
function formatCardNumber(rawNumber) {
    if (rawNumber === undefined || rawNumber === null) {
        return null;
    }
    const sanitized = String(rawNumber).trim();
    if (!sanitized) {
        return null;
    }
    const parts = sanitized.match(/^(\d+)([A-Za-z]*)$/);
    if (!parts) {
        return sanitized.toUpperCase();
    }
    const [, digits, suffix = ''] = parts;
    return `${digits.padStart(3, '0')}${suffix.toUpperCase()}`;
}
function buildThumbnailUrl(setCode, number, size = 'SM') {
    const set = String(setCode || '').toUpperCase().trim();
    if (!set) {
        return null;
    }
    const normalizedNumber = formatCardNumber(number);
    if (!normalizedNumber) {
        return null;
    }
    return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${set}/${set}_${normalizedNumber}_R_EN_${size}.png`;
}
function buildThumbnailSources(thumbnails) {
    if (!Array.isArray(thumbnails) || !thumbnails.length) {
        return [];
    }
    return thumbnails
        .map(entry => {
        const [set, number] = entry.split('/');
        return buildThumbnailUrl(set, number);
    })
        .filter(Boolean);
}
function setupThumbnailObserver(img, container, fallback, name, prioritized = false) {
    if (!state.thumbnailObserver && 'IntersectionObserver' in globalThis) {
        state.thumbnailObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) {
                    return;
                }
                const targetImg = entry.target;
                state.thumbnailObserver?.unobserve(targetImg);
                loadThumbnail(targetImg, name);
            });
        }, {
            rootMargin: '200px'
        });
    }
    img.dataset.fallback = buildFallback(name);
    img.dataset.containerId = container.dataset.index || '';
    img.dataset.fallbackId = fallback.dataset.index || '';
    if (prioritized) {
        loadThumbnail(img, name);
        return;
    }
    if (state.thumbnailObserver) {
        state.thumbnailObserver.observe(img);
    }
    else {
        loadThumbnail(img, name);
    }
}
function loadThumbnail(img, deckName) {
    const container = img.closest('.analysis-list-item__thumbnail');
    const fallback = container?.querySelector('.analysis-list-item__thumbnail-fallback');
    const thumbnailIds = img.dataset.thumbnails?.split(',').filter(Boolean) ?? [];
    const fallbackText = img.dataset.fallback || buildFallback(deckName);
    if (fallback) {
        fallback.textContent = fallbackText;
    }
    applyDeckThumbnail(container, img, fallback, deckName, thumbnailIds);
}
function applyDeckThumbnail(thumbnailEl, imgEl, fallbackEl, deckName, thumbIds) {
    if (!thumbnailEl || !imgEl || !fallbackEl) {
        return;
    }
    const sources = buildThumbnailSources(thumbIds);
    const usePlaceholder = () => {
        thumbnailEl.classList.add('is-placeholder');
        imgEl.style.display = '';
        imgEl.removeAttribute('src');
    };
    fallbackEl.textContent = buildFallback(deckName);
    if (!sources.length) {
        usePlaceholder();
        return;
    }
    if (sources.length >= 2) {
        applySplitThumbnail(thumbnailEl, imgEl, fallbackEl, sources, usePlaceholder, deckName);
        return;
    }
    thumbnailEl.classList.remove('is-placeholder');
    imgEl.style.display = 'block';
    imgEl.alt = '';
    imgEl.loading = 'lazy';
    imgEl.decoding = 'async';
    imgEl.style.opacity = '0';
    imgEl.style.transition = imgEl.style.transition || 'opacity 250ms ease';
    imgEl.onerror = usePlaceholder;
    imgEl.onload = () => {
        thumbnailEl.classList.remove('is-placeholder');
        imgEl.style.opacity = '1';
    };
    imgEl.src = sources[0];
}
function applySplitThumbnail(thumbnailEl, baseImg, fallbackEl, sources, usePlaceholder, deckName) {
    const clearBase = () => {
        baseImg.style.display = 'none';
        baseImg.removeAttribute('src');
    };
    clearBase();
    thumbnailEl.classList.remove('is-placeholder');
    thumbnailEl.classList.add('analysis-list-item__thumbnail--split');
    let splitWrapper = thumbnailEl.querySelector('.analysis-list-item__split');
    if (!splitWrapper) {
        splitWrapper = document.createElement('div');
        splitWrapper.className = 'analysis-list-item__split';
        thumbnailEl.insertBefore(splitWrapper, fallbackEl);
    }
    splitWrapper.replaceChildren();
    const handleError = () => {
        usePlaceholder();
    };
    sources.slice(0, 2).forEach((src, index) => {
        const slice = document.createElement('div');
        const orientation = index === 0 ? 'left' : 'right';
        slice.className = `analysis-list-item__slice analysis-list-item__slice--${orientation}`;
        const img = document.createElement('img');
        img.className = 'analysis-list-item__thumbnail-image analysis-list-item__thumbnail-image--split';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = '';
        img.style.opacity = '0';
        img.style.transition = img.style.transition || 'opacity 250ms ease';
        img.onerror = handleError;
        img.onload = () => {
            img.style.opacity = '1';
        };
        applySplitCrop(img, orientation === 'left' ? { x: 0, width: 0.5 } : { x: 0.5, width: 0.5 });
        img.src = src;
        slice.appendChild(img);
        splitWrapper?.appendChild(slice);
    });
    if (!splitWrapper.hasChildNodes()) {
        usePlaceholder();
    }
}
function applySplitCrop(img, crop) {
    const x = clamp(typeof crop.x === 'number' ? crop.x : 0, 0, 1);
    const width = clamp(typeof crop.width === 'number' ? crop.width : 0.5, 0.05, 1 - x);
    const y = clamp(typeof crop.y === 'number' ? crop.y : 0, 0, 1);
    const height = clamp(typeof crop.height === 'number' ? crop.height : 1, 0.05, 1 - y);
    const top = clamp(y * 100, 0, 100);
    const left = clamp(x * 100, 0, 100);
    const bottom = clamp((1 - (y + height)) * 100, 0, 100);
    const right = clamp((1 - (x + width)) * 100, 0, 100);
    img.style.position = 'absolute';
    img.style.top = '0';
    img.style.left = '0';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.clipPath = `inset(${top}% ${right}% ${bottom}% ${left}%)`;
}
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
function applyCachedData(data) {
    state.archetypes = data;
    state.visibleCount = Math.min(INITIAL_VISIBLE, state.archetypes.length);
    renderList(true);
    schedulePrefetchHotset();
}
async function refreshFromNetwork() {
    try {
        const summaries = await fetchSummaries();
        if (!summaries.length) {
            if (!state.archetypes.length) {
                updateListEmptyState();
            }
            return;
        }
        writeCache(summaries);
        applyCachedData(summaries);
    }
    catch (error) {
        logger.exception('Failed to refresh archetype summaries', error);
        if (!state.archetypes.length) {
            setPageState('error');
            toggleLoading(false);
            if (elements.listLoading) {
                elements.listLoading.textContent = 'Unable to load archetypes right now.';
                elements.listLoading.hidden = false;
            }
        }
    }
}
async function initialize() {
    try {
        setPageState('loading');
        toggleLoading(true);
        const tournamentReport = await fetchReport(ONLINE_META_TOURNAMENT);
        if (!tournamentReport || typeof tournamentReport.deckTotal !== 'number') {
            throw new Error(`Missing deck totals for ${ONLINE_META_TOURNAMENT}`);
        }
        state.tournamentDeckTotal = tournamentReport.deckTotal;
        if (elements.eventName) {
            elements.eventName.textContent = ONLINE_META_TOURNAMENT;
        }
        ensureLoadMoreSentinel();
        installListObserver();
        setupPrefetchHandlers();
        const cached = readCache();
        if (cached?.length) {
            applyCachedData(cached);
            toggleLoading(false);
            setPageState('ready');
        }
        await refreshFromNetwork();
        toggleLoading(false);
        setPageState('ready');
    }
    catch (error) {
        logger.exception('Failed to initialize archetype analysis', error);
        setPageState('error');
        toggleLoading(false);
        if (elements.listLoading) {
            elements.listLoading.textContent = 'Something went wrong while loading archetypes.';
            elements.listLoading.hidden = false;
        }
    }
}
initialize();
