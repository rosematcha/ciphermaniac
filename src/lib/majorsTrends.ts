/**
 * Majors-trends computation, shared between the page and the pipeline.
 *
 * The Trends page's "Majors (events)" view derives an archetype-share timeline
 * and card-level movers from the last N regional / international / special
 * events. Doing that in the browser means downloading up to ten full
 * `master.json` files (~5 MB) plus each event's archetype index on every visit.
 *
 * These functions are the exact math that used to live inline in
 * `TrendsPage.tsx`. Extracting them lets the daily pipeline
 * (`.github/scripts/run-majors-trends.ts`) precompute the rendered result into
 * a small artifact while the page keeps the identical code path as a 404
 * fallback — so both routes produce byte-identical output.
 */

import type { ArchetypeIndexEntry, CardItem } from '../types';
import { shortDate } from './format';

/** A newcomer must hold at least this share (%) in the recent half to be listed. */
export const NEWCOMER_MIN_SHARE = 10;

/**
 * One major event's data, as consumed by the computations below. On the page
 * `master`/`archetypes` come from `fetchMaster`/`fetchArchetypes` (already
 * canonicalized / scale-normalized); the pipeline reproduces the same shape.
 */
export interface EventSnapshot {
  tournament: string;
  date: Date;
  master: { deckTotal: number; items: CardItem[] } | null;
  archetypes: ArchetypeIndexEntry[] | null;
}

/** One archetype's timeline: a share per day bin (null where the archetype is absent). */
export interface ArchetypeSeries {
  name: string;
  label: string;
  avg: number;
  points: (number | null)[];
}

/** One day bin on the shared trend chart. */
export interface DayBin {
  key: string;
  date: Date;
  count: number;
  snaps?: EventSnapshot[];
}

/** A single card mover row (rising / falling / newcomer). */
export interface MoverRow {
  name: string;
  set: string | null;
  number: string | null;
  recentAvg: number | null;
  olderAvg: number | null;
  /** Share-point change, recent half minus older half. */
  delta: number;
}

interface HalfCoverage {
  /** Date range covered by the recent half, e.g. "Jun 6 to Jul 6". */
  recent: string;
  /** Date range covered by the older half. */
  older: string;
  recentCount: number;
  olderCount: number;
}

export interface MoversResult {
  rising: MoverRow[];
  falling: MoverRow[];
  newcomers: MoverRow[];
  /** False when a half has fewer than two events, so the list stays hidden. */
  enoughForMovers: boolean;
  coverage: HalfCoverage | null;
  newcomerMin: number;
}

/** Precomputed result for one window (last 3 / 5 / 10 events), fully serializable. */
export interface MajorsWindowResult {
  /** Number of events requested for this window (matches the page's event count). */
  sampleCount: number;
  /** Day bins with archetype data, ascending, as YYYY-MM-DD keys. */
  dayKeys: string[];
  series: ArchetypeSeries[];
  movers: MoversResult;
}

/** The full majors-trends artifact: one result per selectable window. */
export interface MajorsTrendsPayload {
  generatedAt: string;
  windows: Record<string, MajorsWindowResult>;
}

/** Local-time YYYY-MM-DD key for a date (stable across timezones for calendar dates). */
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Inverse of {@link dayKey}: rebuild the local-midnight Date a key was produced from. */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Min-to-max date label for a set of events, e.g. "Jun 6 to Jul 6" (or a single date). */
function eventDateRange(reps: EventSnapshot[]): string {
  const times = reps
    .map(r => r.date.getTime())
    .filter(t => t > 0)
    .sort((a, b) => a - b);
  if (times.length === 0) {
    return '';
  }
  const first = shortDate(new Date(times[0]));
  const last = shortDate(new Date(times[times.length - 1]));
  return first === last ? first : `${first} to ${last}`;
}

/**
 * Card-level movers: compare the recent half of the window against the older
 * half, weighting each event by its deck total. Returns rising / falling /
 * newcomer lists plus the coverage note the page renders. Mirrors the logic
 * that shipped inline in TrendsPage.
 */
