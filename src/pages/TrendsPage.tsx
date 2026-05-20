import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { A } from '@solidjs/router';
import {
  fetchArchetypes,
  fetchMaster,
  fetchOnlineTrendReport,
  fetchTournamentsList,
  majorTournaments,
  tournamentDate
} from '../lib/data';
import type { ArchetypeIndexEntry, CardItem } from '../types';
import { Section } from '../components/Section';
import { Segmented } from '../components/Segmented';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { createPersistentSignal } from '../lib/persistentSignal';

type Source = 'online' | 'majors';
type OnlineWindow = '7d' | '14d' | '30d';
type MajorsWindow = '3-events' | '5-events' | '10-events';

const SOURCE_OPTIONS: { value: Source; label: string }[] = [
  { value: 'online', label: 'Online (daily)' },
  { value: 'majors', label: 'Majors (events)' }
];
const ONLINE_WINDOW_OPTIONS: { value: OnlineWindow; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '14d', label: '14 days' },
  { value: '30d', label: '30 days' }
];
const ONLINE_WINDOW_DAYS: Record<OnlineWindow, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30
};
const MAJORS_WINDOW_OPTIONS: { value: MajorsWindow; label: string }[] = [
  { value: '3-events', label: 'Last 3 events' },
  { value: '5-events', label: 'Last 5 events' },
  { value: '10-events', label: 'Last 10 events' }
];
const MAJORS_WINDOW_COUNT: Record<MajorsWindow, number> = {
  '3-events': 3,
  '5-events': 5,
  '10-events': 10
};

const ARCHETYPE_LINE_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', '#9c5fd0', '#d4a043', '#3eb9c5'];

const TOP_ARCHETYPES_FOR_CHART = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

interface EventSnapshot {
  tournament: string;
  date: Date;
  master: { deckTotal: number; items: CardItem[] } | null;
  archetypes: ArchetypeIndexEntry[] | null;
}

/**
 * Trends — two distinct ways of looking at meta movement.
 *
 *  • Online (daily): reads the cron-built `Trends - Last 30 Days/trends.json`,
 *    which carries 30 daily timeline points per archetype plus pre-computed
 *    rising/falling card lists. Window is selectable in days (7 / 14 / 30).
 *    This is the default — it's smooth, dense, and reflects the actual day-by-day
 *    meta evolution from hundreds of online tournaments.
 *
 *  • Majors (events): one data point per regional / international / special
 *    tournament. Sparser but each point is a real bricks-and-mortar event.
 *    Window is selectable by event count (last 3 / 5 / 10).
 */
export function TrendsPage() {
  const [source, setSourceAndStore] = createPersistentSignal<Source>('cm:trendsSource', 'online', v =>
    v === 'majors' || v === 'online' ? v : null
  );
  const [onlineWindow, setOnlineWindow] = createSignal<OnlineWindow>('30d');
  const [majorsWindow, setMajorsWindow] = createSignal<MajorsWindow>('5-events');

  onMount(() => {
    document.title = 'Trends — Ciphermaniac';
  });

  return (
    <>
      <section class='hero'>
        <h1>Trends</h1>
        <div class='hero-meta'>
          <span>How the meta has shifted over the selected window</span>
        </div>
      </section>

      <Section>
        <div class='filter-bar'>
          <div class='filter-row'>
            <Segmented<Source>
              options={SOURCE_OPTIONS}
              selected={source()}
              onSelect={setSourceAndStore}
              ariaLabel='Trend source'
            />
            <Show
              when={source() === 'online'}
              fallback={
                <Segmented<MajorsWindow>
                  options={MAJORS_WINDOW_OPTIONS}
                  selected={majorsWindow()}
                  onSelect={setMajorsWindow}
                  ariaLabel='Majors window'
                />
              }
            >
              <Segmented<OnlineWindow>
                options={ONLINE_WINDOW_OPTIONS}
                selected={onlineWindow()}
                onSelect={setOnlineWindow}
                ariaLabel='Online window'
              />
            </Show>
          </div>
        </div>
      </Section>

      <Show when={source() === 'online'} fallback={<MajorsView windowKey={majorsWindow()} />}>
        <OnlineView windowKey={onlineWindow()} />
      </Show>
    </>
  );
}

