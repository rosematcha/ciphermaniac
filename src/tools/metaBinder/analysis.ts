import { fetchDecks, fetchTournamentSummary, getCardPrice } from '../../api.js';
import { analyzeEvents, type BinderDataset, buildBinderDataset } from '../metaBinderData.js';
import { logger } from '../../utils/logger.js';
import { storage } from '../../utils/storage.js';
import {
  type AnalysisEvent,
  type BinderCard,
  type BinderMetrics,
  type BinderMetricsContext,
  type BinderSelections,
  type DeckRecord,
  DEFAULT_ONLINE_META,
  getEffectiveCopies,
  hideError,
  pendingArchetypeSelection,
  setLoading,
  setPendingArchetypeSelection,
  setPendingMessage,
  showError,
  state,
  STORAGE_KEY,
  updateGenerateState
} from './state.js';
import {
  getTotalMetaDecks,
  markBinderDirty,
  renderArchetypeControls,
  renderBinderSections,
  updateStats
} from './ui.js';

export function computeSelectionDecks() {
  if (!state.analysis) {
    state.selectionDecks = 0;
    return;
  }
  const allowed = state.selectedArchetypes.size > 0 ? state.selectedArchetypes : null;
  let count = 0;
  for (const event of state.analysis.events) {
    for (const deck of event.decks) {
      const archetype = deck.canonicalArchetype;
      if (!allowed || (archetype && allowed.has(archetype))) {
        count += 1;
      }
    }
  }
  state.selectionDecks = count;
}

export async function ensureDecksLoaded(tournaments: string[]): Promise<void> {
  const missing = tournaments.filter(name => !state.decksCache.has(name));
  if (!missing.length) {
    return;
  }

  const loaders = missing.map(async tournament => {
    const decks = await fetchDecks(tournament);
    const deckList = Array.isArray(decks) ? (decks as DeckRecord[]) : [];
    state.decksCache.set(tournament, deckList);
    logger.debug('Loaded decks for binder', { tournament, decks: deckList.length });
  });

  await Promise.all(loaders);
}

export function loadSelections(): BinderSelections | null {
  if (!storage.isAvailable) {
    return null;
  }

  try {
    const stored = storage.get(STORAGE_KEY) as Partial<BinderSelections> | null;
    if (!stored || typeof stored !== 'object') {
      return null;
    }
    const tournaments = Array.isArray(stored.tournaments)
      ? stored.tournaments.filter(item => typeof item === 'string')
      : [];
    const archetypes = Array.isArray(stored.archetypes)
      ? stored.archetypes.filter(item => typeof item === 'string')
      : [];
    return { tournaments, archetypes };
  } catch (error) {
    logger.debug('Failed to load binder selections', error);
    return null;
  }
}

export function saveSelections(): void {
  if (!storage.isAvailable) {
    return;
  }
  const payload = {
    tournaments: Array.from(state.selectedTournaments),
    archetypes: Array.from(state.selectedArchetypes)
  };
  storage.set(STORAGE_KEY, payload);
}

export function collectAllCards(sections: BinderDataset['sections']): BinderCard[] {
  const lists: BinderCard[][] = [
    sections.aceSpecs,
    sections.staplePokemon,
    sections.frequentSupporters,
    sections.nicheSupporters,
    sections.stadiums,
    sections.tools,
    sections.frequentItems,
    sections.nicheItems,
    sections.specialEnergy,
    sections.basicEnergy
  ];
  for (const group of sections.archetypePokemon) {
    lists.push(group.cards);
  }
  return lists.flat();
}

