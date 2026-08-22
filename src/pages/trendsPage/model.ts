/**
 * The trends page's calculations, as pure functions.
 *
 * The interesting one is {@link buildOnlineChart}. Its windowing has a subtlety
 * that is easy to reintroduce: the window anchors to the PAYLOAD's end date,
 * never to wall-clock now. If the cron lags, "now" drifts past the newest data
 * and a 7-day window slides off the end of the file, rendering an empty chart
 * on perfectly good data. The fallback when the payload has no usable end date
 * is the latest timeline point actually present — again, never the clock.
 * @module src/pages/trendsPage/model
 */

import type { ArchetypeSeries, DayBin } from '../../lib/majorsTrends';
import { parseReportDate, windowCutoff } from '../../lib/trendWindow';

/** The subset of the online trends payload this module reads. */
export interface OnlineTrendReportLike {
  windowEnd?: string;
  series?: Array<{
    base: string;
    displayName: string;
    avgShare: number;
    timeline?: Array<{ date: string; share: number }>;
  }>;
}

export interface ChartData {
  series: ArchetypeSeries[];
  days: DayBin[];
}

const EMPTY_CHART: ChartData = { series: [], days: [] };

/**
 * Latest timeline date present anywhere in the report, in epoch ms.
 *
 * The deterministic fallback anchor: a report whose `windowEnd` is missing or
 * unparseable still has real data, and using the clock instead would make the
 * chart depend on when it was viewed.
 */
function latestTimelinePoint(report: OnlineTrendReportLike): number {
  let latest = Number.NaN;
  for (const s of report.series ?? []) {
    for (const p of s.timeline ?? []) {
      const t = parseReportDate(p.date);
      if (Number.isFinite(t) && (!Number.isFinite(latest) || t > latest)) {
        latest = t;
      }
    }
  }
  return latest;
}

/**
 * Project the online trends payload onto a chart for a day window.
 *
 * Series are ranked by the file's own `avgShare` (a stable popularity order, so
 * each archetype keeps its colour regardless of what the user toggles), while
 * the legend's average is recomputed scoped to the visible window. Days are the
 * union of dates across archetypes, since a given archetype may skip days.
 * @param report - The `trends.json` payload, or null while loading
 * @param windowDays - Window length in days, inclusive of the anchor day
 * @returns Ranked series and their day bins, both empty when there is no usable data
 */
export function buildOnlineChart(report: OnlineTrendReportLike | null | undefined, windowDays: number): ChartData {
  if (!report?.series?.length) {
    return EMPTY_CHART;
  }

  const parsedEnd = parseReportDate(report.windowEnd);
  const anchorMs = Number.isFinite(parsedEnd) ? parsedEnd : latestTimelinePoint(report);
  if (!Number.isFinite(anchorMs)) {
    return EMPTY_CHART;
  }
  // Inclusive: the anchor day plus the (windowDays - 1) days before it.
  // Subtracting the full windowDays would admit N+1 calendar days.
  const cutoffMs = windowCutoff(anchorMs, windowDays);

  const dateSet = new Set<string>();
  for (const s of report.series) {
    for (const p of s.timeline ?? []) {
      const t = parseReportDate(p.date);
      if (Number.isFinite(t) && t >= cutoffMs) {
        dateSet.add(p.date);
      }
    }
  }
  const dates = [...dateSet].sort();
  if (!dates.length) {
    return EMPTY_CHART;
  }
  const dateIdx = new Map(dates.map((d, i) => [d, i]));

  const days: DayBin[] = dates.map(d => ({ key: d, date: new Date(`${d}T12:00:00Z`), count: 1 }));

  const ranked = [...report.series].sort((a, b) => b.avgShare - a.avgShare);
  const series: ArchetypeSeries[] = ranked.map(s => {
    const points: (number | null)[] = Array.from({ length: dates.length }, () => null);
    for (const p of s.timeline ?? []) {
      const idx = dateIdx.get(p.date);
      if (idx !== undefined) {
        points[idx] = p.share;
      }
    }
    const present = points.filter((v): v is number => v !== null);
    const windowAvg = present.length ? present.reduce((a, b) => a + b, 0) / present.length : s.avgShare;
    return { name: s.base, label: s.displayName, avg: windowAvg, points };
  });

  return { series, days };
}

/**
 * "3 hours ago" from an ISO timestamp.
 *
 * `now` is a parameter so the phrasing can be tested without freezing the clock.
 * @param iso - An ISO timestamp
 * @param now - Reference time in epoch ms
 * @returns The phrase, or null when the timestamp is missing or unparseable
 */
export function relativeTimeFrom(iso: string | undefined, now: number = Date.now()): string | null {
  if (!iso) {
    return null;
  }
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return null;
  }
  const mins = Math.round((now - t) / 60000);
  if (mins < 1) {
    return 'just now';
  }
  if (mins < 60) {
    return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  }
  const hrs = Math.round(mins / 60);
  if (hrs < 24) {
    return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  }
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * "Jun 6 to Jul 6" from two date strings.
 * @param start - Window start (YYYY-MM-DD or full ISO)
 * @param end - Window end
 * @returns The phrase, or null when either end is unparseable
 */
export function formatDateWindow(start: string | undefined, end: string | undefined): string | null {
  const fmt = (d: string | undefined): string | null => {
    const t = parseReportDate(d);
    return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  };
  const s = fmt(start);
  const e = fmt(end);
  return s && e ? `${s} to ${e}` : null;
}

/**
 * Take the top movers from each direction.
 * @param cardTrends - The payload's pre-computed lists
 * @param limit - How many to keep per direction
 * @returns Sliced rising and falling lists
 */
export function sliceCardMovers<T>(
  cardTrends: { rising?: T[]; falling?: T[] } | null | undefined,
  limit = 12
): { rising: T[]; falling: T[] } {
  return {
    rising: (cardTrends?.rising ?? []).slice(0, limit),
    falling: (cardTrends?.falling ?? []).slice(0, limit)
  };
}
