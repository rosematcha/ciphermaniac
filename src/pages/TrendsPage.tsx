import { createMemo, createResource, createSignal, For, type JSX, onMount, Show } from 'solid-js';
import { A } from '@solidjs/router';
import {
  fetchMajorsTrendReport,
  fetchOnlineTrendReport,
  fetchPriceMovers,
  getArchetypeIconMap,
  type PriceMoverList,
  type PriceMoverMetric,
  type PriceMoverRow,
  resolveArchetypeIcons,
  type WeeklyDeck,
  type WeeklyDeckCard,
  type WeeklyMover,
  type WeeklyReport
} from '../lib/data';
import {
  type ArchetypeSeries,
  type DayBin,
  type MajorsWindowResult,
  type MoverRow,
  parseDayKey
} from '../lib/majorsTrends';
import { ArchetypeIcons } from '../components/ArchetypeIcon';
import { Section } from '../components/Section';
import { Segmented } from '../components/Segmented';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { createPersistentSignal } from '../lib/persistentSignal';
import { latestValue } from '../lib/resource';
import { defaultOnlineWindow, ONLINE_WINDOW_DAYS, type OnlineWindow, sliceCardMovers } from './trendsPage/model';
import {
  changeArrow,
  chartFromDaily,
  chartFromWeekly,
  type ChartMetric,
  MAX_LINES,
  railRows,
  rankedArchetypes,
  signedDecimal,
  smoothSeries,
  wholePercent
} from './trendsPage/weekly';
import { ArchetypeTrendChart, lineColor } from './trendsPage/ArchetypeTrendChart';
import { TrendTile } from './trendsPage/TrendTile';
import '../styles/pages/trends.css';

type Source = 'online' | 'majors';
type MajorsWindow = '3-events' | '5-events' | '10-events';

const SOURCE_OPTIONS: { value: Source; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'majors', label: 'Majors' }
];
const ONLINE_WINDOW_OPTIONS: { value: OnlineWindow; label: string }[] = [
  { value: '7d', label: '7d' },
  { value: '14d', label: '14d' },
  { value: '30d', label: '30d' }
];
const MAJORS_WINDOW_OPTIONS: { value: MajorsWindow; label: string }[] = [
  { value: '3-events', label: '3 events' },
  { value: '5-events', label: '5 events' },
  { value: '10-events', label: '10 events' }
];
const METRIC_OPTIONS: { value: ChartMetric; label: string }[] = [
  { value: 'share', label: 'All' },
  { value: 'top10', label: 'Top 10%' }
];
/** Deck blocks shown, and tiles per side inside each. */
const DECK_BLOCKS = 6;
const DECK_TILES = 2;
/** Mover tiles per direction. */
const MOVER_TILES = 4;

/**
 * Trends: what moved this week, and what moved it.
 *
 * The page is one chart with a rail of the archetypes it draws, then the cards
 * each deck added and cut this week against last, then the cards whose share
 * of all lists moved most, then price movers. The online source reads the
 * pipeline's weekly report; the majors source reads the per-event artifact
 * and shows what it can (no deck blocks, since events are too few to compare
 * a deck's lists week to week).
 */
/** The page's controls: signals shared by the two control bands and the views. */
interface TrendsState {
  source: () => Source;
  setSource: (v: Source) => void;
  onlineWindow: () => OnlineWindow;
  setOnlineWindow: (v: OnlineWindow) => void;
  majorsWindow: () => MajorsWindow;
  setMajorsWindow: (v: MajorsWindow) => void;
  metric: () => ChartMetric;
  setMetric: (v: ChartMetric) => void;
}

export function TrendsPage() {
  const [source, setSource] = createPersistentSignal<Source>('cm:trendsSource', 'online', v =>
    v === 'majors' || v === 'online' ? v : null
  );
  const [onlineWindow, setOnlineWindow] = createSignal<OnlineWindow>(defaultOnlineWindow());
  const [majorsWindow, setMajorsWindow] = createSignal<MajorsWindow>('5-events');
  const [metric, setMetric] = createSignal<ChartMetric>('share');
  const state: TrendsState = {
    source,
    setSource,
    onlineWindow,
    setOnlineWindow,
    majorsWindow,
    setMajorsWindow,
    metric,
    setMetric
  };

  onMount(() => {
    document.title = 'Trends — Ciphermaniac';
  });

  return (
    <>
      <Show when={source() === 'online'} fallback={<MajorsView state={state} />}>
        <OnlineView state={state} />
      </Show>
      <PriceMovers />
    </>
  );
}