/* ============================================================
   ONLINE — daily timeline + card-trend lists from cron
   ============================================================ */

function OnlineView(props: { windowKey: OnlineWindow }) {
  const [trends] = createResource(fetchOnlineTrendReport);

  /**
   * Pick the top-N archetypes by avgShare across the full file, then slice
   * each archetype's timeline to the selected window.
   */
  const chart = createMemo<{ series: ArchetypeSeries[]; days: DayBin[] }>(() => {
    const data = trends();
    if (!data) {
      return { series: [], days: [] };
    }
    const report = data.trendReport;
    if (!report || !report.series || report.series.length === 0) {
      return { series: [], days: [] };
    }

    const windowDays = ONLINE_WINDOW_DAYS[props.windowKey];
    const cutoffMs = Date.now() - windowDays * DAY_MS;

    // Union of all dates across archetypes that fall in window (some archetypes
    // may skip days). Sorted ascending.
    const dateSet = new Set<string>();
    for (const s of report.series) {
      for (const p of s.timeline ?? []) {
        const t = Date.parse(`${p.date}T12:00:00Z`);
        if (Number.isFinite(t) && t >= cutoffMs) {
          dateSet.add(p.date);
        }
      }
    }
    const dates = Array.from(dateSet).sort();
    if (dates.length === 0) {
      return { series: [], days: [] };
    }
    const dateIdx = new Map(dates.map((d, i) => [d, i]));

    const days: DayBin[] = dates.map(d => ({
      key: d,
      date: new Date(`${d}T12:00:00Z`),
      count: 1
    }));

    // Pick top-N by avgShare across the file (this is the cron's avg, computed
    // over the full 30-day window — close enough to a "popularity ranking"
    // for picking which lines to show).
    const ranked = [...report.series].sort((a, b) => b.avgShare - a.avgShare);
    const top = ranked.slice(0, TOP_ARCHETYPES_FOR_CHART);

    const series: ArchetypeSeries[] = top.map(s => {
      const points: (number | null)[] = Array.from({ length: dates.length }, () => null);
      for (const p of s.timeline ?? []) {
        const idx = dateIdx.get(p.date);
        if (idx === undefined) {
          continue;
        }
        points[idx] = p.share;
      }
      // Recompute avgShare scoped to this window for the legend.
      const present = points.filter((v): v is number => v !== null);
      const windowAvg = present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : s.avgShare;
      return {
        name: s.base,
        label: s.displayName,
        avg: windowAvg,
        points
      };
    });

    return { series, days };
  });

  const windowDays = () => ONLINE_WINDOW_DAYS[props.windowKey];

  /** Card-level movers from the cron's pre-computed lists, sliced (top 12 each). */
  const cardMovers = createMemo(() => {
    const data = trends();
    if (!data?.cardTrends) {
      return { rising: [] as CardTrendLike[], falling: [] as CardTrendLike[] };
    }
    return {
      rising: (data.cardTrends.rising ?? []).slice(0, 12),
      falling: (data.cardTrends.falling ?? []).slice(0, 12)
    };
  });

  /** Window meta for the right-side caption. */
  const sourceCaption = createMemo(() => {
    const data = trends();
    if (!data) {
      return null;
    }
    const tc = data.trendReport.tournamentCount;
    return `${tc.toLocaleString()} online events aggregated`;
  });

  return (
    <>
      <Section
        title='Archetype share over time'
        right={
          <Show when={trends() !== undefined} fallback='—'>
            {chart().days.length} daily snapshots · {sourceCaption()}
          </Show>
        }
      >
        <Show when={trends() !== undefined} fallback={<Skeleton height='360px' />}>
          <Show
            when={trends() && chart().series.length > 0}
            fallback={
              <EmptyState
                title='No online trend data yet.'
                description="The cron-built trend file isn't published yet. Switch source to 'Majors (events)' for per-tournament data, or check back after the cron's next run."
              />
            }
          >
            <ArchetypeTrendChart series={chart().series} days={chart().days} windowDays={windowDays()} />
          </Show>
        </Show>
      </Section>

      <Show when={cardMovers().rising.length > 0 || cardMovers().falling.length > 0}>
        <Section title='Top card movers' right='Rising and falling cards across the window'>
          <div class='movers'>
            <div class='mover-col'>
              <h3 class='up'>Rising — biggest gainers</h3>
              <For each={cardMovers().rising}>
                {(m, idx) => (
                  <A href={m.set && m.number ? `/cards/${m.set}/${m.number}` : '#'} class='mover-row'>
                    <span class='rank'>{idx() + 1}</span>
                    <span class='name'>{m.name}</span>
                    <span class='set'>
                      {m.set ?? ''}/{m.number ?? ''}
                    </span>
                    <span class='delta up'>↑ {Math.abs(m.delta).toFixed(1)}%</span>
                  </A>
                )}
              </For>
            </div>
            <div class='mover-col'>
              <h3 class='down'>Falling — biggest losers</h3>
              <For each={cardMovers().falling}>
                {(m, idx) => (
                  <A href={m.set && m.number ? `/cards/${m.set}/${m.number}` : '#'} class='mover-row'>
                    <span class='rank'>{idx() + 1}</span>
                    <span class='name'>{m.name}</span>
                    <span class='set'>
                      {m.set ?? ''}/{m.number ?? ''}
                    </span>
                    <span class='delta down'>↓ {Math.abs(m.delta).toFixed(1)}%</span>
                  </A>
                )}
              </For>
            </div>
          </div>
        </Section>
      </Show>
    </>
  );
}

