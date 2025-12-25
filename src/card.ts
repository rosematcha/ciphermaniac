// Entry for per-card page: loads meta-share over tournaments and common decks
import './utils/buildVersion.js';
import {
  fetchArchetypeReport,
  fetchArchetypesList,
  fetchCardIndex,
  fetchReport,
  fetchTop8ArchetypesList,
  fetchTournamentsList
} from './api.js';
import { parseReport } from './parse.js';
import { buildThumbCandidates } from './thumbs.js';
import { baseToLabel, pickArchetype } from './selectArchetype.js';
import { normalizeCardRouteOnLoad } from './router.js';
import {
  createChartSkeleton,
  createEventsTableSkeleton,
  createHistogramSkeleton,
  showSkeleton
} from './components/placeholders.js';
import { logger, setupGlobalErrorHandler } from './utils/errorHandler.js';

// Import card-specific modules
import { getBaseName, getDisplayName, parseDisplayName } from './card/identifiers.js';
import { findCard, renderCardPrice, renderCardSets } from './card/data.js';
import { renderChart, renderCopiesHistogram, renderEvents } from './card/charts.js';
import { getCanonicalCard, getCardVariants, getVariantImageCandidates } from './utils/cardSynonyms.js';
import {
  buildCardPath,
  buildIdentifierLookup,
  describeSlug,
  makeCardSlug,
  parseCardRoute,
  resolveCardSlug
} from './card/routing.js';
import {
  buildLgUrlFromVariant,
  deriveLgUrlFromCandidate,
  enableHeroImageModal,
  type VariantInfo
} from './card/modal.js';
import { renderMissingCardPage } from './card/missingCard.js';
import { renderAnalysisSelector } from './card/analysis.js';

// Set up global error handling
setupGlobalErrorHandler();

