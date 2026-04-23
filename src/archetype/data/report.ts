import { fetchArchetypeFilterReport, fetchArchetypeSummaryBySuccess } from '../../api.js';
import { isFeatureEnabled } from '../../utils/featureFlags.js';
import { getFilterKey } from '../filters/utils.js';
import { getState } from '../state.js';
import type { FilterDescriptor, FilterResult } from '../types.js';
import { logger } from '../../utils/logger.js';

const VALID_FILTER_OPERATORS = new Set(['=', '<', '<=', '>', '>=', 'any', '']);

function normalizeFilterOperator(operator: string | null): '=' | '<' | '<=' | '>' | '>=' | 'any' | '' | null {
  if (operator === null) {
    return null;
  }
  return VALID_FILTER_OPERATORS.has(operator) ? (operator as '=' | '<' | '<=' | '>' | '>=' | 'any' | '') : null;
}

function toApiFilters(filters: FilterDescriptor[]) {
  return filters.map(filter => ({
    cardId: filter.cardId,
    operator: normalizeFilterOperator(filter.operator),
    count: Number.isFinite(Number(filter.count)) ? Number(filter.count) : null
  }));
}

function canUseArchetypeFilterApi(): boolean {
  return typeof window !== 'undefined' && isFeatureEnabled('useArchetypeFilterApi');
}

function clearRequestController(controller: AbortController): void {
  const state = getState();
  if (state.filterRequestController === controller) {
    state.filterRequestController = null;
  }
}

function createRequestController(): AbortController {
  const state = getState();
  if (state.filterRequestController) {
    state.filterRequestController.abort();
  }
  const controller = new AbortController();
  state.filterRequestController = controller;
  return controller;
}

async function loadFilterCombinationClientSide(filters: FilterDescriptor[]): Promise<FilterResult> {
  const state = getState();
  const { fetchAllDecks, generateReportForFilters, filterDecksBySuccess } = await import(
    '../../utils/clientSideFiltering.js'
  );

  logger.info('Loading decks for client-side filtering', {
    filterCount: filters.length,
    tournament: state.tournament,
    archetypeBase: state.archetypeBase,
    successFilter: state.successFilter
  });

  // Fire both requests in parallel; prefer archetype-specific result
  const [specificResult, fallbackResult] = await Promise.allSettled([
    fetchAllDecks(state.tournament, state.archetypeBase),
    fetchAllDecks(state.tournament)
  ]);

  let decks;
  if (specificResult.status === 'fulfilled') {
    decks = specificResult.value;
    logger.debug('Using archetype-specific decks for filtering', {
      archetype: state.archetypeBase,
      deckCount: decks.length
    });
  } else if (fallbackResult.status === 'fulfilled') {
    decks = fallbackResult.value;
    logger.debug('Falling back to main decks.json for filtering', {
      archetype: state.archetypeBase,
      deckCount: decks.length
    });
  } else {
    throw fallbackResult.reason;
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
}

/**
 * Load or compute the report for a filter combination.
 * @param filters - Active filter descriptors.
 */
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
      if (canUseArchetypeFilterApi()) {
        const controller = createRequestController();
        try {
          const response = await fetchArchetypeFilterReport(
            {
              tournament: state.tournament,
              archetype: state.archetypeBase,
              successFilter: state.successFilter,
              filters: toApiFilters(filters)
            },
            controller.signal
          );
          return {
            deckTotal: Number(response.deckTotal || 0),
            items: Array.isArray(response.items) ? response.items : [],
            raw: response.raw
          };
        } finally {
          clearRequestController(controller);
        }
      }

      return loadFilterCombinationClientSide(filters);
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') {
        logger.debug('Cancelled stale archetype filter request');
        throw error;
      }

      if (canUseArchetypeFilterApi()) {
        logger.warn('API filter report failed; falling back to client-side filtering', {
          message: error instanceof Error ? error.message : String(error)
        });
        return loadFilterCombinationClientSide(filters);
      }

      logger.error('Filter combination loading failed', error);
      state.filterCache.delete(key);
      throw error;
    }
  })();

  state.filterCache.set(key, promise);
  return promise;
}

/**
 * Load the baseline report for the current success filter.
 */
export async function loadSuccessBaseline(): Promise<{ deckTotal: number; items: FilterResult['items'] }> {
  const state = getState();
  if (state.successFilter === 'all') {
    return {
      deckTotal: state.defaultDeckTotal,
      items: state.defaultItems
    };
  }

  if (canUseArchetypeFilterApi()) {
    const summary = await fetchArchetypeSummaryBySuccess(state.tournament, state.archetypeBase);
    const bucket = summary?.[state.successFilter];
    if (bucket && Array.isArray(bucket.items)) {
      return {
        deckTotal: Number(bucket.deckTotal || 0),
        items: bucket.items
      };
    }

    const controller = createRequestController();
    try {
      const response = await fetchArchetypeFilterReport(
        {
          tournament: state.tournament,
          archetype: state.archetypeBase,
          successFilter: state.successFilter,
          filters: []
        },
        controller.signal
      );
      return {
        deckTotal: Number(response.deckTotal || 0),
        items: Array.isArray(response.items) ? response.items : []
      };
    } finally {
      clearRequestController(controller);
    }
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
