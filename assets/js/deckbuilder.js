/**
 * Deckbuilder functionality for building Pokemon TCG decks
 * @module Deckbuilder
 */

import {
  fetchTournamentsList,
  fetchReport,
  fetchArchetypesList,
  fetchArchetypeReport
} from './api.js';
import { parseReport } from './parse.js';
import { logger } from './utils/logger.js';
import { getCanonicalCard as _getCanonicalCard } from './utils/cardSynonyms.js';
import {
  validateEvolutionRequirements,
  formatEvolutionWarnings,
  getEvolutionValidationSummary
} from './utils/evolutionValidator.js';

// Deck state
let currentDeck = new Map(); // cardId -> { card, count, order }
let nextCardOrder = 1; // Tracks insertion order
const aceSpecCards = new Set([
  'Awakening Drum', 'Hero\'s Cape', 'Master Ball', 'Maximum Belt', 'Prime Catcher',
  'Reboot Pod', 'Hyper Aroma', 'Scoop Up Cyclone', 'Secret Box', 'Survival Brace',
  'Unfair Stamp', 'Dangerous Laser', 'Neutralization Zone', 'Poke Vital A',
  'Deluxe Bomb', 'Grand Tree', 'Sparkling Crystal', 'Amulet of Hope',
  'Brilliant Blender', 'Energy Search Pro', 'Megaton Blower', 'Miracle Headset',
  'Precious Trolley', 'Scramble Switch', 'Max Rod', 'Treasure Tracker'
]);

// Card database for search
const cardDatabase = new Map(); // displayName -> card data
let tournaments = [];

// DOM elements
let cardSearchInput, cardSuggestions, deckList, deckCountEl, totalCardsEl, aceSpecCountEl;
let categoryFilterSelect;
let tournamentSelect, archetypeSelect, usageThreshold, usageValue, autoFillBtn, archetypePreview;
let importExportModal, deckText, modalTitle;

// Initialize deckbuilder
async function init() {
  // Show warning dialog before allowing access
  const userAccepted = await showWarningDialog();
  if (!userAccepted) {
    // Redirect to LimitlessTCG if user cancels
    window.location.href = 'https://my.limitlesstcg.com/builder';
    return;
  }

  setupDOMElements();
  await loadCardDatabase();
  setupEventListeners();
  updateDeckDisplay();
  loadTournaments();
}

function setupDOMElements() {
  cardSearchInput = document.getElementById('card-search');
  cardSuggestions = document.getElementById('card-suggestions');
  categoryFilterSelect = document.getElementById('category-filter-select');
  deckList = document.getElementById('deck-list');
  deckCountEl = document.getElementById('deck-count');
  totalCardsEl = document.getElementById('total-cards');
  aceSpecCountEl = document.getElementById('ace-spec-count');

  tournamentSelect = document.getElementById('tournament-select');
  archetypeSelect = document.getElementById('archetype-select');
  usageThreshold = document.getElementById('usage-threshold');
  usageValue = document.getElementById('usage-value');
  autoFillBtn = document.getElementById('auto-fill');
  archetypePreview = document.getElementById('archetype-preview');

  importExportModal = document.getElementById('import-export-modal');
  deckText = document.getElementById('deck-text');
  modalTitle = document.getElementById('modal-title');
}

async function loadCardDatabase() {
  try {
    // Load tournaments and build comprehensive card database
    tournaments = await fetchTournamentsList();
    if (!Array.isArray(tournaments) || tournaments.length === 0) {
      tournaments = ['2025-08-15, World Championships 2025'];
    }

    // Process multiple recent tournaments to build card database
    const recentTournaments = tournaments.slice(0, 3);

    for (const tournament of recentTournaments) {
      try {
        const report = await fetchReport(tournament);
        const parsed = parseReport(report);

        parsed.items.forEach(card => {
          // Create display name for the card
          let displayName;
          if (card.set && card.number) {
            displayName = `${card.name} ${card.set} ${card.number}`;
          } else {
            displayName = card.name;
          }

          // Store card data if not already present
          if (!cardDatabase.has(displayName)) {
            cardDatabase.set(displayName, {
              ...card,
              displayName,
              id: card.uid || displayName,
              isAceSpec: aceSpecCards.has(card.name),
              isBasicEnergy: card.set === 'SVE' // Basic Energy from SVE set
            });
          }
        });
      } catch (error) {
        logger.warn(`Failed to load tournament ${tournament}:`, error);
      }
    }

    logger.info(`Loaded ${cardDatabase.size} cards into database`);
  } catch (error) {
    logger.error('Failed to load card database:', error);
  }
}

function loadTournaments() {
  tournamentSelect.innerHTML = '<option value="">Select tournament...</option>';

  tournaments.forEach(tournament => {
    const option = document.createElement('option');
    option.value = tournament;
    option.textContent = tournament;
    tournamentSelect.appendChild(option);
  });
}