/**
 * The control band. It renders twice, once in the section head for desktop and
 * once between the chart and the rail for phones, sharing the page's signals.
 */
function Controls(props: { state: TrendsState; showMetric: boolean }) {
  const s = () => props.state;
  return (
    <span class='trends-controls'>
      <Segmented<Source> options={SOURCE_OPTIONS} selected={s().source()} onSelect={s().setSource} ariaLabel='Source' />
      <Show
        when={s().source() === 'online'}
        fallback={
          <Segmented<MajorsWindow>
            options={MAJORS_WINDOW_OPTIONS}
            selected={s().majorsWindow()}
            onSelect={s().setMajorsWindow}
            ariaLabel='Events'
          />
        }
      >
        <Segmented<OnlineWindow>
          options={ONLINE_WINDOW_OPTIONS}
          selected={s().onlineWindow()}
          onSelect={s().setOnlineWindow}
          ariaLabel='Window'
        />
        {/* Only a file with the weekly block carries top-10% shares; the older
            daily series has nothing for the switch to show. */}
        <Show when={props.showMetric}>
          <Segmented<ChartMetric>
            options={METRIC_OPTIONS}
            selected={s().metric()}
            onSelect={s().setMetric}
            ariaLabel='Finishes'
          />
        </Show>
      </Show>
    </span>
  );
}

function OnlineView(props: { state: TrendsState }) {
  const [trends] = createResource(fetchOnlineTrendReport);
  const trendsData = () => latestValue(trends);
  const weekly = (): WeeklyReport | undefined => trendsData()?.weekly;

  const chart = createMemo(() => {
    const data = trendsData();
    const days = ONLINE_WINDOW_DAYS[props.state.onlineWindow()];
    if (!data) {
      return { series: [] as ArchetypeSeries[], days: [] as DayBin[] };
    }
    return data.weekly ? chartFromWeekly(data.weekly, metric(), days) : chartFromDaily(data.trendReport, days);
  });
  const deltas = createMemo(() => {
    const w = weekly();
    return w ? new Map(w.archetypes.map(a => [a.base, a.delta])) : null;
  });
  // Top-10% shares exist only in the weekly block; without it the chart is share.
  const metric = (): ChartMetric => (weekly() ? props.state.metric() : 'share');
  const yLabel = () => (metric() === 'top10' ? 'Share of top-10% finishes' : 'Meta share (%)');

  return (
    <>
      <ChartSection
        state={props.state}
        loaded={trendsData() !== undefined}
        series={chart().series}
        days={chart().days}
        deltas={deltas()}
        showMetric={weekly() !== undefined}
        yLabel={yLabel()}
        empty={
          <EmptyState
            title='No online trend data yet.'
            description="The daily trend file isn't published yet. Switch to Majors for per-event data, or check back after the next run."
          />
        }
      />
      <Show when={weekly()}>{w => <DeckBlocks weekly={w()} />}</Show>
      <Show when={weekly()} fallback={<LegacyMovers payload={trendsData()} />}>
        {w => (
          <MoverSection
            rising={w().movers.rising.slice(0, MOVER_TILES)}
            falling={w().movers.falling.slice(0, MOVER_TILES)}
          />
        )}
      </Show>
    </>
  );
}

