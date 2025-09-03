// Entry for per-card page: loads meta-share over tournaments and common decks
import {
  fetchTournamentsList,
  fetchReport,
  fetchArchetypesList,
  fetchArchetypeReport,
  fetchOverrides,
  fetchTop8ArchetypesList,
  fetchCardIndex
} from './api.js';
import { parseReport } from './parse.js';
import { buildThumbCandidates } from './thumbs.js';
import { pickArchetype, baseToLabel } from './selectArchetype.js';
import { normalizeCardRouteOnLoad } from './router.js';
import {
  createChartSkeleton,
  createHistogramSkeleton,
  createEventsTableSkeleton,
  showSkeleton
} from './components/placeholders.js';
import {
  createProgressIndicator,
  processInParallel,
  cleanupOrphanedProgressIndicators
} from './utils/parallelLoader.js';
import { CleanupManager } from './utils/cleanupManager.js';
import { logger, setupGlobalErrorHandler } from './utils/errorHandler.js';

// Import card-specific modules
import {
  getCardNameFromLocation,
  getCanonicalId,
  getDisplayName,
  parseDisplayName,
  getBaseName
} from './card/identifiers.js';
import { findCard, renderCardPrice, renderCardSets } from './card/data.js';
import { renderChart, renderCopiesHistogram, renderEvents } from './card/charts.js';
import { getCanonicalCard, getCardVariants } from './utils/cardSynonyms.js';

// Show curated suggestions on the card landing view
import './cardsLanding.js';

// Set up global error handling
setupGlobalErrorHandler();

// Create cleanup manager for this page
const pageCleanupManager = new CleanupManager();

// Find canonical identifier for a given search term across all tournaments

// Normalize #grid route to index when landing on card page via hash
const __ROUTE_REDIRECTING = normalizeCardRouteOnLoad();
let cardIdentifier = getCardNameFromLocation();

// Check for synonym redirect early - if this card has a canonical version, redirect to it
if (cardIdentifier) {
  getCanonicalCard(cardIdentifier).then(canonicalIdentifier => {
    if (canonicalIdentifier !== cardIdentifier) {
      // This is a non-canonical card, redirect to canonical version
      console.log(`Redirecting ${cardIdentifier} to canonical version: ${canonicalIdentifier}`);
      const newUrl = `card.html#card/${encodeURIComponent(canonicalIdentifier)}`;
      window.location.replace(newUrl);
    } else {
      // Update cardIdentifier to canonical version for consistency
      // (though in this case they're the same)
      cardIdentifier = canonicalIdentifier;
    }
  }).catch(error => {
    // Continue with original identifier if synonym lookup fails
    console.warn('Synonym lookup failed:', error);
  });
}

const cardName = getDisplayName(cardIdentifier) || cardIdentifier;
const cardTitleEl = document.getElementById('card-title');
if (cardName) {
  const { name, setId } = parseDisplayName(cardName);
  cardTitleEl.innerHTML = '';

  const nameSpan = document.createElement('span');
  nameSpan.textContent = name;
  cardTitleEl.appendChild(nameSpan);

  if (setId) {
    const setSpan = document.createElement('span');
    setSpan.className = 'card-title-set';
    setSpan.textContent = setId;
    cardTitleEl.appendChild(setSpan);
  }
} else {
  cardTitleEl.textContent = 'Card Details';
}

const metaSection = document.getElementById('card-meta');
const decksSection = document.getElementById('card-decks');
const eventsSection = document.getElementById('card-events');
const copiesSection = document.getElementById('card-copies');
const backLink = document.getElementById('back-link');
if (backLink) { backLink.href = 'index.html'; }
const analysisSel = document.getElementById('analysis-event');
const analysisTable = document.getElementById('analysis-table');
const searchInGrid = document.getElementById('search-in-grid');
// These will be set inside initCardSearch to ensure DOM is ready
let cardSearchInput, cardNamesList, suggestionsBox;
// Copy link button removed per request

// When navigating between cards via hash (e.g., from Suggestions), reload to re-init
try {
  pageCleanupManager.addEventListener(window, 'hashchange', () => {
    // Only react if we're on card.html and the hash points to a card route
    if (/^#card\//.test(location.hash)) {
      location.reload();
    }
  });
} catch (error) {
  logger.warn('Failed to set up hash change listener', error);
}

// Link to grid prefilled with search
if (searchInGrid) {
  const href = `index.html?q=${encodeURIComponent(cardName || '')}`;
  searchInGrid.href = href;
}