/* ============================================================
   MAJORS — per-event series, card-level movers
   ============================================================ */

function MajorsView(props: { windowKey: MajorsWindow }) {
  const [tournaments] = createResource(fetchTournamentsList);

  const sample = createMemo<string[]>(() => {
    const list = tournaments() ?? [];
    return majorTournaments(list).slice(0, MAJORS_WINDOW_COUNT[props.windowKey]);
  });

  const [snapshots] = createResource<EventSnapshot[], string[]>(sample, async list => {
    if (list.length === 0) {
      return [];
    }
    const results = await Promise.all(
      list.map(async t => {
        const [masterResult, archetypesResult] = await Promise.allSettled([fetchMaster(t), fetchArchetypes(t)]);
        return {
          tournament: t,
          date: tournamentDate(t) ?? new Date(0),
          master: masterResult.status === 'fulfilled' ? masterResult.value : null,
          archetypes: archetypesResult.status === 'fulfilled' ? archetypesResult.value : null
        };
      })
    );
    return results;
  });

  const movers = createMemo(() => {
    const reps = (snapshots() ?? []).filter(r => r.master !== null);
    if (reps.length < 2) {
      return { rising: [] as Mover[], falling: [] as Mover[], newcomers: [] as Mover[] };
    }
    const mid = Math.ceil(reps.length / 2);
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
    const recentMaps = repMaps.slice(0, mid);
    const olderMaps = repMaps.slice(mid);

    const allKeys = new Map<string, CardItem>();
    for (let i = 0; i < reps.length; i++) {
      for (const [key, item] of repMaps[i]) {
        if (!allKeys.has(key) || (item.pct ?? 0) > (allKeys.get(key)!.pct ?? 0)) {
          allKeys.set(key, item);
        }
      }
    }

    const avgFor = (maps: Map<string, CardItem>[], key: string): number | null => {
      let sum = 0;
      let count = 0;
      for (const m of maps) {
        const item = m.get(key);
        if (item && Number.isFinite(item.pct)) {
          sum += item.pct;
          count += 1;
        }
      }
      return count === 0 ? null : sum / count;
    };
    const appearancesFor = (maps: Map<string, CardItem>[], key: string): number =>
      maps.reduce((n, m) => (m.has(key) ? n + 1 : n), 0);

    const all: Mover[] = [];
    for (const [key, item] of allKeys) {
      const recentAvg = avgFor(recentMaps, key);
      const olderAvg = avgFor(olderMaps, key);
      const appearancesRecent = appearancesFor(recentMaps, key);
      if (appearancesRecent < Math.max(1, Math.ceil(recentMaps.length / 2))) {
        continue;
      }
      const delta = (recentAvg ?? 0) - (olderAvg ?? 0);
      all.push({ item, recentAvg, olderAvg, delta });
    }

    const present = all.filter(m => m.olderAvg !== null && m.recentAvg !== null);
    const rising = [...present].sort((a, b) => b.delta - a.delta).slice(0, 12);
    const falling = [...present].sort((a, b) => a.delta - b.delta).slice(0, 12);
    const newcomers = all
      .filter(m => m.olderAvg === null && m.recentAvg !== null && m.recentAvg >= 10)
      .sort((a, b) => (b.recentAvg ?? 0) - (a.recentAvg ?? 0))
      .slice(0, 8);
    return { rising, falling, newcomers };
  });

  const archetypeSeries = createMemo<{ series: ArchetypeSeries[]; days: DayBin[]; windowDays: number }>(() => {
    const reps = (snapshots() ?? []).filter(r => r.archetypes !== null);
    if (reps.length === 0) {
      return { series: [], days: [], windowDays: 30 };
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

    const byArche = new Map<string, { label: string; shares: (number | null)[] }>();
    days.forEach((day, dayIdx) => {
      for (const snap of day.snaps!) {
        for (const a of snap.archetypes!) {
          const key = a.name;
          if (!byArche.has(key)) {
            byArche.set(key, {
              label: a.label || a.name,
              shares: Array.from({ length: days.length }, () => null)
            });
          }
          // Per-tournament reports store percent in 0..100 already.
          const raw = a.percent;
          if (raw === null || raw === undefined || !Number.isFinite(raw)) {
            continue;
          }
          const existing = byArche.get(key)!.shares[dayIdx];
          byArche.get(key)!.shares[dayIdx] = existing === null ? raw : (existing + raw) / 2;
        }
      }
    });

    const allSeries: ArchetypeSeries[] = [];
    for (const [name, info] of byArche.entries()) {
      const present = info.shares.filter((s): s is number => s !== null);
      if (present.length === 0) {
        continue;
      }
      const avg = present.reduce((a, b) => a + b, 0) / present.length;
      allSeries.push({ name, label: info.label, avg, points: info.shares });
    }
    allSeries.sort((a, b) => b.avg - a.avg);

    // Window-days for chart X-axis spans from the earliest event to today.
    const earliest = days[0].date.getTime();
    const windowDays = Math.max(7, Math.ceil((Date.now() - earliest) / DAY_MS) + 2);

    return { series: allSeries.slice(0, TOP_ARCHETYPES_FOR_CHART), days, windowDays };
  });

  return (
    <>
      <Section
        title='Archetype share over time'
        right={`${archetypeSeries().days.length} days · ${sample().length} events`}
      >
        <Show
          when={snapshots() && archetypeSeries().series.length > 0}
          fallback={
            <Show
              when={snapshots.loading}
              fallback={
                <EmptyState
                  title='Not enough major events.'
                  description='Fewer than two regional / international / special championships are available. Widen the window or switch to the online source.'
                />
              }
            >
              <Skeleton height='360px' />
            </Show>
          }
        >
          <ArchetypeTrendChart
            series={archetypeSeries().series}
            days={archetypeSeries().days}
            windowDays={archetypeSeries().windowDays}
          />
        </Show>
      </Section>

      <Section title='Top card movers' right={`Across ${sample().length} tournaments`}>
        <Show
          when={snapshots() && (movers().rising.length > 0 || movers().falling.length > 0)}
          fallback={
            <Show when={snapshots.loading}>
              <div class='movers'>
                <Skeleton height='320px' />
                <Skeleton height='320px' />
              </div>
            </Show>
          }
        >
          <div class='movers'>
            <div class='mover-col'>
              <h3 class='up'>Rising — biggest gainers</h3>
              <For each={movers().rising}>
                {(m, idx) => (
                  <A
                    href={m.item.set && m.item.number ? `/cards/${m.item.set}/${m.item.number}` : '#'}
                    class='mover-row'
                  >
                    <span class='rank'>{idx() + 1}</span>
                    <span class='name'>{m.item.name}</span>
                    <span class='set'>
                      {m.item.set}/{m.item.number}
                    </span>
                    <span class='delta up'>↑ {m.delta.toFixed(1)}%</span>
                  </A>
                )}
              </For>
            </div>
            <div class='mover-col'>
              <h3 class='down'>Falling — biggest losers</h3>
              <For each={movers().falling}>
                {(m, idx) => (
                  <A
                    href={m.item.set && m.item.number ? `/cards/${m.item.set}/${m.item.number}` : '#'}
                    class='mover-row'
                  >
                    <span class='rank'>{idx() + 1}</span>
                    <span class='name'>{m.item.name}</span>
                    <span class='set'>
                      {m.item.set}/{m.item.number}
                    </span>
                    <span class='delta down'>↓ {Math.abs(m.delta).toFixed(1)}%</span>
                  </A>
                )}
              </For>
            </div>
          </div>
        </Show>
      </Section>

      <Show when={movers().newcomers.length > 0}>
        <Section title='Newcomers' right='Appeared only in recent events'>
          <div class='mover-col'>
            <For each={movers().newcomers}>
              {(m, idx) => (
                <A href={m.item.set && m.item.number ? `/cards/${m.item.set}/${m.item.number}` : '#'} class='mover-row'>
                  <span class='rank'>{idx() + 1}</span>
                  <span class='name'>{m.item.name}</span>
                  <span class='set'>
                    {m.item.set}/{m.item.number}
                  </span>
                  <span class='delta up'>{(m.recentAvg ?? 0).toFixed(1)}%</span>
                </A>
              )}
            </For>
          </div>
        </Section>
      </Show>
    </>
  );
}

/* ============================================================
   Shared chart
   ============================================================ */

interface ArchetypeSeries {
  name: string;
  label: string;
  avg: number;
  points: (number | null)[];
}

interface DayBin {
  key: string;
  date: Date;
  count: number;
  snaps?: EventSnapshot[];
}

function ArchetypeTrendChart(props: { series: ArchetypeSeries[]; days: DayBin[]; windowDays: number }) {
  const PADDING = { top: 16, right: 16, bottom: 32, left: 38 };
  const HEIGHT = 320;
  // Width is measured from the container so the SVG fills horizontally without
  // ever stretching its coordinates. Text and dots stay at a constant size.
  let containerRef: HTMLDivElement | undefined;
  const [width, setWidth] = createSignal(880);
  onMount(() => {
    if (!containerRef) {
      return;
    }
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) {
          setWidth(w);
        }
      }
    });
    ro.observe(containerRef);
    onCleanup(() => ro.disconnect());
  });
  const innerW = () => width() - PADDING.left - PADDING.right;
  const innerH = () => HEIGHT - PADDING.top - PADDING.bottom;

  // X domain spans the actual data range so the line fills the chart width,
  // regardless of how wide the user's window selector is.
  const xDomain = createMemo(() => {
    if (props.days.length === 0) {
      const now = Date.now();
      return { start: now - DAY_MS, end: now };
    }
    const start = props.days[0].date.getTime();
    const end = props.days[props.days.length - 1].date.getTime();
    return { start, end: start === end ? start + DAY_MS : end };
  });

  function x(d: Date): number {
    const { start, end } = xDomain();
    const t = d.getTime();
    const frac = (t - start) / (end - start);
    return PADDING.left + Math.max(0, Math.min(1, frac)) * innerW();
  }

  // Y domain: max rounded up to nearest %, min rounded down to nearest % —
  // so the chart fills vertically too.
  const yDomain = createMemo(() => {
    let max = -Infinity;
    let min = Infinity;
    for (const s of props.series) {
      for (const p of s.points) {
        if (p === null || !Number.isFinite(p)) {
          continue;
        }
        if (p > max) {
          max = p;
        }
        if (p < min) {
          min = p;
        }
      }
    }
    if (!Number.isFinite(max)) {
      return { min: 0, max: 10 };
    }
    const yMax = Math.max(1, Math.ceil(max));
    const yMin = Math.max(0, Math.floor(min));
    return { min: yMin === yMax ? Math.max(0, yMax - 1) : yMin, max: yMax };
  });

  const y = (v: number) => {
    const { min, max } = yDomain();
    return PADDING.top + innerH() - ((v - min) / (max - min)) * innerH();
  };

  const yTicks = () => {
    const { min, max } = yDomain();
    const range = max - min;
    const step = range <= 4 ? 1 : range <= 10 ? 2 : range <= 25 ? 5 : 10;
    const set = new Set<number>();
    set.add(min);
    set.add(max);
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
      if (v > min && v < max) {
        set.add(v);
      }
    }
    return Array.from(set).sort((a, b) => a - b);
  };

  function pathFor(points: (number | null)[]): string {
    let d = '';
    let started = false;
    for (let i = 0; i < points.length; i++) {
      const v = points[i];
      if (v === null) {
        continue;
      }
      const cmd = started ? 'L' : 'M';
      d += `${cmd} ${x(props.days[i].date).toFixed(1)} ${y(v).toFixed(1)} `;
      started = true;
    }
    return d.trim();
  }

  const xTicks = () => {
    const { start, end } = xDomain();
    const span = end - start;
    const days = Math.max(1, Math.round(span / DAY_MS));
    // Aim for ~6 ticks but never more than one per day, and at least 2.
    const COUNT = Math.min(7, Math.max(2, days + 1));
    const ticks: { label: string; xPx: number }[] = [];
    for (let i = 0; i < COUNT; i++) {
      const frac = COUNT === 1 ? 0 : i / (COUNT - 1);
      const tMs = start + frac * span;
      const d = new Date(tMs);
      ticks.push({
        label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        xPx: PADDING.left + frac * innerW()
      });
    }
    return ticks;
  };

  // Drop per-point dots when there are many daily points — the line itself is the story.
  const showDots = () => props.days.length <= 14;

  // Crosshair index. `hoverIdx` follows the mouse and clears on leave; `pinIdx`
  // is set by tap on touch/pen devices and persists until tapped again. The
  // effective index is hover ?? pin so a mouse user's transient hover always
  // wins over a stale pin.
  const [hoverIdx, setHoverIdx] = createSignal<number | null>(null);
  const [pinIdx, setPinIdx] = createSignal<number | null>(null);
  let svgRef: SVGSVGElement | undefined;

  function indexFromPointer(e: PointerEvent): number | null {
    if (!svgRef || props.days.length === 0) {
      return null;
    }
    const rect = svgRef.getBoundingClientRect();
    if (rect.width === 0) {
      return null;
    }
    const svgX = ((e.clientX - rect.left) / rect.width) * width();
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < props.days.length; i++) {
      const dx = Math.abs(x(props.days[i].date) - svgX);
      if (dx < bestDist) {
        bestDist = dx;
        best = i;
      }
    }
    return best;
  }

  function handlePointerMove(e: PointerEvent) {
    if (e.pointerType !== 'mouse') {
      return;
    }
    setHoverIdx(indexFromPointer(e));
  }
  function handlePointerLeave() {
    setHoverIdx(null);
  }
  function handlePointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      return;
    }
    const idx = indexFromPointer(e);
    if (idx === null) {
      return;
    }
    setPinIdx(prev => (prev === idx ? null : idx));
  }

  const hoverData = createMemo(() => {
    const i = hoverIdx() ?? pinIdx();
    if (i === null || i >= props.days.length) {
      return null;
    }
    const day = props.days[i];
    const entries = props.series
      .map((s, idx) => ({
        label: s.label,
        color: ARCHETYPE_LINE_COLORS[idx % ARCHETYPE_LINE_COLORS.length],
        value: s.points[i]
      }))
      .filter((e): e is { label: string; color: string; value: number } => e.value !== null);
    return { day, entries, xPx: x(day.date) };
  });

  return (
    <div class='chart-card' ref={containerRef}>
      <div class='chart-svg-wrap'>
        <svg
          class='chart trend-chart'
          ref={svgRef}
          width={width()}
          height={HEIGHT}
          viewBox={`0 0 ${width()} ${HEIGHT}`}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onPointerDown={handlePointerDown}
        >
          <g class='grid'>
            <For each={yTicks()}>
              {v => (
                <>
                  <line x1={PADDING.left} x2={width() - PADDING.right} y1={y(v)} y2={y(v)} />
                  <text x={PADDING.left - 6} y={y(v)} class='axis-label' text-anchor='end' dominant-baseline='middle'>
                    {v}%
                  </text>
                </>
              )}
            </For>
          </g>

          <g>
            <For each={xTicks()}>
              {tick => (
                <text x={tick.xPx} y={HEIGHT - PADDING.bottom + 18} class='axis-label' text-anchor='middle'>
                  {tick.label}
                </text>
              )}
            </For>
          </g>

          <For each={props.series}>
            {(series, i) => {
              const color = ARCHETYPE_LINE_COLORS[i() % ARCHETYPE_LINE_COLORS.length];
              return (
                <>
                  <path
                    d={pathFor(series.points)}
                    fill='none'
                    stroke={color}
                    stroke-width='2'
                    stroke-linecap='round'
                    stroke-linejoin='round'
                  />
                  <Show when={showDots()}>
                    <For each={series.points}>
                      {(v, j) =>
                        v === null ? null : (
                          <circle cx={x(props.days[j()].date)} cy={y(v as number)} r='3' fill={color} />
                        )
                      }
                    </For>
                  </Show>
                </>
              );
            }}
          </For>

          <Show when={hoverData()}>
            {h => (
              <g class='hover-layer' pointer-events='none'>
                <line x1={h().xPx} x2={h().xPx} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} class='hover-line' />
                <For each={h().entries}>
                  {e => <circle cx={h().xPx} cy={y(e.value)} r='4.5' fill={e.color} class='hover-dot' />}
                </For>
              </g>
            )}
          </Show>
        </svg>

        <Show when={hoverData()}>
          {h => {
            const w = width();
            const isRight = h().xPx > w / 2;
            return (
              <div class='chart-tooltip' classList={{ 'is-right': isRight }} style={{ left: `${h().xPx}px` }}>
                <div class='chart-tooltip-date'>
                  {h().day.date.toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric'
                  })}
                </div>
                <ul class='chart-tooltip-list'>
                  <For each={[...h().entries].sort((a, b) => b.value - a.value)}>
                    {e => (
                      <li>
                        <span class='dot' style={{ background: e.color }} />
                        <span class='label'>{e.label}</span>
                        <span class='value'>{e.value.toFixed(1)}%</span>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            );
          }}
        </Show>
      </div>

      <div class='chart-legend trend-legend'>
        <For each={props.series}>
          {(s, i) => (
            <span class='leg' style={{ '--leg-color': ARCHETYPE_LINE_COLORS[i() % ARCHETYPE_LINE_COLORS.length] }}>
              {s.label}
              <span class='muted-cell'> · {s.avg.toFixed(1)}% avg</span>
            </span>
          )}
        </For>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface Mover {
  item: CardItem;
  recentAvg: number | null;
  olderAvg: number | null;
  delta: number;
}

interface CardTrendLike {
  name: string;
  set: string | null;
  number: string | null;
  delta: number;
}