function setupEventListeners() {
  // Card search
  cardSearchInput.addEventListener('input', handleCardSearch);
  cardSearchInput.addEventListener('focus', handleCardSearch);
  categoryFilterSelect.addEventListener('change', handleCardSearch);
  document.addEventListener('click', handleClickOutside);

  // Deck management
  document.getElementById('sort-deck').addEventListener('click', sortDeck);
  document.getElementById('clear-deck').addEventListener('click', clearDeck);
  document.getElementById('export-deck').addEventListener('click', () => showImportExportModal('export'));
  document.getElementById('import-deck').addEventListener('click', () => showImportExportModal('import'));

  // Archetype controls
  tournamentSelect.addEventListener('change', loadArchetypes);
  archetypeSelect.addEventListener('change', previewArchetype);
  usageThreshold.addEventListener('input', updateUsageValue);
  autoFillBtn.addEventListener('click', autoFillFromArchetype);

  // Modal controls
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-import').addEventListener('click', importDeck);
  document.getElementById('modal-export').addEventListener('click', exportDeck);
}

function handleCardSearch() {
  const query = cardSearchInput.value.trim().toLowerCase();
  const categoryFilter = categoryFilterSelect.value;

  if (!query) {
    cardSuggestions.classList.remove('is-open');
    return;
  }

  // Find matching cards
  const matches = [];
  for (const [displayName, card] of cardDatabase) {
    // Apply category filter if selected
    if (categoryFilter !== 'all') {
      const cardType = getCardType(card);
      if (cardType !== categoryFilter) {
        continue;
      }
    }

    if (displayName.toLowerCase().includes(query)) {
      matches.push({ displayName, card });
    }
    if (matches.length >= 8) {break;}
  }

  // Render suggestions
  cardSuggestions.innerHTML = '';

  if (matches.length === 0) {
    cardSuggestions.classList.remove('is-open');
    return;
  }

  matches.forEach(({ displayName, card }) => {
    const item = document.createElement('div');
    item.className = 'item';

    // Create category badge if available
    let categoryBadge = '';
    if (card.category) {
      categoryBadge = `<span class="category-badge category-${card.category}">${card.category.charAt(0).toUpperCase() + card.category.slice(1)}</span>`;
    }

    item.innerHTML = `
      <span class="suggestion-name">
        <span class="suggestion-card-name">${displayName}</span>
        ${categoryBadge}
      </span>
      <button class="add-card-btn" data-card-id="${card.id}">Add</button>
    `;

    const addBtn = item.querySelector('.add-card-btn');
    addBtn.addEventListener('click', event => {
      event.preventDefault();
      addCardToDeck(card);
      cardSearchInput.value = '';
      cardSuggestions.classList.remove('is-open');
    });

    cardSuggestions.appendChild(item);
  });

  cardSuggestions.classList.add('is-open');
}

function handleClickOutside(event) {
  if (!cardSuggestions.contains(event.target) && event.target !== cardSearchInput) {
    cardSuggestions.classList.remove('is-open');
  }
}

function addCardToDeck(card, count = 1) {
  const cardId = card.id || card.displayName;

  // Check deck constraints
  if (!canAddCard(card, count)) {
    return;
  }

  if (currentDeck.has(cardId)) {
    const existing = currentDeck.get(cardId);
    const newCount = existing.count + count;

    // Check individual card limit (4 max, except Basic Energy)
    const maxCount = card.isBasicEnergy ? Infinity : 4;
    if (newCount > maxCount) {
      alert(`Cannot add more than ${maxCount} copies of ${card.displayName}`);
      return;
    }

    existing.count = newCount;
  } else {
    // New card - find smart insertion position
    const insertionOrder = findSmartInsertionOrder(card);
    currentDeck.set(cardId, { card, count, order: insertionOrder });
  }

  updateDeckDisplay();
}

function canAddCard(card, count = 1) {
  const totalCards = getTotalCardCount();

  // Check total deck size
  if (totalCards + count > 60) {
    alert('Deck cannot exceed 60 cards');
    return false;
  }

  // Check Ace Spec limit
  if (card.isAceSpec) {
    const currentAceSpecs = getAceSpecCount();
    if (currentAceSpecs + count > 1) {
      alert('Only one Ace Spec card allowed per deck');
      return false;
    }
  }

  return true;
}

function removeCardFromDeck(cardId, count = 1) {
  if (!currentDeck.has(cardId)) {return;}

  const existing = currentDeck.get(cardId);
  existing.count -= count;

  if (existing.count <= 0) {
    currentDeck.delete(cardId);
  }

  updateDeckDisplay();
}

