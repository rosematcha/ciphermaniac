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
import type { OnlineTrendReportLike } from './model';

/** One calendar day in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000;

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
 * `days` days, in share or top-10% share, as the 7-day trailing mean.
 * @param weekly - The weekly report
 * @param metric - Which daily figure to plot
 * @param days - How many trailing days to show
 * @returns Ranked series and their day bins
 */
export function chartFromWeekly(
  weekly: WeeklyReport,
  metric: ChartMetric,
  days: number
): { series: ArchetypeSeries[]; days: DayBin[] } {
  const dates = weekly.dates.slice(-days);
  const offset = weekly.dates.length - dates.length;
  const series = rankedArchetypes(weekly).map(a => {
    const full = a.daily.map(p => (metric === 'top10' ? p.top10Share : p.share));
    const points = smoothSeries(full).slice(offset);
    return { name: a.base, label: a.displayName, avg: mean(points), points };
  });
  return { series, days: dates.map(dayBin) };
}

/**
 * Chart series from the older daily report, for files without a weekly block.
 * Share only, smoothed the same way.
 */
export function chartFromDaily(
  report: OnlineTrendReportLike,
  days: number
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
      const points = smoothSeries(full).slice(offset);
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
  /**
   * Change across the visible window in the plotted metric: the line's last
   * point minus its first. Null when the window holds fewer than two points.
   */
  delta: number | null;
}

/**
 * How far a plotted line moved across the window it shows, so the figure
 * beside the chart always describes the lines in it: switching 7d/14d/30d or
 * All/Top 10% changes both together.
 * @param points - The plotted points, null where a day is missing
 * @returns Last present point minus first, to one decimal; null under two points
 */
export function windowChange(points: (number | null)[]): number | null {
  const present = points.filter((v): v is number => v !== null);
  if (present.length < 2) {
    return null;
  }
  return Math.round((present[present.length - 1] - present[0]) * 10) / 10;
}

/**
 * Rail rows for the visible series: the default lines plus any the user added.
 * @param series - Ranked chart series, already cut to the visible window
 * @param added - Names the user added beyond the default lines
 * @returns Rows in colour order
 */
export function railRows(series: ArchetypeSeries[], added: string[]): RailRow[] {
  const base = series.slice(0, DEFAULT_LINES);
  const extra = added.map(n => series.find(s => s.name === n)).filter((s): s is ArchetypeSeries => s !== undefined);
  return [...base, ...extra].map(s => ({
    name: s.name,
    label: s.label,
    avg: s.avg,
    delta: windowChange(s.points)
  }));
}

/** The chart's Y axis: its bounds and the ticks to label. */
export interface YAxis {
  min: number;
  max: number;
  ticks: number[];
}

/**
 * Y axis fitted to the data: one whole percent below the lowest value and one
 * above the highest, so a chart running 3.8% to 12% reads 3% to 13% rather
 * than 0% to 20%. Ticks are the bounds plus the round steps between them,
 * dropping any step that would crowd a bound.
 * @param values - Every plotted value
 * @returns The axis; 0% to 10% when there is nothing to plot
 */
export function yAxisDomain(values: number[]): YAxis {
  const finite = values.filter(v => Number.isFinite(v));
  if (finite.length === 0) {
    return { min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10] };
  }
  const min = Math.max(0, Math.ceil(Math.min(...finite)) - 1);
  const max = Math.floor(Math.max(...finite)) + 1;
  const range = max - min;
  const step = range <= 4 ? 1 : range <= 10 ? 2 : range <= 25 ? 5 : 10;
  const ticks = [min];
  for (let v = Math.ceil(min / step) * step; v < max; v += step) {
    if (v - min > step / 2 && max - v > step / 2) {
      ticks.push(v);
    }
  }
  ticks.push(max);
  return { min, max, ticks };
}

/** Signed whole-number change for a tile's overlay, e.g. "+9%". */
export function signedPercent(delta: number): string {
  const whole = Math.round(Math.abs(delta));
  return `${delta < 0 ? '−' : '+'}${whole}%`;
}

/** Signed one-decimal change for text, e.g. "+2.3%"; a change that rounds to nothing is "0.0%". */
export function signedDecimal(delta: number): string {
  if (Math.abs(delta) < 0.05) {
    return '0.0%';
  }
  return `${delta < 0 ? '−' : '+'}${Math.abs(delta).toFixed(1)}%`;
}

/** Arrow for a change, or nothing when it rounds to zero. */
export function changeArrow(delta: number): string {
  if (Math.abs(delta) < 0.05) {
    return '';
  }
  return delta < 0 ? '↓' : '↑';
}

/** Whole-number percent for a level, with "<1%" under one. */
export function wholePercent(value: number): string {
  if (value > 0 && value < 1) {
    return '<1%';
  }
  return `${Math.round(value)}%`;
}
