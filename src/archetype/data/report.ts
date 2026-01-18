import { getFilterKey } from '../filters/utils.js';
import { getState } from '../state.js';
import type { FilterDescriptor, FilterResult } from '../types.js';
import { logger } from '../../utils/logger.js';

export async function loadFilterCombination(filters: FilterDescriptor[]): Promise<FilterResult> {
  const state = getState();
  const key = getFilterKey(filters, state.successFilter);
  logger.info('loadFilterCombination called', {
    filterCount: filters?.length,
    filters,
    key,
    hasCached: state.filterCache.has(key)
  });

  const cached = state.filterCache.get(key);
  if (cached) {
    logger.debug('Using cached filter result', { key });
    return cached as Promise<FilterResult>;
  }

  const promise = (async () => {
    try {
      const { fetchAllDecks, generateReportForFilters, filterDecksBySuccess } = await import(
        '../../utils/clientSideFiltering.js'
      );

      logger.info('Loading decks for client-side filtering', {
        filterCount: filters.length,
        tournament: state.tournament,
        archetypeBase: state.archetypeBase,
        successFilter: state.successFilter
      });

      let decks;
      try {
        decks = await fetchAllDecks(state.tournament, state.archetypeBase);
        logger.debug('Using archetype-specific decks for filtering', {
          archetype: state.archetypeBase,
          deckCount: decks.length
        });
      } catch {
        decks = await fetchAllDecks(state.tournament);
        logger.debug('Falling back to main decks.json for filtering', {
          archetype: state.archetypeBase,
          deckCount: decks.length
        });
      }

      const eligibleDecks = filterDecksBySuccess(decks, state.successFilter);
      const report = generateReportForFilters(eligibleDecks, state.archetypeBase, filters);

      logger.info('Built filtered report', {
        itemsCount: report.items?.length || 0,
        deckTotal: report.deckTotal,
        filterCount: filters.length,
        successFilter: state.successFilter,
        eligibleDecks: eligibleDecks.length
      });

      return {
        deckTotal: report.deckTotal,
        items: report.items,
        raw: report.raw || { generatedClientSide: true }
      };
    } catch (error) {
      logger.error('Filter combination loading failed', error);
      state.filterCache.delete(key);
      throw error;
    }
  })();

  state.filterCache.set(key, promise);
  return promise;
}

export async function loadSuccessBaseline(): Promise<{ deckTotal: number; items: FilterResult['items'] }> {
  const state = getState();
  if (state.successFilter === 'all') {
    return {
      deckTotal: state.defaultDeckTotal,
      items: state.defaultItems
    };
  }

  const { fetchAllDecks, filterDecksBySuccess, generateReportForFilters } = await import(
    '../../utils/clientSideFiltering.js'
  );

  let decks;

  try {
    decks = await fetchAllDecks(state.tournament, state.archetypeBase);
    logger.debug('Using archetype-specific decks for baseline', {
      archetype: state.archetypeBase,
      deckCount: decks.length
    });
  } catch {
    decks = await fetchAllDecks(state.tournament);
    logger.debug('Falling back to main decks.json for baseline', {
      archetype: state.archetypeBase,
      deckCount: decks.length
    });
  }

  const eligible = filterDecksBySuccess(decks, state.successFilter);
  const report = generateReportForFilters(eligible, state.archetypeBase, []);

  return {
    deckTotal: report.deckTotal,
    items: report.items
  };
}
