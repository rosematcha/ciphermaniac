/* eslint-disable no-param-reassign */
/**
 * Reusable card search component with autocomplete
 */
import { fetchReport, fetchTournamentsList } from '../api.js';
import { parseReport } from '../parse.js';
import { buildCardPath } from '../card/routing.js';
import { getCanonicalId, parseDisplayName } from '../card/identifiers.js';
import { logger } from '../utils/logger.js';

interface CardOptionItem {
  display: string;
  uid: string;
}

interface SearchOptions {
  searchInputId: string;
  datalistId: string;
  suggestionsId: string;
  onSelect?: (identifier: string) => void;
  onSubmit?: (value: string) => void;
}

// Global variables for search functionality (per instance if we wanted, but singleton for now is fine as we usually have one per page)
let currentMatches: string[] = [];
let selectedIndex = -1;

// Helper functions for card search
function getCachedNames(): { names: string[] } {
  const SKEY = 'cardNamesUnionV5';
  try {
    return JSON.parse(localStorage.getItem(SKEY) || '{"names":[]}');
  } catch {
    return { names: [] };
  }
}

function saveCachedNames(names: string[]) {
  const SKEY = 'cardNamesUnionV5';
  try {
    localStorage.setItem(SKEY, JSON.stringify({ names }));
  } catch {
    // Ignore storage errors
  }
}

function createCardOption(item: CardOptionItem): HTMLOptionElement {
  const opt = document.createElement('option');
  opt.value = item.display;
  opt.setAttribute('data-uid', item.uid);
  return opt;
}

