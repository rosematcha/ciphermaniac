import { buildThumbCandidates } from '../thumbs.js';
import { palette, state } from './state';
import type {
  CardTrendMover,
  DisplayCardMover,
  MetaChart,
  MetaLine,
  NormalizedCardMover,
  TrendSharePoint,
  TrendTimelinePoint
} from './types';
import type { TrendDataset } from '../utils/trendAggregator.js';

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'unknown date';
  }
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatPercent(value: number): string {
  const pct = Math.round(value * 10) / 10;
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
}

export function formatSignedPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const normalized = Math.abs(rounded) < 0.05 ? 0 : rounded;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized.toFixed(Math.abs(normalized) % 1 === 0 ? 0 : 1)}%`;
}

export function normalizeLookupKey(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function buildFallbackLabel(value: string, maxWords = 2): string {
  const parts = value.replace(/_/g, ' ').split(/\s+/u).filter(Boolean).slice(0, maxWords);
  if (!parts.length) {
    return '?';
  }
  return parts.map(part => part[0]?.toUpperCase() || '').join('');
}

export function buildArchetypeHref(name: string): string {
  return `/${name.replace(/\s+/g, '_')}`;
}

export function buildCardHref(card: NormalizedCardMover): string {
  if (card.set && card.number) {
    return `/card/${encodeURIComponent(card.set)}~${encodeURIComponent(card.number)}`;
  }
  return `/cards?q=${encodeURIComponent(card.name)}`;
}

export function normalizeCardMover(item: CardTrendMover): NormalizedCardMover {
  const latest =
    item.recentAvg ?? item.latest ?? item.endShare ?? item.currentShare ?? item.avgShare ?? item.startShare ?? 0;
  const start = item.startAvg ?? item.startShare ?? 0;

  // For cooling cards, absDrop is reported as positive; convert to negative for UI consistency.
  const delta =
    item.absDrop !== undefined && item.absDrop !== null ? -Math.abs(item.absDrop) : (item.deltaAbs ?? item.delta ?? 0);

  return {
    name: item.name,
    set: item.set || null,
    number: item.number || null,
    latest,
    start,
    delta
  };
}

export function parseSetNumber(value: string | null | undefined): { set: string; number: string } | null {
  if (!value) {
    return null;
  }
  const [setRaw, numberRaw] = value.split('/');
  const set = String(setRaw || '').trim();
  const number = String(numberRaw || '').trim();
  if (!set || !number) {
    return null;
  }
  return { set, number };
}

export function getArchetypeThumbUrl(archetypeName: string): string | null {
  const normalized = normalizeLookupKey(archetypeName);
  if (!normalized || !state.archetypeThumbnails.size) {
    return null;
  }

  const direct = state.archetypeThumbnails.get(normalized);
  const candidates =
    direct ||
    Array.from(state.archetypeThumbnails.entries()).find(
      ([key]) => normalized.includes(key) || key.includes(normalized)
    )?.[1] ||
    null;

  const firstCard = parseSetNumber(candidates?.[0] || null);
  if (!firstCard) {
    return null;
  }
  return buildThumbCandidates(archetypeName, false, undefined, firstCard)[0] || null;
}

export function getCardThumbUrl(card: NormalizedCardMover): string | null {
  if (!card.set || !card.number) {
    return null;
  }
  return buildThumbCandidates(card.name, false, undefined, { set: card.set, number: card.number })[0] || null;
}

export function createMoverMedia(name: string, mediaUrl: string | null): HTMLElement {
  const media = document.createElement('span');
  media.className = 'mover-media';
  if (mediaUrl) {
    const img = document.createElement('img');
    img.src = mediaUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    media.appendChild(img);
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'mover-media-fallback';
    fallback.textContent = buildFallbackLabel(name);
    media.appendChild(fallback);
  }
  return media;
}

export function smoothSeries(series: TrendSharePoint[], window = 3): TrendSharePoint[] {
  if (!Array.isArray(series) || series.length === 0) {
    return series;
  }
  const windowSize = Math.max(1, window);
  const result: TrendSharePoint[] = [];
  for (let i = 0; i < series.length; i += 1) {
    const slice = series.slice(
      Math.max(0, i - Math.floor(windowSize / 2)),
      Math.min(series.length, i + Math.ceil(windowSize / 2) + 1)
    );
    const avg = slice.reduce((sum, point) => sum + (point.share || 0), 0) / slice.length;
    result.push({ ...series[i], share: avg });
  }
  return result;
}

export function binDaily(timeline: TrendTimelinePoint[]): TrendSharePoint[] {
  const byDay = new Map<string, { decks: number; totalDecks: number }>();
  (timeline || []).forEach(point => {
    if (!point?.date) {
      return;
    }
    const day = point.date.split('T')[0];
    const totalDecks = Number(point.totalDecks || point.total || 0);
    const fallbackTotal = totalDecks > 0 ? totalDecks : 1;
    const explicitDecks = Number((point as { decks?: number }).decks);
    const share = Number(point.share) || 0;
    const decks = Number.isFinite(explicitDecks) && explicitDecks >= 0 ? explicitDecks : (share / 100) * fallbackTotal;
    if (!byDay.has(day)) {
      byDay.set(day, { decks: 0, totalDecks: 0 });
    }
    const entry = byDay.get(day);
    if (!entry) {
      return;
    }
    entry.decks += decks;
    entry.totalDecks += fallbackTotal;
  });
  return Array.from(byDay.entries())
    .map(([date, val]) => ({
      date,
      decks: val.decks,
      totalDecks: val.totalDecks,
      share: val.totalDecks ? (val.decks / val.totalDecks) * 100 : 0
    }))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

export function buildMetaLines(
  trendData: TrendDataset | null,
  topN = 8,
  timeRangeDays = 30,
  minAppearances = 1
): MetaChart | null {
  if (!trendData || !Array.isArray(trendData.series)) {
    return null;
  }

  // Calculate cutoff date for time filtering
  const anchor = trendData.windowEnd ? new Date(trendData.windowEnd) : new Date();
  const anchorMs = Number.isFinite(anchor.getTime()) ? anchor.getTime() : Date.now();
  const cutoffDate = new Date(anchorMs - timeRangeDays * 24 * 60 * 60 * 1000);
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

  // OPTIMIZATION: Single pass to compute bins, collect dates, and calculate ranking data
  const allDatesSet = new Set<string>();
  const allSeriesWithBins: Array<{
    displayName?: string;
    base: string;
    rawDaily: TrendSharePoint[];
    daily: TrendSharePoint[];
    dailyByDate: Map<string, TrendSharePoint>;
    windowShare: number;
    latestPointShare: number;
    startShare: number;
    endShare: number;
  }> = [];

  for (const entry of trendData.series) {
    if (entry.appearances && entry.appearances < minAppearances) {
      continue;
    }

    const daily = binDaily(entry.timeline || []);
    // Filter by time range
    const filteredDaily = daily.filter(pt => pt.date >= cutoffDateStr);
    const smoothed = smoothSeries(filteredDaily, 3);

    if (smoothed.length === 0) {
      continue;
    }

    // Collect dates in the same pass
    for (const pt of smoothed) {
      if (pt.date) {
        allDatesSet.add(pt.date);
      }
    }

    // Pre-build Map for O(1) lookups later
    const dailyByDate = new Map(smoothed.map(pt => [pt.date, pt]));
    const windowTotalDecks = filteredDaily.reduce((sum, point) => sum + (Number(point.totalDecks) || 0), 0);
    const windowDecks = filteredDaily.reduce((sum, point) => sum + (Number(point.decks) || 0), 0);
    const fallbackWindowShare = filteredDaily.length
      ? filteredDaily.reduce((sum, point) => sum + (Number(point.share) || 0), 0) / filteredDaily.length
      : 0;
    const windowShare = windowTotalDecks > 0 ? (windowDecks / windowTotalDecks) * 100 : fallbackWindowShare;
    const latestPointShare = smoothed.at(-1)?.share ?? 0;

    allSeriesWithBins.push({
      ...entry,
      rawDaily: filteredDaily,
      daily: smoothed,
      dailyByDate,
      windowShare,
      latestPointShare,
      startShare: 0,
      endShare: 0
    });
  }

  // Get all unique dates sorted
  const allDates = Array.from(allDatesSet)
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b));

  if (!allDates.length) {
    return null;
  }

  // Calculate start and end date windows
  const windowSize = Math.max(1, Math.ceil(allDates.length * 0.3));
  const startDates = new Set(allDates.slice(0, windowSize));
  const endDates = new Set(allDates.slice(-windowSize));

  // OPTIMIZATION: Calculate ranking data using cached dailyByDate Map
  for (const entry of allSeriesWithBins) {
    let startDecks = 0;
    let startTotalDecks = 0;
    let endDecks = 0;
    let endTotalDecks = 0;

    for (const pt of entry.rawDaily) {
      const decks = Number(pt.decks) || 0;
      const totalDecks = Number(pt.totalDecks) || 0;
      if (startDates.has(pt.date)) {
        startDecks += decks;
        startTotalDecks += totalDecks;
      }
      if (endDates.has(pt.date)) {
        endDecks += decks;
        endTotalDecks += totalDecks;
      }
    }

    entry.startShare = startTotalDecks ? (startDecks / startTotalDecks) * 100 : 0;
    entry.endShare = endTotalDecks ? (endDecks / endTotalDecks) * 100 : 0;
  }

  // Rank by weighted share across the selected window
  const ranked = [...allSeriesWithBins]
    .filter(series => series.windowShare > 0.05)
    .sort((a, b) => b.windowShare - a.windowShare || b.latestPointShare - a.latestPointShare);

  const selectedSeries = ranked.slice(0, topN);

  if (!selectedSeries.length) {
    return null;
  }

  // Build timeline dates from selected series only
  const timelineDatesSet = new Set<string>();
  for (const entry of selectedSeries) {
    for (const pt of entry.daily) {
      if (pt.date) {
        timelineDatesSet.add(pt.date);
      }
    }
  }

  const timelineDates = Array.from(timelineDatesSet).sort((a, b) => Date.parse(a) - Date.parse(b));

  // Build lines using pre-computed dailyByDate Map
  const lines: MetaLine[] = selectedSeries.map((entry, index) => {
    const color = palette[index % palette.length];
    const points = timelineDates.map(d => entry.dailyByDate.get(d)?.share ?? 0);
    const delta = Math.round((entry.endShare - entry.startShare) * 10) / 10;
    return {
      name: entry.displayName || entry.base,
      color,
      points,
      latestPointShare: points.at(-1) || 0,
      windowShare: Math.round(entry.windowShare * 10) / 10,
      delta
    };
  });

  return { dates: timelineDates, lines };
}

export function findMovers(lines: MetaLine[]): { rising: MetaLine[]; falling: MetaLine[] } {
  if (!Array.isArray(lines) || !lines.length) {
    return { rising: [], falling: [] };
  }
  const sorted = [...lines].filter(line => line.name !== 'Other');
  sorted.sort((a, b) => b.delta - a.delta);
  return {
    rising: sorted.slice(0, 3),
    falling: [...sorted].sort((a, b) => a.delta - b.delta).slice(0, 3)
  };
}

export function aggregateCardMoverDirection(
  list: CardTrendMover[],
  direction: 'up' | 'down',
  includeZero = false
): DisplayCardMover[] {
  const normalized = (Array.isArray(list) ? list : []).map(normalizeCardMover).filter(item => item.name);
  const groups = new Map<
    string,
    {
      name: string;
      latest: number;
      start: number;
      delta: number;
      set: string | null;
      number: string | null;
      variants: number;
    }
  >();

  for (const item of normalized) {
    const existing = groups.get(item.name);
    if (existing) {
      existing.latest = Math.max(existing.latest, item.latest);
      existing.start = Math.max(existing.start, item.start);
      existing.delta += item.delta;
      existing.variants += 1;
      if (!existing.set && item.set) {
        existing.set = item.set;
        existing.number = item.number;
      }
    } else {
      groups.set(item.name, {
        name: item.name,
        latest: item.latest,
        start: item.start,
        delta: item.delta,
        set: item.set,
        number: item.number,
        variants: 1
      });
    }
  }

  const result: DisplayCardMover[] = Array.from(groups.values()).map(group => ({
    name: group.name,
    set: group.set,
    number: group.number,
    latest: group.latest,
    start: group.start,
    delta: Math.round(group.delta * 10) / 10,
    variantCount: group.variants
  }));

  if (direction === 'up') {
    return result.filter(item => (includeZero ? item.delta >= 0 : item.delta > 0)).sort((a, b) => b.delta - a.delta);
  }
  return result.filter(item => (includeZero ? item.delta <= 0 : item.delta < 0)).sort((a, b) => a.delta - b.delta);
}
