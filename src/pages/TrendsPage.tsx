import { createMemo, createResource, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { A } from '@solidjs/router';
import {
  fetchArchetypes,
  fetchMaster,
  fetchOnlineTrendReport,
  fetchPriceHistory,
  fetchTournamentsList,
  getArchetypeIconMap,
  majorTournaments,
  PRICE_HISTORY_MIN_DAYS,
  priceHistorySpanDays,
  resolveArchetypeIcons,
  tournamentDate
} from '../lib/data';
import type { ArchetypeIndexEntry, CardItem } from '../types';
import { ArchetypeIcons } from '../components/ArchetypeIcon';
import { Section } from '../components/Section';
import { Segmented } from '../components/Segmented';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { createPersistentSignal } from '../lib/persistentSignal';
import { shortDate } from '../lib/format';
import { latestValue } from '../lib/resource';
import '../styles/pages/trends.css';

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
/** Never draw more than this many lines at once — the chart stays readable. */
const MAX_VISIBLE_SERIES = 8;
/** A newcomer must hold at least this share (%) in the recent half to be listed. */
const NEWCOMER_MIN_SHARE = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Stable line color for a series by its rank index (cycles the palette). */
function lineColor(index: number): string {
  return ARCHETYPE_LINE_COLORS[index % ARCHETYPE_LINE_COLORS.length];
}

/** "3 hours ago" from an ISO timestamp, or null if unparseable. Plain words, no em dashes. */
function relativeTimeFrom(iso: string | undefined): string | null {
  if (!iso) {
    return null;
  }
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return null;
  }
  const mins = Math.round((Date.now() - t) / 60000);
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

/** "Jun 6 to Jul 6" from two YYYY-MM-DD strings, or null if either is unparseable. */
function formatDateWindow(start: string | undefined, end: string | undefined): string | null {
  const fmt = (d: string | undefined): string | null => {
    if (!d) {
      return null;
    }
    const t = Date.parse(`${d}T12:00:00Z`);
    if (!Number.isFinite(t)) {
      return null;
    }
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const s = fmt(start);
  const e = fmt(end);
  if (!s || !e) {
    return null;
  }
  return `${s} to ${e}`;
}

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

      <PriceMovers />
    </>
  );
}

/* ============================================================
   PRICE MOVERS — biggest TCGPlayer market-price swings
   ============================================================ */

interface PriceMover {
  uid: string;
  name: string;
  set: string;
  number: string;
  start: number;
  current: number;
  delta: number;
}

/** Minimum current price to list — filters out penny cards whose swings are noise. */
const PRICE_MOVER_MIN = 1;
/** Minimum absolute dollar swing to count as a mover. */
const PRICE_MOVER_MIN_DELTA = 0.25;

/**
 * Price movers, independent of the online/majors toggle: the biggest first-to-
 * last swings in the rolling 90-day price history. Renders nothing until the
 * history spans PRICE_HISTORY_MIN_DAYS, so it stays invisible rather than
 * showing a placeholder while the pipeline accumulates its first month of data.
 */
