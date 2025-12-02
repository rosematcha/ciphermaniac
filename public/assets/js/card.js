// Entry for per-card page: loads meta-share over tournaments and common decks
import './utils/buildVersion.js';
import { ONLINE_META_NAME, fetchArchetypeReport, fetchArchetypesList, fetchCardIndex, fetchReport, fetchTop8ArchetypesList, fetchTournamentsList, fetchTrendReport } from './api.js';
import { parseReport } from './parse.js';
import { buildThumbCandidates } from './thumbs.js';
import { baseToLabel, pickArchetype } from './selectArchetype.js';
import { normalizeCardRouteOnLoad } from './router.js';
import { createChartSkeleton, createEventsTableSkeleton, createHistogramSkeleton, showSkeleton } from './components/placeholders.js';
import { cleanupOrphanedProgressDisplay, createProgressIndicator, processInParallel } from './utils/parallelLoader.js';
import { logger, setupGlobalErrorHandler } from './utils/errorHandler.js';
// Import card-specific modules
import { getBaseName, getDisplayName, parseDisplayName } from './card/identifiers.js';
import { findCard, renderCardPrice, renderCardSets } from './card/data.js';
import { renderChart, renderCopiesHistogram, renderEvents } from './card/charts.js';
import { getCanonicalCard, getCardVariants, getVariantImageCandidates } from './utils/cardSynonyms.js';
import { buildCardPath, describeSlug, makeCardSlug, normalizeCardNumber, parseCardRoute, resolveCardSlug } from './card/routing.js';
import { normalizeSetCode } from './utils/filterState.js';
// Set up global error handling
setupGlobalErrorHandler();
const CARD_META_TEMPLATE = `
  <div class="header-title">
    <div class="title-row">
      <h1 id="card-title">Card Details</h1>
      <div id="card-price" class="card-price">
        <!-- Price loads asynchronously -->
      </div>
    </div>
    <div id="card-sets" class="card-sets">
      <!-- Sets load asynchronously -->
    </div>
  </div>
  <div id="card-hero" class="card-hero">
    <div class="thumb" aria-hidden="true">
      <div class="skeleton-image" style="width: 100%; height: 100%; background: var(--bar-bg); animation: skeleton-loading 1.5s ease-in-out infinite;"></div>
    </div>
  </div>
  <div id="card-center">
    <div id="card-chart">
      <!-- Chart loads asynchronously with smooth transition -->
    </div>
    <div id="card-copies">
      <!-- Histogram loads asynchronously with smooth transition -->
    </div>
  </div>
  <div id="card-events"></div>
`;
let cardTitleEl = null;
let metaSection = null;
let decksSection = null;
let eventsSection = null;
let copiesSection = null;
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1")]';
const LIMITLESS_SIZE_PATTERN = /(https:\/\/limitlesstcg\.nyc3\.cdn\.digitaloceanspaces\.com\/tpci\/[^/]+\/[^_]+_\d{3}[A-Z0-9]*_R_[A-Z]{2})_(XS|SM)\.png$/i;
let cardImageModalController = null;
function refreshDomRefs() {
    cardTitleEl = document.getElementById('card-title');
    metaSection = document.getElementById('card-meta');
    decksSection = document.getElementById('card-decks');
    eventsSection = document.getElementById('card-events');
    copiesSection = document.getElementById('card-copies');
}
function ensureCardMetaStructure() {
    const meta = document.getElementById('card-meta');
    if (!meta) {
        return false;
    }
    const hasHeader = Boolean(meta.querySelector('.header-title'));
    const hasHero = Boolean(meta.querySelector('#card-hero'));
    const hasCenter = Boolean(meta.querySelector('#card-center'));
    const hasChart = Boolean(document.getElementById('card-chart'));
    const hasCopies = Boolean(document.getElementById('card-copies'));
    const hasEvents = Boolean(document.getElementById('card-events'));
    if (hasHeader && hasHero && hasCenter && hasChart && hasCopies && hasEvents) {
        return false;
    }
    meta.innerHTML = CARD_META_TEMPLATE;
    refreshDomRefs();
    return true;
}
function deriveLgUrlFromCandidate(url) {
    if (!url) {
        return null;
    }
    const trimmed = String(url).trim();
    if (!trimmed) {
        return null;
    }
    const match = trimmed.match(LIMITLESS_SIZE_PATTERN);
    if (match) {
        return `${match[1]}_LG.png`;
    }
    return null;
}
function buildLgUrlFromVariant(variant) {
    if (!variant || !variant.set || !variant.number) {
        return null;
    }
    const setCode = normalizeSetCode(variant.set);
    const normalizedNumber = normalizeCardNumber(variant.number);
    if (!setCode || !normalizedNumber) {
        return null;
    }
    const padded = normalizedNumber.padStart(3, '0');
    return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${setCode}/${setCode}_${padded}_R_EN_LG.png`;
}
function ensureCardImageModal() {
    if (cardImageModalController) {
        return cardImageModalController;
    }
    const container = document.getElementById('card-image-modal');
    const dialog = container?.querySelector('.card-image-modal__dialog');
    const image = container?.querySelector('[data-card-modal-image]');
    const caption = container?.querySelector('[data-card-modal-caption]');
    const closeElements = container
        ? Array.from(container.querySelectorAll('[data-card-modal-close]'))
        : [];
    if (!container || !dialog || !image) {
        return null;
    }
    let previouslyFocused = null;
    let pendingFallback = null;
    let focusableElements = [];
    const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            api.close();
            return;
        }
        if (event.key === 'Tab' && focusableElements.length > 0) {
            const first = focusableElements[0];
            const last = focusableElements[focusableElements.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            }
            else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    };
    const handleImageLoad = () => {
        container.classList.remove('is-loading');
        container.classList.remove('has-error');
    };
    const handleImageError = () => {
        if (pendingFallback) {
            const fallbackUrl = pendingFallback;
            pendingFallback = null;
            image.src = fallbackUrl;
            return;
        }
        container.classList.add('has-error');
        container.classList.remove('is-loading');
    };
    image.addEventListener('load', handleImageLoad);
    image.addEventListener('error', handleImageError);
    const api = {
        open(options) {
            if (!options || !options.src) {
                return;
            }
            pendingFallback = options.fallback && options.fallback !== options.src ? options.fallback : null;
            previouslyFocused = options.trigger || document.activeElement;
            container.classList.add('is-visible', 'is-loading');
            container.setAttribute('aria-hidden', 'false');
            document.body.classList.add('card-image-modal-open');
            image.alt = options.alt || 'Full-size card image';
            if (caption) {
                caption.textContent = options.caption || image.alt;
            }
            image.src = options.src;
            focusableElements = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter(el => {
                return !el.hasAttribute('disabled') && el.getAttribute('tabindex') !== '-1';
            });
            const focusTarget = focusableElements[0] || dialog;
            requestAnimationFrame(() => {
                focusTarget?.focus();
            });
            document.addEventListener('keydown', handleKeyDown);
        },
        close() {
            container.classList.remove('is-visible', 'is-loading', 'has-error');
            container.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('card-image-modal-open');
            pendingFallback = null;
            focusableElements = [];
            image.removeAttribute('src');
            document.removeEventListener('keydown', handleKeyDown);
            if (previouslyFocused) {
                previouslyFocused.focus();
                previouslyFocused = null;
            }
        }
    };
    closeElements.forEach(el => {
        el.addEventListener('click', () => api.close());
    });
    container.addEventListener('click', event => {
        const target = event.target;
        if (!target) {
            return;
        }
        if (target.dataset.cardModalClose === 'true' || target === container) {
            api.close();
        }
    });
    return (cardImageModalController = api);
}
function enableHeroImageModal(trigger, image, variantLgUrl) {
    if (!trigger || !image) {
        return;
    }
    trigger.classList.add('card-hero__trigger');
    trigger.tabIndex = 0;
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-label', 'Open high-resolution card image');
    const handleActivate = () => {
        const controller = ensureCardImageModal();
        if (!controller) {
            return;
        }
        const fallback = image.currentSrc || image.src;
        const altText = image.alt || cardName || 'Card image';
        const hiRes = image._fullResUrl || variantLgUrl || fallback;
        controller.open({
            src: hiRes,
            fallback,
            alt: altText,
            caption: cardName ? `${cardName} — Full-size view` : altText,
            trigger
        });
    };
    trigger.addEventListener('click', handleActivate);
    trigger.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleActivate();
        }
    });
}
refreshDomRefs();
if (ensureCardMetaStructure()) {
    refreshDomRefs();
}
const __ROUTE_REDIRECTING = normalizeCardRouteOnLoad();
const routeInfo = parseCardRoute();
const shouldPrefillSearch = routeInfo.source === 'query' || routeInfo.source === 'hash';
let cardIdentifier = null;
let cardName = null;
const backLink = document.getElementById('back-link');
if (backLink) {
    backLink.href = '/';
}
const analysisSel = document.getElementById('analysis-event');
const analysisTable = document.getElementById('analysis-table');
const searchInGrid = document.getElementById('search-in-grid');
// These will be set inside initCardSearch to ensure DOM is ready
let cardSearchInput = null;
let cardNamesList = null;
let suggestionsBox = null;
// Link to grid prefilled with search will be updated after card resolution
function updateCardTitle(displayName, slugHint) {
    if (!cardTitleEl) {
        return;
    }
    cardTitleEl.innerHTML = '';
    if (!displayName && !slugHint) {
        cardTitleEl.textContent = 'Card Details';
        document.title = 'Card Details – Ciphermaniac';
        return;
    }
    const label = displayName || slugHint || 'Card Details';
    const parsed = displayName ? parseDisplayName(displayName) : null;
    const resolvedName = parsed?.name || label;
    const setId = parsed?.setId || '';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = resolvedName;
    cardTitleEl.appendChild(nameSpan);
    if (setId) {
        const setSpan = document.createElement('span');
        setSpan.className = 'card-title-set';
        setSpan.textContent = setId;
        cardTitleEl.appendChild(setSpan);
    }
    document.title = `${resolvedName}${setId ? ` ${setId}` : ''} – Ciphermaniac`;
}
function updateSearchLink() {
    if (!searchInGrid) {
        return;
    }
    if (cardName) {
        searchInGrid.href = `/cards?q=${encodeURIComponent(cardName)}`;
    }
    else {
        searchInGrid.href = '/cards';
    }
}
function syncSearchInputValue() {
    if (!cardSearchInput || !cardName) {
        return;
    }
    if (!shouldPrefillSearch) {
        return;
    }
    if (document.activeElement === cardSearchInput) {
        return;
    }
    cardSearchInput.value = cardName;
}
async function initializeCardPage() {
    if (__ROUTE_REDIRECTING) {
        return;
    }
    if (routeInfo.source === 'hash' && routeInfo.identifier) {
        const search = location.search || '';
        const target = `${buildCardPath(routeInfo.identifier)}${search}`;
        window.location.replace(target);
        return;
    }
    if (routeInfo.source === 'landing') {
        // Redirect to /trends for the trends landing page
        window.location.replace('/trends');
        return;
    }
    if (routeInfo.identifier) {
        cardIdentifier = routeInfo.identifier;
    }
    else if (routeInfo.slug) {
        let resolvedIdentifier = null;
        try {
            resolvedIdentifier = await resolveCardSlug(routeInfo.slug);
        }
        catch (error) {
            logger.warn('Failed to resolve card slug', {
                slug: routeInfo.slug,
                error: error?.message || error
            });
        }
        if (resolvedIdentifier) {
            cardIdentifier = resolvedIdentifier;
        }
        else {
            cardIdentifier = routeInfo.slug;
            updateCardTitle(null, describeSlug(routeInfo.slug));
        }
    }
    if (!cardIdentifier) {
        updateCardTitle(null);
        updateSearchLink();
        return;
    }
    const identifierToCanonize = cardIdentifier;
    let canonicalIdentifier = identifierToCanonize;
    try {
        const resolvedCanonical = await getCanonicalCard(identifierToCanonize);
        if (resolvedCanonical) {
            canonicalIdentifier = resolvedCanonical;
        }
    }
    catch (error) {
        logger.warn('Canonical lookup failed', {
            cardIdentifier,
            error: error?.message || error
        });
    }
    if (cardIdentifier === identifierToCanonize) {
        cardIdentifier = canonicalIdentifier;
    }
    cardName = getDisplayName(cardIdentifier) || cardIdentifier;
    updateCardTitle(cardName);
    updateSearchLink();
    syncSearchInputValue();
    const canonicalSlug = makeCardSlug(cardIdentifier);
    if (canonicalSlug) {
        const desiredPath = buildCardPath(cardIdentifier);
        if (location.pathname !== desiredPath || location.hash) {
            const newUrl = `${desiredPath}${location.search || ''}`;
            history.replaceState(null, '', newUrl);
        }
    }
    else if (location.hash) {
        history.replaceState(null, '', `${location.pathname}${location.search || ''}`);
    }
    await load();
}
initializeCardPage().catch(error => logger.error('Failed to initialize card page', error));
// No tabs: all content on one page
import { initCardSearch as initSearchComponent } from './components/cardSearch.js';
// Global variables for search functionality
// (Removed as they are now handled in the component)
// Initialize search suggestions regardless of whether a card is selected
function initCardSearch() {
    // Initialize the reusable component
    initSearchComponent({
        searchInputId: 'card-search',
        datalistId: 'card-names',
        suggestionsId: 'card-suggestions'
    });
    // Local reference for syncSearchInputValue
    cardSearchInput = document.getElementById('card-search');
    syncSearchInputValue();
}
// Ensure DOM is ready before initializing search
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCardSearch);
}
else {
    initCardSearch();
}
function buildIdentifierLookup(cardIdentifier) {
    const searchKeys = new Set();
    const addIdentifier = (value) => {
        if (value) {
            searchKeys.add(String(value).trim().toLowerCase());
        }
    };
    addIdentifier(cardIdentifier);
    addIdentifier(cardIdentifier?.toLowerCase());
    const baseName = getBaseName(cardIdentifier);
    if (baseName) {
        addIdentifier(baseName);
    }
    // Add a space-delimited version of UID (e.g., "DRI:175" -> "DRI 175")
    if (cardIdentifier && cardIdentifier.includes(':')) {
        addIdentifier(cardIdentifier.replace(':', ' '));
    }
    // Add colon-delimited version if we were passed a space-delimited UID
    if (cardIdentifier && cardIdentifier.includes(' ')) {
        const parts = cardIdentifier.split(/\s+/);
        if (parts.length === 2 && parts[0].length >= 2 && /^\d/.test(parts[1]) === false) {
            addIdentifier(`${parts[0]}:${parts[1]}`);
        }
    }
    // Handle slug separators like "~" (from /card/SET~###)
    if (cardIdentifier && cardIdentifier.includes('~')) {
        const tildeColon = cardIdentifier.replace(/~/g, ':');
        addIdentifier(tildeColon);
        addIdentifier(tildeColon.replace(':', ' '));
    }
    const slugVariant = cardIdentifier?.replace(/[-_]/g, ' ');
    addIdentifier(slugVariant);
    return { searchKeys, baseName };
}
function extractSetAndNumber(identifier) {
    if (!identifier) {
        return { set: null, number: null };
    }
    // UID form Name::SET::NUMBER
    if (identifier.includes('::')) {
        const parts = identifier.split('::');
        if (parts.length >= 3 && parts[1] && parts[2]) {
            return { set: parts[1], number: parts[2] };
        }
    }
    const setNumberPattern = /^([A-Z]{2,})[:~\s]+(\d+[A-Za-z]?)$/;
    const match = identifier.toUpperCase().match(setNumberPattern);
    if (match) {
        return { set: match[1], number: match[2] };
    }
    return { set: null, number: null };
}
/**
 * Check if a card exists in the Ciphermaniac database
 * @param cardIdentifier - Card identifier to check
 * @returns Whether the card has a Ciphermaniac page
 */
async function checkCardExistsInDatabase(cardIdentifier) {
    try {
        const tournaments = await fetchTournamentsList();
        const tournamentList = Array.isArray(tournaments) ? tournaments : [];
        if (tournamentList.length === 0) {
            return true;
        }
        let canonicalIdentifier = cardIdentifier;
        try {
            const canonical = await getCanonicalCard(cardIdentifier);
            if (canonical) {
                canonicalIdentifier = canonical;
            }
        }
        catch (canonicalError) {
            logger.debug('Canonical lookup failed during existence check', {
                cardIdentifier,
                error: canonicalError?.message || canonicalError
            });
        }
        const { searchKeys } = buildIdentifierLookup(cardIdentifier);
        if (canonicalIdentifier && canonicalIdentifier !== cardIdentifier) {
            searchKeys.add(canonicalIdentifier.toLowerCase());
        }
        try {
            const variants = await getCardVariants(cardIdentifier);
            if (Array.isArray(variants) && variants.length > 0) {
                for (const variantIdentifier of variants) {
                    searchKeys.add(variantIdentifier.trim().toLowerCase());
                }
            }
        }
        catch (variantError) {
            logger.debug('Failed to load card variants for fallback', {
                cardIdentifier,
                error: variantError?.message || variantError
            });
        }
        const tournamentsToCheck = tournamentList.slice(0, 8);
        for (const tournament of tournamentsToCheck) {
            try {
                const index = await fetchCardIndex(tournament);
                const cards = index?.cards;
                if (!cards || typeof cards !== 'object') {
                    continue;
                }
                const available = new Set(Object.keys(cards).map(name => name.toLowerCase()));
                for (const key of searchKeys) {
                    if (available.has(key)) {
                        return true;
                    }
                }
            }
            catch (error) {
                logger.debug('Card index unavailable during existence check', {
                    cardIdentifier,
                    tournament,
                    error: error.message
                });
            }
        }
        return false;
    }
    catch (error) {
        logger.warn('Failed to check card existence via card indices', {
            cardIdentifier,
            error: error.message
        });
        return true;
    }
}
/**
 * Suggested cards to surface when a requested card is missing
 */
const MISSING_CARD_TRENDS_SOURCE = 'Trends - Last 30 Days';
async function resolveMissingCardDisplayName(cardIdentifier) {
    const initial = getDisplayName(cardIdentifier);
    if (initial && initial !== cardIdentifier) {
        return initial;
    }
    const { searchKeys } = buildIdentifierLookup(cardIdentifier);
    const { set: idSet, number: idNumber } = extractSetAndNumber(cardIdentifier);
    if (idSet && idNumber) {
        searchKeys.add(`${idSet}::${idNumber}`.toLowerCase());
        searchKeys.add(`${idSet} ${idNumber}`.toLowerCase());
    }
    const matchFromIndex = (cards, keys) => {
        if (!cards || typeof cards !== 'object') {
            return null;
        }
        for (const [name, details] of Object.entries(cards)) {
            const normalized = name.toLowerCase();
            if (keys.has(normalized)) {
                return name;
            }
            const uid = details?.uid;
            if (typeof uid === 'string') {
                const display = getDisplayName(uid);
                if (display && keys.has(display.toLowerCase())) {
                    return name;
                }
            }
        }
        return null;
    };
    const matchFromReportItems = (items, keys) => {
        if (!Array.isArray(items) || items.length === 0) {
            return null;
        }
        for (const item of items) {
            const name = item?.name;
            if (typeof name === 'string' && keys.has(name.toLowerCase())) {
                const uidDisplay = item?.uid ? getDisplayName(item.uid) : null;
                if (uidDisplay) {
                    return `${name} ${uidDisplay}`;
                }
                if (item?.set && item?.number) {
                    return `${name} ${item.set} ${item.number}`;
                }
                return name;
            }
            if (item?.set && item?.number) {
                const key = `${item.set}::${item.number}`.toLowerCase();
                if (keys.has(key)) {
                    return `${item.name || ''} ${item.set} ${item.number}`.trim();
                }
            }
            const uid = item?.uid;
            if (typeof uid === 'string') {
                const display = getDisplayName(uid);
                if (display && keys.has(display.toLowerCase())) {
                    return `${name || ''} ${display}`.trim();
                }
            }
        }
        return null;
    };
    // 1) Prefer online meta index first
    try {
        const onlineReport = await fetchReport(ONLINE_META_NAME).catch(() => null);
        if (onlineReport) {
            const parsed = parseReport(onlineReport);
            const match = matchFromReportItems(parsed?.items, searchKeys);
            if (match) {
                return match;
            }
        }
    }
    catch {
        // ignore
    }
    // 2) Fall back to tournaments list indices
    let tournaments = [];
    try {
        tournaments = await fetchTournamentsList();
    }
    catch {
        tournaments = [];
    }
    const subset = tournaments.slice(0, 12);
    for (const tournament of subset) {
        try {
            const index = await fetchCardIndex(tournament);
            const match = matchFromIndex(index?.cards, searchKeys);
            if (match) {
                return match;
            }
        }
        catch {
            continue;
        }
    }
    return null;
}
function formatUsagePercent(value) {
    if (!Number.isFinite(value)) {
        return '0%';
    }
    const normalized = Math.max(0, value);
    const precision = normalized >= 10 ? 0 : normalized >= 1 ? 1 : 2;
    return `${normalized.toFixed(precision)}%`;
}
function formatDeltaPercent(value) {
    if (!Number.isFinite(value) || value === 0) {
        return '+0%';
    }
    const clamped = Math.max(Math.min(value, 100), -100);
    const abs = Math.abs(clamped);
    const precision = abs >= 10 ? 0 : abs >= 1 ? 1 : 2;
    const sign = clamped > 0 ? '+' : '-';
    return `${sign}${abs.toFixed(precision)}%`;
}
function titleCase(value) {
    return value
        .toLowerCase()
        .split(' ')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
function prettifyIdentifier(identifier) {
    if (!identifier) {
        return '';
    }
    const display = getDisplayName(identifier);
    if (display && display !== identifier) {
        return display;
    }
    const slugGuess = describeSlug(identifier);
    if (slugGuess) {
        return titleCase(slugGuess.replace(/[:]/g, ' '));
    }
    if (identifier.includes('-')) {
        return titleCase(identifier.replace(/-/g, ' '));
    }
    return identifier;
}
function normalizeTrendingCard(entry) {
    if (!entry || !entry.name) {
        return null;
    }
    const shareKeys = ['recentAvg', 'latest', 'currentShare', 'endShare', 'startShare', 'avgShare', 'share'];
    let latest = 0;
    for (const key of shareKeys) {
        const val = Number(entry[key]);
        if (Number.isFinite(val)) {
            latest = val;
            break;
        }
    }
    const deltaKeys = ['deltaAbs', 'delta'];
    let delta = 0;
    for (const key of deltaKeys) {
        const val = Number(entry[key]);
        if (Number.isFinite(val)) {
            delta = val;
            break;
        }
    }
    delta = Math.max(Math.min(delta, 100), -100);
    const set = typeof entry.set === 'string' ? entry.set : null;
    const numberValue = entry.number;
    const number = typeof numberValue === 'string' || typeof numberValue === 'number' ? String(numberValue).trim() : null;
    const identifier = set && number ? `${entry.name} :: ${set} ${number}` : entry.name;
    return {
        name: entry.name,
        set,
        number,
        latest,
        delta,
        identifier
    };
}
function describeTournamentLabel(label) {
    if (!label) {
        return 'latest event';
    }
    const parts = label.split(',');
    if (parts.length >= 2) {
        return parts.slice(1).join(',').trim() || label.trim();
    }
    return label.trim();
}
async function pickUnderdogCard(tournamentLabel, existingNames) {
    try {
        const reportData = await fetchReport(tournamentLabel);
        const parsed = parseReport(reportData);
        const candidates = (parsed?.items || []).filter(item => item &&
            typeof item.pct === 'number' &&
            item.pct > 0 &&
            item.pct < 15 &&
            typeof item.name === 'string' &&
            item.name.trim().length > 0);
        if (!candidates.length) {
            return null;
        }
        const filtered = candidates.filter(item => !existingNames.has(item.name.toLowerCase()));
        const pool = filtered.length ? filtered : candidates;
        const selection = pool[Math.floor(Math.random() * pool.length)];
        if (!selection) {
            return null;
        }
        existingNames.add(selection.name.toLowerCase());
        const identifier = selection.uid ||
            (selection.set && selection.number ? `${selection.name} :: ${selection.set} ${selection.number}` : selection.name);
        return {
            name: selection.name,
            identifier,
            set: selection.set,
            number: selection.number,
            label: 'Underdog pick',
            meta: `${formatUsagePercent(selection.pct || 0)} in ${describeTournamentLabel(tournamentLabel)}`
        };
    }
    catch (error) {
        logger.warn('Failed to load underdog card preview', {
            tournament: tournamentLabel,
            error: error?.message || error
        });
        return null;
    }
}
function pickRandom(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return null;
    }
    const idx = Math.floor(Math.random() * items.length);
    return items[idx] ?? null;
}
async function buildMissingCardPreviewData(cardIdentifier) {
    const previews = [];
    const seenNames = new Set();
    try {
        const [trendPayload, tournaments] = await Promise.all([
            fetchTrendReport(MISSING_CARD_TRENDS_SOURCE).catch(() => null),
            fetchTournamentsList().catch(() => [])
        ]);
        if (trendPayload) {
            const risingList = (trendPayload?.suggestions?.onTheRise &&
                trendPayload.suggestions.onTheRise.length &&
                trendPayload.suggestions.onTheRise) ||
                trendPayload?.cardTrends?.rising ||
                [];
            const coolingList = (trendPayload?.suggestions?.choppedAndWashed &&
                trendPayload.suggestions.choppedAndWashed.length &&
                trendPayload.suggestions.choppedAndWashed) ||
                trendPayload?.cardTrends?.falling ||
                [];
            const risingPool = (Array.isArray(risingList) ? risingList : []).map(normalizeTrendingCard).filter(Boolean).slice(0, 6);
            const coolingPool = (Array.isArray(coolingList) ? coolingList : []).map(normalizeTrendingCard).filter(Boolean).slice(0, 6);
            const rising = pickRandom(risingPool.filter(item => !seenNames.has(item.name.toLowerCase())));
            if (rising) {
                seenNames.add(rising.name.toLowerCase());
                previews.push({
                    name: rising.name,
                    identifier: rising.identifier,
                    set: rising.set,
                    number: rising.number,
                    label: 'Meta riser',
                    meta: `${formatUsagePercent(rising.latest)} &middot; ${formatDeltaPercent(rising.delta)}`
                });
            }
            const cooling = pickRandom(coolingPool.filter(item => item && !seenNames.has(item.name.toLowerCase())));
            if (cooling) {
                seenNames.add(cooling.name.toLowerCase());
                previews.push({
                    name: cooling.name,
                    identifier: cooling.identifier,
                    set: cooling.set,
                    number: cooling.number,
                    label: 'Cooling off',
                    meta: `${formatUsagePercent(cooling.latest)} &middot; ${formatDeltaPercent(cooling.delta)}`
                });
            }
        }
        if (Array.isArray(tournaments) && tournaments.length > 0) {
            const underdog = await pickUnderdogCard(tournaments[0], seenNames);
            if (underdog) {
                previews.push({
                    ...underdog,
                    label: 'Sleeper pick'
                });
            }
        }
    }
    catch (error) {
        logger.warn('Failed to assemble missing-card previews', {
            cardIdentifier,
            error: error?.message || error
        });
    }
    return previews;
}
function loadPreviewThumbnail(target, preview) {
    const variant = preview.set && preview.number ? { set: preview.set, number: preview.number } : undefined;
    const candidates = [];
    const appendCandidates = (list) => {
        if (!Array.isArray(list)) {
            return;
        }
        for (const url of list) {
            if (url && !candidates.includes(url)) {
                candidates.push(url);
            }
        }
    };
    if (preview.identifier) {
        let uidSet = null;
        let uidNumber = null;
        if (preview.identifier.includes('::')) {
            const parts = preview.identifier.split('::');
            uidSet = parts[1] || null;
            uidNumber = parts[2] || null;
        }
        else {
            const match = preview.identifier.match(/^([A-Z]{2,})[:\s]+(\d+[A-Za-z]?)$/);
            if (match) {
                uidSet = match[1];
                uidNumber = match[2];
            }
        }
        if (uidSet && uidNumber) {
            appendCandidates(buildThumbCandidates(preview.name, false, {}, { set: uidSet, number: uidNumber }));
        }
    }
    appendCandidates(buildThumbCandidates(preview.name, false, {}, variant));
    if (candidates.length === 0) {
        return;
    }
    const img = document.createElement('img');
    img.decoding = 'async';
    img.loading = 'lazy';
    img.alt = preview.name;
    img.width = 48;
    img.height = 68;
    target.appendChild(img);
    let idx = 0;
    let fallbackAttempted = false;
    const tryNext = async () => {
        if (idx >= candidates.length && !fallbackAttempted) {
            fallbackAttempted = true;
            try {
                const fallback = await getVariantImageCandidates(preview.identifier, false, {});
                if (fallback.length) {
                    candidates.push(...fallback);
                }
            }
            catch {
                // ignore fallback failure
            }
        }
        if (idx >= candidates.length) {
            target.classList.add('card-missing-trend-thumb--empty');
            img.remove();
            return;
        }
        img.src = candidates[idx++];
    };
    img.onerror = () => {
        tryNext();
    };
    tryNext();
}
async function renderMissingCardTrendingCards(container, cardIdentifier) {
    if (!container) {
        return;
    }
    container.innerHTML = '<p class="card-missing-empty">Loading trending cards...</p>';
    try {
        const previews = await buildMissingCardPreviewData(cardIdentifier);
        if (!previews.length) {
            container.innerHTML =
                '<p class="card-missing-empty">Trending cards will appear once new events are processed.</p>';
            return;
        }
        container.innerHTML = '';
        previews.forEach(preview => {
            const href = buildCardPath(preview.identifier);
            const link = document.createElement('a');
            link.className = 'card-missing-trend';
            link.href = href;
            link.innerHTML = `
        <div class="card-missing-trend-thumb" aria-hidden="true"></div>
        <div class="card-missing-trend-copy">
          <span class="card-missing-trend-label">${preview.label}</span>
          <span class="card-missing-trend-name">${preview.name}</span>
          ${preview.set && preview.number ? `<span class="card-missing-trend-set">${preview.set} ${preview.number}</span>` : ''}
          <span class="card-missing-trend-meta">${preview.meta}</span>
        </div>
      `;
            container.appendChild(link);
            const thumb = link.querySelector('.card-missing-trend-thumb');
            if (thumb) {
                loadPreviewThumbnail(thumb, preview);
            }
        });
    }
    catch (error) {
        logger.warn('Failed to load trending cards preview for missing card', {
            cardIdentifier,
            error: error?.message || error
        });
        container.innerHTML = '<p class="card-missing-empty">Trending cards unavailable right now.</p>';
    }
}
/**
 * Render a user-friendly error page for missing cards
 * @param cardIdentifier - The card that was requested
 */
async function renderMissingCardPage(cardIdentifier) {
    try {
        let canonicalIdentifier = cardIdentifier;
        try {
            canonicalIdentifier = (await getCanonicalCard(cardIdentifier)) || cardIdentifier;
        }
        catch (error) {
            logger.debug('Unable to resolve canonical identifier for missing card', {
                cardIdentifier,
                error: error?.message || error
            });
        }
        const resolvedFromReports = (await resolveMissingCardDisplayName(canonicalIdentifier)) || null;
        const displaySource = resolvedFromReports || canonicalIdentifier || cardIdentifier;
        const displayName = prettifyIdentifier(displaySource) || displaySource || cardIdentifier;
        const fallbackVariant = extractSetAndNumber(displaySource);
        if (typeof history !== 'undefined') {
            document.title = `Card Not Found - ${displayName} | Ciphermaniac`;
        }
        const main = document.querySelector('main');
        if (main) {
            const baseName = getBaseName(displaySource) || getBaseName(canonicalIdentifier) || getBaseName(cardIdentifier) || cardIdentifier;
            const encodedSearch = encodeURIComponent(displayName);
            const heroVariant = fallbackVariant ?? extractSetAndNumber(cardIdentifier);
            main.innerHTML = `
        <section class="card-missing">
          <div class="card-missing-card">
            <div class="card-missing-thumb" aria-hidden="true"></div>
            <div class="card-missing-info">
              <p class="card-missing-eyebrow">No tournament entries yet</p>
              <h1>${displayName}</h1>
              <p class="card-missing-meta">This card has no Day 2 finishes, so no data can be shown.<br><span>Maybe you can get it its page?</span></p>
            <div class="card-missing-actions">
                <a href="/cards?q=${encodedSearch}" class="card-missing-button primary">Search for ${displayName}</a>
                <a href="/trends.html" class="card-missing-button">View meta trends</a>
              </div>
            </div>
          </div>
          <div class="card-missing-trending">
            <div class="card-missing-trending-header">
              <h2>Check these out!</h2>
              <a class="card-missing-link" href="/trends.html">See full report</a>
            </div>
            <div class="card-missing-trending-grid" id="card-missing-trending"></div>
          </div>
        </section>
      `;
            if (!document.getElementById('card-missing-style')) {
                const style = document.createElement('style');
                style.id = 'card-missing-style';
                style.textContent = `
        .card-missing {
          max-width: 880px;
          margin: 1.5rem auto 3rem;
          padding: 0 1rem;
          color: var(--text, #eef1f7);
        }

        .card-missing-card {
          display: flex;
          gap: 1.25rem;
          align-items: center;
          padding: 1.5rem;
          border-radius: 12px;
          border: 1px solid var(--border, #2a3150);
          background: var(--panel, #17181d);
        }

        .card-missing-thumb {
          width: min(220px, 40vw);
          aspect-ratio: 3 / 4;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.04);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .card-missing-info h1 {
          margin: 0 0 0.35rem 0;
          font-size: 1.6rem;
        }

        .card-missing-info {
          flex: 1;
        }

        .card-missing-eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 0.78rem;
          color: var(--muted, #a3a8b7);
          margin: 0 0 0.35rem 0;
        }

        .card-missing-meta {
          margin: 0 0 1rem 0;
          color: var(--muted, #a3a8b7);
          line-height: 1.4;
        }

        .card-missing-meta span {
          display: inline-block;
          font-size: 0.85rem;
          opacity: 0.85;
        }

        .card-missing-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
        }

        .card-missing-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.6rem 1.1rem;
          border-radius: 8px;
          border: 1px solid var(--border, #2a3150);
          color: var(--text, #eef1f7);
          text-decoration: none;
          font-weight: 600;
          transition: border-color 0.15s ease, background 0.15s ease;
        }

        .card-missing-button.primary {
          background: var(--accent-2, #6aa3ff);
          border-color: transparent;
          color: #0c1223;
        }

        .card-missing-button:hover {
          border-color: var(--accent-2, #6aa3ff);
          background: rgba(106, 163, 255, 0.08);
        }

        .card-missing-trending {
          margin-top: 1.25rem;
          border-radius: 12px;
          border: 1px solid var(--border, #2a3150);
          padding: 1.25rem;
          background: rgba(0, 0, 0, 0.2);
        }

        .card-missing-trending-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }

        .card-missing-trending-header h2 {
          margin: 0;
          font-size: 1.1rem;
        }

        .card-missing-link {
          color: var(--muted, #a3a8b7);
          text-decoration: none;
          font-size: 0.9rem;
        }

        .card-missing-trending-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 0.75rem;
        }

        .card-missing-trend {
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          padding: 0.65rem 0.9rem;
          text-decoration: none;
          color: var(--text, #eef1f7);
          background: rgba(255, 255, 255, 0.02);
          display: flex;
          gap: 0.75rem;
          align-items: center;
          transition: border-color 0.15s ease, background 0.15s ease;
        }

        .card-missing-trend:hover {
          border-color: var(--accent-2, #6aa3ff);
          background: rgba(106, 163, 255, 0.08);
        }

        .card-missing-trend-thumb {
          width: 48px;
          height: 68px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.04);
          overflow: hidden;
          flex-shrink: 0;
        }

        .card-missing-trend-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .card-missing-trend-thumb--empty {
          background: rgba(255, 255, 255, 0.08);
        }

        .card-missing-trend-copy {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }

        .card-missing-trend-label {
          text-transform: uppercase;
          font-size: 0.75rem;
          letter-spacing: 0.08em;
          color: var(--muted, #a3a8b7);
        }

        .card-missing-trend-name {
          font-weight: 600;
          display: block;
        }

        .card-missing-trend-set {
          color: var(--muted, #a3a8b7);
          font-size: 0.9rem;
          display: block;
        }

        .card-missing-trend-meta {
          color: var(--muted, #a3a8b7);
          font-size: 0.9rem;
        }

        .card-missing-empty {
          color: var(--muted, #a3a8b7);
          font-size: 0.95rem;
          margin: 0;
        }

        @media (max-width: 720px) {
          .card-missing-card {
            flex-direction: column;
            padding: 1.25rem;
            align-items: flex-start;
          }

          .card-missing-thumb {
            width: 100%;
            max-width: 340px;
          }

          .card-missing-actions {
            flex-direction: column;
            align-items: stretch;
          }

          .card-missing-button {
            width: 100%;
            justify-content: center;
            text-align: center;
          }
        }
        `;
                document.head.appendChild(style);
            }
            const trendingContainer = document.getElementById('card-missing-trending');
            renderMissingCardTrendingCards(trendingContainer, canonicalIdentifier);
            const imageContainer = main.querySelector('.card-missing-thumb');
            if (imageContainer) {
                const parsed = parseDisplayName(displaySource);
                const variant = {};
                if (parsed?.setId) {
                    const match = parsed.setId.match(/^([A-Z]+)\s+(\d+[A-Za-z]?)$/);
                    if (match) {
                        variant.set = match[1];
                        variant.number = match[2];
                    }
                }
                if (!variant.set && fallbackVariant.set) {
                    variant.set = fallbackVariant.set;
                }
                if (!variant.number && fallbackVariant.number) {
                    variant.number = fallbackVariant.number;
                }
                const candidateName = parsed?.name || baseName || displayName;
                const candidates = buildThumbCandidates(candidateName, true, {}, variant);
                if (candidates.length === 0) {
                    imageContainer.remove();
                }
                else {
                    const img = document.createElement('img');
                    img.decoding = 'async';
                    img.loading = 'lazy';
                    img.alt = displayName;
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.objectFit = 'cover';
                    img.style.borderRadius = 'inherit';
                    let idx = 0;
                    let fallbackAttempted = false;
                    const tryNext = async () => {
                        // If we've exhausted all candidates and haven't tried fallback yet, try synonym variants
                        if (idx >= candidates.length && !fallbackAttempted) {
                            fallbackAttempted = true;
                            try {
                                const fallbackCandidates = await getVariantImageCandidates(canonicalIdentifier, false, {});
                                if (fallbackCandidates.length > 0) {
                                    candidates.push(...fallbackCandidates);
                                    if (idx < candidates.length) {
                                        img.src = candidates[idx++];
                                    }
                                    else {
                                        imageContainer.remove();
                                    }
                                }
                                else {
                                    imageContainer.remove();
                                }
                            }
                            catch (error) {
                                imageContainer.remove();
                            }
                            return;
                        }
                        if (idx >= candidates.length) {
                            imageContainer.remove();
                            return;
                        }
                        img.src = candidates[idx++];
                    };
                    img.onerror = tryNext;
                    tryNext();
                    imageContainer.appendChild(img);
                }
            }
        }
        logger.info('Rendered missing card page', { cardIdentifier });
    }
    catch (error) {
        logger.error('Failed to render missing card page', {
            cardIdentifier,
            error: error.message
        });
        if (metaSection) {
            metaSection.innerHTML =
                '<div style="text-align: center; padding: 2rem; color: var(--text);">Card page not available. We do not have tournament data for this card yet.</div>';
        }
    }
}
async function load() {
    ensureCardMetaStructure();
    refreshDomRefs();
    if (!cardIdentifier) {
        if (metaSection) {
            metaSection.textContent = 'Missing card identifier.';
        }
        return;
    }
    // Check if card exists in Ciphermaniac database before proceeding
    const cardExistsInDatabase = await checkCardExistsInDatabase(cardIdentifier);
    if (!cardExistsInDatabase) {
        await renderMissingCardPage(cardIdentifier);
        return;
    }
    // Phase 1: Immediate UI Setup (synchronous, runs before any network)
    setupImmediateUI();
    // Phase 2: Start all async operations in parallel
    const dataPromises = startParallelDataLoading();
    // Phase 3: Progressive rendering as data becomes available
    await renderProgressively(dataPromises);
}
function setupImmediateUI() {
    // Show placeholders for all sections to prevent CLS
    const chartEl = document.getElementById('card-chart');
    if (chartEl) {
        showSkeleton(chartEl, createChartSkeleton('180px'));
    }
    if (copiesSection) {
        showSkeleton(copiesSection, createHistogramSkeleton());
    }
    if (eventsSection) {
        showSkeleton(eventsSection, createEventsTableSkeleton());
    }
    // Start hero image loading immediately, replacing skeleton
    const hero = document.getElementById('card-hero');
    if (hero && cardName) {
        // Get existing skeleton thumb if present
        const existingThumb = hero.querySelector('.thumb');
        const skeletonImage = existingThumb?.querySelector('.skeleton-image');
        // Create image element and wrapper
        const img = document.createElement('img');
        img.alt = cardName;
        img.decoding = 'async';
        img.loading = 'eager';
        img.style.opacity = '0';
        img.style.transition = 'opacity .18s ease-out';
        const wrap = document.createElement('div');
        wrap.className = 'thumb';
        wrap.style.position = 'relative';
        wrap.appendChild(img);
        // If there's a skeleton, fade it out smoothly
        if (skeletonImage instanceof HTMLElement) {
            skeletonImage.style.transition = 'opacity 0.15s ease-out';
            skeletonImage.style.opacity = '0';
            // Replace after skeleton fades
            setTimeout(() => {
                hero.innerHTML = '';
                hero.appendChild(wrap);
                hero.removeAttribute('aria-hidden');
            }, 150);
        }
        else {
            // No skeleton, just replace immediately
            hero.innerHTML = '';
            hero.appendChild(wrap);
            hero.removeAttribute('aria-hidden');
        }
        // Store image loading state on the element
        img._loadingState = {
            candidates: [],
            idx: 0,
            loading: false,
            fallbackAttempted: false
        };
        const tryNextImage = async () => {
            const state = img._loadingState;
            if (state.loading) {
                return;
            }
            // If we've exhausted all candidates and haven't tried fallback yet, try synonym variants
            if (state.idx >= state.candidates.length && !state.fallbackAttempted) {
                state.fallbackAttempted = true;
                try {
                    const fallbackCandidates = await getVariantImageCandidates(cardIdentifier, true, {});
                    if (fallbackCandidates.length > 0) {
                        // Append fallback candidates and continue trying
                        state.candidates.push(...fallbackCandidates);
                        if (state.idx < state.candidates.length) {
                            state.loading = true;
                            img.src = state.candidates[state.idx++];
                        }
                    }
                }
                catch (error) {
                    // Silently continue if fallback fails
                }
                return;
            }
            if (state.idx >= state.candidates.length) {
                return;
            }
            state.loading = true;
            img.src = state.candidates[state.idx++];
        };
        img.onerror = () => {
            img._loadingState.loading = false;
            tryNextImage();
        };
        const assignHiResCandidate = () => {
            const currentSrc = img.currentSrc || img.src;
            const derived = deriveLgUrlFromCandidate(currentSrc);
            if (derived) {
                img._fullResUrl = derived;
            }
            else if (!img._fullResUrl) {
                img._fullResUrl = currentSrc;
            }
        };
        img.onload = () => {
            img.style.opacity = '1';
            assignHiResCandidate();
        };
        // Parse variant information from card name
        const { name, setId } = parseDisplayName(cardName);
        let variant = {};
        if (setId) {
            const setMatch = setId.match(/^([A-Z]+)\s+(\d+[A-Za-z]?)$/);
            if (setMatch) {
                variant = { set: setMatch[1], number: setMatch[2] };
            }
        }
        const variantLgUrl = buildLgUrlFromVariant(variant);
        img._fullResUrl = variantLgUrl || null;
        enableHeroImageModal(wrap, img, variantLgUrl);
        // Start with variant-aware candidates
        const defaultCandidates = buildThumbCandidates(name, true, {}, variant);
        img._loadingState.candidates = defaultCandidates;
        tryNextImage();
    }
}
function startParallelDataLoading() {
    // Start all data fetching in parallel immediately
    const tournamentsPromise = fetchTournamentsList().catch(() => ['2025-08-15, World Championships 2025']);
    const overridesPromise = Promise.resolve({});
    // Secondary data that doesn't block initial content
    const cardSetsPromise = cardName ? renderCardSets(cardName).catch(() => null) : Promise.resolve(null);
    const cardPricePromise = cardIdentifier ? renderCardPrice(cardIdentifier).catch(() => null) : Promise.resolve(null);
    return {
        tournaments: tournamentsPromise,
        overrides: overridesPromise,
        cardSets: cardSetsPromise,
        cardPrice: cardPricePromise
    };
}
async function renderProgressively(dataPromises) {
    // Get tournaments data first (needed for most content)
    let tournaments = [];
    try {
        tournaments = await dataPromises.tournaments;
    }
    catch {
        tournaments = ['2025-08-15, World Championships 2025'];
    }
    if (!Array.isArray(tournaments) || tournaments.length === 0) {
        tournaments = ['2025-08-15, World Championships 2025'];
    }
    // Enhance hero image with overrides when available (non-blocking)
    dataPromises.overrides
        .then(async (overrides) => {
        const hero = document.getElementById('card-hero');
        const img = hero?.querySelector('img');
        if (hero && img && cardName && img.style.opacity === '0' && img._loadingState) {
            // Only enhance if image hasn't loaded yet and we have better candidates
            const { name, setId } = parseDisplayName(cardName);
            let variant = {};
            if (setId) {
                const setMatch = setId.match(/^([A-Z]+)\s+(\d+[A-Za-z]?)$/);
                if (setMatch) {
                    variant = { set: setMatch[1], number: setMatch[2] };
                }
            }
            const enhancedCandidates = buildThumbCandidates(name, true, overrides, variant);
            const state = img._loadingState;
            // If we haven't started loading or failed on default candidates, use enhanced ones
            if (state.idx === 0 || (state.idx >= state.candidates.length && !state.loading && !state.fallbackAttempted)) {
                state.candidates = enhancedCandidates;
                state.idx = 0;
                state.loading = false;
                state.fallbackAttempted = false; // Reset fallback flag for new candidates
                // Retry with enhanced candidates
                if (state.idx < state.candidates.length && !state.loading) {
                    state.loading = true;
                    img.src = state.candidates[state.idx++];
                }
            }
        }
    })
        .catch(() => {
        // Keep default candidates on override failure
    });
    // Simple localStorage cache for All-archetypes stats: key by tournament+card
    const CACHE_KEY = 'metaCacheV1';
    const cache = (() => {
        try {
            return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        }
        catch (error) {
            return {};
        }
    })();
    const saveCache = () => {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        }
        catch (error) {
            // Ignore initialization errors
        }
    };
    // Load main chart data in parallel
    await loadAndRenderMainContent(tournaments, cache, saveCache);
}
async function loadAndRenderMainContent(tournaments, cacheObject, saveCache) {
    // Fixed window: only process the most recent 6 tournaments to minimize network calls
    const PROCESS_LIMIT = 6;
    const recentTournaments = tournaments.slice(0, PROCESS_LIMIT);
    // Aggregate meta-share per tournament; only load the most recent tournaments
    const timePoints = [];
    const deckRows = [];
    const eventsWithCard = [];
    // Process tournaments in parallel with Promise.all for faster loading
    const tournamentPromises = recentTournaments.map(async (tournamentName) => {
        try {
            const ck = `${tournamentName}::${cardIdentifier}`;
            let globalPct = null;
            let globalFound = null;
            let globalTotal = null;
            if (cacheObject[ck]) {
                ({ pct: globalPct, found: globalFound, total: globalTotal } = cacheObject[ck]);
            }
            else {
                // Get all variants of this card and combine their usage data
                let card = null;
                const hasUID = cardIdentifier && cardIdentifier.includes('::'); // Matches "Name SET NUMBER" pattern
                if (!hasUID) {
                    // Try cardIndex for base name lookups (trainers and base Pokemon names)
                    try {
                        const idx = await fetchCardIndex(tournamentName);
                        const baseName = getBaseName(cardIdentifier) || '';
                        const matchingKey = Object.keys(idx.cards || {}).find(k => k.toLowerCase() === baseName.toLowerCase()) || '';
                        const entry = idx.cards?.[baseName] || idx.cards?.[matchingKey];
                        if (entry) {
                            card = {
                                name: baseName,
                                found: entry.found,
                                total: entry.total,
                                pct: entry.pct,
                                dist: entry.dist
                            };
                        }
                    }
                    catch (error) {
                        // Ignore initialization errors
                    }
                }
                if (!card) {
                    // Get canonical card and all its variants for combined usage statistics
                    const canonical = await getCanonicalCard(cardIdentifier);
                    const variants = await getCardVariants(canonical);
                    const master = await fetchReport(tournamentName);
                    const parsed = parseReport(master);
                    // Find data for all variants and combine
                    let combinedFound = 0;
                    let combinedTotal = null;
                    let hasAnyData = false;
                    for (const variant of variants) {
                        const variantCard = findCard(parsed.items, variant);
                        if (variantCard) {
                            hasAnyData = true;
                            if (Number.isFinite(variantCard.found)) {
                                combinedFound += variantCard.found;
                            }
                            // Use the total from any variant (should be the same across all variants in a tournament)
                            if (combinedTotal === null && Number.isFinite(variantCard.total)) {
                                combinedTotal = variantCard.total;
                            }
                        }
                    }
                    if (hasAnyData && combinedTotal !== null) {
                        card = {
                            name: getDisplayName(canonical),
                            found: combinedFound,
                            total: combinedTotal,
                            pct: combinedTotal > 0 ? (100 * combinedFound) / combinedTotal : 0
                        };
                    }
                }
                if (card) {
                    globalPct = Number.isFinite(card.pct) ? card.pct : card.total ? (100 * card.found) / card.total : 0;
                    globalFound = Number.isFinite(card.found) ? card.found : null;
                    globalTotal = Number.isFinite(card.total) ? card.total : null;
                    const cacheEntry = {
                        pct: globalPct,
                        found: globalFound,
                        total: globalTotal
                    };
                    // Store cache entry atomically
                    Object.assign(cacheObject, { [ck]: cacheEntry });
                    saveCache();
                }
            }
            if (globalPct !== null) {
                return {
                    tournament: tournamentName,
                    pct: globalPct,
                    found: globalFound,
                    total: globalTotal
                };
            }
            return null;
        }
        catch {
            return null; // missing tournament master
        }
    });
    // Wait for all tournament data in parallel
    const tournamentResults = await Promise.all(tournamentPromises);
    // Filter and collect results
    tournamentResults.forEach(result => {
        if (result) {
            timePoints.push({ tournament: result.tournament, pct: result.pct });
            eventsWithCard.push(result.tournament);
            deckRows.push({
                tournament: result.tournament,
                archetype: null,
                pct: result.pct,
                found: result.found,
                total: result.total
            });
        }
    });
    // Fixed window: always show the most recent 6 tournaments
    const LIMIT = 6;
    const showAll = false;
    // Cache for chosen archetype label per (tournament, card)
    const PICK_CACHE_KEY = 'archPickV2';
    const pickCache = (() => {
        try {
            return JSON.parse(localStorage.getItem(PICK_CACHE_KEY) || '{}');
        }
        catch (error) {
            return {};
        }
    })();
    const savePickCache = () => {
        try {
            localStorage.setItem(PICK_CACHE_KEY, JSON.stringify(pickCache));
        }
        catch (error) {
            // Ignore initialization errors
        }
    };
    async function chooseArchetypeForTournament(tournament) {
        const ck = `${tournament}::${cardIdentifier}`;
        if (pickCache[ck]) {
            return pickCache[ck];
        }
        try {
            const list = await fetchArchetypesList(tournament);
            const archetypeBases = Array.isArray(list)
                ? list.map(entry => (typeof entry === 'string' ? entry : entry?.name)).filter(Boolean)
                : [];
            const top8 = await fetchTop8ArchetypesList(tournament);
            const candidates = [];
            const canonical = await getCanonicalCard(cardIdentifier);
            const variants = await getCardVariants(canonical);
            for (const base of archetypeBases) {
                try {
                    const arc = await fetchArchetypeReport(tournament, base);
                    const parsedReport = parseReport(arc);
                    // Combine data from all variants for this archetype
                    let combinedFound = 0;
                    let combinedTotal = null;
                    let hasAnyData = false;
                    for (const variant of variants) {
                        const variantCardInfo = findCard(parsedReport.items, variant);
                        if (variantCardInfo) {
                            hasAnyData = true;
                            if (Number.isFinite(variantCardInfo.found)) {
                                combinedFound += variantCardInfo.found;
                            }
                            if (combinedTotal === null && Number.isFinite(variantCardInfo.total)) {
                                combinedTotal = variantCardInfo.total;
                            }
                        }
                    }
                    if (hasAnyData && combinedTotal !== null) {
                        const pct = combinedTotal > 0 ? (100 * combinedFound) / combinedTotal : 0;
                        candidates.push({
                            base,
                            pct,
                            found: combinedFound,
                            total: combinedTotal
                        });
                    }
                }
                catch {
                    /* missing archetype file */
                }
            }
            // Dynamic minimum based on card usage: if card has high overall usage but low per-archetype,
            // use a lower threshold to capture distributed usage patterns
            const overallUsage = cacheObject[`${tournament}::${cardIdentifier}`]?.pct || 0;
            const minTotal = overallUsage > 20 ? 1 : 3; // Lower threshold for high-usage cards
            const chosen = pickArchetype(candidates, top8 || undefined, { minTotal });
            const label = chosen ? baseToLabel(chosen.base) : null;
            // eslint-disable-next-line require-atomic-updates
            pickCache[ck] = label;
            savePickCache();
            return label;
        }
        catch {
            return null;
        }
    }
    const renderToggles = () => {
        // Removed all toggle notes
    };
    const refresh = () => {
        const rebuiltStructure = ensureCardMetaStructure();
        refreshDomRefs();
        if (rebuiltStructure) {
            updateCardTitle(cardName);
            updateSearchLink();
            syncSearchInputValue();
            try {
                setupImmediateUI();
            }
            catch (error) {
                logger.debug('Failed to re-run immediate UI after rebuilding structure', error?.message || error);
            }
            if (cardIdentifier) {
                // Re-run derived renderers so new DOM receives content
                renderCardSets(cardIdentifier).catch(() => { });
                renderCardPrice(cardIdentifier).catch(() => { });
            }
        }
        const ptsAll = [...timePoints].reverse();
        const rowsAll = [...deckRows].reverse();
        const pts = showAll ? ptsAll : ptsAll.slice(-LIMIT);
        const rows = showAll ? rowsAll : rowsAll.slice(-LIMIT);
        let chartContainer = document.getElementById('card-chart');
        if (!chartContainer) {
            const cardCenter = document.getElementById('card-center') || metaSection;
            chartContainer = document.createElement('div');
            chartContainer.id = 'card-chart';
            chartContainer.className = 'card-chart skeleton-loading';
            if (cardCenter) {
                cardCenter.insertBefore(chartContainer, cardCenter.firstChild || null);
            }
            else if (metaSection) {
                metaSection.appendChild(chartContainer);
            }
            refreshDomRefs();
        }
        if (chartContainer) {
            renderChart(chartContainer, pts);
        }
        const copiesTarget = document.getElementById('card-copies');
        if (copiesTarget) {
            const latest = rows[rows.length - 1];
            if (latest) {
                (async () => {
                    try {
                        const canonical = await getCanonicalCard(cardIdentifier);
                        const variants = await getCardVariants(canonical);
                        const master = await fetchReport(latest.tournament);
                        const parsed = parseReport(master);
                        let overall = null;
                        let combinedFound = 0;
                        let combinedTotal = null;
                        const combinedDist = [];
                        for (const variant of variants) {
                            const variantCard = findCard(parsed.items, variant);
                            if (variantCard) {
                                if (Number.isFinite(variantCard.found)) {
                                    combinedFound += variantCard.found;
                                }
                                if (combinedTotal === null && Number.isFinite(variantCard.total)) {
                                    combinedTotal = variantCard.total;
                                }
                                if (variantCard.dist && Array.isArray(variantCard.dist)) {
                                    for (const distEntry of variantCard.dist) {
                                        const existing = combinedDist.find(distItem => distItem.copies === distEntry.copies);
                                        if (existing) {
                                            existing.players += distEntry.players || 0;
                                        }
                                        else {
                                            combinedDist.push({
                                                copies: distEntry.copies,
                                                players: distEntry.players || 0
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        if (combinedFound > 0 && combinedTotal !== null) {
                            overall = {
                                name: getDisplayName(canonical),
                                found: combinedFound,
                                total: combinedTotal,
                                pct: combinedTotal > 0 ? (100 * combinedFound) / combinedTotal : 0,
                                dist: combinedDist.sort((first, second) => first.copies - second.copies)
                            };
                        }
                        if (overall) {
                            renderCopiesHistogram(copiesTarget, overall);
                        }
                        else {
                            copiesTarget.textContent = '';
                        }
                    }
                    catch {
                        copiesTarget.textContent = '';
                    }
                })();
            }
            else {
                copiesTarget.textContent = '';
            }
        }
        let eventsTarget = document.getElementById('card-events');
        if (!eventsTarget && metaSection) {
            eventsTarget = document.createElement('div');
            eventsTarget.id = 'card-events';
            metaSection.appendChild(eventsTarget);
            refreshDomRefs();
            eventsTarget = document.getElementById('card-events');
        }
        renderEvents(eventsTarget || decksSection || metaSection || document.body, rows);
        renderToggles();
        renderAnalysisSelector(eventsWithCard);
        // After initial paint, fill archetype labels for visible rows asynchronously
        // Attach lazy hover handlers for event rows to prefetch and compute archetype label on demand
        const tableContainer = eventsSection || decksSection;
        if (tableContainer && !tableContainer._hoverPrefetchAttached) {
            tableContainer.addEventListener('mouseover', async (eventTarget) => {
                const targetElement = eventTarget.target instanceof HTMLElement ? eventTarget.target : null;
                const rowEl = targetElement ? targetElement.closest('.event-row') : null;
                if (!rowEl) {
                    return;
                }
                const tournamentFromRow = rowEl.dataset.tournament;
                if (!tournamentFromRow) {
                    return;
                }
                // Prefetch event master if not present
                // await loadTournament(t); // Function not defined - commented out
                // Compute archetype label if missing
                const target = deckRows.find(deckRow => deckRow.tournament === tournamentFromRow);
                if (target && !target.archetype) {
                    const label = await chooseArchetypeForTournament(tournamentFromRow);
                    if (label) {
                        target.archetype = label;
                        const eventsToRender = showAll ? [...deckRows].reverse() : [...deckRows].reverse().slice(-LIMIT);
                        renderEvents(tableContainer, eventsToRender);
                        renderToggles();
                    }
                }
            });
            tableContainer._hoverPrefetchAttached = true;
        }
    };
    refresh();
    // Lazy-load older events as the user hovers suggestions or event rows
    // no hover prefetch on card page in eager mode
    // Re-render chart on resize (throttled)
    let resizeTimer = null;
    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
        // Skip if resize is too small (less than 50px change) to avoid unnecessary re-renders
        const currentWidth = window.innerWidth;
        if (Math.abs(currentWidth - lastWidth) < 50) {
            return;
        }
        if (resizeTimer) {
            return;
        }
        resizeTimer = setTimeout(() => {
            resizeTimer = null;
            lastWidth = window.innerWidth;
            const elementToRender = document.getElementById('card-chart') || metaSection;
            const pointsToRender = showAll ? [...timePoints].reverse() : [...timePoints].reverse().slice(-LIMIT);
            if (elementToRender) {
                renderChart(elementToRender, pointsToRender);
            }
        }, 200); // Increased throttle to reduce flash frequency
    });
    // No min-decks selector in UI; default minTotal used in picker
}
function renderAnalysisSelector(events) {
    if (!(analysisSel && analysisTable)) {
        return;
    }
    analysisSel.innerHTML = '';
    if (!events || events.length === 0) {
        analysisTable.textContent = 'Select an event to view per-archetype usage.';
        return;
    }
    for (const tournamentName of events) {
        const opt = document.createElement('option');
        opt.value = tournamentName;
        opt.textContent = tournamentName;
        analysisSel.appendChild(opt);
    }
    analysisSel.addEventListener('change', () => {
        renderAnalysisTable(analysisSel.value);
    });
    renderAnalysisTable(analysisSel.value || events[0]);
}
async function renderAnalysisTable(tournament) {
    if (!analysisTable) {
        return;
    }
    // Show loading state with skeleton
    const loadingSkeleton = document.createElement('div');
    loadingSkeleton.className = 'skeleton-analysis-loading';
    loadingSkeleton.setAttribute('aria-hidden', 'true');
    loadingSkeleton.innerHTML = `
    <div class="skeleton-text medium" style="margin-bottom: 8px;"></div>
    <div class="skeleton-text large" style="margin-bottom: 16px;"></div>
    <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 8px;">
      <div class="skeleton-text small"></div>
      <div class="skeleton-text small"></div>
      <div class="skeleton-text small"></div>
      <div class="skeleton-text small"></div>
      <div class="skeleton-text small"></div>
      <div class="skeleton-text small"></div>
    </div>
    ${Array(5)
        .fill(0)
        .map(() => `
      <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 4px;">
        <div class="skeleton-text medium"></div>
        <div class="skeleton-text small"></div>
        <div class="skeleton-text small"></div>
        <div class="skeleton-text small"></div>
        <div class="skeleton-text small"></div>
        <div class="skeleton-text small"></div>
      </div>
    `)
        .join('')}
  `;
    analysisTable.innerHTML = '';
    // Create enhanced progress indicator positioned within the analysis section
    const progress = createProgressIndicator('Loading Archetype Analysis', ['Processing archetype data', 'Building analysis table'], {
        position: 'relative',
        container: analysisTable,
        autoRemove: true,
        showPercentage: true
    });
    analysisTable.appendChild(loadingSkeleton);
    try {
        // Overall (All archetypes) distribution for this event
        let overall = null;
        try {
            const master = await fetchReport(tournament);
            const parsed = parseReport(master);
            // Get canonical card and all its variants for combined usage statistics
            const canonical = await getCanonicalCard(cardIdentifier);
            const variants = await getCardVariants(canonical);
            // Combine data from all variants
            let combinedFound = 0;
            let combinedTotal = null;
            const combinedDist = [];
            let hasAnyData = false;
            for (const variant of variants) {
                const variantCard = findCard(parsed.items, variant);
                if (variantCard) {
                    hasAnyData = true;
                    if (Number.isFinite(variantCard.found)) {
                        combinedFound += variantCard.found;
                    }
                    if (combinedTotal === null && Number.isFinite(variantCard.total)) {
                        combinedTotal = variantCard.total;
                    }
                    // Combine distribution data
                    if (variantCard.dist && Array.isArray(variantCard.dist)) {
                        for (const distEntry of variantCard.dist) {
                            const existing = combinedDist.find(distItem => distItem.copies === distEntry.copies);
                            if (existing) {
                                existing.players += distEntry.players || 0;
                            }
                            else {
                                combinedDist.push({
                                    copies: distEntry.copies,
                                    players: distEntry.players || 0
                                });
                            }
                        }
                    }
                }
            }
            if (hasAnyData && combinedTotal !== null) {
                overall = {
                    name: getDisplayName(canonical),
                    found: combinedFound,
                    total: combinedTotal,
                    pct: combinedTotal > 0 ? (100 * combinedFound) / combinedTotal : 0,
                    dist: combinedDist.sort((first, second) => first.copies - second.copies)
                };
            }
        }
        catch {
            /* ignore */
        }
        // Per-archetype distributions using enhanced parallel loading
        const list = await fetchArchetypesList(tournament);
        const archetypeBases = Array.isArray(list)
            ? list.map(entry => (typeof entry === 'string' ? entry : entry?.name)).filter(Boolean)
            : [];
        progress.updateStep(0, 'loading');
        // Get canonical card and all its variants for combined usage statistics
        const canonical = await getCanonicalCard(cardIdentifier);
        const variants = await getCardVariants(canonical);
        // Use parallel processing utility for better performance
        const archetypeResults = await processInParallel(archetypeBases, async (base) => {
            try {
                const archetypeReport = await fetchArchetypeReport(tournament, base);
                const parsedReport = parseReport(archetypeReport);
                // Combine data from all variants for this archetype
                let combinedFound = 0;
                let combinedTotal = null;
                const combinedDist = [];
                let hasAnyData = false;
                for (const variant of variants) {
                    const variantCardInfo = findCard(parsedReport.items, variant);
                    if (variantCardInfo) {
                        hasAnyData = true;
                        if (Number.isFinite(variantCardInfo.found)) {
                            combinedFound += variantCardInfo.found;
                        }
                        if (combinedTotal === null && Number.isFinite(variantCardInfo.total)) {
                            combinedTotal = variantCardInfo.total;
                        }
                        // Combine distribution data
                        if (variantCardInfo.dist && Array.isArray(variantCardInfo.dist)) {
                            for (const distEntry of variantCardInfo.dist) {
                                const existing = combinedDist.find(distItem => distItem.copies === distEntry.copies);
                                if (existing) {
                                    existing.players += distEntry.players || 0;
                                }
                                else {
                                    combinedDist.push({
                                        copies: distEntry.copies,
                                        players: distEntry.players || 0
                                    });
                                }
                            }
                        }
                    }
                }
                if (hasAnyData && combinedTotal !== null) {
                    // For high-usage cards (>20%), include single-deck archetypes to show distribution
                    const overallItem = overall || {};
                    const overallPct = overallItem.total ? (100 * overallItem.found) / overallItem.total : overallItem.pct || 0;
                    const minSample = overallPct > 20 ? 1 : 2; // Lower threshold for high-usage cards
                    if (combinedTotal >= minSample) {
                        const percentage = combinedTotal > 0 ? (100 * combinedFound) / combinedTotal : 0;
                        // Precompute percent of all decks in archetype by copies
                        const copiesPct = (numberOfCopies) => {
                            if (!Array.isArray(combinedDist) || !(combinedTotal > 0)) {
                                return null;
                            }
                            const distribution = combinedDist.find(distItem => distItem.copies === numberOfCopies);
                            if (!distribution) {
                                return 0;
                            }
                            return (100 * (distribution.players ?? 0)) / combinedTotal;
                        };
                        return {
                            archetype: base.replace(/_/g, ' '),
                            pct: percentage,
                            found: combinedFound,
                            total: combinedTotal,
                            c1: copiesPct(1),
                            c2: copiesPct(2),
                            c3: copiesPct(3),
                            c4: copiesPct(4)
                        };
                    }
                }
                return null;
            }
            catch {
                return null; // missing archetype
            }
        }, {
            concurrency: 6, // Reasonable limit to avoid overwhelming the server
            onProgress: (processed, total) => {
                progress.updateProgress(processed, total, `${processed}/${total} archetypes processed`);
            }
        });
        // Filter out null results
        const rows = archetypeResults.filter((result) => result !== null);
        progress.updateStep(0, 'complete', `Processed ${rows.length} archetypes with data`);
        progress.updateStep(1, 'loading');
        rows.sort((archA, archB) => {
            // Primary sort: actual deck count (found)
            const foundDiff = (archB.found ?? 0) - (archA.found ?? 0);
            if (foundDiff !== 0) {
                return foundDiff;
            }
            // Secondary sort: deck popularity (total) when found counts are equal
            const totalDiff = (archB.total ?? 0) - (archA.total ?? 0);
            if (totalDiff !== 0) {
                return totalDiff;
            }
            // Tertiary sort: alphabetical by archetype name
            return archA.archetype.localeCompare(archB.archetype);
        });
        // Fade out existing content before replacing
        analysisTable.style.transition = 'opacity 0.1s ease-out';
        analysisTable.style.opacity = '0';
        // Wait for fade out, then rebuild
        await new Promise(resolve => setTimeout(resolve, 100));
        // eslint-disable-next-line require-atomic-updates
        analysisTable.innerHTML = '';
        // Per-archetype table
        if (rows.length === 0) {
            const note = document.createElement('div');
            note.className = 'summary';
            note.textContent = 'No per-archetype usage found for this event (or all archetypes have only one deck).';
            analysisTable.appendChild(note);
            progress.updateStep(1, 'complete');
            progress.setComplete(500); // Show for half a second then fade
            // Fade in the empty state
            requestAnimationFrame(() => {
                analysisTable.style.opacity = '1';
            });
            return;
        }
        const tbl = document.createElement('table');
        tbl.style.width = '100%';
        tbl.style.borderCollapse = 'collapse';
        tbl.style.background = 'var(--panel)';
        tbl.style.border = '1px solid #242a4a';
        tbl.style.borderRadius = '8px';
        const thead = document.createElement('thead');
        const trh = document.createElement('tr');
        ['Archetype', 'Played %', '1x', '2x', '3x', '4x'].forEach((header, i) => {
            const th = document.createElement('th');
            th.textContent = header;
            if (header === 'Played %') {
                th.title = 'Percent of decks in the archetype that ran the card (any copies).';
            }
            if (['1x', '2x', '3x', '4x'].includes(header)) {
                th.title = `Percent of decks in the archetype that ran exactly ${header}`;
            }
            th.style.textAlign = i > 0 && i < 6 ? 'right' : 'left';
            th.style.padding = '10px 12px';
            th.style.borderBottom = '1px solid #2c335a';
            th.style.color = 'var(--muted)';
            trh.appendChild(th);
        });
        thead.appendChild(trh);
        tbl.appendChild(thead);
        const tbody = document.createElement('tbody');
        for (const rowData of rows) {
            const tableRow = document.createElement('tr');
            const formatValue = (value) => (value === null ? '—' : `${Math.round(value)}%`);
            const archetypeDeckCount = rowData.total !== null ? rowData.total : rowData.found !== null ? rowData.found : null;
            const firstCell = document.createElement('td');
            const strong = document.createElement('strong');
            strong.textContent = rowData.archetype;
            firstCell.appendChild(strong);
            if (archetypeDeckCount !== null) {
                firstCell.appendChild(document.createTextNode(` (${archetypeDeckCount})`));
            }
            firstCell.style.padding = '10px 12px';
            firstCell.style.textAlign = 'left';
            tableRow.appendChild(firstCell);
            const otherValues = [
                rowData.pct !== null ? `${Math.round(rowData.pct)}%` : '—',
                formatValue(rowData.c1),
                formatValue(rowData.c2),
                formatValue(rowData.c3),
                formatValue(rowData.c4)
            ];
            otherValues.forEach((valueText, valueIndex) => {
                const tableCell = document.createElement('td');
                tableCell.textContent = valueText;
                if (valueIndex === 0) {
                    tableCell.title = 'Played % = (decks with the card / total decks in archetype)';
                }
                if (valueIndex >= 1 && valueIndex <= 4) {
                    const numberOfCopies = valueIndex;
                    tableCell.title = `Percent of decks in archetype that ran exactly ${numberOfCopies}x`;
                }
                if (typeof valueText === 'string') {
                    const percentageMatch = valueText.match(/^\s*(\d+)%$/);
                    if (percentageMatch && Number(percentageMatch[1]) === 0) {
                        tableCell.classList.add('zero-pct');
                    }
                }
                tableCell.style.padding = '10px 12px';
                tableCell.style.textAlign = 'right';
                tableRow.appendChild(tableCell);
            });
            tbody.appendChild(tableRow);
        }
        tbl.appendChild(tbody);
        analysisTable.appendChild(tbl);
        // Fade in the new table content
        requestAnimationFrame(() => {
            analysisTable.style.opacity = '1';
        });
        // Make table header sticky via a floating cloned header as a fallback when CSS sticky doesn't work
        // This ensures the header row stays visible even if ancestor overflow/transform prevents CSS sticky.
        try {
            enableFloatingTableHeader(tbl);
        }
        catch (err) {
            // Non-fatal: if anything goes wrong, don't block rendering
            logger.debug('enableFloatingTableHeader failed:', err);
        }
        progress.updateStep(1, 'complete', `Built table with ${rows.length} archetypes`);
        progress.setComplete(500); // Show for half a second then fade away
    }
    catch (error) {
        logger.error('Analysis table error:', error);
        // eslint-disable-next-line require-atomic-updates
        analysisTable.textContent = 'Failed to load analysis for this event.';
        // Clean up progress indicator and any orphans
        if (progress && progress.fadeAndRemove) {
            progress.fadeAndRemove();
        }
        // Failsafe cleanup for any lingering progress indicators
        setTimeout(() => {
            cleanupOrphanedProgressDisplay();
        }, 100);
    }
}
if (!__ROUTE_REDIRECTING) {
    load();
}
// Debug utility - expose cleanup function globally for troubleshooting
window.cleanupProgress = () => {
    const elements = document.querySelectorAll('.parallel-loader-progress, [id^="progress-"]');
    logger.debug(`Found ${elements.length} progress indicator(s) to clean up`);
    elements.forEach((element, index) => {
        logger.debug(`Removing progress indicator ${index + 1}: ${element.id || element.className}`);
        const el = element;
        el.style.transition = 'opacity 0.3s ease-out';
        el.style.opacity = '0';
        setTimeout(() => {
            if (el.parentNode) {
                el.remove();
                logger.debug(`Successfully removed progress indicator ${index + 1}`);
            }
        }, 300);
    });
    return elements.length;
};
/**
 * Creates a floating clone of the table header that appears fixed at the top of the viewport
 * when the real header scrolls out of view. This is a robust fallback for cases where
 * CSS position: sticky is prevented by overflow/transform on ancestor elements.
 * @param table
 */
function enableFloatingTableHeader(table) {
    if (!table || !(table instanceof HTMLTableElement)) {
        return;
    }
    const thead = table.querySelector('thead');
    if (!thead) {
        return;
    }
    // Create floating wrapper
    const floating = document.createElement('div');
    floating.className = 'floating-thead';
    floating.style.position = 'fixed';
    floating.style.top = '0';
    const initialRect = table.getBoundingClientRect();
    floating.style.left = `${initialRect.left}px`;
    floating.style.width = `${initialRect.width}px`;
    floating.style.overflow = 'hidden';
    floating.style.zIndex = '1000';
    floating.style.pointerEvents = 'none';
    floating.style.display = 'none';
    // Clone header table structure
    const cloneTable = document.createElement('table');
    cloneTable.className = table.className;
    cloneTable.style.borderCollapse = 'collapse';
    const cloneThead = thead.cloneNode(true);
    cloneTable.appendChild(cloneThead);
    floating.appendChild(cloneTable);
    document.body.appendChild(floating);
    // Helper to sync column widths
    function syncWidths() {
        if (!thead)
            return;
        const srcCols = thead.querySelectorAll('th');
        const dstCols = cloneThead.querySelectorAll('th');
        const srcRect = table.getBoundingClientRect();
        floating.style.left = `${Math.max(0, srcRect.left)}px`;
        floating.style.width = `${srcRect.width}px`;
        for (let i = 0; i < srcCols.length; i++) {
            const columnWidth = srcCols[i].getBoundingClientRect().width;
            dstCols[i].style.width = `${columnWidth}px`;
        }
    }
    function onScroll() {
        if (!thead)
            return;
        const rect = table.getBoundingClientRect();
        const headerRect = thead.getBoundingClientRect();
        // Show floating header once the real header is scrolled above the viewport top
        if (headerRect.top < 0 && rect.bottom > 40) {
            syncWidths();
            floating.style.display = '';
        }
        else {
            floating.style.display = 'none';
        }
    }
    // Throttle resize/scroll handlers lightly
    let ticking = false;
    function ticked() {
        onScroll();
        ticking = false;
    }
    function schedule() {
        if (!ticking) {
            requestAnimationFrame(ticked);
            ticking = true;
        }
    }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // Initial sync
    schedule();
    // Return a cleanup function attached to the table for potential removal
    Object.defineProperty(table, '_floatingHeaderCleanup', {
        value: () => {
            window.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            if (floating && floating.parentNode) {
                floating.parentNode.removeChild(floating);
            }
        },
        configurable: true
    });
}
