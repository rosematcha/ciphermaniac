import { fetchTrendReport } from '../api.js';
import { fetchAllDecks } from '../utils/clientSideFiltering.js';
import { buildCardTrendDataset, buildTrendDataset, type TrendDataset } from '../utils/trendAggregator.js';
import { logger } from '../utils/logger.js';
import type { Deck, TrendReport } from '../types/index.js';
import { elements, state, TRENDS_SOURCE } from './state';
import { normalizeLookupKey } from './aggregator';
import { renderMetaChart } from './charts/metaChart';
import { renderCardMovers } from './charts/movers';
import { renderList } from './charts/seriesCard';
import type { TrendTournament } from './types';

function normalizeTrendReport(report: TrendReport): TrendDataset {
  return {
    generatedAt: report.generatedAt,
    windowStart: report.windowStart,
    windowEnd: report.windowEnd,
    minAppearances: report.minAppearances,
    deckTotal: report.deckTotal,
    tournamentCount: report.tournamentCount,
    archetypeCount: report.archetypeCount,
    tournaments: (report.tournaments || []).map(tournament => ({
      id: tournament.id,
      name: tournament.name,
      date: tournament.date,
      deckTotal: typeof tournament.deckTotal === 'number' ? tournament.deckTotal : 0
    })),
    series: report.series.map(series => ({
      ...series,
      timeline: series.timeline.map(point => ({
        tournamentId: point.date || '',
        tournamentName: point.date || '',
        date: point.date || null,
        decks: typeof point.decks === 'number' ? point.decks : 0,
        success: (point as { success?: Record<string, number> }).success || {},
        totalDecks: point.totalDecks,
        share: typeof point.share === 'number' ? point.share : 0
      }))
    }))
  };
}

function deriveTournamentsFromDecks(decks: Deck[] | null | undefined): TrendTournament[] {
  const map = new Map<string, TrendTournament>();
  (Array.isArray(decks) ? decks : []).forEach(deck => {
    const tournamentId = deck?.tournamentId;
    if (!tournamentId) {
      return;
    }
    if (!map.has(tournamentId)) {
      map.set(tournamentId, {
        id: tournamentId,
        name: deck?.tournamentName || 'Unknown Tournament',
        date: deck?.tournamentDate || '',
        players: deck?.tournamentPlayers || null,
        format: deck?.tournamentFormat || null,
        platform: deck?.tournamentPlatform || null,
        organizer: deck?.tournamentOrganizer || null
      });
    }
  });
  return Array.from(map.values()).sort((a, b) => Date.parse(a.date || '') - Date.parse(b.date || ''));
}

export function updateMinSliderBounds(): void {
  const { minSlider } = elements;
  const { minValue } = elements;

  if (!minSlider || !minValue) {
    return;
  }
  const tournamentCount = state.trendData?.tournamentCount || Number(minSlider.max) || 8;
  const requiredMin = Math.max(1, Math.floor(tournamentCount / 2));
  const max = Math.max(requiredMin, tournamentCount);
  state.minAppearances = requiredMin;
  minSlider.max = String(max);
  minSlider.value = String(requiredMin);
  minSlider.disabled = true;
  minValue.textContent = `${requiredMin}+ (auto)`;
}

export async function loadArchetypeThumbnails(): Promise<void> {
  if (state.thumbIndexLoading || state.archetypeThumbnails.size) {
    return;
  }
  state.thumbIndexLoading = true;
  try {
    const response = await fetch('/assets/data/archetype-thumbnails.json', { cache: 'force-cache' });
    if (!response.ok) {
      return;
    }
    const data = (await response.json()) as Record<string, string[]>;
    const nextMap = new Map<string, string[]>();
    Object.entries(data || {}).forEach(([name, cards]) => {
      const key = normalizeLookupKey(name);
      if (!key || !Array.isArray(cards)) {
        return;
      }
      nextMap.set(key, cards.filter(Boolean));
    });
    state.archetypeThumbnails = nextMap;
    if (state.trendData) {
      renderMetaChart();
      renderCardMovers(state.cardTrends);
    }
  } catch (error) {
    logger.warn('Unable to load archetype thumbnails for trends media', { message: error?.message || error });
  } finally {
    state.thumbIndexLoading = false;
  }
}