function updateDeckDisplay() {
  const totalCards = getTotalCardCount();
  const aceSpecCount = getAceSpecCount();

  // Validate evolution requirements
  const evolutionWarnings = validateEvolutionRequirements(currentDeck);
  const evolutionSummary = getEvolutionValidationSummary(evolutionWarnings);

  // Update counters
  deckCountEl.textContent = `${totalCards}/60`;
  totalCardsEl.textContent = `${totalCards}/60`;
  aceSpecCountEl.textContent = `${aceSpecCount}/1`;

  // Update constraint colors
  updateConstraintStatus('card-count-constraint', totalCards === 60);
  updateConstraintStatus('ace-spec-constraint', aceSpecCount <= 1);
  updateConstraintStatus('evolution-constraint', evolutionSummary.errors.length === 0);

  // Update deck status
  const deckStatus = document.getElementById('deck-status');
  const hasEvolutionErrors = evolutionSummary.errors.length > 0;
  const hasEvolutionWarnings = evolutionSummary.warnings.length > 0;

  if (totalCards === 60 && aceSpecCount <= 1 && !hasEvolutionErrors) {
    if (hasEvolutionWarnings) {
      deckStatus.textContent = '⚠ Legal (with warnings)';
      deckStatus.className = 'deck-status warning';
    } else {
      deckStatus.textContent = '✓ Legal';
      deckStatus.className = 'deck-status legal';
    }
  } else if (totalCards > 60 || aceSpecCount > 1 || hasEvolutionErrors) {
    deckStatus.textContent = '❌ Illegal';
    deckStatus.className = 'deck-status illegal';
  } else {
    deckStatus.textContent = `Need ${60 - totalCards} more cards`;
    deckStatus.className = 'deck-status incomplete';
  }

  // Render deck list
  renderDeckList();

  // Update evolution validation display
  updateEvolutionDisplay(evolutionWarnings);
}

function updateConstraintStatus(constraintId, isValid) {
  const element = document.getElementById(constraintId);
  if (element) {
    element.classList.toggle('valid', isValid);
    element.classList.toggle('invalid', !isValid);
  }
}

function updateEvolutionDisplay(warnings) {
  const evolutionValidation = document.getElementById('evolution-validation');
  if (!evolutionValidation) {
    return; // Element doesn't exist in the HTML yet
  }

  if (warnings.length === 0) {
    evolutionValidation.innerHTML = `
      <div class="validation-success">
        ✓ No evolution issues found
      </div>
    `;
    evolutionValidation.className = 'evolution-validation success';
  } else {
    const summary = getEvolutionValidationSummary(warnings);
    const formattedWarnings = formatEvolutionWarnings(warnings);

    evolutionValidation.innerHTML = `
      <div class="validation-header">
        Evolution Validation (${summary.errors.length} errors, ${summary.warnings.length} warnings)
      </div>
      <div class="validation-content">
        <pre>${formattedWarnings}</pre>
      </div>
    `;

    evolutionValidation.className = summary.errors.length > 0
      ? 'evolution-validation error'
      : 'evolution-validation warning';
  }
}

function renderDeckList() {
  if (currentDeck.size === 0) {
    deckList.innerHTML = `
      <div class="empty-deck">
        <p>Your deck is empty. Search for cards above to get started!</p>
        <p class="deck-rules">
          <strong>Deckbuilding Rules:</strong><br>
          • Exactly 60 cards required<br>
          • Maximum 4 copies of any card (except Basic Energy)<br>
          • Maximum 1 Ace Spec total<br>
          • Unlimited Basic Energy (SVE set) allowed
        </p>
      </div>
    `;
    return;
  }

  // Group cards by type and preserve user order
  const pokemon = [];
  const trainers = [];
  const energy = [];

  for (const [cardId, { card, count, order }] of currentDeck) {
    const cardType = getCardType(card);
    const entry = { cardId, card, count, order: order || nextCardOrder++ };

    switch (cardType) {
      case 'pokemon': pokemon.push(entry); break;
      case 'energy': energy.push(entry); break;
      default: trainers.push(entry); break;
    }
  }

  // Sort each category by user-defined order
  [pokemon, trainers, energy].forEach(category => {
    category.sort((first, second) => first.order - second.order);
  });

  // Render categories
  let html = '';

  if (pokemon.length > 0) {
    html += '<div class="deck-category"><h4>Pokémon</h4>';
    html += renderCardCategory(pokemon);
    html += '</div>';
  }

  if (trainers.length > 0) {
    html += '<div class="deck-category"><h4>Trainers</h4>';
    html += renderCardCategory(trainers);
    html += '</div>';
  }

  if (energy.length > 0) {
    html += '<div class="deck-category"><h4>Energy</h4>';
    html += renderCardCategory(energy);
    html += '</div>';
  }

  deckList.innerHTML = html;

  // Add event listeners for +/- buttons
  deckList.querySelectorAll('.deck-card-controls button').forEach(button => {
    button.addEventListener('click', event => {
      const { cardId } = event.target.dataset;
      const { action } = event.target.dataset;

      if (action === 'add') {
        const { card } = currentDeck.get(cardId);
        addCardToDeck(card, 1);
      } else if (action === 'remove') {
        removeCardFromDeck(cardId, 1);
      }
    });
  });

  // Add drag and drop event listeners
  deckList.querySelectorAll('.deck-card').forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragover', handleDragOver);
    card.addEventListener('dragenter', handleDragEnter);
    card.addEventListener('dragleave', handleDragLeave);
    card.addEventListener('drop', handleDrop);
    card.addEventListener('dragend', handleDragEnd);
  });
}

