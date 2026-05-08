import { fetchReport, fetchTournamentsList } from '../api.js';
import { safeAsync } from '../utils/errorHandler.js';
import { parseReport } from '../parse.js';
import { getStateFromURL, setStateInURL } from '../router.js';
import { logger } from '../utils/logger.js';
import { CONFIG } from '../config.js';
import { hideGridSkeleton, showGridSkeleton } from '../components/placeholders.js';
import { aggregateReports } from '../utils/reportAggregator.js';
import { DataCache } from '../utils/DataCache.js';
import type { Deck, TournamentReport } from '../types/index.js';
import { type AppState, DEFAULT_ONLINE_META } from './state.js';

const deckCache = new Map<string, Promise<Deck[]>>();

export function normalizeArchetypeValue(value: string | null | undefined): string {
  return (value || '').toLowerCase().replace(/_/g, ' ').trim();
}

export async function fetchTournamentDecks(tournament: string): Promise<Deck[]> {
  if (deckCache.has(tournament)) {
    return deckCache.get(tournament)!;
  }
  const loader = (async () => {
    const { fetchAllDecks } = await import('../utils/clientSideFiltering.js');
    return fetchAllDecks(tournament);
  })();
  deckCache.set(tournament, loader);
  return loader;
}

export async function buildDeckReport(
  tournaments: string | string[],
  successFilter: string = 'all',
  archetypeBase: string | string[] | null = null
): Promise<TournamentReport> {
  const { aggregateDecksAsync, filterDecksBySuccess } = await import('../utils/clientSideFiltering.js');
  const selection = Array.isArray(tournaments) ? tournaments : [tournaments];
  const deckLists = await Promise.all(selection.map(tournament => fetchTournamentDecks(tournament)));
  const allDecks = deckLists.flat();
  const successDecks = filterDecksBySuccess(allDecks, successFilter);
  const normalizedTargets = Array.isArray(archetypeBase)
    ? archetypeBase.map(normalizeArchetypeValue).filter(Boolean)
    : archetypeBase
      ? [normalizeArchetypeValue(archetypeBase)]
      : [];
  const archetypeFilter = normalizedTargets.length ? new Set(normalizedTargets) : null;

  const scopedDecks = archetypeFilter
    ? successDecks.filter((deck: Deck) => archetypeFilter.has(normalizeArchetypeValue(deck?.archetype)))
    : successDecks;

  return aggregateDecksAsync(scopedDecks);
}

export function normalizeTournamentSelection(selection: string | string[] | null | undefined): string[] {
  if (!selection) {
    return [];
  }
  const array = Array.isArray(selection) ? selection : [selection];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of array) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export function getArchetypeSourceTournaments(selection: string | string[] | null | undefined): string[] {
  const normalized = normalizeTournamentSelection(selection);
  const physical = normalized.filter(tournament => tournament !== DEFAULT_ONLINE_META);
  if (physical.length > 0) {
    return physical;
  }
  return normalized.includes(DEFAULT_ONLINE_META) ? [DEFAULT_ONLINE_META] : [];
}