const CARD_META_TEMPLATE = `
  <div class="header-title">
    <div class="title-row">
      <h1 id="card-title"></h1>
      <div id="card-price" class="card-price">
        <!-- Price loads asynchronously -->
      </div>
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

let cardTitleEl: HTMLElement | null = null;
let metaSection: HTMLElement | null = null;
let decksSection: HTMLElement | null = null;
let eventsSection: HTMLElement | null = null;
let copiesSection: HTMLElement | null = null;

function refreshDomRefs() {
  cardTitleEl = document.getElementById('card-title');
  metaSection = document.getElementById('card-meta');
  decksSection = document.getElementById('card-decks');
  eventsSection = document.getElementById('card-events');
  copiesSection = document.getElementById('card-copies');
}

function ensureCardMetaStructure(): boolean {
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

// Modal functions imported from ./card/modal.js

refreshDomRefs();
if (ensureCardMetaStructure()) {
  refreshDomRefs();
}

const __ROUTE_REDIRECTING = normalizeCardRouteOnLoad();
const routeInfo = parseCardRoute();
const shouldPrefillSearch = routeInfo.source === 'query' || routeInfo.source === 'hash';

let cardIdentifier: string | null = null;
let cardName: string | null = null;

const backLink = document.getElementById('back-link') as HTMLAnchorElement | null;
if (backLink) {
  backLink.href = '/';
}
const _analysisSel = document.getElementById('analysis-event') as HTMLSelectElement | null;
const _analysisTable = document.getElementById('analysis-table') as HTMLElement | null;
const searchInGrid = document.getElementById('search-in-grid') as HTMLAnchorElement | null;

// These will be set inside initCardSearch to ensure DOM is ready
let cardSearchInput: HTMLInputElement | null = null;

// Link to grid prefilled with search will be updated after card resolution

function updateCardTitle(displayName: string | null, slugHint?: string) {
  if (!cardTitleEl) {
    return;
  }

  cardTitleEl.innerHTML = '';

  if (!displayName && !slugHint) {
    const nameSpan = document.createElement('span');
    nameSpan.textContent = 'Card Details';
    cardTitleEl.appendChild(nameSpan);
    document.title = 'Card Details – Ciphermaniac';
    return;
  }

  const label = displayName || slugHint || 'Card Details';
  const parsed = displayName ? parseDisplayName(displayName) : null;

  // Determine the clean card name and set info
  let resolvedName = parsed?.name || '';
  let setInfo = parsed?.setId || '';

  // If parsing didn't find a name but found setId, or if the label looks like just "SET NUMBER",
  // the displayName was just a set ID - we need to extract the name from the base identifier
  if (!resolvedName && setInfo) {
    // The "name" wasn't found, so the entire displayName is likely just set info
    // Use the label as a fallback for now - renderCardSets will fix it later with proper data
    resolvedName = label;
    setInfo = '';
  } else if (!resolvedName && !setInfo) {
    // No parsing succeeded at all, use the label
    resolvedName = label;
  }

  // If resolvedName still looks like a set ID pattern (e.g., "SVI 181"), try to get base name from cardIdentifier
  const setIdOnlyPattern = /^[A-Z]{2,4}\s+\d+[A-Za-z]?$/i;
  if (setIdOnlyPattern.test(resolvedName) && cardIdentifier) {
    // The resolved name is just a set ID - get the base name from the card identifier
    const baseName = getBaseName(cardIdentifier);
    if (baseName && !setIdOnlyPattern.test(baseName)) {
      resolvedName = baseName;
      // Extract set info from the original display name
      setInfo = displayName || '';
    }
  }

  // Create and append the clean card name as the main title
  const nameSpan = document.createElement('span');
  nameSpan.className = 'card-title-name';
  nameSpan.textContent = resolvedName;
  cardTitleEl.appendChild(nameSpan);

  // If we have set info, add it as a subheading
  if (setInfo) {
    const setSpan = document.createElement('span');
    setSpan.className = 'card-title-set';
    setSpan.textContent = setInfo;
    cardTitleEl.appendChild(setSpan);
  }

  document.title = `${resolvedName} – Ciphermaniac`;
}

function updateSearchLink() {
  if (!searchInGrid) {
    return;
  }
  if (cardName) {
    searchInGrid.href = `/cards?q=${encodeURIComponent(cardName)}`;
  } else {
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
  } else if (routeInfo.slug) {
    let resolvedIdentifier: string | null = null;
    try {
      resolvedIdentifier = await resolveCardSlug(routeInfo.slug);
    } catch (error: any) {
      logger.warn('Failed to resolve card slug', {
        slug: routeInfo.slug,
        error: error?.message || error
      });
    }

    if (resolvedIdentifier) {
      cardIdentifier = resolvedIdentifier;
    } else {
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
  } catch (error: any) {
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
  } else if (location.hash) {
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
  cardSearchInput = document.getElementById('card-search') as HTMLInputElement | null;
  syncSearchInputValue();
}

// Ensure DOM is ready before initializing search
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCardSearch);
} else {
  initCardSearch();
}

// buildIdentifierLookup moved to ./card/routing.js

/**
 * Check if a card exists in the Ciphermaniac database
 * @param cardIdentifier - Card identifier to check
 * @returns Whether the card has a Ciphermaniac page
 */
async function checkCardExistsInDatabase(cardIdentifier: string): Promise<boolean> {
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
    } catch (canonicalError: any) {
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
    } catch (variantError: any) {
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
      } catch (error: any) {
        logger.debug('Card index unavailable during existence check', {
          cardIdentifier,
          tournament,
          error: error.message
        });
      }
    }
    return false;
  } catch (error: any) {
    logger.warn('Failed to check card existence via card indices', {
      cardIdentifier,
      error: error.message
    });
    return true;
  }
}

// Missing card page functionality moved to ./card/missingCard.js

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
    await renderMissingCardPage(cardIdentifier, metaSection);
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
    } else {
      // No skeleton, just replace immediately
      hero.innerHTML = '';
      hero.appendChild(wrap);
      hero.removeAttribute('aria-hidden');
    }

    // Store image loading state on the element
    (img as any)._loadingState = {
      candidates: [],
      idx: 0,
      loading: false,
      fallbackAttempted: false
    };

    const tryNextImage = async () => {
      const state = (img as any)._loadingState;
      if (state.loading) {
        return;
      }

      // If we've exhausted all candidates and haven't tried fallback yet, try synonym variants
      if (state.idx >= state.candidates.length && !state.fallbackAttempted) {
        state.fallbackAttempted = true;
        try {
          const fallbackCandidates = await getVariantImageCandidates(cardIdentifier!, true, {});
          if (fallbackCandidates.length > 0) {
            // Append fallback candidates and continue trying
            state.candidates.push(...fallbackCandidates);
            if (state.idx < state.candidates.length) {
              state.loading = true;
              img.src = state.candidates[state.idx++];
            }
          }
        } catch {
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
      (img as any)._loadingState.loading = false;
      tryNextImage();
    };

    const assignHiResCandidate = () => {
      const currentSrc = img.currentSrc || img.src;
      const derived = deriveLgUrlFromCandidate(currentSrc);
      if (derived) {
        (img as any)._fullResUrl = derived;
      } else if (!(img as any)._fullResUrl) {
        (img as any)._fullResUrl = currentSrc;
      }
    };

    img.onload = () => {
      img.style.opacity = '1';
      assignHiResCandidate();
    };

    // Parse variant information from card name
    const { name, setId } = parseDisplayName(cardName);
    let variant: VariantInfo = {};
    if (setId) {
      const setMatch = setId.match(/^([A-Z]+)\s+(\d+[A-Za-z]?)$/);
      if (setMatch) {
        variant = { set: setMatch[1], number: setMatch[2] };
      }
    }

    const variantLgUrl = buildLgUrlFromVariant(variant);
    (img as any)._fullResUrl = variantLgUrl || null;

    enableHeroImageModal(wrap, img, variantLgUrl, cardName);

    // Start with variant-aware candidates
    const defaultCandidates = buildThumbCandidates(name, true, {}, variant);
    (img as any)._loadingState.candidates = defaultCandidates;
    tryNextImage();
  }
}

function startParallelDataLoading() {
  // Start all data fetching in parallel immediately
  const tournamentsPromise = fetchTournamentsList().catch(() => ['2025-08-15, World Championships 2025']);
  const overridesPromise = Promise.resolve({});

  // Secondary data that doesn't block initial content
  const cardSetsPromise = cardIdentifier ? renderCardSets(cardIdentifier).catch(() => null) : Promise.resolve(null);
  const cardPricePromise = cardIdentifier ? renderCardPrice(cardIdentifier).catch(() => null) : Promise.resolve(null);

  return {
    tournaments: tournamentsPromise,
    overrides: overridesPromise,
    cardSets: cardSetsPromise,
    cardPrice: cardPricePromise
  };
}

async function renderProgressively(dataPromises: any) {
  // Get tournaments data first (needed for most content)
  let tournaments: string[] = [];
  try {
    tournaments = await dataPromises.tournaments;
  } catch {
    tournaments = ['2025-08-15, World Championships 2025'];
  }
  if (!Array.isArray(tournaments) || tournaments.length === 0) {
    tournaments = ['2025-08-15, World Championships 2025'];
  }

  // Enhance hero image with overrides when available (non-blocking)
  dataPromises.overrides
    .then(async (overrides: any) => {
      const hero = document.getElementById('card-hero');
      const img = hero?.querySelector('img');
      if (hero && img && cardName && img.style.opacity === '0' && (img as any)._loadingState) {
        // Only enhance if image hasn't loaded yet and we have better candidates
        const { name, setId } = parseDisplayName(cardName);
        let variant: any = {};
        if (setId) {
          const setMatch = setId.match(/^([A-Z]+)\s+(\d+[A-Za-z]?)$/);
          if (setMatch) {
            variant = { set: setMatch[1], number: setMatch[2] };
          }
        }
        const enhancedCandidates = buildThumbCandidates(name, true, overrides, variant);
        const state = (img as any)._loadingState;

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
    } catch {
      return {};
    }
  })();
  const saveCache = () => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Ignore initialization errors
    }
  };

  // Load main chart data in parallel
  await loadAndRenderMainContent(tournaments, cache, saveCache);
}

async function loadAndRenderMainContent(tournaments: string[], cacheObject: any, saveCache: () => void) {
  // Fixed window: only process the most recent 6 tournaments to minimize network calls
  const PROCESS_LIMIT = 6;
  const recentTournaments = tournaments.slice(0, PROCESS_LIMIT);

  // Aggregate meta-share per tournament; only load the most recent tournaments
  const timePoints: any[] = [];
  const deckRows: any[] = [];
  const eventsWithCard: string[] = [];

  // Process tournaments in parallel with Promise.all for faster loading
  const tournamentPromises = recentTournaments.map(async tournamentName => {
    try {
      const ck = `${tournamentName}::${cardIdentifier}`;
      let globalPct: number | null = null;
      let globalFound: number | null = null;
      let globalTotal: number | null = null;
      if (cacheObject[ck]) {
        ({ pct: globalPct, found: globalFound, total: globalTotal } = cacheObject[ck]);
      } else {
        // Get all variants of this card and combine their usage data
        let card: any = null;
        const hasUID = cardIdentifier && cardIdentifier.includes('::'); // Matches "Name SET NUMBER" pattern

        if (!hasUID) {
          // Try cardIndex for base name lookups (trainers and base Pokemon names)
          try {
            const idx = await fetchCardIndex(tournamentName);
            const baseName = getBaseName(cardIdentifier!) || '';
            const matchingKey =
              Object.keys(idx.cards || {}).find(k => k.toLowerCase() === baseName.toLowerCase()) || '';
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
          } catch {
            // Ignore initialization errors
          }
        }

        if (!card) {
          // Get canonical card and all its variants for combined usage statistics
          const canonical = await getCanonicalCard(cardIdentifier!);
          const variants = await getCardVariants(canonical);

          const master = await fetchReport(tournamentName);
          const parsed = parseReport(master);

          // Find data for all variants and combine
          let combinedFound = 0;
          let combinedTotal: number | null = null;
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
    } catch {
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
    } catch {
      return {};
    }
  })();
  const savePickCache = () => {
    try {
      localStorage.setItem(PICK_CACHE_KEY, JSON.stringify(pickCache));
    } catch {
      // Ignore initialization errors
    }
  };

  async function chooseArchetypeForTournament(tournament: string) {
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
      const candidates: any[] = [];
      const canonical = await getCanonicalCard(cardIdentifier!);
      const variants = await getCardVariants(canonical);

      for (const base of archetypeBases) {
        try {
          const arc = await fetchArchetypeReport(tournament, base);
          const parsedReport = parseReport(arc);

          // Combine data from all variants for this archetype
          let combinedFound = 0;
          let combinedTotal: number | null = null;
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
        } catch {
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
    } catch {
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
      } catch (error: any) {
        logger.debug('Failed to re-run immediate UI after rebuilding structure', error?.message || error);
      }
      if (cardIdentifier) {
        // Re-run derived renderers so new DOM receives content
        renderCardSets(cardIdentifier).catch(() => {});
        renderCardPrice(cardIdentifier).catch(() => {});
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
      } else if (metaSection) {
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
            const canonical = await getCanonicalCard(cardIdentifier!);
            const variants = await getCardVariants(canonical);

            const master = await fetchReport(latest.tournament);
            const parsed = parseReport(master);

            let overall: any = null;
            let combinedFound = 0;
            let combinedTotal: number | null = null;
            const combinedDist: any[] = [];

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
                    } else {
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
            } else {
              copiesTarget.textContent = '';
            }
          } catch {
            copiesTarget.textContent = '';
          }
        })();
      } else {
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
    renderAnalysisSelector(eventsWithCard, cardIdentifier);

    // After initial paint, fill archetype labels for visible rows asynchronously
    // Attach lazy hover handlers for event rows to prefetch and compute archetype label on demand
    const tableContainer = eventsSection || decksSection;
    if (tableContainer && !(tableContainer as any)._hoverPrefetchAttached) {
      tableContainer.addEventListener('mouseover', async eventTarget => {
        const targetElement = eventTarget.target instanceof HTMLElement ? eventTarget.target : null;
        const rowEl = targetElement ? targetElement.closest('.event-row') : null;
        if (!rowEl) {
          return;
        }
        const tournamentFromRow = (rowEl as HTMLElement).dataset.tournament;
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
      (tableContainer as any)._hoverPrefetchAttached = true;
    }
  };
  refresh();

  // Lazy-load older events as the user hovers suggestions or event rows
  // no hover prefetch on card page in eager mode

  // Re-render chart on resize (throttled)
  let resizeTimer: any = null;
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

if (!__ROUTE_REDIRECTING) {
  load();
}