function renderCardCategory(cards) {
  return cards.map(({ cardId, card, count, order }) => {
    // Create category badge if available
    let categoryBadge = '';
    if (card.category) {
      categoryBadge = `<span class="category-badge category-${card.category}">${card.category.charAt(0).toUpperCase() + card.category.slice(1)}</span>`;
    }

    return `
      <div class="deck-card" draggable="true" data-card-id="${cardId}" data-order="${order}">
        <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
        <span class="card-count">${count}</span>
        <span class="card-name">
          <span class="deck-card-name">${card.displayName}</span>
          ${categoryBadge}
        </span>
        <div class="deck-card-controls">
          <button data-card-id="${cardId}" data-action="remove" title="Remove one">−</button>
          <button data-card-id="${cardId}" data-action="add" title="Add one">+</button>
        </div>
      </div>
    `;
  }).join('');
}

function getCardType(card) {
  // Use the actual category data if available
  if (card.category) {
    return card.category;
  }

  // Fallback to heuristics for backwards compatibility
  if (card.isBasicEnergy) {return 'energy';}
  if (card.name.includes('Energy')) {return 'energy';}
  if (card.name.includes('ex') || card.name.includes('EX') || card.name.includes('GX') ||
      card.name.includes('V') || card.name.includes('VMAX') || card.name.includes('VSTAR')) {
    return 'pokemon';
  }
  // Simple heuristic: if it has set/number and isn't energy, it's likely pokemon
  if (card.set && card.number && !card.name.includes('Energy')) {
    return 'pokemon';
  }
  return 'trainer';
}

function findSmartInsertionOrder(newCard) {
  const cardType = getCardType(newCard);

  // Group existing cards by type
  const existingCards = Array.from(currentDeck.values());
  const pokemon = existingCards.filter(entry => getCardType(entry.card) === 'pokemon');
  const trainers = existingCards.filter(entry => getCardType(entry.card) === 'trainer');
  const energy = existingCards.filter(entry => getCardType(entry.card) === 'energy');

  let targetOrder;

  if (cardType === 'pokemon') {
    // Find the best position within Pokemon section
    targetOrder = findPokemonInsertionOrder(newCard, pokemon);
  } else if (cardType === 'trainer') {
    // Insert at end of Pokemon, before existing trainers based on quantity
    const pokemonMaxOrder = pokemon.length > 0 ? Math.max(...pokemon.map(pokemonEntry => pokemonEntry.order)) : 0;
    const baseOrder = pokemonMaxOrder + 1000; // Leave space for Pokemon
    targetOrder = findQuantityBasedOrder(newCard, trainers, baseOrder);
  } else { // energy
    // Insert at end, after Pokemon and Trainers
    const pokemonMaxOrder = pokemon.length > 0
      ? Math.max(...pokemon.map(pokemonEntry => pokemonEntry.order))
      : 0;
    const trainerMaxOrder = trainers.length > 0
      ? Math.max(...trainers.map(trainerEntry => trainerEntry.order))
      : pokemonMaxOrder + 1000;
    const baseOrder = Math.max(trainerMaxOrder + 1000, pokemonMaxOrder + 2000);
    targetOrder = findQuantityBasedOrder(newCard, energy, baseOrder);
  }

  return targetOrder;
}

function findPokemonInsertionOrder(newCard, existingPokemon) {
  if (existingPokemon.length === 0) {
    return nextCardOrder++;
  }

  const newEvolutionOrder = getEvolutionOrder(newCard);
  const _newQuantity = 1; // Default quantity when first added

  // Sort existing Pokemon by current display order to maintain user arrangements
  const sortedPokemon = existingPokemon.sort((first, second) => first.order - second.order);

  // Try to find a good position based on evolution line and quantity
  for (let i = 0; i < sortedPokemon.length; i++) {
    const existing = sortedPokemon[i];
    const existingEvolutionOrder = getEvolutionOrder(existing.card);

    // Same evolution line - sort by stage
    if (Math.floor(newEvolutionOrder / 1000) === Math.floor(existingEvolutionOrder / 1000)) {
      if (newEvolutionOrder < existingEvolutionOrder) {
        // Insert before this card (earlier evolution stage)
        return existing.order - 0.5;
      }
      continue; // Keep looking within this evolution line
    }

    // Different evolution line - insert based on alphabetical order of base Pokemon
    if (newEvolutionOrder < existingEvolutionOrder) {
      return existing.order - 0.5;
    }
  }

  // Insert at end of Pokemon section
  const maxPokemonOrder = Math.max(...sortedPokemon.map(pokemonEntry => pokemonEntry.order));
  return maxPokemonOrder + 1;
}

function findQuantityBasedOrder(newCard, existingSameType, baseOrder) {
  if (existingSameType.length === 0) {
    return baseOrder;
  }

  // Sort by current order to preserve user arrangements
  const sorted = existingSameType.sort((first, second) => first.order - second.order);

  // Find position based on similar quantity cards
  const newQuantity = 1; // Default quantity when first added

  for (let i = 0; i < sorted.length; i++) {
    const existing = sorted[i];

    // Insert before lower quantities
    if (newQuantity > existing.count) {
      return existing.order - 0.5;
    }

    // Same quantity - insert alphabetically
    if (newQuantity === existing.count) {
      if (newCard.displayName < existing.card.displayName) {
        return existing.order - 0.5;
      }
    }
  }

  // Insert at end
  const maxOrder = Math.max(...sorted.map(cardEntry => cardEntry.order));
  return maxOrder + 1;
}