export function parseArchetypeQueryParam(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

export async function loadSelectionData(
  selection: string | string[],
  cache: DataCache,
  options: { showSkeleton?: boolean; successFilter?: string; archetypeBase?: string | null } = {}
): Promise<TournamentReport> {
  const { showSkeleton = false, successFilter = 'all', archetypeBase = null } = options;
  const tournaments = normalizeTournamentSelection(selection);

  if (tournaments.length === 0) {
    return { deckTotal: 0, items: [] };
  }

  if (showSkeleton) {
    showGridSkeleton();
  }

  try {
    if (successFilter !== 'all') {
      return buildDeckReport(tournaments, successFilter, archetypeBase);
    }

    const reports = new Array(tournaments.length);
    const pendingFetches: Promise<void>[] = [];

    tournaments.forEach((tournament, index) => {
      const cached = cache.getCachedMaster(tournament);

      if (cached) {
        reports[index] = { deckTotal: cached.deckTotal, items: cached.items };
        return;
      }

      const loader = loadTournamentData(tournament, cache).then(report => {
        reports[index] = report;
      });

      pendingFetches.push(loader);
    });

    if (pendingFetches.length > 0) {
      await Promise.all(pendingFetches);
    }

    const resolvedReports = reports.filter(Boolean);

    if (resolvedReports.length === 1) {
      return resolvedReports[0];
    }

    return aggregateReports(resolvedReports);
  } finally {
    if (showSkeleton) {
      hideGridSkeleton();
    }
  }
}

export function getInitialTournamentSelection(state: AppState): { selection: string[]; needsTournamentList: boolean } {
  const urlState = getStateFromURL();
  const urlSelectionRaw = urlState.tour ? urlState.tour.split('|') : [];
  const normalizedFromUrl = normalizeTournamentSelection(urlSelectionRaw);

  if (normalizedFromUrl.length > 0) {
    return { selection: normalizedFromUrl, needsTournamentList: true };
  }

  if (state.selectedTournaments.length > 0) {
    return { selection: state.selectedTournaments, needsTournamentList: false };
  }

  return { selection: [DEFAULT_ONLINE_META], needsTournamentList: false };
}

export async function loadTournamentList(state: AppState, currentSelection: string[]) {
  const tournaments = await safeAsync(() => fetchTournamentsList(), 'fetching tournaments list', [
    '2025-08-15, World Championships 2025'
  ]);

  const hasOnlineMeta = await safeAsync(
    async () => {
      const response = await fetch(
        `${CONFIG.API.R2_BASE}/reports/${encodeURIComponent(DEFAULT_ONLINE_META)}/master.json`,
        { method: 'HEAD' }
      );
      return response.ok;
    },
    'checking availability of online meta report',
    false
  );

  if (hasOnlineMeta && tournaments) {
    tournaments.unshift(DEFAULT_ONLINE_META);
  }

  let validatedSelection: string[] = [];
  if (tournaments) {
    validatedSelection = currentSelection.filter(value => tournaments.includes(value));
  }

  if (validatedSelection.length === 0 && tournaments) {
    if (tournaments.includes(DEFAULT_ONLINE_META)) {
      validatedSelection = [DEFAULT_ONLINE_META];
    } else if (tournaments.length > 0) {
      validatedSelection = [tournaments[0]];
    }
  }

  state.availableTournaments = tournaments || [];

  const selectionChanged =
    validatedSelection.length !== currentSelection.length ||
    !validatedSelection.every((val, idx) => val === currentSelection[idx]);

  if (selectionChanged) {
    state.selectedTournaments = validatedSelection;
    state.currentTournament = validatedSelection[0] || null;
  }

  const urlState = getStateFromURL();
  if (urlState.tour && tournaments && selectionChanged) {
    const normalizedParam = validatedSelection.join('|');
    const urlSelectionRaw = urlState.tour.split('|');
    const normalizedUrlParam = normalizeTournamentSelection(urlSelectionRaw)
      .filter(value => tournaments.includes(value))
      .join('|');
    if (normalizedUrlParam !== normalizedParam) {
      setStateInURL({ tour: normalizedParam }, { merge: true, replace: true });
    }
  }

  const dropdown = state.ui?.dropdowns?.tournaments;
  if (dropdown && tournaments) {
    dropdown.render(tournaments, selectionChanged ? validatedSelection : currentSelection);
  }

  logger.info(
    `Tournament list loaded, selection: ${(selectionChanged ? validatedSelection : currentSelection).join(', ') || 'None'}`
  );
}

export async function ensureTournamentListLoaded(state: AppState): Promise<void> {
  if (state.availableTournaments.length > 0) {
    return;
  }
  await loadTournamentList(state, state.selectedTournaments);
}

export async function loadTournamentData(
  tournament: string,
  cache: DataCache,
  showSkeletonLoading = false
): Promise<TournamentReport> {
  const cached = cache.getCachedMaster(tournament);
  if (cached) {
    logger.debug(`Using cached data for ${tournament}`);
    return { deckTotal: cached.deckTotal, items: cached.items };
  }

  if (showSkeletonLoading) {
    showGridSkeleton();
  }

  try {
    const data = await fetchReport(tournament);
    const parsed = parseReport(data);
    cache.setCachedMaster(tournament, parsed);
    return parsed;
  } finally {
    if (showSkeletonLoading) {
      hideGridSkeleton();
    }
  }
}