function updateCardDatalist(byExactName: Map<string, CardOptionItem>, cardNamesList: HTMLDataListElement) {
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

function enrichSuggestions(
  tournaments: string[],
  byExactName: Map<string, CardOptionItem>,
  updateDatalist: () => void,
  processedTournaments: Set<string>
) {
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
    .catch(error => {
      logger.debug('Tournament processing skipped:', error);
    });

  // Process remaining tournaments in parallel batches (background)
  if (rest.length > 0) {
    processTournamentBatch(rest, byExactName, updateDatalist, MAX_PARALLEL, processedTournaments);
  }
}

async function processTournamentBatch(
  tournaments: string[],
  byExactName: Map<string, CardOptionItem>,
  updateDatalist: () => void,
  maxParallel: number,
  processedTournaments: Set<string>
) {
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

async function processTournament(
  tournament: string,
  byExactName: Map<string, CardOptionItem>,
  processedTournaments: Set<string>
): Promise<boolean> {
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
      let displayName: string;
      if (item.set && item.number) {
        displayName = `${item.name} ${item.set} ${item.number}`;
      } else {
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
  } catch (error) {
    logger.debug('Failed to process tournament:', tournament, error);
    return false;
  }
}

export function initCardSearch(options: SearchOptions) {
  try {
    // Get DOM elements when function is called to ensure DOM is ready
    const cardSearchInput = document.getElementById(options.searchInputId) as HTMLInputElement | null;
    const cardNamesList = document.getElementById(options.datalistId) as HTMLDataListElement | null;
    const suggestionsBox = document.getElementById(options.suggestionsId);

    if (!(cardSearchInput && cardNamesList)) {
      return;
    }

    // Use fallback immediately to avoid blocking, fetch in background
    let tournaments = ['2025-08-15, World Championships 2025'];
    const processedTournaments = new Set<string>();

    const byExactName = new Map<string, CardOptionItem>(); // exact display name -> {display, uid}
    let hasLoadedData = false;

    const updateDatalist = () => {
      if (cardNamesList) {
        updateCardDatalist(byExactName, cardNamesList);
      }
    };

    const loadData = () => {
      if (hasLoadedData) {
        return;
      }
      hasLoadedData = true;

      // Fetch tournaments list in background and update later
      fetchTournamentsList()
        .then(fetchedTournaments => {
          if (Array.isArray(fetchedTournaments) && fetchedTournaments.length > 0) {
            tournaments = fetchedTournaments;
            enrichSuggestions(tournaments, byExactName, updateDatalist, processedTournaments);
          }
        })
        .catch(error => {
          logger.debug('Failed to fetch tournaments list:', error);
        });

      // Incrementally enrich suggestions by scanning tournaments sequentially
      enrichSuggestions(tournaments, byExactName, updateDatalist, processedTournaments);
    };

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
    } else {
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

    // Defer data loading until user interaction
    cardSearchInput.addEventListener('focus', loadData, { once: true });
    cardSearchInput.addEventListener('input', loadData, { once: true });

    setupSearchHandlers(cardSearchInput, cardNamesList, suggestionsBox, options);
  } catch (error) {
    logger.debug('Card search initialization failed:', error);
  }
}

function setupSearchHandlers(
  cardSearchInput: HTMLInputElement,
  cardNamesList: HTMLDataListElement,
  suggestionsBox: HTMLElement | null,
  options: SearchOptions
) {
  function getAllNames(): string[] {
    return Array.from(cardNamesList?.options || []).map(option => String(option.value || ''));
  }

  function getUidForName(displayName: string): string {
    const option = Array.from(cardNamesList?.options || []).find(opt => opt.value === displayName);
    return option?.getAttribute('data-uid') || displayName;
  }

  function computeMatches(query: string): string[] {
    const searchQuery = query.trim().toLowerCase();
    if (!searchQuery) {
      return getAllNames().slice(0, 8);
    }

    const allNames = getAllNames();
    const startMatches: string[] = [];
    const containsMatches: string[] = [];

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

  function renderSuggestions() {
    if (!suggestionsBox) {
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
      cardSearchInput?.setAttribute('aria-expanded', 'false');
      cardSearchInput?.removeAttribute('aria-activedescendant');
      return;
    }

    matches.forEach((match, matchIndex) => {
      const item = createSuggestionItem(match, matchIndex, matches);
      suggestionsBox!.appendChild(item);
    });

    suggestionsBox.classList.add('is-open');
    cardSearchInput?.setAttribute('aria-expanded', 'true');
  }

  function createSuggestionItem(match: string, matchIndex: number, matches: string[]) {
    const item = document.createElement('div');
    item.className = 'item';
    item.setAttribute('role', 'option');
    item.id = `suggestion-${matchIndex}`;
    item.setAttribute('tabindex', '-1');

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

    function handleMouseDown(event: MouseEvent) {
      event.preventDefault();
      if (cardSearchInput) {
        cardSearchInput.value = matches[matchIndex];
        selectedIndex = matchIndex;
        updateSelection(matchIndex);
        cardSearchInput?.focus();
      }
    }

    function handleClick(event: MouseEvent) {
      event.preventDefault();
      selectedIndex = matchIndex;
      goTo(matches[matchIndex]);
    }

    function handleDoubleClick(event: MouseEvent) {
      event.preventDefault();
      selectedIndex = matchIndex;
      goTo(matches[matchIndex]);
    }
  }

  if (cardSearchInput) {
    // Set up ARIA attributes for combobox pattern
    cardSearchInput.setAttribute('role', 'combobox');
    cardSearchInput.setAttribute('aria-autocomplete', 'list');
    cardSearchInput.setAttribute('aria-haspopup', 'listbox');
    cardSearchInput.setAttribute('aria-expanded', 'false');
    if (suggestionsBox) {
      cardSearchInput.setAttribute('aria-controls', suggestionsBox.id || options.suggestionsId);
    }

    cardSearchInput.addEventListener('focus', renderSuggestions);
    cardSearchInput.addEventListener('input', renderSuggestions);
    cardSearchInput.addEventListener('keydown', handleKeyDown);
    cardSearchInput.addEventListener('change', handleInputChange);
  }

  document.addEventListener('click', handleDocumentClick);

  function handleDocumentClick(event: MouseEvent) {
    if (!suggestionsBox) {
      return;
    }
    if (!suggestionsBox.contains(event.target as Node) && event.target !== cardSearchInput) {
      suggestionsBox.classList.remove('is-open');
      cardSearchInput?.setAttribute('aria-expanded', 'false');
      cardSearchInput?.removeAttribute('aria-activedescendant');
    }
  }

  function goTo(identifier: string) {
    if (!identifier) {
      return;
    }

    if (options.onSelect) {
      options.onSelect(identifier);
      return;
    }

    // Default behavior: navigate to card page
    const targetId = getUidForName(identifier) || identifier;
    location.assign(buildCardPath(targetId));
  }

  function updateSelection(idx: number) {
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

    selectedIndex = idx >= 0 && idx < currentMatches.length ? idx : -1;
    if (selectedIndex >= 0 && cardSearchInput) {
      // Preview selection into the input so user sees the chosen suggestion
      cardSearchInput.value = currentMatches[selectedIndex];
      // Update aria-activedescendant for screen readers
      cardSearchInput.setAttribute('aria-activedescendant', `suggestion-${selectedIndex}`);
    } else {
      cardSearchInput?.removeAttribute('aria-activedescendant');
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      // If user navigated suggestions, pick highlighted
      if (selectedIndex >= 0 && currentMatches[selectedIndex]) {
        event.preventDefault();
        goTo(currentMatches[selectedIndex]);
        return;
      }

      // If no suggestion selected, let the custom onSubmit handle it, or default behavior
      if (options.onSubmit) {
        // If onSubmit is provided, we might want to prevent default form submission if it's not a form submit
        // But here we want to allow form submission if it's just text.
        // However, if the user explicitly wants to handle it (e.g. single page app nav), they can.
        // For the home page, we want the form to submit naturally if no suggestion is selected.
        // So we do NOTHING here if selectedIndex is -1.
        // UNLESS options.onSubmit is explicitly provided to override.
        options.onSubmit(cardSearchInput.value);
        return;
      }

      // If no onSubmit provided, and no suggestion selected:
      // Default legacy behavior
      event.preventDefault();
      goTo(cardSearchInput.value.trim());
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
      cardSearchInput?.setAttribute('aria-expanded', 'false');
      cardSearchInput?.removeAttribute('aria-activedescendant');
      selectedIndex = -1;
      currentMatches = [];
    }
  }

  function handleTabCompletion(pick: string) {
    if (pick && cardSearchInput && pick !== cardSearchInput.value) {
      cardSearchInput.value = pick;
      try {
        const end = pick.length;
        cardSearchInput.setSelectionRange(end, end);
      } catch {
        // Ignore selection range errors
      }
      renderSuggestions();
    }
  }

  function handleInputChange() {
    // Only trigger navigation on change if it's not a result of typing (which is handled by input/keydown)
    // I'll wrap it in `if (!options.onSubmit)` to preserve legacy behavior only if no custom submit handler is present.
    if (!options.onSubmit) {
      const inputValue = cardSearchInput?.value.trim();
      if (inputValue) {
        goTo(inputValue);
      }
    }
  }
}