function getEvolutionOrder(card) {
  const name = card.name.toLowerCase();

  // Define evolution lines with their stage order
  const evolutionLines = {
    // Gardevoir line
    ralts: { base: 'ralts', stage: 0 },
    kirlia: { base: 'ralts', stage: 1 },
    gardevoir: { base: 'ralts', stage: 2 },
    gallade: { base: 'ralts', stage: 2 },

    // Common evolution lines
    charmander: { base: 'charmander', stage: 0 },
    charmeleon: { base: 'charmander', stage: 1 },
    charizard: { base: 'charmander', stage: 2 },

    squirtle: { base: 'squirtle', stage: 0 },
    wartortle: { base: 'squirtle', stage: 1 },
    blastoise: { base: 'squirtle', stage: 2 },

    bulbasaur: { base: 'bulbasaur', stage: 0 },
    ivysaur: { base: 'bulbasaur', stage: 1 },
    venusaur: { base: 'bulbasaur', stage: 2 },

    caterpie: { base: 'caterpie', stage: 0 },
    metapod: { base: 'caterpie', stage: 1 },
    butterfree: { base: 'caterpie', stage: 2 },

    pidgey: { base: 'pidgey', stage: 0 },
    pidgeotto: { base: 'pidgey', stage: 1 },
    pidgeot: { base: 'pidgey', stage: 2 },

    sprigatito: { base: 'sprigatito', stage: 0 },
    floragato: { base: 'sprigatito', stage: 1 },
    meowscarada: { base: 'sprigatito', stage: 2 },

    fuecoco: { base: 'fuecoco', stage: 0 },
    crocalor: { base: 'fuecoco', stage: 1 },
    skeledirge: { base: 'fuecoco', stage: 2 },

    quaxly: { base: 'quaxly', stage: 0 },
    quaxwell: { base: 'quaxly', stage: 1 },
    quaquaval: { base: 'quaxly', stage: 2 },

    // Add more common evolution lines as needed
    abra: { base: 'abra', stage: 0 },
    kadabra: { base: 'abra', stage: 1 },
    alakazam: { base: 'abra', stage: 2 },

    gastly: { base: 'gastly', stage: 0 },
    haunter: { base: 'gastly', stage: 1 },
    gengar: { base: 'gastly', stage: 2 },

    machop: { base: 'machop', stage: 0 },
    machoke: { base: 'machop', stage: 1 },
    machamp: { base: 'machop', stage: 2 },

    geodude: { base: 'geodude', stage: 0 },
    graveler: { base: 'geodude', stage: 1 },
    golem: { base: 'geodude', stage: 2 },

    magikarp: { base: 'magikarp', stage: 0 },
    gyarados: { base: 'magikarp', stage: 1 },

    dratini: { base: 'dratini', stage: 0 },
    dragonair: { base: 'dratini', stage: 1 },
    dragonite: { base: 'dratini', stage: 2 }
  };

  // Extract the base Pokemon name (remove suffixes like "ex", "V", "VMAX", etc.)
  const baseName = name
    .replace(/\s+(ex|v|vmax|vstar|gx)\b/gi, '')
    .replace(/\s+\w+\s+\d+$/i, '') // Remove set and number
    .trim();

  // Look up the evolution data
  const evolutionData = evolutionLines[baseName];

  if (evolutionData) {
    // Return a composite sort key: base name first, then stage
    // This groups evolution lines together and sorts by stage within each line
    return evolutionData.base.charCodeAt(0) * 1000 + evolutionData.stage;
  }

  // For unknown Pokemon, assume they're Basic (stage 0) and sort by name
  return baseName.charCodeAt(0) * 1000;
}

function getTotalCardCount() {
  let total = 0;
  for (const { count } of currentDeck.values()) {
    total += count;
  }
  return total;
}

function getAceSpecCount() {
  let total = 0;
  for (const { card, count } of currentDeck.values()) {
    if (card.isAceSpec) {
      total += count;
    }
  }
  return total;
}