function PriceMovers() {
  const [history] = createResource(fetchPriceHistory);
  const historyData = () => latestValue(history);

  const movers = createMemo<{ rising: PriceMover[]; falling: PriceMover[] }>(() => {
    const h = historyData();
    if (!h || priceHistorySpanDays(h) < PRICE_HISTORY_MIN_DAYS) {
      return { rising: [], falling: [] };
    }
    const all: PriceMover[] = [];
    for (const [uid, points] of Object.entries(h)) {
      if (points.length < 2) {
        continue;
      }
      const start = points[0].price;
      const current = points[points.length - 1].price;
      const delta = current - start;
      if (current < PRICE_MOVER_MIN || Math.abs(delta) < PRICE_MOVER_MIN_DELTA) {
        continue;
      }
      const parts = uid.split('::');
      if (parts.length < 3) {
        continue;
      }
      all.push({ uid, name: parts[0], set: parts[1], number: parts[2], start, current, delta });
    }
    const rising = all
      .filter(m => m.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 12);
    const falling = all
      .filter(m => m.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 12);
    return { rising, falling };
  });

  return (
    <Show when={movers().rising.length > 0 || movers().falling.length > 0}>
      <Section title='Price movers' right='Biggest market-price swings, last 90 days'>
        <div class='movers'>
          <div class='mover-col'>
            <h3 class='up'>Rising: biggest gainers</h3>
            <For each={movers().rising}>
              {(m, idx) => (
                <A href={`/cards/${m.set}/${m.number}`} class='mover-row'>
                  <span class='rank'>{idx() + 1}</span>
                  <span class='name'>{m.name}</span>
                  <span class='set'>
                    {m.set}/{m.number}
                  </span>
                  <span class='delta up'>
                    <span class='delta-pp'>↑ ${m.delta.toFixed(2)}</span>
                    <span class='delta-base'>
                      ${m.start.toFixed(2)} → ${m.current.toFixed(2)}
                    </span>
                  </span>
                </A>
              )}
            </For>
          </div>
          <div class='mover-col'>
            <h3 class='down'>Falling: biggest drops</h3>
            <For each={movers().falling}>
              {(m, idx) => (
                <A href={`/cards/${m.set}/${m.number}`} class='mover-row'>
                  <span class='rank'>{idx() + 1}</span>
                  <span class='name'>{m.name}</span>
                  <span class='set'>
                    {m.set}/{m.number}
                  </span>
                  <span class='delta down'>
                    <span class='delta-pp'>↓ ${Math.abs(m.delta).toFixed(2)}</span>
                    <span class='delta-base'>
                      ${m.start.toFixed(2)} → ${m.current.toFixed(2)}
                    </span>
                  </span>
                </A>
              )}
            </For>
          </div>
        </div>
      </Section>
    </Show>
  );
}

/* ============================================================
   ONLINE — daily timeline + card-trend lists from cron
   ============================================================ */