// No tabs: all content on one page

// Global variables for search functionality
let currentMatches = [];
let selectedIndex = -1;

// Helper functions for card search
function getCachedNames() {
  const SKEY = 'cardNamesUnionV5';
  try {
    return JSON.parse(localStorage.getItem(SKEY) || '{"names":[]}');
  } catch (error) {
    return { names: [] };
  }
}

function saveCachedNames(names) {
  const SKEY = 'cardNamesUnionV5';
  try {
    localStorage.setItem(SKEY, JSON.stringify({ names }));
  } catch (error) {
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
  const MAX = 600;
  const allCards = Array.from(byExactName.values())
    .sort((cardA, cardB) => cardA.display.localeCompare(cardB.display));

  // Clear existing options without parameter reassignment
  const listElement = cardNamesList;
  while (listElement.firstChild) {
    listElement.removeChild(listElement.firstChild);
  }

  const itemsToShow = allCards.slice(0, MAX);
  itemsToShow.forEach(item => {
    listElement.appendChild(createCardOption(item));
  });

  // Update cache
  const namesToCache = itemsToShow.map(cardItem => cardItem.display);
  saveCachedNames(namesToCache);
}

function enrichSuggestions(tournaments, byExactName, updateDatalist, skipFirst = false) {
  // Process tournaments in parallel with limited concurrency for better performance
  const MAX_PARALLEL = 3; // Process max 3 tournaments simultaneously

  const tournamentsToProcess = skipFirst ? tournaments.slice(1) : tournaments;

  // Don't await anything - run everything in background to avoid blocking
  // Process first tournament immediately for quickest feedback
  if (tournamentsToProcess.length > 0 && !skipFirst) {
    processTournament(tournamentsToProcess[0], byExactName).then(added => {
      if (added) {
        updateDatalist();
      }
    }).catch(() => {
      // Silently continue
    });
  }

  // Process remaining tournaments in parallel batches (background)
  const remainingTournaments = skipFirst ? tournamentsToProcess : tournamentsToProcess.slice(1);
  if (remainingTournaments.length > 0) {
    processTournamentBatch(remainingTournaments, byExactName, updateDatalist, MAX_PARALLEL);
  }
}

async function processTournamentBatch(tournaments, byExactName, updateDatalist, maxParallel) {
  // Process tournaments in parallel batches
  for (let i = 0; i < tournaments.length; i += maxParallel) {
    const batch = tournaments.slice(i, i + maxParallel);

    // Process batch in parallel
    const promises = batch.map(tournament => processTournament(tournament, byExactName));
    const results = await Promise.allSettled(promises);

    // Check if any new cards were added
    const hasNewCards = results.some(result => result.status === 'fulfilled' && result.value);

    if (hasNewCards) {
      updateDatalist();
    }
  }
}

async function processTournament(tournament, byExactName) {
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
      } else {
        displayName = item.name;
      }

      // Store all cards: Pokemon with full identifiers, Trainers/Energies with base names
      if (displayName && !byExactName.has(displayName)) {
        byExactName.set(displayName, { display: displayName, uid: canonicalId || displayName });
        added = true;
      }
    }

    return added;
  } catch (error) {
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

    // Fetch tournaments list in background and update later
    fetchTournamentsList().then(fetchedTournaments => {
      if (Array.isArray(fetchedTournaments) && fetchedTournaments.length > 0) {
        tournaments = fetchedTournaments;
        // Re-run enrichment with full tournament list, skip first since already processed
        enrichSuggestions(tournaments, byExactName, updateDatalist, true);
      }
    }).catch(() => {
      // Silently continue with fallback
    });

    // Union cache across tournaments for robust suggestions
    const cached = getCachedNames();
    const byExactName = new Map(); // exact display name -> {display, uid}

    // Seed from cache for instant suggestions
    if (Array.isArray(cached.names) && cached.names.length > 0) {
      cached.names.forEach(cardNameFromCache => {
        if (cardNameFromCache) {
          byExactName.set(cardNameFromCache, { display: cardNameFromCache, uid: cardNameFromCache });
        }
      });
    } else {
      // Fallback: Add common cards for immediate suggestions when no cache exists
      const commonCards = [
        'Boss\'s Orders PAL 172',
        'Ultra Ball SVI 196',
        'Professor\'s Research JTG 155',
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

    const updateDatalist = () => {
      updateCardDatalist(byExactName, cardNamesList);
    };

    updateDatalist();

    // Incrementally enrich suggestions by scanning tournaments sequentially
    enrichSuggestions(tournaments, byExactName, updateDatalist);

    if (cardName) {
      cardSearchInput.value = cardName;
    }

    setupSearchHandlers();
  } catch (error) {
    // Ignore initialization errors
  }
}

// Search helper functions
function getAllNames() {
  return Array.from(cardNamesList?.options || []).map(option => String(option.value || ''));
}

function getUidForName(displayName) {
  const option = Array.from(cardNamesList?.options || [])
    .find(opt => opt.value === displayName);
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
    } else if (lowerName.includes(searchQuery)) {
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
    const tabTarget = (selectedIndex >= 0) ? selectedIndex : 0;
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
    item.dataset.index = matchIndex;

    return item;

    function handleMouseDown(event) {
      event.preventDefault();
      cardSearchInput.value = matches[matchIndex];
      selectedIndex = matchIndex;
      updateSelection(matchIndex);
      cardSearchInput.focus();
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
  cardSearchInput.addEventListener('focus', renderSuggestions);
  cardSearchInput.addEventListener('input', renderSuggestions);

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
    const clean = `${location.origin}${location.pathname.replace(/card\.html$/, 'card.html')}#card/${encodeURIComponent(targetId)}`;
    location.assign(clean);

    setTimeout(() => {
      try {
        location.reload();
      } catch (error) {
        // Ignore reload errors
      }
    }, 0);
  }
  function updateSelection(idx) {
    if (!suggestionsBox) {
      return;
    }

    const items = Array.from(suggestionsBox.children);
    items.forEach((item, itemIndex) => {
      if (itemIndex === idx) {
        item.setAttribute('aria-selected', 'true');
      } else {
        item.removeAttribute('aria-selected');
      }

      // Move tab-indicator to the selected item (update right span)
      const right = item.children && item.children[1];
      if (right) {
        if (itemIndex === idx) {
          right.className = 'tab-indicator';
          right.textContent = 'Tab';
        } else {
          right.className = '';
          right.textContent = '';
        }
      }
    });

    selectedIndex = (idx >= 0 && idx < currentMatches.length) ? idx : -1;
    if (selectedIndex >= 0) {
      // Preview selection into the input so user sees the chosen suggestion
      cardSearchInput.value = currentMatches[selectedIndex];
    }
  }
  cardSearchInput.addEventListener('keydown', handleKeyDown);

  function handleKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      // If user navigated suggestions, pick highlighted; otherwise use input value
      const pick = (selectedIndex >= 0 && currentMatches[selectedIndex])
        ? currentMatches[selectedIndex]
        : cardSearchInput.value.trim();
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
      } else {
        // No selection yet: choose top (or last if shift)
        const idx = event.shiftKey ? (currentMatches.length - 1) : 0;
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
      } else {
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
    if (pick && pick !== cardSearchInput.value) {
      cardSearchInput.value = pick;
      try {
        const end = pick.length;
        cardSearchInput.setSelectionRange(end, end);
      } catch (error) {
        // Ignore selection range errors
      }
      renderSuggestions();
    }
  }
  cardSearchInput.addEventListener('change', handleInputChange);

  function handleInputChange() {
    const inputValue = cardSearchInput.value.trim();
    if (inputValue) {
      goTo(inputValue);
    }
  }
}