function sortDeck() {
  if (currentDeck.size === 0) {return;}

  if (!confirm('This will sort your deck by quantity and evolution lines. Continue?')) {
    return;
  }

  // Convert deck to array for sorting
  const deckEntries = Array.from(currentDeck.values());

  // Group by type
  const pokemon = deckEntries.filter(entry => getCardType(entry.card) === 'pokemon');
  const trainers = deckEntries.filter(entry => getCardType(entry.card) === 'trainer');
  const energy = deckEntries.filter(entry => getCardType(entry.card) === 'energy');

  let newOrder = 1;

  // Sort Pokemon by quantity (desc) -> evolution line -> alphabetical
  pokemon.sort((first, second) => {
    if (first.count !== second.count) {
      return second.count - first.count;
    }

    const evolutionOrderA = getEvolutionOrder(first.card);
    const evolutionOrderB = getEvolutionOrder(second.card);

    if (evolutionOrderA !== evolutionOrderB) {
      return evolutionOrderA - evolutionOrderB;
    }

    return first.card.displayName.localeCompare(second.card.displayName);
  });

  // Sort Trainers and Energy by quantity (desc) -> alphabetical
  [trainers, energy].forEach(category => {
    category.sort((first, second) => {
      if (first.count !== second.count) {
        return second.count - first.count;
      }
      return first.card.displayName.localeCompare(second.card.displayName);
    });
  });

  // Assign new order values
  [...pokemon, ...trainers, ...energy].forEach(entry => {
    // eslint-disable-next-line no-param-reassign
    entry.order = newOrder++;
  });

  nextCardOrder = newOrder;
  updateDeckDisplay();
}

function clearDeck() {
  if (currentDeck.size === 0) {return;}

  if (confirm('Are you sure you want to clear the entire deck?')) {
    currentDeck.clear();
    nextCardOrder = 1; // Reset order counter
    updateDeckDisplay();
  }
}

async function loadArchetypes() {
  const tournament = tournamentSelect.value;
  if (!tournament) {
    archetypeSelect.innerHTML = '<option value="">Select archetype...</option>';
    return;
  }

  try {
    const archetypes = await fetchArchetypesList(tournament);
    archetypeSelect.innerHTML = '<option value="">Select archetype...</option>';

    archetypes.forEach(archetype => {
      const option = document.createElement('option');
      option.value = archetype;
      option.textContent = archetype.replace(/_/g, ' ');
      archetypeSelect.appendChild(option);
    });
  } catch (error) {
    logger.error('Failed to load archetypes:', error);
  }
}

async function previewArchetype() {
  const tournament = tournamentSelect.value;
  const archetype = archetypeSelect.value;

  if (!tournament || !archetype) {
    archetypePreview.innerHTML = '';
    return;
  }

  try {
    const report = await fetchArchetypeReport(tournament, archetype);
    const parsed = parseReport(report);
    const threshold = parseInt(usageThreshold.value, 10);

    // Calculate proper usage percentages
    const cards = parsed.items
      .map(card => {
        // Calculate percentage correctly: either use provided pct or calculate from found/total
        const percentage = Number.isFinite(card.pct) && card.pct > 0
          ? card.pct
          : (card.total && card.total > 0 ? (100 * card.found / card.total) : 0);

        return {
          ...card,
          calculatedPct: percentage
        };
      })
      .filter(card => card.calculatedPct >= threshold)
      .sort((first, second) => second.calculatedPct - first.calculatedPct)
      .slice(0, 20); // Top 20 cards

    let html = `<h4>${archetype.replace(/_/g, ' ')} - Cards ≥${threshold}% usage</h4>`;
    html += '<div class="archetype-cards">';

    cards.forEach(card => {
      const displayName = card.set && card.number ?
        `${card.name} ${card.set} ${card.number}` : card.name;

      // Find most common copy count from distribution data
      let mostCommonCopies = '';
      if (Array.isArray(card.dist) && card.dist.length > 0) {
        const sortedDist = card.dist
          .filter(distribution =>
            Number.isFinite(distribution.copies) &&
            distribution.copies >= 1 &&
            distribution.copies <= 6
          )
          .sort((first, second) => (second.players || 0) - (first.players || 0));

        if (sortedDist.length > 0) {
          mostCommonCopies = ` (${sortedDist[0].copies}x)`;
        }
      }

      html += `
        <div class="archetype-card">
          <span class="card-name">${displayName}${mostCommonCopies}</span>
          <span class="card-usage">${card.calculatedPct.toFixed(1)}%</span>
        </div>
      `;
    });

    html += '</div>';
    archetypePreview.innerHTML = html;
  } catch (error) {
    archetypePreview.innerHTML = '<p>Failed to load archetype data.</p>';
    logger.error('Failed to preview archetype:', error);
  }
}

function updateUsageValue() {
  usageValue.textContent = `${usageThreshold.value}%`;
  previewArchetype(); // Update preview when threshold changes
}

