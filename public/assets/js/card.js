// Entry for per-card page: loads meta-share over tournaments and common decks
import './utils/buildVersion.js';
import { fetchArchetypeReport, fetchArchetypesList, fetchCardIndex, fetchReport, fetchTop8ArchetypesList, fetchTournamentsList } from './api.js';
import { parseReport } from './parse.js';
import { buildThumbCandidates } from './thumbs.js';
import { baseToLabel, pickArchetype } from './selectArchetype.js';
import { normalizeCardRouteOnLoad } from './router.js';
import { createChartSkeleton, createEventsTableSkeleton, createHistogramSkeleton, showSkeleton } from './components/placeholders.js';
import { cleanupOrphanedProgressDisplay, createProgressIndicator, processInParallel } from './utils/parallelLoader.js';
import { logger, setupGlobalErrorHandler } from './utils/errorHandler.js';
// Import card-specific modules
import { getBaseName, getCanonicalId, getDisplayName, parseDisplayName } from './card/identifiers.js';
import { findCard, renderCardPrice, renderCardSets } from './card/data.js';
import { renderChart, renderCopiesHistogram, renderEvents } from './card/charts.js';
import { getCanonicalCard, getCardVariants, getVariantImageCandidates } from './utils/cardSynonyms.js';
import { buildCardPath, describeSlug, makeCardSlug, parseCardRoute, resolveCardSlug } from './card/routing.js';
// Set up global error handling
setupGlobalErrorHandler();
const CARD_META_TEMPLATE = `
  <div class="header-title">
    <div class="title-row">
      <h1 id="card-title">Card Details</h1>
      <div id="card-price" class="card-price skeleton-loading">
        <div class="skeleton-text small"></div>
      </div>
    </div>
    <div id="card-sets" class="card-sets skeleton-loading">
      <div class="skeleton-text medium"></div>
    </div>
  </div>
  <div id="card-hero" class="card-hero">
    <div class="thumb skeleton-loading">
      <div class="skeleton-image"></div>
    </div>
  </div>
  <div id="card-center">
    <div id="card-chart" class="skeleton-loading">
      <div class="skeleton-chart"></div>
    </div>
    <div id="card-copies" class="skeleton-loading">
      <div class="skeleton-histogram"></div>
    </div>
  </div>
  <div id="card-events"></div>
`;
let cardTitleEl = null;
let metaSection = null;
let decksSection = null;
let eventsSection = null;
let copiesSection = null;
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
        searchInGrid.href = `/index.html?q=${encodeURIComponent(cardName)}`;
    }
    else {
        searchInGrid.href = '/index.html';
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
// Global variables for search functionality
let currentMatches = [];
let selectedIndex = -1;
// Helper functions for card search
function getCachedNames() {
    const SKEY = 'cardNamesUnionV5';
    try {
        return JSON.parse(localStorage.getItem(SKEY) || '{"names":[]}');
    }
    catch (error) {
        return { names: [] };
    }
}
function saveCachedNames(names) {
    const SKEY = 'cardNamesUnionV5';
    try {
        localStorage.setItem(SKEY, JSON.stringify({ names }));
    }
    catch (error) {
        // Ignore storage errors
    }
}
function createCardOption(item) {
    const opt = document.createElement('option');
    opt.value = item.display;
    opt.setAttribute('data-uid', item.uid);
    return opt;
}
function updateCardDatalist(byExactName, cardNamesList) {
    const allCards = Array.from(byExactName.values()).sort((cardA, cardB) => cardA.display.localeCompare(cardB.display));
    // Clear existing options without parameter reassignment
    const listElement = cardNamesList;
    while (listElement.firstChild) {
        listElement.removeChild(listElement.firstChild);
    }
    allCards.forEach(item => {
        listElement.appendChild(createCardOption(item));
    });
    // Update cache
    const namesToCache = allCards.map(cardItem => cardItem.display);
    saveCachedNames(namesToCache);
}
function enrichSuggestions(tournaments, byExactName, updateDatalist, processedTournaments) {
    // Process tournaments in parallel with limited concurrency for better performance
    const MAX_PARALLEL = 3; // Process max 3 tournaments simultaneously
    const tournamentsToProcess = tournaments.filter(tournament => !processedTournaments.has(tournament));
    if (tournamentsToProcess.length === 0) {
        return;
    }
    // Don't await anything - run everything in background to avoid blocking
    // Process first tournament immediately for quickest feedback
    const [firstTournament, ...rest] = tournamentsToProcess;
    processTournament(firstTournament, byExactName, processedTournaments)
        .then(added => {
        if (added) {
            updateDatalist();
        }
    })
        .catch(() => {
        // Silently continue
    });
    // Process remaining tournaments in parallel batches (background)
    if (rest.length > 0) {
        processTournamentBatch(rest, byExactName, updateDatalist, MAX_PARALLEL, processedTournaments);
    }
}
async function processTournamentBatch(tournaments, byExactName, updateDatalist, maxParallel, processedTournaments) {
    // Process tournaments in parallel batches
    for (let i = 0; i < tournaments.length; i += maxParallel) {
        const batch = tournaments.slice(i, i + maxParallel);
        // Process batch in parallel
        const promises = batch.map(tournament => processTournament(tournament, byExactName, processedTournaments));
        const results = await Promise.allSettled(promises);
        // Check if any new cards were added
        const hasNewCards = results.some(result => result.status === 'fulfilled' && result.value);
        if (hasNewCards) {
            updateDatalist();
        }
    }
}
async function processTournament(tournament, byExactName, processedTournaments) {
    if (processedTournaments.has(tournament)) {
        return false;
    }
    try {
        const master = await fetchReport(tournament);
        const parsed = parseReport(master);
        let added = false;
        for (const item of parsed.items) {
            const canonicalId = getCanonicalId(item);
            // Create consistent display name: "Card Name SET NUMBER" when available, otherwise just name
            let displayName;
            if (item.set && item.number) {
                displayName = `${item.name} ${item.set} ${item.number}`;
            }
            else {
                displayName = item.name;
            }
            // Store all cards: Pokemon with full identifiers, Trainers/Energies with base names
            if (displayName && !byExactName.has(displayName)) {
                byExactName.set(displayName, {
                    display: displayName,
                    uid: canonicalId || displayName
                });
                added = true;
            }
        }
        processedTournaments.add(tournament);
        return added;
    }
    catch (error) {
        // Skip missing tournaments
        return false;
    }
}
// Initialize search suggestions regardless of whether a card is selected
function initCardSearch() {
    try {
        // Get DOM elements when function is called to ensure DOM is ready
        cardSearchInput = document.getElementById('card-search');
        cardNamesList = document.getElementById('card-names');
        suggestionsBox = document.getElementById('card-suggestions');
        if (!(cardSearchInput && cardNamesList)) {
            return;
        }
        // Use fallback immediately to avoid blocking, fetch in background
        let tournaments = ['2025-08-15, World Championships 2025'];
        const processedTournaments = new Set();
        const byExactName = new Map(); // exact display name -> {display, uid}
        const updateDatalist = () => {
            if (cardNamesList) {
                updateCardDatalist(byExactName, cardNamesList);
            }
        };
        // Fetch tournaments list in background and update later
        fetchTournamentsList()
            .then(fetchedTournaments => {
            if (Array.isArray(fetchedTournaments) && fetchedTournaments.length > 0) {
                tournaments = fetchedTournaments;
                enrichSuggestions(tournaments, byExactName, updateDatalist, processedTournaments);
            }
        })
            .catch(() => {
            // Silently continue with fallback
        });
        // Union cache across tournaments for robust suggestions
        const cached = getCachedNames();
        // Seed from cache for instant suggestions
        if (Array.isArray(cached.names) && cached.names.length > 0) {
            cached.names.forEach(cardNameFromCache => {
                if (cardNameFromCache) {
                    byExactName.set(cardNameFromCache, {
                        display: cardNameFromCache,
                        uid: cardNameFromCache
                    });
                }
            });
        }
        else {
            // Fallback: Add common cards for immediate suggestions when no cache exists
            const commonCards = [
                "Boss's Orders PAL 172",
                'Ultra Ball SVI 196',
                "Professor's Research JTG 155",
                'Iono PAL 185',
                'Rare Candy SVI 191',
                'Night Stretcher SFA 061',
                'Nest Ball SVI 181',
                'Counter Catcher PAR 160'
            ];
            commonCards.forEach(cardName => {
                byExactName.set(cardName, { display: cardName, uid: cardName });
            });
        }
        updateDatalist();
        // Incrementally enrich suggestions by scanning tournaments sequentially
        enrichSuggestions(tournaments, byExactName, updateDatalist, processedTournaments);
        setupSearchHandlers();
        syncSearchInputValue();
    }
    catch (error) {
        // Ignore initialization errors
    }
}
// Search helper functions
function getAllNames() {
    return Array.from(cardNamesList?.options || []).map(option => String(option.value || ''));
}
function getUidForName(displayName) {
    const option = Array.from(cardNamesList?.options || []).find(opt => opt.value === displayName);
    return option?.getAttribute('data-uid') || displayName;
}
function computeMatches(query) {
    const searchQuery = query.trim().toLowerCase();
    if (!searchQuery) {
        return getAllNames().slice(0, 8);
    }
    const allNames = getAllNames();
    const startMatches = [];
    const containsMatches = [];
    for (const cardNameInList of allNames) {
        const lowerName = cardNameInList.toLowerCase();
        if (lowerName.startsWith(searchQuery)) {
            startMatches.push(cardNameInList);
        }
        else if (lowerName.includes(searchQuery)) {
            containsMatches.push(cardNameInList);
        }
        if (startMatches.length + containsMatches.length >= 8) {
            break;
        }
    }
    return [...startMatches, ...containsMatches].slice(0, 8);
}
function setupSearchHandlers() {
    function renderSuggestions() {
        if (!(suggestionsBox && cardSearchInput)) {
            return;
        }
        const matches = computeMatches(cardSearchInput.value);
        // Wire keyboard state
        currentMatches = matches;
        // Reset selection when suggestions refresh
        selectedIndex = -1;
        suggestionsBox.innerHTML = '';
        if (matches.length === 0 || document.activeElement !== cardSearchInput) {
            suggestionsBox.classList.remove('is-open');
            return;
        }
        matches.forEach((match, matchIndex) => {
            const item = createSuggestionItem(match, matchIndex, matches);
            suggestionsBox.appendChild(item);
        });
        suggestionsBox.classList.add('is-open');
    }
    function createSuggestionItem(match, matchIndex, matches) {
        const item = document.createElement('div');
        item.className = 'item';
        item.setAttribute('role', 'option');
        if (matchIndex === selectedIndex) {
            item.setAttribute('aria-selected', 'true');
        }
        const left = document.createElement('span');
        left.className = 'suggestion-name';
        const { name, setId } = parseDisplayName(match);
        const nameSpan = document.createElement('span');
        nameSpan.textContent = name;
        left.appendChild(nameSpan);
        if (setId) {
            const setSpan = document.createElement('span');
            setSpan.className = 'suggestion-set';
            setSpan.textContent = setId;
            left.appendChild(setSpan);
        }
        item.appendChild(left);
        const right = document.createElement('span');
        // Show Tab badge on the first item by default (or on selectedIndex when set)
        const tabTarget = selectedIndex >= 0 ? selectedIndex : 0;
        if (matchIndex === tabTarget) {
            right.className = 'tab-indicator';
            right.textContent = 'Tab';
        }
        item.appendChild(right);
        // Event handlers
        item.addEventListener('mousedown', handleMouseDown);
        item.addEventListener('click', handleClick);
        item.addEventListener('dblclick', handleDoubleClick);
        // Store index for event handlers
        item.dataset.index = String(matchIndex);
        return item;
        function handleMouseDown(event) {
            event.preventDefault();
            if (cardSearchInput) {
                cardSearchInput.value = matches[matchIndex];
                selectedIndex = matchIndex;
                updateSelection(matchIndex);
                cardSearchInput.focus();
            }
        }
        function handleClick(event) {
            event.preventDefault();
            selectedIndex = matchIndex;
            goTo(matches[matchIndex]);
        }
        function handleDoubleClick(event) {
            event.preventDefault();
            selectedIndex = matchIndex;
            goTo(matches[matchIndex]);
        }
    }
    if (cardSearchInput) {
        cardSearchInput.addEventListener('focus', renderSuggestions);
        cardSearchInput.addEventListener('input', renderSuggestions);
        cardSearchInput.addEventListener('keydown', handleKeyDown);
        cardSearchInput.addEventListener('change', handleInputChange);
    }
    document.addEventListener('click', handleDocumentClick);
    function handleDocumentClick(event) {
        if (!suggestionsBox) {
            return;
        }
        if (!suggestionsBox.contains(event.target) && event.target !== cardSearchInput) {
            suggestionsBox.classList.remove('is-open');
        }
    }
    function goTo(identifier) {
        if (!identifier) {
            return;
        }
        // Try to get the UID for this display name
        const targetId = getUidForName(identifier) || identifier;
        location.assign(buildCardPath(targetId));
    }
    function updateSelection(idx) {
        if (!suggestionsBox) {
            return;
        }
        const items = Array.from(suggestionsBox.children);
        items.forEach((item, itemIndex) => {
            if (itemIndex === idx) {
                item.setAttribute('aria-selected', 'true');
            }
            else {
                item.removeAttribute('aria-selected');
            }
            // Move tab-indicator to the selected item (update right span)
            const right = item.children && item.children[1];
            if (right) {
                if (itemIndex === idx) {
                    right.className = 'tab-indicator';
                    right.textContent = 'Tab';
                }
                else {
                    right.className = '';
                    right.textContent = '';
                }
            }
        });
        selectedIndex = idx >= 0 && idx < currentMatches.length ? idx : -1;
        if (selectedIndex >= 0 && cardSearchInput) {
            // Preview selection into the input so user sees the chosen suggestion
            cardSearchInput.value = currentMatches[selectedIndex];
        }
    }
    function handleKeyDown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            // If user navigated suggestions, pick highlighted; otherwise use input value
            const pick = selectedIndex >= 0 && currentMatches[selectedIndex]
                ? currentMatches[selectedIndex]
                : cardSearchInput?.value.trim();
            if (pick) {
                goTo(pick);
            }
            return;
        }
        if (event.key === 'Tab') {
            if (!currentMatches || currentMatches.length === 0) {
                return;
            }
            event.preventDefault();
            // Tab completes the current highlight (or top/last when none)
            if (selectedIndex >= 0) {
                handleTabCompletion(currentMatches[selectedIndex]);
            }
            else {
                // No selection yet: choose top (or last if shift)
                const idx = event.shiftKey ? currentMatches.length - 1 : 0;
                updateSelection(idx);
                handleTabCompletion(currentMatches[idx]);
            }
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!currentMatches || currentMatches.length === 0) {
                return;
            }
            if (event.key === 'ArrowDown') {
                const next = selectedIndex < currentMatches.length - 1 ? selectedIndex + 1 : 0;
                updateSelection(next);
            }
            else {
                const prev = selectedIndex > 0 ? selectedIndex - 1 : currentMatches.length - 1;
                updateSelection(prev);
            }
            return;
        }
        if (event.key === 'Escape') {
            if (suggestionsBox) {
                suggestionsBox.classList.remove('is-open');
            }
            selectedIndex = -1;
            currentMatches = [];
        }
    }
    function handleTabCompletion(pick) {
        if (pick && cardSearchInput && pick !== cardSearchInput.value) {
            cardSearchInput.value = pick;
            try {
                const end = pick.length;
                cardSearchInput.setSelectionRange(end, end);
            }
            catch (error) {
                // Ignore selection range errors
            }
            renderSuggestions();
        }
    }
    function handleInputChange() {
        const inputValue = cardSearchInput?.value.trim();
        if (inputValue) {
            goTo(inputValue);
        }
    }
}
// Ensure DOM is ready before initializing search
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCardSearch);
}
else {
    initCardSearch();
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
        const searchKeys = new Set();
        const lowerIdentifier = cardIdentifier.toLowerCase();
        const canonicalLower = canonicalIdentifier ? canonicalIdentifier.toLowerCase() : null;
        const baseName = getBaseName(cardIdentifier)?.toLowerCase();
        const addIdentifier = (value) => {
            if (value) {
                searchKeys.add(String(value).toLowerCase());
            }
        };
        addIdentifier(cardIdentifier);
        if (canonicalIdentifier && canonicalIdentifier !== cardIdentifier) {
            addIdentifier(canonicalIdentifier);
        }
        addIdentifier(lowerIdentifier);
        if (canonicalLower) {
            addIdentifier(canonicalLower);
        }
        if (baseName) {
            addIdentifier(baseName);
        }
        // Add variant fallbacks (e.g., PAL, SVI) so that if the preferred canonical (MEG/MEE)
        // isn't present in tournament indices, we can fall back to older reprints.
        try {
            const variants = await getCardVariants(cardIdentifier);
            if (Array.isArray(variants) && variants.length > 0) {
                // Ensure canonical is first, then add older variants
                for (const variantIdentifier of variants) {
                    addIdentifier(variantIdentifier);
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
 * Render a user-friendly error page for missing cards
 * @param cardIdentifier - The card that was requested
 */
function renderMissingCardPage(cardIdentifier) {
    try {
        const displayName = getDisplayName(cardIdentifier) || cardIdentifier;
        if (typeof history !== 'undefined') {
            document.title = `Card Not Found - ${displayName} | Ciphermaniac`;
        }
        const main = document.querySelector('main');
        if (main) {
            const baseName = getBaseName(cardIdentifier) || cardIdentifier;
            const encodedSearch = encodeURIComponent(baseName);
            main.innerHTML = `
        <section class="card-404-section">
          <div class="card-404-content">
            <div class="card-404-header">
              <h1>Card Page Not Available</h1>
              <div class="card-404-subtitle">${displayName}</div>
            </div>

            <div class="card-404-image" aria-hidden="true"></div>

            <div class="card-404-explanation">
              <p>We don't have tournament usage data for this card yet, so there's no dedicated page.</p>
              <p>Once the card shows up in processed tournament results, its page will be created automatically.</p>
            </div>

            <div class="card-404-actions">
              <div class="card-404-suggestions">
                <h3>What you can do:</h3>
                <ul>
                  <li><a href="/index.html" class="card-404-link">Browse all cards with data</a></li>
                  <li><a href="/index.html?q=${encodedSearch}" class="card-404-link">Search for similar cards</a></li>
                  <li><a href="/feedback.html" class="card-404-link">Request this card be prioritized</a></li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      `;
            if (!document.getElementById('card-404-style')) {
                const style = document.createElement('style');
                style.id = 'card-404-style';
                style.textContent = `
        .card-404-section {
          max-width: 600px;
          margin: 2rem auto;
          padding: 2rem;
          text-align: center;
        }

        .card-404-content {
          background: var(--panel, #1a1f3a);
          border-radius: 12px;
          padding: 2rem;
          border: 1px solid var(--border, #2a3150);
        }

        .card-404-header h1 {
          color: var(--text, #ffffff);
          margin: 0 0 0.5rem 0;
          font-size: 1.5rem;
        }

        .card-404-subtitle {
          color: var(--muted, #a3add8);
          font-size: 1rem;
        }

        .card-404-image {
          margin: 1.5rem 0;
        }

        .card-404-explanation {
          color: var(--text, #dbe2ff);
          line-height: 1.6;
          margin-bottom: 2rem;
        }

        .card-404-actions {
          text-align: left;
        }

        .card-404-suggestions ul {
          margin: 0;
          padding-left: 1.5rem;
        }

        .card-404-link {
          color: var(--accent, #4f8cf4);
          text-decoration: none;
          padding: 0.5rem 0;
          display: inline-block;
          transition: color 0.2s ease;
        }

        .card-404-link:hover {
          color: var(--accent-hover, #6ba0f6);
          text-decoration: underline;
        }

        @media (max-width: 640px) {
          .card-404-section {
            margin: 1rem;
            padding: 1rem;
          }

          .card-404-content {
            padding: 1.5rem;
          }

          .card-404-header h1 {
            font-size: 1.3rem;
          }
        }
        `;
                document.head.appendChild(style);
            }
            const imageContainer = main.querySelector('.card-404-image');
            if (imageContainer) {
                const parsed = parseDisplayName(displayName);
                const variant = {};
                if (parsed?.setId) {
                    const match = parsed.setId.match(/^([A-Z]+)\s+(\d+[A-Za-z]?)$/);
                    if (match) {
                        variant.set = match[1];
                        variant.number = match[2];
                    }
                }
                const candidateName = parsed?.name || baseName || displayName;
                const candidates = buildThumbCandidates(candidateName, false, {}, variant);
                if (candidates.length === 0) {
                    imageContainer.remove();
                }
                else {
                    const img = document.createElement('img');
                    img.decoding = 'async';
                    img.loading = 'lazy';
                    img.alt = displayName;
                    img.style.maxWidth = '300px';
                    img.style.borderRadius = '8px';
                    img.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
                    let idx = 0;
                    let fallbackAttempted = false;
                    const tryNext = async () => {
                        // If we've exhausted all candidates and haven't tried fallback yet, try synonym variants
                        if (idx >= candidates.length && !fallbackAttempted) {
                            fallbackAttempted = true;
                            try {
                                const fallbackCandidates = await getVariantImageCandidates(cardIdentifier, false, {});
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
        renderMissingCardPage(cardIdentifier);
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
        // Clear any existing skeleton placeholder
        hero.innerHTML = '';
        // Create image element and wrapper
        const img = document.createElement('img');
        img.alt = cardName;
        img.decoding = 'async';
        img.loading = 'eager';
        img.style.opacity = '0';
        img.style.transition = 'opacity .18s ease-out';
        const wrap = document.createElement('div');
        wrap.className = 'thumb';
        wrap.appendChild(img);
        hero.appendChild(wrap);
        hero.removeAttribute('aria-hidden');
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
        img.onload = () => {
            img.style.opacity = '1';
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
    window.addEventListener('resize', () => {
        if (resizeTimer) {
            return;
        }
        resizeTimer = setTimeout(() => {
            resizeTimer = null;
            const elementToRender = document.getElementById('card-chart') || metaSection;
            const pointsToRender = showAll ? [...timePoints].reverse() : [...timePoints].reverse().slice(-LIMIT);
            if (elementToRender) {
                renderChart(elementToRender, pointsToRender);
            }
        }, 120);
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