function MajorsView(props: { state: TrendsState }) {
  const [report] = createResource(fetchMajorsTrendReport);
  const reportData = () => latestValue(report);
  const windowResult = createMemo<MajorsWindowResult | null>(
    () => reportData()?.windows[props.state.majorsWindow()] ?? null
  );
  const chart = createMemo(() => {
    const w = windowResult();
    if (!w) {
      return { series: [] as ArchetypeSeries[], days: [] as DayBin[] };
    }
    return {
      series: w.series,
      days: w.dayKeys.map(key => ({ key, date: parseDayKey(key), count: 1 }))
    };
  });
  const movers = () => windowResult()?.movers;
  const toTile = (m: MoverRow): JSX.Element => (
    <TrendTile name={m.name} set={m.set} number={m.number} delta={m.delta} level={m.recentAvg ?? 0} />
  );
  return (
    <>
      <ChartSection
        state={props.state}
        loaded={reportData() !== undefined}
        series={chart().series}
        days={chart().days}
        deltas={null}
        showMetric={false}
        yLabel='Meta share (%)'
        empty={
          <EmptyState
            title='Not enough major events.'
            description='Fewer than two championships are available. Widen the window or switch to the online source.'
          />
        }
      />
      <Show when={movers()?.enoughForMovers}>
        <Section title='Top card movers' right='Recent events against the ones before, weighted by field size'>
          <div class='trends-two'>
            <div>
              <h3 class='trends-dir up'>Rising</h3>
              <div class='trends-tiles'>
                <For each={movers()?.rising.slice(0, MOVER_TILES) ?? []}>{toTile}</For>
              </div>
            </div>
            <div>
              <h3 class='trends-dir down'>Falling</h3>
              <div class='trends-tiles'>
                <For each={movers()?.falling.slice(0, MOVER_TILES) ?? []}>{toTile}</For>
              </div>
            </div>
          </div>
        </Section>
      </Show>
    </>
  );
}

