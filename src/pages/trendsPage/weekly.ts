/**
 * Projections of the weekly report onto the Trends page.
 *
 * The page shows one thing several ways: the same six archetypes drive the
 * chart lines, the rail beside the chart, and the order of the deck blocks.
 * These functions derive each view from the report so the three never
 * disagree, and they degrade to the older daily series when a trends file
 * predates the weekly report.
 * @module src/pages/trendsPage/weekly
 */

import type { ArchetypeSeries, DayBin } from '../../lib/majorsTrends';
import type { WeeklyArchetype, WeeklyReport } from '../../lib/data/trends';
import { classifyTournament, tournamentDate } from '../../lib/data';
import type { OnlineTrendReportLike } from './model';

/** Which figure the chart plots. */
export type ChartMetric = 'share' | 'top10';

/** Lines drawn by default; the rail can add more up to the cap. */
export const DEFAULT_LINES = 6;
/** Never draw more than this many lines at once. */
export const MAX_LINES = 8;

/**
 * Trailing mean over `window` days, skipping missing days. A point needs at
 * least three present days behind it, so the first days of a series stay
 * blank rather than plotting a one-day "average".
 * @param points - Daily values, null where the day is missing
 * @param window - Days in the trailing window
 * @returns The smoothed series, same length
 */
export function smoothSeries(points: (number | null)[], window = 7): (number | null)[] {
  return points.map((_, i) => {
    const slice = points.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v !== null);
    if (slice.length < 3) {
      return null;
    }
    return Math.round((slice.reduce((s, v) => s + v, 0) / slice.length) * 100) / 100;
  });
}

/** Ranked archetypes: this week's share first, so colours follow the rail. */
export function rankedArchetypes(weekly: WeeklyReport): WeeklyArchetype[] {
  return [...weekly.archetypes].sort((a, b) => b.share - a.share || b.lists - a.lists);
}

const mean = (points: (number | null)[]): number => {
  const present = points.filter((v): v is number => v !== null);
  return present.length ? present.reduce((s, v) => s + v, 0) / present.length : 0;
};

const dayBin = (date: string): DayBin => ({ key: date, date: new Date(`${date}T12:00:00Z`), count: 1 });

/**
 * Chart series from the weekly report: one line per archetype over the last
 * `days` days, in share or top-10% share, optionally smoothed.
 * @param weekly - The weekly report
 * @param metric - Which daily figure to plot
 * @param days - How many trailing days to show
 * @param smoothed - Whether to plot the 7-day trailing mean
 * @returns Ranked series and their day bins
 */
export function chartFromWeekly(
  weekly: WeeklyReport,
  metric: ChartMetric,
  days: number,
  smoothed: boolean
): { series: ArchetypeSeries[]; days: DayBin[] } {
  const dates = weekly.dates.slice(-days);
  const offset = weekly.dates.length - dates.length;
  const series = rankedArchetypes(weekly).map(a => {
    const full = a.daily.map(p => (metric === 'top10' ? p.top10Share : p.share));
    const points = (smoothed ? smoothSeries(full) : full).slice(offset);
    return { name: a.base, label: a.displayName, avg: mean(points), points };
  });
  return { series, days: dates.map(dayBin) };
}

/**
 * Chart series from the older daily report, for files without a weekly block.
 * Share only; smoothing still applies.
 */
export function chartFromDaily(
  report: OnlineTrendReportLike,
  days: number,
  smoothed: boolean
): { series: ArchetypeSeries[]; days: DayBin[] } {
  const dateSet = new Set<string>();
  for (const s of report.series ?? []) {
    for (const p of s.timeline ?? []) {
      dateSet.add(p.date);
    }
  }
  const all = [...dateSet].sort();
  const dates = all.slice(-days);
  const offset = all.length - dates.length;
  const index = new Map(all.map((d, i) => [d, i]));
  const series = [...(report.series ?? [])]
    .sort((a, b) => b.avgShare - a.avgShare)
    .map(s => {
      const full: (number | null)[] = all.map(() => null);
      for (const p of s.timeline ?? []) {
        const i = index.get(p.date);
        if (i !== undefined) {
          full[i] = p.share;
        }
      }
      const points = (smoothed ? smoothSeries(full) : full).slice(offset);
      return { name: s.base, label: s.displayName, avg: mean(points), points };
    });
  return { series, days: dates.map(dayBin) };
}

/** One row of the rail beside the chart. */
export interface RailRow {
  name: string;
  label: string;
  /** Average of the plotted line over the visible window, 0..100. */
  avg: number;
  /** This week against last in share points, or null when the file has no weekly block. */
  delta: number | null;
}

/**
 * Rail rows for the visible series: the default lines plus any the user added.
 * @param series - Ranked chart series
 * @param added - Names the user added beyond the default lines
 * @param deltas - This-week-against-last per archetype name, when known
 * @returns Rows in colour order
 */
export function railRows(series: ArchetypeSeries[], added: string[], deltas: Map<string, number> | null): RailRow[] {
  const base = series.slice(0, DEFAULT_LINES);
  const extra = added.map(n => series.find(s => s.name === n)).filter((s): s is ArchetypeSeries => s !== undefined);
  return [...base, ...extra].map(s => ({
    name: s.name,
    label: s.label,
    avg: s.avg,
    delta: deltas?.get(s.name) ?? null
  }));
}

/** A dated marker on the chart's axis. */
export interface EventMarker {
  date: string;
  label: string;
}

const MARKER_LABELS: Partial<Record<ReturnType<typeof classifyTournament>, string>> = {
  worlds: 'Worlds',
  international: 'IC',
  regional: 'Regional',
  special: 'Special'
};

/**
 * Major events that fall on one of the charted days. One label per day; when
 * two share a day the bigger class wins, in the order the labels are listed.
 * @param tournaments - Tournament keys from the catalog
 * @param days - The charted day bins
 * @returns Markers in date order
 */
export function eventMarkers(tournaments: string[], days: DayBin[]): EventMarker[] {
  const charted = new Set(days.map(d => d.key));
  const byDate = new Map<string, EventMarker>();
  const rank = Object.keys(MARKER_LABELS);
  for (const key of tournaments) {
    const label = MARKER_LABELS[classifyTournament(key)];
    const date = tournamentDate(key);
    if (!label || !date) {
      continue;
    }
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (!charted.has(iso)) {
      continue;
    }
    const current = byDate.get(iso);
    if (!current || rank.indexOf(label) < rank.indexOf(current.label)) {
      byDate.set(iso, { date: iso, label });
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Signed whole-number change for a tile's overlay, e.g. "+9%". */
export function signedPercent(delta: number): string {
  const whole = Math.round(Math.abs(delta));
  return `${delta < 0 ? '−' : '+'}${whole}%`;
}

/** Signed one-decimal change for text, e.g. "+2.3%". */
export function signedDecimal(delta: number): string {
  return `${delta < 0 ? '−' : '+'}${Math.abs(delta).toFixed(1)}%`;
}

/** Whole-number percent for a level, with "<1%" under one. */
export function wholePercent(value: number): string {
  if (value > 0 && value < 1) {
    return '<1%';
  }
  return `${Math.round(value)}%`;
}