function OnlineView(props: { windowKey: OnlineWindow }) {
  const [trends] = createResource(fetchOnlineTrendReport);

  // Non-suspending read: keeps navigation instant and lets the skeleton
  // fallbacks below actually render (see lib/resource.ts).
  const trendsData = () => latestValue(trends);

  /**
   * Pick the top-N archetypes by avgShare across the full file, then slice
   * each archetype's timeline to the selected window.
   */
  const chart = createMemo<{ series: ArchetypeSeries[]; days: DayBin[] }>(() => {
    const data = trendsData();
    if (!data) {
      return { series: [], days: [] };
    }
    const report = data.trendReport;
    if (!report || !report.series || report.series.length === 0) {
      return { series: [], days: [] };
    }

    const windowDays = ONLINE_WINDOW_DAYS[props.windowKey];
    // Anchor the window to the payload's own end date, not Date.now(). If the
    // cron lags, wall-clock "now" drifts past the newest data and a 7-day window
    // would slide off the end; anchoring to windowEnd keeps the window aligned
    // with what the file actually contains.
    const windowEndMs = Date.parse(`${report.windowEnd}T12:00:00Z`);
    const anchorMs = Number.isFinite(windowEndMs) ? windowEndMs : Date.now();
    const cutoffMs = anchorMs - windowDays * DAY_MS;

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

    // Rank every archetype by avgShare across the file (the cron's avg over the
    // full 30-day window — a stable "popularity ranking"). The full ranked list
    // is handed to the chart, which draws the top-N by default and lets the user
    // toggle series or add their own deck. Ranking order is stable, so each
    // series keeps its color regardless of what's toggled.
    const ranked = [...report.series].sort((a, b) => b.avgShare - a.avgShare);

    const series: ArchetypeSeries[] = ranked.map(s => {
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

  /** Card-level movers from the cron's pre-computed lists, sliced (top 12 each). */
  const cardMovers = createMemo(() => {
    const data = trendsData();
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
    const data = trendsData();
    if (!data) {
      return null;
    }
    const tc = data.trendReport.tournamentCount;
    return `${tc.toLocaleString()} online events aggregated`;
  });

  /**
   * Freshness + window straight from the payload (not Date.now), so the label
   * never silently disagrees with the data when the cron lags.
   */
  const dataStamp = createMemo(() => {
    const data = trendsData();
    if (!data) {
      return null;
    }
    const report = data.trendReport;
    const updated = relativeTimeFrom(report.generatedAt);
    const window = formatDateWindow(report.windowStart, report.windowEnd);
    if (!updated && !window) {
      return null;
    }
    return { updated, window };
  });

  return (
    <>
      <Section
        title='Archetype share over time'
        right={
          <Show when={trendsData() !== undefined} fallback='—'>
            {chart().days.length} daily snapshots · {sourceCaption()}
          </Show>
        }
      >
        <Show when={dataStamp()}>
          {stamp => (
            <p class='trends-stamp'>
              <Show when={stamp().window}>{w => <span>Window {w()}.</span>}</Show>{' '}
              <Show when={stamp().updated}>{u => <span>Updated {u()}.</span>}</Show>
            </p>
          )}
        </Show>
        <Show when={trendsData() !== undefined} fallback={<Skeleton height='360px' />}>
          <Show
            when={trendsData() && chart().series.length > 0}
            fallback={
              <EmptyState
                title='No online trend data yet.'
                description="The cron-built trend file isn't published yet. Switch source to 'Majors (events)' for per-tournament data, or check back after the cron's next run."
              />
            }
          >
            <ArchetypeTrendChart series={chart().series} days={chart().days} />
          </Show>
        </Show>
      </Section>

      <Show when={cardMovers().rising.length > 0 || cardMovers().falling.length > 0}>
        <Section title='Top card movers' right='Rising and falling cards across the window'>
          <div class='movers'>
            <MoverColumn<CardTrendLike>
              title='Rising: biggest gainers'
              titleClass='up'
              rows={cardMovers().rising}
              href={m => (m.set && m.number ? `/cards/${m.set}/${m.number}` : '#')}
              name={m => m.name}
              setLabel={m => (
                <>
                  {m.set ?? ''}/{m.number ?? ''}
                </>
              )}
              trailing={m => (
                <span class='delta up'>
                  <span class='delta-pp'>↑ {Math.abs(m.delta).toFixed(1)} pp</span>
                  <span class='delta-base'>
                    {m.startShare.toFixed(1)} → {m.endShare.toFixed(1)}%
                  </span>
                </span>
              )}
            />
            <MoverColumn<CardTrendLike>
              title='Falling: biggest losers'
              titleClass='down'
              rows={cardMovers().falling}
              href={m => (m.set && m.number ? `/cards/${m.set}/${m.number}` : '#')}
              name={m => m.name}
              setLabel={m => (
                <>
                  {m.set ?? ''}/{m.number ?? ''}
                </>
              )}
              trailing={m => (
                <span class='delta down'>
                  <span class='delta-pp'>↓ {Math.abs(m.delta).toFixed(1)} pp</span>
                  <span class='delta-base'>
                    {m.startShare.toFixed(1)} → {m.endShare.toFixed(1)}%
                  </span>
                </span>
              )}
            />
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

  // Non-suspending read (see lib/resource.ts).
  const tournamentsData = () => latestValue(tournaments);

  const sample = createMemo<string[]>(() => {
    const list = tournamentsData() ?? [];
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
  // `latestValue`: window-size switches refetch the snapshots — keep the old
  // chart in place instead of flashing a skeleton.
  const snapshotsData = () => latestValue(snapshots);

  const movers = createMemo<MoversResult>(() => {
    const empty = (enough: boolean, coverage: HalfCoverage | null): MoversResult => ({
      rising: [],
      falling: [],
      newcomers: [],
      enoughForMovers: enough,
      coverage,
      newcomerMin: NEWCOMER_MIN_SHARE
    });

    const reps = (snapshotsData() ?? []).filter(r => r.master !== null);
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
      let weight = 0;
      for (let i = 0; i < maps.length; i++) {
        const item = maps[i].get(key);
        if (item && Number.isFinite(item.pct)) {
          sum += item.pct * weights[i];
          weight += weights[i];
        }
      }
      return weight === 0 ? null : sum / weight;
    };
    const appearancesFor = (maps: Map<string, CardItem>[], key: string): number =>
      maps.reduce((n, m) => (m.has(key) ? n + 1 : n), 0);

    const all: Mover[] = [];
    for (const [key, item] of allKeys) {
      const recentAvg = avgFor(recentMaps, recentWeights, key);
      const olderAvg = avgFor(olderMaps, olderWeights, key);
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
      .filter(m => m.olderAvg === null && m.recentAvg !== null && m.recentAvg >= NEWCOMER_MIN_SHARE)
      .sort((a, b) => (b.recentAvg ?? 0) - (a.recentAvg ?? 0))
      .slice(0, 8);
    return { rising, falling, newcomers, enoughForMovers: true, coverage, newcomerMin: NEWCOMER_MIN_SHARE };
  });

  const archetypeSeries = createMemo<{ series: ArchetypeSeries[]; days: DayBin[] }>(() => {
    const reps = (snapshotsData() ?? []).filter(r => r.archetypes !== null);
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
    // day's value is the true pooled share. The old (existing + raw) / 2 merge
    // was order-dependent — a third same-day event got weight 1/2 while the
    // first two got 1/4 — and every event counted equally regardless of size.
    const byArche = new Map<string, { label: string; num: number[]; den: number[] }>();
    days.forEach((day, dayIdx) => {
      for (const snap of day.snaps!) {
        // Per-event archetype reports store `percent` as either a 0..1 fraction
        // (post-3939e71) or a 0..100 value (older files). The scale is uniform
        // within a file, so detect it once per snapshot: a fractional file's max
        // is ≤1, while a 0..100 file always has a dominant deck >1. Detecting
        // per-value instead would wrongly inflate sub-1% niche decks (e.g. a deck
        // at 0.84% in a 0..100 file) into 84%.
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
  });

  return (
    <>
      <Section
        title='Archetype share over time'
        right={`${archetypeSeries().days.length} days · ${sample().length} events`}
      >
        <Show
          when={snapshotsData() && archetypeSeries().series.length > 0}
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
          <ArchetypeTrendChart series={archetypeSeries().series} days={archetypeSeries().days} />
        </Show>
      </Section>

      <Section title='Top card movers' right={`Across ${sample().length} tournaments`}>
        <Show
          when={snapshotsData() && movers().enoughForMovers}
          fallback={
            <Show
              when={snapshots.loading}
              fallback={
                <EmptyState
                  title='Not enough events to compare'
                  description='Card movers compare the recent half of the window against the older half, and each half needs at least two events so a single tournament does not read as a trend. Widen the window to Last 5 or Last 10 events.'
                />
              }
            >
              <div class='movers'>
                <Skeleton height='320px' />
                <Skeleton height='320px' />
              </div>
            </Show>
          }
        >
          <Show when={movers().coverage}>
            {c => (
              <p class='movers-note'>
                Recent half: {c().recentCount} events, {c().recent}. Earlier half: {c().olderCount} events, {c().older}.
                Shares are weighted by each event's deck total.
              </p>
            )}
          </Show>
          <div class='movers'>
            <MoverColumn<Mover>
              title='Rising: biggest gainers'
              titleClass='up'
              rows={movers().rising}
              href={m => (m.item.set && m.item.number ? `/cards/${m.item.set}/${m.item.number}` : '#')}
              name={m => m.item.name}
              setLabel={m => (
                <>
                  {m.item.set}/{m.item.number}
                </>
              )}
              trailing={m => (
                <span class='delta up'>
                  <span class='delta-pp'>↑ {m.delta.toFixed(1)} pp</span>
                  <span class='delta-base'>
                    {(m.olderAvg ?? 0).toFixed(1)} → {(m.recentAvg ?? 0).toFixed(1)}%
                  </span>
                </span>
              )}
            />
            <MoverColumn<Mover>
              title='Falling: biggest losers'
              titleClass='down'
              rows={movers().falling}
              href={m => (m.item.set && m.item.number ? `/cards/${m.item.set}/${m.item.number}` : '#')}
              name={m => m.item.name}
              setLabel={m => (
                <>
                  {m.item.set}/{m.item.number}
                </>
              )}
              trailing={m => (
                <span class='delta down'>
                  <span class='delta-pp'>↓ {Math.abs(m.delta).toFixed(1)} pp</span>
                  <span class='delta-base'>
                    {(m.olderAvg ?? 0).toFixed(1)} → {(m.recentAvg ?? 0).toFixed(1)}%
                  </span>
                </span>
              )}
            />
          </div>
        </Show>
      </Section>

      <Show when={movers().newcomers.length > 0}>
        <Section title='Newcomers' right='Appeared only in recent events'>
          <MoverColumn<Mover>
            note={
              <Show when={movers().coverage}>
                {c => (
                  <p class='movers-note'>
                    Held at least {movers().newcomerMin}% share in the recent half ({c().recent}) and absent from the
                    older half.
                  </p>
                )}
              </Show>
            }
            rows={movers().newcomers}
            href={m => (m.item.set && m.item.number ? `/cards/${m.item.set}/${m.item.number}` : '#')}
            name={m => m.item.name}
            setLabel={m => (
              <>
                {m.item.set}/{m.item.number}
              </>
            )}
            trailing={m => <span class='share-neutral'>{(m.recentAvg ?? 0).toFixed(1)}% of decks</span>}
          />
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

function ArchetypeTrendChart(props: { series: ArchetypeSeries[]; days: DayBin[] }) {
  const iconMap = getArchetypeIconMap();
  const PADDING = { top: 16, right: 16, bottom: 32, left: 46 };

  // ---- Series visibility ----
  // `props.series` is the full ranked list. We draw the top-N by default; the
  // user can hide any line (click the legend) or add any archetype (the select).
  // Colors are keyed by rank index in the full list, so they never shift as
  // series are toggled or added.
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
  const [added, setAdded] = createSignal<string[]>([]);
  const [legendHover, setLegendHover] = createSignal<string | null>(null);

  const colorByName = createMemo(() => {
    const m = new Map<string, string>();
    props.series.forEach((s, i) => m.set(s.name, lineColor(i)));
    return m;
  });
  const colorOf = (name: string): string => colorByName().get(name) ?? lineColor(0);

  // Resolve each series' archetype icon slugs once per series list, rather than
  // per render inside the hover tooltip.
  const slugsByName = createMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of props.series) {
      m.set(s.name, resolveArchetypeIcons({ name: s.name, label: s.label }, iconMap));
    }
    return m;
  });
  const slugsOf = (s: ArchetypeSeries): string[] =>
    slugsByName().get(s.name) ?? resolveArchetypeIcons({ name: s.name, label: s.label }, iconMap);

  const legendList = createMemo<ArchetypeSeries[]>(() => {
    const base = props.series.slice(0, TOP_ARCHETYPES_FOR_CHART);
    const extra = added()
      .map(n => props.series.find(s => s.name === n))
      .filter((s): s is ArchetypeSeries => s !== undefined);
    return [...base, ...extra];
  });
  const visibleSeries = createMemo<ArchetypeSeries[]>(() =>
    legendList()
      .filter(s => !hidden().has(s.name))
      .slice(0, MAX_VISIBLE_SERIES)
  );
  const atCap = () => visibleSeries().length >= MAX_VISIBLE_SERIES;
  const addable = createMemo<ArchetypeSeries[]>(() => {
    const shown = new Set(legendList().map(s => s.name));
    return props.series.filter(s => !shown.has(s.name));
  });

  function toggleSeries(name: string) {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        // Re-showing: respect the visible cap.
        if (visibleSeries().length >= MAX_VISIBLE_SERIES) {
          return prev;
        }
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }
  function onAddSeries(e: Event & { currentTarget: HTMLSelectElement }) {
    const select = e.currentTarget;
    const name = select.value;
    select.value = '';
    if (!name || atCap()) {
      return;
    }
    setAdded(prev => (prev.includes(name) ? prev : [...prev, name]));
  }

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
  // Shorter chart on phones: at 320px tall the chart plus legend ate most of
  // the first screen (F5). Width is the container width, so <560 ≈ phone.
  const height = () => (width() < 560 ? 240 : 320);
  const innerH = () => height() - PADDING.top - PADDING.bottom;

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
    for (const s of visibleSeries()) {
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

  // Break the path at gaps: each run of consecutive present points is its own
  // `M…L` subpath, so a missing day leaves a gap instead of a fabricated straight
  // line. A run of one point has no line to draw, so it's emitted as a dot.
  function segmentsFor(points: (number | null)[]): { d: string; isolated: { x: number; y: number }[] } {
    let d = '';
    const isolated: { x: number; y: number }[] = [];
    let i = 0;
    while (i < points.length) {
      const v = points[i];
      if (v === null || !Number.isFinite(v)) {
        i++;
        continue;
      }
      let j = i;
      while (j < points.length) {
        const w = points[j];
        if (w === null || !Number.isFinite(w)) {
          break;
        }
        j++;
      }
      if (j - i === 1) {
        isolated.push({ x: x(props.days[i].date), y: y(points[i] as number) });
      } else {
        for (let k = i; k < j; k++) {
          const cmd = k === i ? 'M' : 'L';
          d += `${cmd} ${x(props.days[k].date).toFixed(1)} ${y(points[k] as number).toFixed(1)} `;
        }
      }
      i = j;
    }
    return { d: d.trim(), isolated };
  }

  // Snap ticks to real data dates so a label never lands on a day with no data.
  const xTicks = () => {
    const count = props.days.length;
    if (count === 0) {
      return [] as { label: string; xPx: number }[];
    }
    const tickCount = Math.min(7, count);
    const seen = new Set<number>();
    const ticks: { label: string; xPx: number }[] = [];
    for (let i = 0; i < tickCount; i++) {
      const idx = tickCount === 1 ? 0 : Math.round((i / (tickCount - 1)) * (count - 1));
      if (seen.has(idx)) {
        continue;
      }
      seen.add(idx);
      const d = props.days[idx].date;
      ticks.push({
        label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        xPx: x(d)
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

  // On touch, a horizontal drag scrubs the crosshair day-by-day (touch-action:
  // pan-y on the svg leaves vertical scrolling to the browser).
  let scrubbing = false;

  function handlePointerMove(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      setHoverIdx(indexFromPointer(e));
      return;
    }
    if (scrubbing) {
      const idx = indexFromPointer(e);
      if (idx !== null && idx !== pinIdx()) {
        setPinIdx(idx);
      }
    }
  }
  function handlePointerLeave() {
    setHoverIdx(null);
  }
  function handlePointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      return;
    }
    scrubbing = true;
    svgRef?.setPointerCapture(e.pointerId);
    const idx = indexFromPointer(e);
    if (idx === null) {
      return;
    }
    setPinIdx(prev => (prev === idx ? null : idx));
  }
  function handlePointerUp() {
    scrubbing = false;
  }

  const hoverData = createMemo(() => {
    const i = hoverIdx() ?? pinIdx();
    if (i === null || i >= props.days.length) {
      return null;
    }
    const day = props.days[i];
    const entries = visibleSeries()
      .map(s => ({
        label: s.label,
        slugs: slugsOf(s),
        color: colorOf(s.name),
        value: s.points[i]
      }))
      .filter((e): e is { label: string; slugs: string[]; color: string; value: number } => e.value !== null)
      .sort((a, b) => b.value - a.value);
    return { day, entries, xPx: x(day.date) };
  });

  return (
    <div class='chart-card' ref={containerRef}>
      <div class='chart-svg-wrap'>
        <svg
          class='chart trend-chart'
          ref={svgRef}
          width={width()}
          height={height()}
          viewBox={`0 0 ${width()} ${height()}`}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
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

          <text
            class='axis-title'
            x={12}
            y={PADDING.top + innerH() / 2}
            transform={`rotate(-90 12 ${PADDING.top + innerH() / 2})`}
            text-anchor='middle'
          >
            Meta share (%)
          </text>

          <g>
            <For each={xTicks()}>
              {tick => (
                <text x={tick.xPx} y={height() - PADDING.bottom + 18} class='axis-label' text-anchor='middle'>
                  {tick.label}
                </text>
              )}
            </For>
          </g>

          <For each={visibleSeries()}>
            {series => {
              const color = colorOf(series.name);
              const seg = createMemo(() => segmentsFor(series.points));
              const dim = () => legendHover() !== null && legendHover() !== series.name;
              return (
                <g style={{ opacity: dim() ? 0.22 : 1 }}>
                  <path
                    d={seg().d}
                    fill='none'
                    stroke={color}
                    stroke-width='2'
                    stroke-linecap='round'
                    stroke-linejoin='round'
                  />
                  <Show
                    when={showDots()}
                    fallback={
                      <For each={seg().isolated}>{pt => <circle cx={pt.x} cy={pt.y} r='3' fill={color} />}</For>
                    }
                  >
                    <For each={series.points}>
                      {(v, j) =>
                        v === null ? null : (
                          <circle cx={x(props.days[j()].date)} cy={y(v as number)} r='3' fill={color} />
                        )
                      }
                    </For>
                  </Show>
                </g>
              );
            }}
          </For>

          <Show when={hoverData()}>
            {h => (
              <g class='hover-layer' pointer-events='none'>
                <line x1={h().xPx} x2={h().xPx} y1={PADDING.top} y2={height() - PADDING.bottom} class='hover-line' />
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
                  <For each={h().entries}>
                    {e => (
                      <li>
                        <span class='dot' style={{ background: e.color }} />
                        <ArchetypeIcons slugs={e.slugs} size={16} reserveSlot />
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

      <div class='trend-controls'>
        <div class='chart-legend trend-legend'>
          <For each={legendList()}>
            {s => {
              const isHidden = () => hidden().has(s.name);
              return (
                <button
                  type='button'
                  class='leg'
                  classList={{
                    'is-hidden': isHidden(),
                    'is-dim': legendHover() !== null && legendHover() !== s.name && !isHidden()
                  }}
                  style={{ '--leg-color': colorOf(s.name) }}
                  aria-pressed={!isHidden()}
                  title={isHidden() ? 'Click to show' : 'Click to hide'}
                  onClick={() => toggleSeries(s.name)}
                  onMouseEnter={() => setLegendHover(s.name)}
                  onMouseLeave={() => setLegendHover(null)}
                >
                  <ArchetypeIcons slugs={resolveArchetypeIcons({ name: s.name, label: s.label }, iconMap)} size={16} />
                  {s.label}
                  <span class='muted-cell'> · {s.avg.toFixed(1)}% avg</span>
                </button>
              );
            }}
          </For>
        </div>
        <Show when={addable().length > 0}>
          <select
            class='trend-add'
            aria-label='Add an archetype to the chart'
            disabled={atCap()}
            onChange={onAddSeries}
          >
            <option value=''>{atCap() ? `Showing max ${MAX_VISIBLE_SERIES}` : 'Add archetype'}</option>
            <For each={addable()}>{s => <option value={s.name}>{s.label}</option>}</For>
          </select>
        </Show>
      </div>
    </div>
  );
}

/* ============================================================
   Shared movers column
   ============================================================ */

/**
 * A single `mover-col`: an optional heading, an optional lead-in note, and a
 * ranked list of `mover-row` links. The row shape differs between the online
 * (CardTrendLike) and majors (Mover) views, so the caller supplies accessors
 * for the href / name / set label plus the trailing delta (or share) cell.
 */
function MoverColumn<T>(props: {
  title?: string;
  titleClass?: string;
  note?: JSX.Element;
  rows: T[];
  href: (row: T) => string;
  name: (row: T) => string;
  setLabel: (row: T) => JSX.Element;
  trailing: (row: T) => JSX.Element;
}) {
  return (
    <div class='mover-col'>
      <Show when={props.title}>
        <h3 class={props.titleClass}>{props.title}</h3>
      </Show>
      {props.note}
      <For each={props.rows}>
        {(m, idx) => (
          <A href={props.href(m)} class='mover-row'>
            <span class='rank'>{idx() + 1}</span>
            <span class='name'>{props.name(m)}</span>
            <span class='set'>{props.setLabel(m)}</span>
            {props.trailing(m)}
          </A>
        )}
      </For>
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

interface HalfCoverage {
  /** Date range covered by the recent half, e.g. "Jun 6 to Jul 6". */
  recent: string;
  /** Date range covered by the older half. */
  older: string;
  recentCount: number;
  olderCount: number;
}

interface MoversResult {
  rising: Mover[];
  falling: Mover[];
  newcomers: Mover[];
  /** False when a half has fewer than two events, so the list stays hidden. */
  enoughForMovers: boolean;
  coverage: HalfCoverage | null;
  newcomerMin: number;
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

interface CardTrendLike {
  name: string;
  set: string | null;
  number: string | null;
  /** Share-point change over the window (endShare - startShare), in pp. */
  delta: number;
  /** Share at the start of the window, 0..100. */
  startShare: number;
  /** Share at the end of the window, 0..100. */
  endShare: number;
}