export function computeMajorsMovers(snapshots: EventSnapshot[], newcomerMin = NEWCOMER_MIN_SHARE): MoversResult {
  const empty = (enough: boolean, coverage: HalfCoverage | null): MoversResult => ({
    rising: [],
    falling: [],
    newcomers: [],
    enoughForMovers: enough,
    coverage,
    newcomerMin
  });

  const reps = snapshots.filter(r => r.master !== null);
  if (reps.length < 2) {
    return empty(false, null);
  }
  // reps arrive most-recent first. Split into a recent half and an older half.
  const mid = Math.ceil(reps.length / 2);
  const recentReps = reps.slice(0, mid);
  const olderReps = reps.slice(mid);
  const coverage: HalfCoverage = {
    recent: eventDateRange(recentReps),
    older: eventDateRange(olderReps),
    recentCount: recentReps.length,
    olderCount: olderReps.length
  };
  // A trend needs at least two events on each side. At "Last 3 events" the
  // older half is a single tournament, so one event's local meta would read as
  // a movement. Below that, disable the list rather than mislead.
  if (recentReps.length < 2 || olderReps.length < 2) {
    return empty(false, coverage);
  }

  // Build a key→item map for each report once; previously avgPctIn/appearancesIn
  // ran .find() per key per report (O(reports × keys × items)).
  const repMaps = reps.map(r => {
    const m = new Map<string, CardItem>();
    for (const item of r.master!.items) {
      if (!item.set || item.number === undefined || item.number === null || item.number === '') {
        continue;
      }
      m.set(`${item.set}::${item.number}`, item);
    }
    return m;
  });
  // Weight each event by its deck total, so a 3,752-player IC counts for more
  // than a 300-player special instead of one-event-one-vote.
  const repWeights = reps.map(r => {
    const dt = r.master!.deckTotal;
    return Number.isFinite(dt) && dt > 0 ? dt : 1;
  });
  const recentMaps = repMaps.slice(0, mid);
  const olderMaps = repMaps.slice(mid);
  const recentWeights = repWeights.slice(0, mid);
  const olderWeights = repWeights.slice(mid);

  const allKeys = new Map<string, CardItem>();
  for (let i = 0; i < reps.length; i++) {
    for (const [key, item] of repMaps[i]) {
      if (!allKeys.has(key) || (item.pct ?? 0) > (allKeys.get(key)!.pct ?? 0)) {
        allKeys.set(key, item);
      }
    }
  }

  const avgFor = (maps: Map<string, CardItem>[], weights: number[], key: string): number | null => {
    let sum = 0;
    let totalWeight = 0;
    let appeared = false;
    for (let i = 0; i < maps.length; i++) {
      // Denominator is the total weight of EVERY event in the half — an event
      // where the card is absent counts as a 0% share, not omitted. Otherwise a
      // card in one of two equal events reads as its full local share (20%)
      // instead of the true pooled share (10%).
      totalWeight += weights[i];
      const item = maps[i].get(key);
      if (item && Number.isFinite(item.pct)) {
        sum += item.pct * weights[i];
        appeared = true;
      }
    }
    // Null only when the card never appears in this half (preserves newcomer
    // detection, which keys off olderAvg === null).
    return appeared && totalWeight > 0 ? sum / totalWeight : null;
  };
  const appearancesFor = (maps: Map<string, CardItem>[], key: string): number =>
    maps.reduce((n, m) => (m.has(key) ? n + 1 : n), 0);

  const all: MoverRow[] = [];
  for (const [key, item] of allKeys) {
    const recentAvg = avgFor(recentMaps, recentWeights, key);
    const olderAvg = avgFor(olderMaps, olderWeights, key);
    const appearancesRecent = appearancesFor(recentMaps, key);
    if (appearancesRecent < Math.max(1, Math.ceil(recentMaps.length / 2))) {
      continue;
    }
    const delta = (recentAvg ?? 0) - (olderAvg ?? 0);
    all.push({
      name: item.name,
      set: item.set ?? null,
      number: item.number === undefined || item.number === null ? null : String(item.number),
      recentAvg,
      olderAvg,
      delta
    });
  }

  const present = all.filter(m => m.olderAvg !== null && m.recentAvg !== null);
  const rising = [...present].sort((a, b) => b.delta - a.delta).slice(0, 12);
  const falling = [...present].sort((a, b) => a.delta - b.delta).slice(0, 12);
  const newcomers = all
    .filter(m => m.olderAvg === null && m.recentAvg !== null && m.recentAvg >= newcomerMin)
    .sort((a, b) => (b.recentAvg ?? 0) - (a.recentAvg ?? 0))
    .slice(0, 8);
  return { rising, falling, newcomers, enoughForMovers: true, coverage, newcomerMin };
}