// Ensure DOM is ready before initializing search
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCardSearch);
} else {
  initCardSearch();
}

/**
 * Check if a card exists in the Ciphermaniac database
 * @param {string} cardIdentifier - Card identifier to check
 * @returns {Promise<boolean>} Whether the card has a Ciphermaniac page
 */
async function checkCardExistsInDatabase(cardIdentifier) {
  try {
    // First try to fetch cardpool data to check if card exists
    const response = await fetch('/assets/data/deckbuilder-cardpool-with-pages.json');
    if (!response.ok) {
      // If cardpool data fails, assume card exists (fallback to normal behavior)
      return true;
    }

    const cardpool = await response.json();

    // Try to find card by UID or name
    const cardEntry = cardpool.find(card => {
      if (!card) {return false;}

      // Direct UID match
      if (card.uid && card.uid.toLowerCase() === cardIdentifier.toLowerCase()) {
        return true;
      }

      // Name match
      if (card.name && card.name.toLowerCase() === cardIdentifier.toLowerCase()) {
        return true;
      }

      // Display name format match (Name SET NUMBER)
      if (card.uid) {
        const displayName = getDisplayName(card.uid);
        if (displayName && displayName.toLowerCase() === cardIdentifier.toLowerCase()) {
          return true;
        }
      }

      return false;
    });

    if (!cardEntry) {
      // Card not found in TCGMasters pool - assume it might exist in tournament data
      return true;
    }

    // Card found in pool - check if it has a Ciphermaniac page
    return cardEntry.hasCiphermaniacPage === true;
  } catch (error) {
    logger.warn('Failed to check card existence', { cardIdentifier, error: error.message });
    // On error, assume card exists (fallback to normal behavior)
    return true;
  }
}