async function autoFillFromArchetype() {
  const tournament = tournamentSelect.value;
  const archetype = archetypeSelect.value;
  const threshold = parseInt(usageThreshold.value, 10);

  if (!tournament || !archetype) {
    alert('Please select both a tournament and archetype first.');
    return;
  }

  if (!confirm(`This will clear your current deck and auto-fill with cards from ${archetype.replace(/_/g, ' ')} that have ≥${threshold}% usage. Continue?`)) {
    return;
  }

  try {
    currentDeck.clear();
    nextCardOrder = 1; // Reset order counter

    const report = await fetchArchetypeReport(tournament, archetype);
    const parsed = parseReport(report);

    // Calculate proper usage percentages and get cards above threshold
    const cards = parsed.items
      .map(card => {
        // Calculate percentage correctly: either use provided pct or calculate from found/total
        const percentage = Number.isFinite(card.pct) && card.pct > 0
          ? card.pct
          : (card.total && card.total > 0 ? (100 * card.found / card.total) : 0);

        return {
          ...card,
          calculatedPct: percentage
        };
      })
      .filter(card => card.calculatedPct >= threshold)
      .sort((first, second) => second.calculatedPct - first.calculatedPct);

    let totalCards = 0;
    let aceSpecAdded = false;

    for (const cardData of cards) {
      if (totalCards >= 60) {break;}

      const displayName = cardData.set && cardData.number ?
        `${cardData.name} ${cardData.set} ${cardData.number}` : cardData.name;

      // Find card in our database
      const card = cardDatabase.get(displayName);
      if (!card) {continue;}

      // Skip if Ace Spec and we already have one
      if (card.isAceSpec && aceSpecAdded) {continue;}

      // Determine count based on actual distribution data
      let count;
      if (card.isAceSpec) {
        count = 1;
        aceSpecAdded = true;
      } else if (Array.isArray(cardData.dist) && cardData.dist.length > 0) {
        // Use distribution data to find the most common copy count
        // Sort by player count (descending) to find the most popular copy count
        const sortedDist = cardData.dist
          .filter(distribution =>
            Number.isFinite(distribution.copies) &&
            distribution.copies >= 1 &&
            distribution.copies <= 6 // Allow up to 6 for Basic Energy
          )
          .sort((first, second) => (second.players || 0) - (first.players || 0));

        if (sortedDist.length > 0) {
          // Use the most common copy count (highest player count)
          count = sortedDist[0].copies;

          // Cap non-basic energy cards at 4 copies
          if (!card.isBasicEnergy && count > 4) {
            count = 4;
          }
        } else {
          // Fallback: conservative estimate based on usage
          count = cardData.calculatedPct >= 75 ? 2 : 1;
        }
      } else {
        // No distribution data available - use conservative fallback
        if (card.isBasicEnergy) {
          // Basic energy without distribution data - conservative estimate
          count = Math.max(2, Math.min(4, Math.ceil(cardData.calculatedPct / 30)));
        } else {
          // Regular cards without distribution data - be conservative
          count = cardData.calculatedPct >= 75 ? 2 : 1;
        }
      }

      // Don't exceed 60 cards total
      count = Math.min(count, 60 - totalCards);
      if (count > 0) {
        currentDeck.set(card.id, { card, count, order: nextCardOrder++ });
        totalCards += count;
      }
    }

    updateDeckDisplay();
    alert(`Auto-filled deck with ${totalCards} cards from ${archetype.replace(/_/g, ' ')}`);
  } catch (error) {
    logger.error('Failed to auto-fill from archetype:', error);
    alert('Failed to auto-fill deck. Please try again.');
  }
}

function showImportExportModal(mode) {
  modalTitle.textContent = mode === 'import' ? 'Import Deck List' : 'Export Deck List';

  if (mode === 'export') {
    deckText.value = exportDeckToText();
  } else {
    deckText.value = '';
  }

  importExportModal.hidden = false;
}

function closeModal() {
  importExportModal.hidden = true;
}

function exportDeckToText() {
  if (currentDeck.size === 0) {return '';}

  const lines = [];

  // Sort cards by user-defined order, maintaining categories
  const sortedCards = Array.from(currentDeck.values())
    .map(entry => ({ ...entry, order: entry.order || nextCardOrder++ }))
    .sort((first, second) => {
      const typeA = getCardType(first.card);
      const typeB = getCardType(second.card);

      if (typeA !== typeB) {
        const order = { pokemon: 0, trainer: 1, energy: 2 };
        return order[typeA] - order[typeB];
      }

      // Within same category, sort by user order
      return first.order - second.order;
    });

  for (const { card, count } of sortedCards) {
    lines.push(`${count} ${card.displayName}`);
  }

  return lines.join('\n');
}

function importDeck() {
  const text = deckText.value.trim();
  if (!text) {
    alert('Please paste a deck list to import.');
    return;
  }

  const lines = text.split('\n').map(line => line.trim()).filter(line => line);
  const newDeck = new Map();
  const errors = [];
  let importOrder = 1;

  for (const line of lines) {
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) {
      errors.push(`Invalid format: ${line}`);
      continue;
    }

    const count = parseInt(match[1], 10);
    const cardName = match[2].trim();

    // Find card in database
    const card = cardDatabase.get(cardName);
    if (!card) {
      errors.push(`Card not found: ${cardName}`);
      continue;
    }

    newDeck.set(card.id, { card, count, order: importOrder++ });
  }

  if (errors.length > 0) {
    alert(`Import completed with errors:\n${errors.join('\n')}`);
  }

  currentDeck = newDeck;
  nextCardOrder = importOrder; // Set counter to continue after imported cards
  updateDeckDisplay();
  closeModal();
}

function exportDeck() {
  const text = exportDeckToText();
  if (!text) {
    alert('Deck is empty - nothing to export.');
    return;
  }

  navigator.clipboard.writeText(text).then(() => {
    alert('Deck list copied to clipboard!');
  }).catch(() => {
    // Fallback - select text
    deckText.select();
    alert('Deck list selected. Press Ctrl+C to copy.');
  });
}