/** The chart with its rail; which lines draw is decided here. */
function ChartSection(props: {
  state: TrendsState;
  loaded: boolean;
  series: ArchetypeSeries[];
  days: DayBin[];
  deltas: Map<string, number> | null;
  showMetric: boolean;
  yLabel: string;
  empty: JSX.Element;
}) {
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
  const [added, setAdded] = createSignal<string[]>([]);
  const [highlight, setHighlight] = createSignal<string | null>(null);
  const rows = createMemo(() => railRows(props.series, added(), props.deltas));
  const visible = createMemo(() =>
    rows()
      .map(r => r.name)
      .filter(n => !hidden().has(n))
      .slice(0, MAX_LINES)
  );
  const atCap = () => visible().length >= MAX_LINES;
  const addable = createMemo(() => {
    const shown = new Set(rows().map(r => r.name));
    return props.series.filter(s => !shown.has(s.name));
  });
  const colors = createMemo(() => new Map(rows().map((r, i) => [r.name, lineColor(i)])));
  const colorOf = (name: string) => colors().get(name) ?? lineColor(0);
  const iconMap = getArchetypeIconMap;

  function toggle(name: string) {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        if (atCap()) {
          return prev;
        }
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }
  function remove(name: string) {
    setAdded(prev => prev.filter(n => n !== name));
    setHidden(prev => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
    setHighlight(null);
  }
  function onAdd(e: Event & { currentTarget: HTMLSelectElement }) {
    const select = e.currentTarget;
    const name = select.value;
    select.value = '';
    if (name && !atCap()) {
      setAdded(prev => (prev.includes(name) ? prev : [...prev, name]));
    }
  }

  return (
    <section>
      <div class='section-head'>
        <h2>Archetype share over time</h2>
        <span class='right trends-controls-desktop'>
          <Controls state={props.state} showMetric={props.showMetric} />
        </span>
      </div>
      <Show when={props.loaded} fallback={<Skeleton height='360px' />}>
        <Show when={props.series.length > 0} fallback={props.empty}>
          <div class='trends-chart-layout'>
            <div class='trends-chart-cell'>
              <ArchetypeTrendChart
                series={props.series}
                colors={colors()}
                days={props.days}
                visible={visible()}
                highlight={highlight()}
                yLabel={props.yLabel}
              />
              <div class='trends-controls-phone'>
                <Controls state={props.state} showMetric={props.showMetric} />
              </div>
            </div>
            <div class='trends-rail'>
              <For each={rows()}>
                {row => (
                  <div
                    class='trends-rail-row'
                    classList={{ 'is-hidden': hidden().has(row.name) }}
                    onMouseEnter={() => setHighlight(row.name)}
                    onMouseLeave={() => setHighlight(null)}
                  >
                    <button
                      type='button'
                      class='trends-rail-toggle'
                      aria-pressed={!hidden().has(row.name)}
                      title={hidden().has(row.name) ? 'Show this line' : 'Hide this line'}
                      onClick={() => toggle(row.name)}
                    >
                      <span class='trends-rail-main'>
                        <span class='trends-rail-name'>
                          <span class='trends-rail-swatch' style={{ background: colorOf(row.name) }} />
                          <ArchetypeIcons
                            slugs={resolveArchetypeIcons({ name: row.name, label: row.label }, iconMap())}
                            size={16}
                          />
                          <span class='trends-rail-label'>{row.label}</span>
                        </span>
                        <span class='trends-rail-avg'>
                          {wholePercent(row.avg)} avg over {props.days.length} days
                        </span>
                      </span>
                      <Show when={row.delta !== null}>
                        <span class='trends-delta' classList={{ up: (row.delta ?? 0) > 0, down: (row.delta ?? 0) < 0 }}>
                          <span class='trends-arrow' aria-hidden='true'>
                            {changeArrow(row.delta ?? 0)}
                          </span>{' '}
                          {signedDecimal(row.delta ?? 0)}
                        </span>
                      </Show>
                    </button>
                    <Show when={added().includes(row.name)}>
                      <button
                        type='button'
                        class='trends-rail-remove'
                        aria-label={`Remove ${row.label} from the chart`}
                        title='Remove from the chart'
                        onClick={() => remove(row.name)}
                      >
                        ×
                      </button>
                    </Show>
                  </div>
                )}
              </For>
              <Show when={addable().length > 0}>
                <div class='trends-rail-add'>
                  <select aria-label='Add an archetype to the chart' disabled={atCap()} onChange={onAdd}>
                    <option value=''>{atCap() ? `Showing ${MAX_LINES} lines` : 'Add archetype…'}</option>
                    <For each={addable()}>{s => <option value={s.name}>{s.label}</option>}</For>
                  </select>
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </Show>
    </section>
  );
}

/* ============================================================
   What changed inside each deck
   ============================================================ */

function DeckBlocks(props: { weekly: WeeklyReport }) {
  const decks = createMemo(() => {
    const order = new Map(rankedArchetypes(props.weekly).map((a, i) => [a.base, i]));
    return [...props.weekly.decks]
      .sort((a, b) => (order.get(a.base) ?? 99) - (order.get(b.base) ?? 99))
      .slice(0, DECK_BLOCKS);
  });
  const byBase = createMemo(() => new Map(props.weekly.archetypes.map(a => [a.base, a])));
  return (
    <Show when={decks().length > 0}>
      <Section
        title='What changed inside each deck'
        right="Inclusion among the deck's own lists, this week against last"
      >
        <div class='trends-decks'>
          <For each={decks()}>{deck => <DeckBlock deck={deck} archetype={byBase().get(deck.base)} />}</For>
        </div>
      </Section>
    </Show>
  );
}

function DeckBlock(props: { deck: WeeklyDeck; archetype: WeeklyReport['archetypes'][number] | undefined }) {
  const iconMap = getArchetypeIconMap;
  const slugs = () => resolveArchetypeIcons({ name: props.deck.base, label: props.deck.displayName }, iconMap());
  const tile = (c: WeeklyDeckCard) => (
    <TrendTile name={c.name} set={c.set} number={c.number} delta={c.delta} level={c.inclusion} />
  );
  return (
    <div class='trends-deck'>
      <div class='trends-deck-head'>
        <h3>
          <ArchetypeIcons slugs={slugs()} size={22} />
          <A href={`/archetypes/${props.deck.base}`}>{props.deck.displayName}</A>
        </h3>
        <Show when={props.archetype}>
          {a => (
            <span class='trends-deck-usage'>
              <DeckSpark points={a().daily.map(p => p.share)} />
              <span class='trends-deck-range'>
                {wholePercent(a().priorShare)} → {wholePercent(a().share)}
              </span>
              <span class='trends-delta' classList={{ up: a().delta > 0, down: a().delta < 0 }}>
                <span class='trends-arrow' aria-hidden='true'>
                  {changeArrow(a().delta)}
                </span>{' '}
                {signedDecimal(a().delta)}
              </span>
            </span>
          )}
        </Show>
      </div>
      <div class='trends-deck-row'>
        <For each={props.deck.added.slice(0, DECK_TILES)}>{tile}</For>
        <span class='trends-deck-rule' aria-hidden='true' />
        <For each={props.deck.cut.slice(0, DECK_TILES)}>{tile}</For>
      </div>
    </div>
  );
}

const SPARK_W = 90;
const SPARK_H = 18;

/** The deck head's usage line: the last fourteen days, smoothed. */
function DeckSpark(props: { points: (number | null)[] }) {
  const pts = createMemo(() => smoothSeries(props.points).slice(-14));
  const path = createMemo(() => {
    const present = pts().filter((v): v is number => v !== null);
    if (present.length < 2) {
      return null;
    }
    const max = Math.max(...present);
    const min = Math.min(...present);
    const range = max - min || 1;
    const n = pts().length;
    let d = '';
    let open = false;
    pts().forEach((v, i) => {
      if (v === null) {
        open = false;
        return;
      }
      const x = ((i / (n - 1)) * SPARK_W).toFixed(1);
      const y = (SPARK_H - 2 - ((v - min) / range) * (SPARK_H - 4)).toFixed(1);
      d += `${open ? 'L' : 'M'}${x} ${y} `;
      open = true;
    });
    const last = present[present.length - 1];
    return { d: d.trim(), endY: SPARK_H - 2 - ((last - min) / range) * (SPARK_H - 4) };
  });
  return (
    <Show when={path()}>
      {p => (
        <svg
          class='trends-spark'
          width={SPARK_W}
          height={SPARK_H}
          viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
          aria-hidden='true'
        >
          <path d={p().d} fill='none' />
          <circle cx={SPARK_W} cy={p().endY} r='2.4' />
        </svg>
      )}
    </Show>
  );
}

/* ============================================================
   Top card movers
   ============================================================ */

function MoverSection(props: { rising: WeeklyMover[]; falling: WeeklyMover[] }) {
  const iconMap = getArchetypeIconMap;
  const tile = (m: WeeklyMover) => {
    const driver = m.drivers[0];
    return (
      <TrendTile
        name={m.name}
        set={m.set}
        number={m.number}
        delta={m.delta}
        level={m.share}
        meta={
          driver ? (
            <>
              <ArchetypeIcons
                slugs={resolveArchetypeIcons({ name: driver.base, label: driver.displayName }, iconMap())}
                size={14}
              />
              <span class='trends-driver'>{driver.displayName}</span>
            </>
          ) : undefined
        }
      />
    );
  };
  return (
    <Show when={props.rising.length > 0 || props.falling.length > 0}>
      <Section title='Top card movers' right='Share of all lists, this week against last · the deck that moved it most'>
        <div class='trends-two'>
          <div>
            <h3 class='trends-dir up'>Rising</h3>
            <div class='trends-tiles'>
              <For each={props.rising}>{tile}</For>
            </div>
          </div>
          <div>
            <h3 class='trends-dir down'>Falling</h3>
            <div class='trends-tiles'>
              <For each={props.falling}>{tile}</For>
            </div>
          </div>
        </div>
      </Section>
    </Show>
  );
}

/** Movers from the older window-start-to-end lists, for a file without a weekly block. */
function LegacyMovers(props: {
  payload: ReturnType<typeof latestValue<Awaited<ReturnType<typeof fetchOnlineTrendReport>>>>;
}) {
  const movers = createMemo(() => sliceCardMovers(props.payload?.cardTrends, MOVER_TILES));
  const tile = (m: { name: string; set: string | null; number: string | null; delta: number; endShare: number }) => (
    <TrendTile name={m.name} set={m.set} number={m.number} delta={m.delta} level={m.endShare} />
  );
  return (
    <Show when={movers().rising.length > 0 || movers().falling.length > 0}>
      <Section title='Top card movers' right='Share of all lists, end of the window against its start'>
        <div class='trends-two'>
          <div>
            <h3 class='trends-dir up'>Rising</h3>
            <div class='trends-tiles'>
              <For each={movers().rising}>{tile}</For>
            </div>
          </div>
          <div>
            <h3 class='trends-dir down'>Falling</h3>
            <div class='trends-tiles'>
              <For each={movers().falling}>{tile}</For>
            </div>
          </div>
        </div>
      </Section>
    </Show>
  );
}

/* ============================================================
   Price movers
   ============================================================ */

type PriceScope = 'all' | 'standard';

/**
 * The biggest market-price swings over the trailing window. Every threshold
 * lives in the pipeline; this renders the artifact. Hidden until the history
 * spans one full window. Rows, not tiles: the movers cover every
 * printing, and older sets have no art on R2.
 */
function PriceMovers() {
  const [payload] = createResource(fetchPriceMovers);
  const [scope, setScope] = createPersistentSignal<PriceScope>('cm:trendsPriceScope', 'all', v =>
    v === 'all' || v === 'standard' ? v : null
  );
  const [metric, setMetric] = createPersistentSignal<PriceMoverMetric>('cm:trendsPriceMetric', 'pct', v =>
    v === 'pct' || v === 'value' ? v : null
  );
  const ready = createMemo(() => {
    const p = latestValue(payload);
    return p && p.spanDays >= p.windowDays ? p : null;
  });
  const movers = createMemo<PriceMoverList>(() => ready()?.scopes[scope()][metric()] ?? { rising: [], falling: [] });
  const magnitude = (m: PriceMoverRow): string =>
    metric() === 'pct'
      ? `${m.pct < 0 ? '−' : '+'}${Math.abs(Math.round(m.pct))}%`
      : `${m.delta < 0 ? '−' : '+'}$${Math.abs(m.delta).toFixed(2)}`;

  const column = (rows: PriceMoverRow[], dir: 'up' | 'down') => (
    <div class='trends-rows'>
      <For each={rows}>
        {(m, idx) => (
          <A href={`/cards/${m.set}/${m.number}`} class='trends-row'>
            <span class='trends-row-rank'>{idx() + 1}</span>
            <span class='trends-row-name'>
              {m.name}{' '}
              <span class='trends-row-set'>
                {m.set}/{m.number}
              </span>
            </span>
            <span class='trends-row-price'>
              ${m.current.toFixed(2)} <small>from ${m.start.toFixed(2)}</small>
            </span>
            <span class='trends-delta' classList={{ [dir]: true }}>
              <span class='trends-arrow' aria-hidden='true'>
                {dir === 'up' ? '↑' : '↓'}
              </span>{' '}
              {magnitude(m)}
            </span>
          </A>
        )}
      </For>
    </div>
  );

  return (
    <Show when={movers().rising.length > 0 || movers().falling.length > 0}>
      <Section
        title='Price movers'
        right={
          <span class='trends-controls'>
            <span class='trends-controls-note'>Last {ready()?.windowDays} days</span>
            <Segmented<PriceMoverMetric>
              ariaLabel='Rank by'
              options={[
                { value: 'pct', label: 'By %' },
                { value: 'value', label: 'By $' }
              ]}
              selected={metric()}
              onSelect={setMetric}
            />
            <Segmented<PriceScope>
              ariaLabel='Printings included'
              options={[
                { value: 'all', label: 'All printings' },
                { value: 'standard', label: 'Standard' }
              ]}
              selected={scope()}
              onSelect={setScope}
            />
          </span>
        }
      >
        <div class='trends-two'>
          <div>
            <h3 class='trends-dir up'>Rising</h3>
            {column(movers().rising, 'up')}
          </div>
          <div>
            <h3 class='trends-dir down'>Falling</h3>
            {column(movers().falling, 'down')}
          </div>
        </div>
      </Section>
    </Show>
  );
}