/**
 * Render a user-friendly error page for missing cards
 * @param {string} cardIdentifier - The card that was requested
 */
async function renderMissingCardPage(cardIdentifier) {
  try {
    // Set proper HTTP status code
    if (typeof history !== 'undefined' && history.replaceState) {
      // This helps with SEO and proper 404 handling
      document.title = `Card Not Found - ${getDisplayName(cardIdentifier) || cardIdentifier} | Ciphermaniac`;
    }

    // Get card details from cardpool if available
    let cardInfo = null;
    let cardImage = null;

    try {
      const response = await fetch('/assets/data/deckbuilder-cardpool-with-pages.json');
      if (response.ok) {
        const cardpool = await response.json();
        cardInfo = cardpool.find(card => {
          if (!card) {return false;}
          return card.uid?.toLowerCase() === cardIdentifier.toLowerCase() ||
                 card.name?.toLowerCase() === cardIdentifier.toLowerCase() ||
                 getDisplayName(card.uid)?.toLowerCase() === cardIdentifier.toLowerCase();
        });

        if (cardInfo && cardInfo.image) {
          cardImage = cardInfo.image;
        }
      }
    } catch (error) {
      logger.debug('Could not fetch card details for missing card page', error);
    }

    // Clear existing content and show error page
    const main = document.querySelector('main');
    if (main) {
      main.innerHTML = `
        <section class="card-404-section">
          <div class="card-404-content">
            <div class="card-404-header">
              <h1>Card Page Not Available</h1>
              <div class="card-404-subtitle">
                ${getDisplayName(cardIdentifier) || cardIdentifier}
              </div>
            </div>
            
            ${cardImage ? `
              <div class="card-404-image">
                <img src="${cardImage}" alt="${getDisplayName(cardIdentifier) || cardIdentifier}" 
                     style="max-width: 300px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
              </div>
            ` : ''}
            
            <div class="card-404-explanation">
              <p>This card exists in the TCGMasters card pool but doesn't have a Ciphermaniac page yet. 
              This means we don't have tournament usage data for this card in our database.</p>
              
              <p>Cards get pages when they appear in tournament results that we've processed. 
              If this card becomes popular in competitive play, its page will be created automatically.</p>
            </div>
            
            <div class="card-404-actions">
              <div class="card-404-suggestions">
                <h3>What you can do:</h3>
                <ul>
                  <li><a href="index.html" class="card-404-link">Browse all cards with data</a></li>
                  <li><a href="index.html?q=${encodeURIComponent(getBaseName(cardIdentifier) || cardIdentifier)}" 
                        class="card-404-link">Search for similar cards</a></li>
                  <li><a href="tools/deckbuilder.html" class="card-404-link">Use the deck builder</a></li>
                  <li><a href="feedback.html" class="card-404-link">Request this card be prioritized</a></li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      `;

      // Add CSS styles for the 404 page
      const style = document.createElement('style');
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
          color: var(--muted, #8b95b8);
          font-size: 1.1rem;
          margin-bottom: 1.5rem;
          font-weight: 500;
        }
        
        .card-404-image {
          margin: 1.5rem 0;
        }
        
        .card-404-explanation {
          text-align: left;
          margin: 1.5rem 0;
          color: var(--text, #ffffff);
          line-height: 1.6;
        }
        
        .card-404-explanation p {
          margin-bottom: 1rem;
        }
        
        .card-404-actions {
          margin-top: 2rem;
          text-align: left;
        }
        
        .card-404-suggestions h3 {
          color: var(--text, #ffffff);
          margin-bottom: 1rem;
          font-size: 1.1rem;
        }
        
        .card-404-suggestions ul {
          list-style: none;
          padding: 0;
        }
        
        .card-404-suggestions li {
          margin: 0.75rem 0;
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

    logger.info('Rendered missing card page', { cardIdentifier });
  } catch (error) {
    logger.error('Failed to render missing card page', { cardIdentifier, error: error.message });
    // Fallback to simple error message
    if (metaSection) {
      metaSection.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text);">Card page not available. This card exists in the TCGMasters pool but doesn\'t have tournament data yet.</div>';
    }
  }
}

async function load() {
  if (!cardIdentifier) { metaSection.textContent = 'Missing card identifier.'; return; }

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
    // Clear any existing skeleton placeholder
    hero.innerHTML = '';

    // Create image element and wrapper
    const img = document.createElement('img');
    img.alt = cardName; img.decoding = 'async'; img.loading = 'eager';
    img.style.opacity = '0'; img.style.transition = 'opacity .18s ease-out';

    const wrap = document.createElement('div');
    wrap.className = 'thumb';
    wrap.appendChild(img);
    hero.appendChild(wrap);
    hero.removeAttribute('aria-hidden');

    // Store image loading state on the element
    img._loadingState = { candidates: [], idx: 0, loading: false };

    const tryNextImage = () => {
      const state = img._loadingState;
      if (state.loading || state.idx >= state.candidates.length) {return;}

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
  const overridesPromise = fetchOverrides();

  // Secondary data that doesn't block initial content
  const cardSetsPromise = renderCardSets(cardName).catch(() => null);
  const cardPricePromise = renderCardPrice(cardIdentifier).catch(() => null);

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
  } catch {
    tournaments = ['2025-08-15, World Championships 2025'];
  }
  if (!Array.isArray(tournaments) || tournaments.length === 0) {
    tournaments = ['2025-08-15, World Championships 2025'];
  }

  // Enhance hero image with overrides when available (non-blocking)
  dataPromises.overrides.then(overrides => {
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
      if (state.idx === 0 || (state.idx >= state.candidates.length && !state.loading)) {
        state.candidates = enhancedCandidates;
        state.idx = 0;
        state.loading = false;

        // Retry with enhanced candidates
        if (state.idx < state.candidates.length && !state.loading) {
          state.loading = true;
          img.src = state.candidates[state.idx++];
        }
      }
    }
  }).catch(() => {
    // Keep default candidates on override failure
  });
  // Simple localStorage cache for All-archetypes stats: key by tournament+card
  const CACHE_KEY = 'metaCacheV1';
  const cache = (() => {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (error) {
      return {};
    }
  })();
  const saveCache = () => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (error) {
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
  const tournamentPromises = recentTournaments.map(async tournamentName => {
    try {
      const ck = `${tournamentName}::${cardIdentifier}`;
      let globalPct = null, globalFound = null, globalTotal = null;
      if (cacheObject[ck]) {
        ({ pct: globalPct, found: globalFound, total: globalTotal } = cacheObject[ck]);
      } else {
        // Get all variants of this card and combine their usage data
        let card = null;
        const hasUID = cardIdentifier && cardIdentifier.includes('::'); // Matches "Name SET NUMBER" pattern

        if (!hasUID) {
          // Try cardIndex for base name lookups (trainers and base Pokemon names)
          try {
            const idx = await fetchCardIndex(tournamentName);
            const baseName = getBaseName(cardIdentifier);
            const matchingKey = Object.keys(idx.cards || {})
              .find(k => k.toLowerCase() === baseName.toLowerCase()) || '';
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
          } catch (error) {
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
              pct: combinedTotal > 0 ? (100 * combinedFound / combinedTotal) : 0
            };
          }
        }
        if (card) {
          globalPct = Number.isFinite(card.pct)
            ? card.pct
            : (card.total ? (100 * card.found / card.total) : 0);
          globalFound = Number.isFinite(card.found) ? card.found : null;
          globalTotal = Number.isFinite(card.total) ? card.total : null;
          const cacheEntry = {
            pct: globalPct,
            found: globalFound,
            total: globalTotal
          };
          // eslint-disable-next-line no-param-reassign
          cacheObject[ck] = cacheEntry;
          saveCache();
        }
      }
      if (globalPct !== null) {
        return { tournament: tournamentName, pct: globalPct, found: globalFound, total: globalTotal };
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
    try { return JSON.parse(localStorage.getItem(PICK_CACHE_KEY) || '{}'); } catch (error) {
      return {};
    }
  })();
  const savePickCache = () => {
    try { localStorage.setItem(PICK_CACHE_KEY, JSON.stringify(pickCache)); } catch (error) {
      // Ignore initialization errors
    }
  };

  async function chooseArchetypeForTournament(tournament) {
    const ck = `${tournament}::${cardIdentifier}`;
    if (pickCache[ck]) {return pickCache[ck];}
    try {
      const list = await fetchArchetypesList(tournament);
      const top8 = await fetchTop8ArchetypesList(tournament);
      const candidates = [];
      const canonical = await getCanonicalCard(cardIdentifier);
      const variants = await getCardVariants(canonical);

      for (const base of list) {
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
            const pct = combinedTotal > 0 ? (100 * combinedFound / combinedTotal) : 0;
            candidates.push({ base, pct, found: combinedFound, total: combinedTotal });
          }
        } catch {/* missing archetype file */}
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
    if (!metaSection) {return;}
    // Clear previous notes
    const oldNotes = metaSection.querySelectorAll('.summary.toggle-note');
    oldNotes.forEach(note => note.remove());
    const totalP = timePoints.length;
    const shown = Math.min(LIMIT, totalP);
    const note = document.createElement('div');
    note.className = 'summary toggle-note';
    note.textContent = `Chronological (oldest to newest). Showing most recent ${shown} of ${totalP}. Limited to 6 tournaments for optimal performance.`;
    metaSection.appendChild(note);
    // Events/decks toggle mirrors chart (attach to eventsSection if present)
    const tableSection = eventsSection || decksSection;
    if (tableSection) {
      const oldNotes2 = tableSection.querySelectorAll('.summary.toggle-note');
      oldNotes2.forEach(note => note.remove());
      const totalR = deckRows.length;
      const shownR = Math.min(LIMIT, totalR);
      const note2 = document.createElement('div');
      note2.className = 'summary toggle-note';
      note2.textContent = `Chronological (oldest to newest). Showing most recent ${shownR} of ${totalR}.`;
      tableSection.appendChild(note2);
    }
  };

  const refresh = () => {
    const chartEl = document.getElementById('card-chart') || metaSection;
    // Show chronological from oldest to newest
    const ptsAll = [...timePoints].reverse();
    const rowsAll = [...deckRows].reverse();
    const pts = showAll ? ptsAll : ptsAll.slice(-LIMIT);
    const rows = showAll ? rowsAll : rowsAll.slice(-LIMIT);
    renderChart(chartEl, pts);
    // Copies histogram from the most recent event in the visible window if available
    if (copiesSection) {
      const latest = rows[rows.length - 1];
      if (latest) {
        // Find overall stats for the same tournament
        (async () => {
          try {
            const canonical = await getCanonicalCard(cardIdentifier);
            const variants = await getCardVariants(canonical);

            const master = await fetchReport(latest.tournament);
            const parsed = parseReport(master);

            // Combine distribution data from all variants
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

                // Combine distribution data
                if (variantCard.dist && Array.isArray(variantCard.dist)) {
                  for (const distEntry of variantCard.dist) {
                    const existing = combinedDist.find(d => d.copies === distEntry.copies);
                    if (existing) {
                      existing.players += distEntry.players || 0;
                    } else {
                      combinedDist.push({ copies: distEntry.copies, players: distEntry.players || 0 });
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
                pct: combinedTotal > 0 ? (100 * combinedFound / combinedTotal) : 0,
                dist: combinedDist.sort((a, b) => a.copies - b.copies)
              };
            }

            if (overall) { renderCopiesHistogram(copiesSection, overall); } else { copiesSection.textContent = ''; }
          } catch { copiesSection.textContent = ''; }
        })();
      } else {
        copiesSection.textContent = '';
      }
    }
    renderEvents(eventsSection || decksSection, rows);
    renderToggles();
    renderAnalysisSelector(eventsWithCard);

    // After initial paint, fill archetype labels for visible rows asynchronously
    // Attach lazy hover handlers for event rows to prefetch and compute archetype label on demand
    const tableContainer = eventsSection || decksSection;
    if (tableContainer && !tableContainer._hoverPrefetchAttached) {
      tableContainer.addEventListener('mouseover', async eventTarget => {
        const rowEl = eventTarget.target && eventTarget.target.closest ? eventTarget.target.closest('.event-row') : null;
        if (!rowEl) {return;}
        const tournamentFromRow = rowEl.dataset.tournament;
        if (!tournamentFromRow) {return;}
        // Prefetch event master if not present
        // await loadTournament(t); // Function not defined - commented out
        // Compute archetype label if missing
        const target = deckRows.find(deckRow => deckRow.tournament === tournamentFromRow);
        if (target && !target.archetype) {
          const label = await chooseArchetypeForTournament(tournamentFromRow);
          if (label) {
            target.archetype = label;
            const eventsToRender = showAll
              ? [...deckRows].reverse()
              : [...deckRows].reverse().slice(-LIMIT);
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
      const pointsToRender = showAll
        ? [...timePoints].reverse()
        : [...timePoints].reverse().slice(-LIMIT);
      renderChart(elementToRender, pointsToRender);
    }, 120);
  });

  // No min-decks selector in UI; default minTotal used in picker
}

function renderAnalysisSelector(events) {
  if (!analysisSel) {return;}
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
    ${Array(5).fill(0).map(() => `
      <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 4px;">
        <div class="skeleton-text medium"></div>
        <div class="skeleton-text small"></div>
        <div class="skeleton-text small"></div>
        <div class="skeleton-text small"></div>
        <div class="skeleton-text small"></div>
        <div class="skeleton-text small"></div>
      </div>
    `).join('')}
  `;

  analysisTable.innerHTML = '';

  // Create enhanced progress indicator positioned within the analysis section
  const progress = createProgressIndicator('Loading Archetype Analysis', [
    'Processing archetype data',
    'Building analysis table'
  ], {
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
      const ci = findCard(parsed.items, cardIdentifier);
      if (ci) { overall = ci; }
    } catch {/* ignore */}

    // Per-archetype distributions using enhanced parallel loading
    const list = await fetchArchetypesList(tournament);

    progress.updateStep(0, 'loading');

    // Use parallel processing utility for better performance
    const archetypeResults = await processInParallel(list, async base => {
      try {
        const archetypeReport = await fetchArchetypeReport(tournament, base);
        const parsedReport = parseReport(archetypeReport);
        const cardInfo = findCard(parsedReport.items, cardIdentifier);

        if (cardInfo) {
          // For high-usage cards (>20%), include single-deck archetypes to show distribution
          const overallItem = overall || {};
          const overallPct = overallItem.total
            ? (100 * overallItem.found / overallItem.total)
            : (overallItem.pct || 0);
          const minSample = overallPct > 20 ? 1 : 2; // Lower threshold for high-usage cards
          if (cardInfo.total >= minSample) {
            const percentage = Number.isFinite(cardInfo.pct) ? cardInfo.pct : (cardInfo.total ? (100 * cardInfo.found / cardInfo.total) : 0);

            // Precompute percent of all decks in archetype by copies
            const copiesPct = numberOfCopies => {
              if (!Array.isArray(cardInfo.dist) || !(cardInfo.total > 0)) { return null; }
              const distribution = cardInfo.dist.find(distItem => distItem.copies === numberOfCopies);
              if (!distribution) { return 0; }
              return 100 * (distribution.players ?? 0) / cardInfo.total;
            };

            return {
              archetype: base.replace(/_/g, ' '),
              pct: percentage,
              found: cardInfo.found,
              total: cardInfo.total,
              c1: copiesPct(1),
              c2: copiesPct(2),
              c3: copiesPct(3),
              c4: copiesPct(4)
            };
          }
        }
        return null;
      } catch {
        return null; // missing archetype
      }
    }, {
      concurrency: 6, // Reasonable limit to avoid overwhelming the server
      onProgress: (processed, total) => {
        progress.updateProgress(processed, total, `${processed}/${total} archetypes processed`);
      }
    });

    // Filter out null results
    const rows = archetypeResults.filter(result => result !== null);
    progress.updateStep(0, 'complete', `Processed ${rows.length} archetypes with data`);
    progress.updateStep(1, 'loading');
    rows.sort((archA, archB) => {
      // Primary sort: actual deck count (found)
      const foundDiff = (archB.found ?? 0) - (archA.found ?? 0);
      if (foundDiff !== 0) {return foundDiff;}

      // Secondary sort: deck popularity (total) when found counts are equal
      const totalDiff = (archB.total ?? 0) - (archA.total ?? 0);
      if (totalDiff !== 0) {return totalDiff;}

      // Tertiary sort: alphabetical by archetype name
      return archA.archetype.localeCompare(archB.archetype);
    });

    // eslint-disable-next-line require-atomic-updates
    analysisTable.innerHTML = '';

    // Overall summary block
    if (overall) {
      const box = document.createElement('div');
      box.className = 'card-sect';
      box.style.margin = '0 0 8px 0';
      const title = document.createElement('div');
      title.className = 'summary';
      const overallPct = (overall.total ? (100 * overall.found / overall.total) : (overall.pct || 0));
      title.textContent = `Overall (All archetypes): Played ${overallPct.toFixed(1)}% of decks`;
      title.title = 'Percentage of all decks in this event that included the card (any copies).';
      box.appendChild(title);
      // 1x-4x list
      const listEl = document.createElement('div');
      listEl.className = 'summary';
      const part = numCopies => {
        if (!overall || !overall.total || !Array.isArray(overall.dist)) {return `${numCopies}x: —`;}
        const distEntry = overall.dist.find(x => x.copies === numCopies);
        const pct = distEntry ? (100 * (distEntry.players || 0) / overall.total) : 0;
        return `${numCopies}x: ${pct.toFixed(1)}%`;
      };
      listEl.textContent = `Copies across all decks — ${[1, 2, 3, 4].map(part).join('  •  ')}`;
      listEl.title = 'For each N, the percent of all decks in this event that ran exactly N copies.';
      box.appendChild(listEl);
      analysisTable.appendChild(box);
    }

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
    tbl.style.width = '100%'; tbl.style.borderCollapse = 'collapse'; tbl.style.background = 'var(--panel)'; tbl.style.border = '1px solid #242a4a'; tbl.style.borderRadius = '8px';
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
      th.style.textAlign = (i > 0 && i < 6) ? 'right' : 'left';
      th.style.padding = '10px 12px';
      th.style.borderBottom = '1px solid #2c335a';
      th.style.color = 'var(--muted)';
      trh.appendChild(th);
    });
    thead.appendChild(trh); tbl.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const rowData of rows) {
      const tableRow = document.createElement('tr');
      const formatValue = value => (value === null ? '—' : `${value.toFixed(1)}%`);
      // Compose archetype cell: bold archetype name + deck count in parentheses
      const archeCount = (rowData.total !== null) ? rowData.total : (rowData.found !== null ? rowData.found : null);
      const firstCell = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = rowData.archetype;
      firstCell.appendChild(strong);
      if (archeCount !== null) { firstCell.appendChild(document.createTextNode(` (${archeCount})`)); }
      firstCell.style.padding = '10px 12px';
      firstCell.style.textAlign = 'left';
      tableRow.appendChild(firstCell);

      const otherValues = [rowData.pct !== null ? `${rowData.pct.toFixed(1)}%` : '—', formatValue(rowData.c1), formatValue(rowData.c2), formatValue(rowData.c3), formatValue(rowData.c4)];
      otherValues.forEach((valueText, valueIndex) => {
        const tableCell = document.createElement('td');
        tableCell.textContent = valueText;
        if (valueIndex === 0) { tableCell.title = 'Played % = (decks with the card / total decks in archetype)'; }
        if (valueIndex >= 1 && valueIndex <= 4) { const numberOfCopies = valueIndex; tableCell.title = `Percent of decks in archetype that ran exactly ${numberOfCopies}x`; }
        tableCell.style.padding = '10px 12px';
        tableCell.style.textAlign = 'right';
        tableRow.appendChild(tableCell);
      });

      tbody.appendChild(tableRow);
    }
    tbl.appendChild(tbody);
    analysisTable.appendChild(tbl);

    progress.updateStep(1, 'complete', `Built table with ${rows.length} archetypes`);
    progress.setComplete(500); // Show for half a second then fade away
  } catch (error) {
    logger.error('Analysis table error:', error);
    // eslint-disable-next-line require-atomic-updates
    analysisTable.textContent = 'Failed to load analysis for this event.';

    // Clean up progress indicator and any orphans
    if (progress && progress.fadeAndRemove) {
      progress.fadeAndRemove();
    }

    // Failsafe cleanup for any lingering progress indicators
    setTimeout(() => {
      cleanupOrphanedProgressIndicators();
    }, 100);
  }
}

if (!__ROUTE_REDIRECTING) {load();}

// Debug utility - expose cleanup function globally for troubleshooting
window.cleanupProgress = () => {
  const elements = document.querySelectorAll('.parallel-loader-progress, [id^="progress-"]');
  logger.debug(`Found ${elements.length} progress indicator(s) to clean up`);

  elements.forEach((element, index) => {
    logger.debug(`Removing progress indicator ${index + 1}: ${element.id || element.className}`);
    element.style.transition = 'opacity 0.3s ease-out';
    element.style.opacity = '0';

    setTimeout(() => {
      if (element.parentNode) {
        element.remove();
        logger.debug(`Successfully removed progress indicator ${index + 1}`);
      }
    }, 300);
  });

  return elements.length;
};