/**
 * Deck-total-weighted archetype-share timeline: one day bin per event date, one
 * series per archetype. Mirrors the logic that shipped inline in TrendsPage,
 * including the per-file 0..1 vs 0..100 percent-scale detection.
 */
export function computeMajorsArchetypeSeries(snapshots: EventSnapshot[]): {
  series: ArchetypeSeries[];
  days: DayBin[];
} {
  const reps = snapshots.filter(r => r.archetypes !== null);
  if (reps.length === 0) {
    return { series: [], days: [] };
  }
  const byDay = new Map<string, EventSnapshot[]>();
  for (const r of reps) {
    const key = dayKey(r.date);
    if (!byDay.has(key)) {
      byDay.set(key, []);
    }
    byDay.get(key)!.push(r);
  }
  const days: DayBin[] = Array.from(byDay.entries())
    .map(([key, snaps]) => ({ key, date: snaps[0].date, count: snaps.length, snaps }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Per (archetype, day): a deck-total-weighted share. `num` accumulates
  // Σ(share × eventDeckTotal) and `den` accumulates Σ(eventDeckTotal), so a
  // day's value is the true pooled share.
  const byArche = new Map<string, { label: string; num: number[]; den: number[] }>();
  days.forEach((day, dayIdx) => {
    for (const snap of day.snaps!) {
      // Per-event archetype reports store `percent` as either a 0..1 fraction
      // (post-3939e71) or a 0..100 value (older files). The scale is uniform
      // within a file, so detect it once per snapshot: a fractional file's max
      // is ≤1, while a 0..100 file always has a dominant deck >1.
      const maxPercent = snap.archetypes!.reduce(
        (m, a) => (Number.isFinite(a.percent) && (a.percent as number) > m ? (a.percent as number) : m),
        0
      );
      const scale = maxPercent > 0 && maxPercent <= 1 ? 100 : 1;
      // Event weight: master deck total when present, else summed archetype
      // deck counts, else 1.
      const masterTotal = snap.master?.deckTotal;
      const archTotal = snap.archetypes!.reduce((s, a) => s + (a.deckCount ?? 0), 0);
      const weight =
        Number.isFinite(masterTotal) && (masterTotal as number) > 0
          ? (masterTotal as number)
          : archTotal > 0
            ? archTotal
            : 1;
      for (const a of snap.archetypes!) {
        const key = a.name;
        if (!byArche.has(key)) {
          byArche.set(key, {
            label: a.label || a.name,
            num: Array.from({ length: days.length }, () => 0),
            den: Array.from({ length: days.length }, () => 0)
          });
        }
        if (a.percent === null || a.percent === undefined || !Number.isFinite(a.percent)) {
          continue;
        }
        const raw = a.percent * scale;
        const acc = byArche.get(key)!;
        acc.num[dayIdx] += raw * weight;
        acc.den[dayIdx] += weight;
      }
    }
  });

  const allSeries: ArchetypeSeries[] = [];
  for (const [name, info] of byArche.entries()) {
    const shares: (number | null)[] = info.num.map((n, i) => (info.den[i] > 0 ? n / info.den[i] : null));
    const present = shares.filter((s): s is number => s !== null);
    if (present.length === 0) {
      continue;
    }
    const avg = present.reduce((a, b) => a + b, 0) / present.length;
    allSeries.push({ name, label: info.label, avg, points: shares });
  }
  allSeries.sort((a, b) => b.avg - a.avg);

  return { series: allSeries, days };
}

/**
 * Bundle the movers + archetype-series computations into one serializable
 * window result. `sampleCount` is the number of events requested for the
 * window (the page shows it in the section captions), independent of how many
 * actually returned data.
 */
export function computeMajorsWindowResult(
  snapshots: EventSnapshot[],
  sampleCount: number,
  newcomerMin = NEWCOMER_MIN_SHARE
): MajorsWindowResult {
  const { series, days } = computeMajorsArchetypeSeries(snapshots);
  const movers = computeMajorsMovers(snapshots, newcomerMin);
  return {
    sampleCount,
    dayKeys: days.map(d => d.key),
    series,
    movers
  };
}