export async function computeBinderMetrics(
  binderData: BinderDataset,
  context: BinderMetricsContext
): Promise<BinderMetrics> {
  const allCards = collectAllCards(binderData.sections);
  const unique = new Map<string, { card: BinderCard; quantity: number }>();

  for (const card of allCards) {
    const quantity = getEffectiveCopies(card);
    const priceKey = card.priceKey || (card.set && card.number ? `${card.name}::${card.set}::${card.number}` : null);
    const mapKey = priceKey || card.name;
    if (!unique.has(mapKey)) {
      unique.set(mapKey, { card, quantity });
    } else {
      const entry = unique.get(mapKey);
      if (entry) {
        entry.quantity = Math.max(entry.quantity, quantity);
      }
    }
  }

  const priceEntries = await Promise.all(
    Array.from(unique.values()).map(async entry => {
      const { card, quantity } = entry;
      const lookupId = card.priceKey || (card.set && card.number ? `${card.name}::${card.set}::${card.number}` : null);
      let price: number | null = null;
      if (lookupId) {
        try {
          price = await getCardPrice(lookupId);
        } catch (error) {
          logger.debug('Price lookup failed', {
            id: lookupId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      if (price == null && !lookupId) {
        try {
          price = await getCardPrice(card.name);
        } catch (error) {
          logger.debug('Fallback price lookup failed', {
            name: card.name,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      const numericPrice = typeof price === 'number' ? price : Number(price);
      return {
        quantity,
        price: Number.isFinite(numericPrice) ? numericPrice : null
      };
    })
  );

  let priceTotal = 0;
  let missingPrices = 0;

  for (const entry of priceEntries) {
    if (entry.price == null) {
      missingPrices += 1;
      continue;
    }
    priceTotal += entry.price * entry.quantity;
  }

  const selectedDecks = context.selectedDecks || 0;
  const metaDecks = context.metaDecks || 0;

  return {
    priceTotal,
    missingPrices,
    coverageSelected: selectedDecks ? Math.min(1, binderData.meta.totalDecks / selectedDecks) : 0,
    coverageMeta: metaDecks ? Math.min(1, binderData.meta.totalDecks / metaDecks) : 0
  };
}

// Archetype toggle callback used by UI — must be set by page.ts
let _archetypeToggleCb: ((archetype: string, checked: boolean) => void) | null = null;
export function setArchetypeToggleCallback(cb: (archetype: string, checked: boolean) => void): void {
  _archetypeToggleCb = cb;
}

export async function recomputeFromSelection() {
  setLoading(true);
  hideError();

  try {
    const tournaments = Array.from(state.selectedTournaments);
    if (tournaments.length === 0) {
      state.analysis = null;
      state.selectedArchetypes.clear();
      computeSelectionDecks();
      markBinderDirty();
      renderArchetypeControls(_archetypeToggleCb || (() => {}));
      updateStats();
      renderBinderSections();
      setLoading(false);
      return;
    }

    await ensureDecksLoaded(tournaments);

    const events: AnalysisEvent[] = tournaments.map(tournament => ({
      tournament,
      decks: (state.decksCache.get(tournament) || []).filter(
        deck => state.placementFilter === 0 || (deck.placement !== null && deck.placement <= state.placementFilter)
      )
    }));

    const analysis = analyzeEvents(events);
    const availableArchetypes = new Set<string>(Array.from(analysis.archetypeStats.keys()));

    let nextSelectedArchetypes: Set<string>;
    if (pendingArchetypeSelection) {
      nextSelectedArchetypes = new Set(
        Array.from(pendingArchetypeSelection).filter(archetype => availableArchetypes.has(archetype as string))
      );
      setPendingArchetypeSelection(null);
      if (!nextSelectedArchetypes.size) {
        nextSelectedArchetypes = new Set(availableArchetypes);
      }
    } else {
      nextSelectedArchetypes = new Set(state.selectedArchetypes);
      if (nextSelectedArchetypes.size === 0) {
        nextSelectedArchetypes = new Set(availableArchetypes);
      } else {
        nextSelectedArchetypes = new Set(
          Array.from(nextSelectedArchetypes).filter(archetype => availableArchetypes.has(archetype as string))
        );
        if (!nextSelectedArchetypes.size) {
          nextSelectedArchetypes = new Set(availableArchetypes);
        }
      }
    }

    state.analysis = analysis;
    state.selectedArchetypes = nextSelectedArchetypes;
    state.showAllArchetypes = false;
    computeSelectionDecks();
    markBinderDirty();
    renderArchetypeControls(_archetypeToggleCb || (() => {}));
    updateStats();
    saveSelections();
    setLoading(false);
    updateGenerateState();
  } catch (error) {
    logger.error('Failed to recompute binder', error);
    showError('Unable to generate binder data. Please refresh the page.');
  }
}

export async function generateBinder(): Promise<void> {
  if (state.isLoading || state.isGenerating || !state.analysis || !state.selectedTournaments.size) {
    return;
  }

  try {
    state.isGenerating = true;
    updateGenerateState();
    setPendingMessage('Generating binder layout...');

    const filterSet = state.selectedArchetypes.size > 0 ? new Set(state.selectedArchetypes) : null;
    const binderData = buildBinderDataset(state.analysis, filterSet);
    const metrics = await computeBinderMetrics(binderData, {
      selectedDecks: state.selectionDecks,
      metaDecks: getTotalMetaDecks()
    });

    state.binderData = binderData;
    state.metrics = metrics;
    state.isBinderDirty = false;

    renderBinderSections();
    updateStats();
    updateGenerateState();
  } catch (error) {
    logger.error('Failed to generate binder layout', error);
    showError('Unable to generate binder layout.');
  } finally {
    state.isGenerating = false;
    updateGenerateState();
  }
}

export async function checkOnlineMetaAvailability(): Promise<boolean> {
  try {
    const summary = await fetchTournamentSummary(DEFAULT_ONLINE_META);
    return (summary.deckTotal ?? 0) > 0;
  } catch (error) {
    logger.debug('Online meta availability check failed', error);
    return false;
  }
}