export async function hydrateFromDecks() {
  if (!state.trendData) {
    return;
  }
  try {
    state.isHydrating = true;
    const decks = await fetchAllDecks(TRENDS_SOURCE);
    const tournaments = deriveTournamentsFromDecks(decks);

    state.rawDecks = decks;
    state.rawTournaments = tournaments;

    const recomputed = buildTrendDataset(decks, tournaments, {
      minAppearances: 1,
      windowStart: state.trendData.windowStart,
      windowEnd: state.trendData.windowEnd,
      successFilter: state.performanceFilter
    });
    const cardTrends = buildCardTrendDataset(decks, tournaments, { minAppearances: 2, topCount: 72 });
    state.trendData = { ...recomputed };
    state.cardTrends = cardTrends;
    updateMinSliderBounds();
    renderMetaChart();
    renderCardMovers(state.cardTrends);
    renderList();
  } catch (error) {
    logger.error('Failed to recompute trends from decks', { message: error?.message || error });
  } finally {
    state.isHydrating = false;
  }
}

export function rebuildWithFilter() {
  if (!state.rawDecks || !state.rawTournaments) {
    hydrateFromDecks();
    return;
  }

  const recomputed = buildTrendDataset(state.rawDecks, state.rawTournaments, {
    minAppearances: 1,
    windowStart: state.trendData?.windowStart,
    windowEnd: state.trendData?.windowEnd,
    successFilter: state.performanceFilter
  });

  state.trendData = { ...recomputed };
  updateMinSliderBounds();
  renderMetaChart();
  renderList();
}

export async function init() {
  if (state.isLoading) {
    return;
  }
  loadArchetypeThumbnails();
  setLoading(true);
  try {
    const payload = await fetchTrendReport(TRENDS_SOURCE);
    const trendReport =
      (payload?.trendReport ? normalizeTrendReport(payload.trendReport) : null) ||
      (payload && 'series' in payload ? (payload as unknown as TrendDataset) : null) ||
      null;
    state.trendData = trendReport;
    state.cardTrends = payload?.cardTrends || null;
    updateMinSliderBounds();
    renderMetaChart();
    renderCardMovers(state.cardTrends);
    renderList();
  } catch (error) {
    logger.warn('Failed to load pre-generated trends, falling back to decks', {
      message: error?.message || error
    });
    try {
      const decks = await fetchAllDecks(TRENDS_SOURCE);
      const fallbackTournaments = deriveTournamentsFromDecks(decks);

      state.rawDecks = decks;
      state.rawTournaments = fallbackTournaments;

      const archetypeTrends = buildTrendDataset(decks, fallbackTournaments, {
        minAppearances: 1,
        successFilter: state.performanceFilter
      });
      const cardTrends = buildCardTrendDataset(decks, fallbackTournaments, { minAppearances: 2, topCount: 72 });
      state.trendData = archetypeTrends;
      state.cardTrends = cardTrends;
      updateMinSliderBounds();
      renderMetaChart();
      renderCardMovers(state.cardTrends);
      renderList();
    } catch (fallbackError) {
      logger.error('Failed to load any trend data', {
        message: fallbackError?.message || fallbackError
      });
    }
  } finally {
    setLoading(false);
  }
}

function setLoadingMeta(isLoading: boolean): void {
  if (!elements.loadingMeta) {
    return;
  }
  elements.loadingMeta.style.display = isLoading ? 'block' : 'none';
}

function setLoadingArchetypes(isLoading: boolean): void {
  if (!elements.loadingArch) {
    return;
  }
  elements.loadingArch.style.display = isLoading ? 'block' : 'none';
}

export function setLoading(isLoading: boolean): void {
  state.isLoading = isLoading;
  setLoadingMeta(isLoading);
  setLoadingArchetypes(isLoading);
}