// Drag and drop functionality
let draggedElement = null;
const _dragIndicator = null;
let lastDropTarget = null;

function handleDragStart(event) {
  draggedElement = event.currentTarget;
  event.currentTarget.classList.add('dragging');
  // eslint-disable-next-line no-param-reassign
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', event.currentTarget.dataset.cardId);
}

function handleDragOver(event) {
  event.preventDefault();
  // eslint-disable-next-line no-param-reassign
  event.dataTransfer.dropEffect = 'move';

  const targetCard = event.currentTarget;
  if (targetCard !== draggedElement && targetCard.classList.contains('deck-card')) {
    // Clear any existing indicators
    clearDragIndicators();

    // Show visual feedback
    targetCard.classList.add('drag-over');

    // Live reorder: move the dragged element to the new position
    if (lastDropTarget !== targetCard) {
      // Check if both cards are in the same category section
      const draggedCategory = draggedElement.closest('.deck-category');
      const targetCategory = targetCard.closest('.deck-category');

      if (draggedCategory === targetCategory) {
        // Same category - we can reorder
        const container = targetCard.parentNode;
        const allCards = Array.from(container.querySelectorAll('.deck-card'));
        const draggedIndex = allCards.indexOf(draggedElement);
        const targetIndex = allCards.indexOf(targetCard);

        if (draggedIndex !== -1 && targetIndex !== -1) {
          if (draggedIndex < targetIndex) {
            // Moving down - insert after target
            container.insertBefore(draggedElement, targetCard.nextSibling);
          } else {
            // Moving up - insert before target
            container.insertBefore(draggedElement, targetCard);
          }
        }
      }

      lastDropTarget = targetCard;
    }
  }
}

function handleDragEnter(event) {
  event.preventDefault();
}

function handleDragLeave(event) {
  // Only clear visual feedback if we're actually leaving this element (not entering a child)
  if (!event.currentTarget.contains(event.relatedTarget)) {
    event.currentTarget.classList.remove('drag-over');
  }
}

function handleDrop(event) {
  event.preventDefault();
  event.stopPropagation();

  clearDragIndicators();

  // Update the data model to match the new DOM order
  if (draggedElement) {
    updateDeckOrderFromDOM();
  }

  return false;
}

function updateDeckOrderFromDOM() {
  // Get all deck cards in their current DOM order
  const deckCards = Array.from(deckList.querySelectorAll('.deck-card'));

  // Update the order in the data model to match DOM order
  deckCards.forEach((cardElement, index) => {
    const { cardId } = cardElement.dataset;
    const deckEntry = currentDeck.get(cardId);
    if (deckEntry) {
      deckEntry.order = index + 1;
    }
  });

  // Update next card order counter
  nextCardOrder = deckCards.length + 1;
}

function handleDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  clearDragIndicators();
  draggedElement = null;
  lastDropTarget = null;
}

function clearDragIndicators() {
  // Remove all visual feedback classes
  deckList.querySelectorAll('.deck-card').forEach(card => {
    card.classList.remove('drag-over');
  });
}

// Show warning dialog before allowing deck builder access
function showWarningDialog() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white;
      padding: 30px;
      border-radius: 12px;
      max-width: 500px;
      margin: 20px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
      text-align: center;
    `;

    dialog.innerHTML = `
      <h2 style="color: #e74c3c; margin: 0 0 20px 0; font-size: 24px;">⚠️ Alpha Warning</h2>
      <p style="font-size: 16px; line-height: 1.5; margin: 0 0 20px 0; color: #333;">
        This deck builder is in an <strong>unfinished alpha state</strong> and should not be used for competitive play.
      </p>
      <p style="font-size: 16px; line-height: 1.5; margin: 0 0 30px 0; color: #333;">
        We recommend using the <strong>LimitlessTCG deck builder</strong> instead:
      </p>
      <p style="margin: 0 0 30px 0;">
        <a href="https://my.limitlesstcg.com/builder" target="_blank" style="
          display: inline-block;
          background: #3498db;
          color: white;
          padding: 10px 20px;
          text-decoration: none;
          border-radius: 6px;
          font-weight: bold;
        ">Visit LimitlessTCG Deck Builder</a>
      </p>
      <div style="display: flex; gap: 15px; justify-content: center;">
        <button id="warning-ok" style="
          background: #e74c3c;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 6px;
          font-size: 16px;
          cursor: pointer;
          font-weight: bold;
        ">I Understand - Continue Anyway</button>
        <button id="warning-cancel" style="
          background: #95a5a6;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 6px;
          font-size: 16px;
          cursor: pointer;
        ">Take Me to LimitlessTCG</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Handle button clicks
    document.getElementById('warning-ok').onclick = () => {
      document.body.removeChild(overlay);
      resolve(true);
    };

    document.getElementById('warning-cancel').onclick = () => {
      document.body.removeChild(overlay);
      resolve(false);
    };

    // Prevent closing by clicking overlay
    overlay.onclick = event => {
      if (event.target === overlay) {
        event.preventDefault();
      }
    };
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
