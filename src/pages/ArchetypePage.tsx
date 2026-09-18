import { A, useNavigate, useParams, useSearchParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, type JSX, onMount, Show } from 'solid-js';
import {
  fetchArchetype,
  fetchArchetypes,
  fetchOnlineTrendReport,
  fetchPrices,
  fetchRotationIndex,
  getArchetypeIconMap,
  normalizeArchetypeKey,
  resolveArchetypeIcons,
  snapshotDateForArchetype,
  snapshotSourceKey,
  type TrendTimelinePoint
} from '../lib/data';
import { useTournament } from '../lib/tournamentContext';
import { ONLINE_META_NAME } from '../lib/constants';
import type { ArchetypeIndexEntry, ArchetypeReport, CardItem } from '../types';
import { Tabs } from '../components/Tabs';
import { Segmented } from '../components/Segmented';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { ArchetypeIcons } from '../components/ArchetypeIcon';
import { CardList, type ViewMode } from '../components/CardList';
import { AdvancedPanel } from '../components/AdvancedPanel';
import { MatchupsPanel } from '../components/MatchupsPanel';
import { createPersistentSignal, createPersistentViewMode } from '../lib/persistentSignal';
import { latestValue, resolved } from '../lib/resource';
import { fetchArchetypeWinRate, type WinRateAggregate } from '../lib/archetypeWinRate';
import { matchPointWilson, sampleTier } from '../lib/confidence';
import { formatRange } from '../components/matchupsPanel/model';
import { estimateDeckCost } from '../lib/deckCost';
import { fetchCardFacets } from '../lib/data/cardFacets';
import { sortByDeckOrder } from '../lib/cardOrder';
import '../styles/pages/archetype.css';

type ArchTab = 'cards' | 'matchups' | 'advanced';

const TAB_OPTIONS: { value: ArchTab; label: string }[] = [
  { value: 'cards', label: 'All cards' },
  { value: 'matchups', label: 'Matchups' },
  { value: 'advanced', label: 'Filters' }
];
const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' }
];

/**
 * How the card lists are ordered. `usage` is inclusion-descending; `deck` reads
 * like a written decklist (see {@link sortByDeckOrder}).
 */
type CardSort = 'usage' | 'deck';

const SORT_OPTIONS: { value: CardSort; label: string }[] = [
  { value: 'usage', label: 'Usage' },
  { value: 'deck', label: 'Deck order' }
];

const CORE_THRESHOLD = 90;
const TECH_THRESHOLD = 30;

// View mode preference is shared with the /cards page under `cm:cardsView` — a
// user who picks list view on /cards almost certainly wants it here too.

export function ArchetypePage() {
  const params = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { tournament } = useTournament();
  const [searchParams, setSearchParams] = useSearchParams();

  onMount(() => {
    if (searchParams.tab) {
      setSearchParams({ tab: undefined }, { replace: true });
    }
  });

  const [report] = createResource(
    () => ({ t: tournament(), slug: params.slug }),
    ({ t, slug }) => fetchArchetype(t, slug)
  );
  const [index] = createResource(tournament, fetchArchetypes);

  // Non-suspending reads (see lib/resource.ts): the report is param-keyed
  // (`resolved` — show the skeleton on slug change, not the previous
  // archetype's cards), the index is tournament-scoped (`latestValue`).
  const indexData = () => latestValue(index);

  // Case-insensitive slug redirect: if the URL slug doesn't exist verbatim but
  // matches an index entry under a different casing, hop to the canonical URL.
  createEffect(() => {
    if (!report.error) {
      return;
    }
    const entries = indexData();
    if (!entries) {
      return;
    }
    const lower = params.slug.toLowerCase();
    const match = entries.find(a => a.name.toLowerCase() === lower);
    if (match && match.name !== params.slug) {
      navigate(`/archetypes/${match.name}`, { replace: true });
    }
  });
  // Deferred: the 49KB Snapshots index is only needed for the historical
  // fallback, so don't fetch it until the live lookup has actually failed
  // (P3.2). A falsy source keeps createResource idle.
  const [rotationIndex] = createResource(
    () => (report.error ? 'fallback' : undefined),
    () => fetchRotationIndex()
  );
  // Land a shared filter link straight on the Filters tab, or a matrix deep-link
  // straight on the Matchups tab.
  const sharedFilters = Boolean(searchParams.b || searchParams.s || searchParams.t);
  const TAB_VALUES: readonly ArchTab[] = ['cards', 'matchups', 'advanced'];
  // 'core' and 'tech' were separate tabs before the card tiers were merged into
  // one page; old links land on the combined list rather than nothing.
  const rawTab = typeof searchParams.tab === 'string' ? searchParams.tab : '';
  const sharedTab = (TAB_VALUES as readonly string[]).includes(rawTab)
    ? (rawTab as ArchTab)
    : rawTab === 'core' || rawTab === 'tech'
      ? ('cards' as ArchTab)
      : null;
  const [tab, setTab] = createSignal<ArchTab>(sharedTab ?? (sharedFilters ? 'advanced' : 'cards'));
  const [viewMode, setViewMode] = createPersistentViewMode('cm:cardsView');
  const [cardSort, setCardSort] = createPersistentSignal<CardSort>('cm:archetypeCardSort', 'usage', v =>
    v === 'deck' || v === 'usage' ? v : null
  );

  // Pre-rotation snapshot fallback. Fires when the live archetype lookup has
  // settled with an error (404 from R2) and the rotation index knows where
  // this slug last appeared. The same archetype page renders, just sourced
  // from `/reports/Snapshots/{date}/` instead of the live folder.
  const liveReport = () => resolved(report) ?? null;
  const rotationIndexData = () => resolved(rotationIndex);
  const snapshotDate = createMemo<string | null>(() => {
    if (liveReport()) {
      return null;
    }
    if (report.loading) {
      return null;
    }
    const idx = rotationIndexData();
    if (idx === undefined) {
      return null;
    }
    return snapshotDateForArchetype(idx ?? null, params.slug);
  });
  const [snapshotReport] = createResource(
    () => snapshotDate(),
    date => fetchArchetype(snapshotSourceKey(date), params.slug)
  );
  const [snapshotIndex] = createResource(
    () => snapshotDate(),
    date => fetchArchetypes(snapshotSourceKey(date))
  );

  const snapshotReportData = () => resolved(snapshotReport);
  const snapshotIndexData = () => resolved(snapshotIndex);
  const effectiveReport = createMemo<ArchetypeReport | null | undefined>(() => liveReport() ?? snapshotReportData());
  const effectiveIndex = createMemo<ArchetypeIndexEntry[] | undefined>(() =>
    liveReport() ? indexData() : snapshotIndexData()
  );
  const effectiveTournament = createMemo<string>(() => {
    if (liveReport()) {
      return tournament();
    }
    const date = snapshotDate();
    return date ? snapshotSourceKey(date) : tournament();
  });

  const indexEntry = createMemo(() => effectiveIndex()?.find(a => a.name === params.slug));
  const label = createMemo(() => indexEntry()?.label || params.slug);

  const showEmpty = createMemo(() => {
    if (effectiveReport()) {
      return false;
    }
    if (report.loading) {
      return false;
    }
    if (rotationIndex.loading) {
      return false;
    }
    const date = snapshotDate();
    if (date && snapshotReport.loading) {
      return false;
    }
    return true;
  });

  createEffect(() => {
    const l = label();
    if (l) {
      document.title = `${l} — Ciphermaniac`;
    }
  });

  return (
    <>
      <Show
        when={effectiveReport()}
        fallback={
          <Show when={showEmpty()} fallback={<ArchetypeSkeleton />}>
            <EmptyState
              title="Couldn't load this archetype."
              description={`The archetype "${params.slug}" doesn't exist in the current scope, or its report failed to load.`}
              actions={
                <A href='/archetypes' class='btn btn-secondary'>
                  Back to all archetypes
                </A>
              }
            />
          </Show>
        }
      >
        <ArchetypeBody
          slug={params.slug}
          label={label()}
          tournament={effectiveTournament()}
          report={effectiveReport()!}
          indexEntry={indexEntry()}
          indexEntries={effectiveIndex()}
          snapshotDate={snapshotDate()}
          tab={tab()}
          onTabChange={setTab}
          viewMode={viewMode()}
          onViewChange={setViewMode}
          cardSort={cardSort()}
          onCardSortChange={setCardSort}
        />
      </Show>
    </>
  );
}

interface ArchetypeBodyProps {
  slug: string;
  label: string;
  tournament: string;
  report: ArchetypeReport;
  indexEntry: ArchetypeIndexEntry | undefined;
  indexEntries: ArchetypeIndexEntry[] | undefined;
  /** When set (YYYY-MM-DD), the report is a frozen pre-rotation snapshot. */
  snapshotDate: string | null;
  tab: ArchTab;
  onTabChange: (t: ArchTab) => void;
  viewMode: ViewMode;
  onViewChange: (v: ViewMode) => void;
  cardSort: CardSort;
  onCardSortChange: (s: CardSort) => void;
}

function ArchetypeBody(props: ArchetypeBodyProps) {
  const sortedByPct = createMemo(() =>
    [...(props.report.items as CardItem[])].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
  );

  // Deck order needs per-card category/stage/pre-evolution facets. They're
  // optional decoration: until the fetch lands (or if it fails) the sort falls
  // back to report categories and no evolution grouping, so the list is never
  // blocked on it.
  const [facets] = createResource(fetchCardFacets);
  const orderedCards = createMemo<CardItem[]>(() =>
    props.cardSort === 'deck' ? sortByDeckOrder(sortedByPct(), latestValue(facets) ?? null) : sortedByPct()
  );

  // Both tiers are cut from the ordered list, so the active sort carries into
  // them rather than only applying to the All-cards tab.
  const coreCards = createMemo(() => orderedCards().filter(i => (i.pct ?? 0) >= CORE_THRESHOLD));
  const techCards = createMemo(() =>
    orderedCards().filter(i => (i.pct ?? 0) < CORE_THRESHOLD && (i.pct ?? 0) >= TECH_THRESHOLD)
  );
  const fringeCards = createMemo(() => orderedCards().filter(i => (i.pct ?? 0) < TECH_THRESHOLD));

  const sharePct = () => {
    const p = props.indexEntry?.percent;
    if (p === null || p === undefined || !Number.isFinite(p)) {
      return null;
    }
    return p.toFixed(1);
  };

  // Scope total: the denominator behind the archetype's meta share. Derived
  // from the entry's own deckCount/percent pair (exact by construction) rather
  // than summing the index, which under-counts scopes whose index omits
  // below-threshold archetypes and would disagree with the displayed share.
  const metaTotal = createMemo(() => {
    const entry = props.indexEntry;
    const count = entry?.deckCount;
    const pct = entry?.percent;
    if (!count || !pct || !Number.isFinite(pct) || pct <= 0) {
      return null;
    }
    return Math.round((count * 100) / pct);
  });

  // Aggregate event win rate — same source the Matchups tab uses.
  const [winRate] = createResource(
    () => ({ t: props.tournament, slug: props.slug, label: props.label }),
    ({ t, slug, label }) => fetchArchetypeWinRate(t, slug, label)
  );
  const wr = () => resolved(winRate);

  const iconSlugs = () =>
    resolveArchetypeIcons(
      { name: props.slug, label: props.label, icons: props.indexEntry?.icons },
      getArchetypeIconMap()
    );

  // Typical-list cost from card prices; null (renders nothing) when coverage is thin.
  const [prices] = createResource(fetchPrices);
  const deckCost = createMemo(() => {
    const p = prices();
    return p ? estimateDeckCost(props.report.items as CardItem[], p) : null;
  });

  // Human-readable snapshot date for the banner (props.snapshotDate is YYYY-MM-DD).
  const snapshotDateLabel = createMemo<string>(() => formatSnapshotDate(props.snapshotDate));

  // 30-day usage sparkline. The online trend file carries a daily share timeline
  // per archetype; match this archetype's slug and hand its points to the
  // sparkline. Only fetched on the online scope (the only one with a trend
  // file) and never on a snapshot — a frozen report has no live trajectory.
  const trendEligible = () => props.tournament === ONLINE_META_NAME && !props.snapshotDate;
  const [trendReport] = createResource(trendEligible, fetchOnlineTrendReport);
  const trendTimeline = createMemo<TrendTimelinePoint[] | null>(() => {
    const payload = resolved(trendReport);
    if (!payload) {
      return null;
    }
    const key = normalizeArchetypeKey(props.slug);
    const series =
      payload.trendReport.series.find(s => s.base === props.slug) ??
      payload.trendReport.series.find(s => normalizeArchetypeKey(s.base) === key);
    const points = series?.timeline ?? [];
    return points.length >= 2 ? points : null;
  });

  return (
    <>
      <Show when={props.snapshotDate}>
        <div class='snapshot-banner' role='status'>
          <span class='snapshot-banner-label'>Historical</span>
          <span>
            This archetype rotated out of the tracked format. You're looking at the final pre-rotation report from{' '}
            {snapshotDateLabel()}.
          </span>
        </div>
      </Show>
      <section class='hero'>
        <h1 class='arche-title'>
          <ArchetypeIcons slugs={iconSlugs()} size={30} />
          <span>{props.label}</span>
        </h1>
        {/* Every cell renders from first paint and fills in as its request
            lands, so a late win rate or price never reflows the band. */}
        <dl class='stat-band arche-band'>
          <ShareStat share={sharePct()} total={metaTotal()} decks={props.report.deckTotal} />
          <WinRateStat loading={winRate.loading} agg={wr()} />
          <Show when={trendEligible()}>
            <TrendStat loading={trendReport.loading} points={trendTimeline()} />
          </Show>
          <CostStat loading={prices.loading} cost={deckCost()?.cost ?? null} />
        </dl>
      </section>

      <section>
        <div class='arche-toolbar'>
          <Tabs options={TAB_OPTIONS} selected={props.tab} onSelect={props.onTabChange} />
          {/* Grid/List only affects the card views; the Matchups tab has its own layout. */}
          <Show when={props.tab !== 'matchups'}>
            <div class='arche-toolbar-controls'>
              <Show when={props.tab !== 'advanced'}>
                <Segmented<CardSort>
                  options={SORT_OPTIONS}
                  selected={props.cardSort}
                  onSelect={props.onCardSortChange}
                  ariaLabel='Card order'
                />
              </Show>
              <Segmented<ViewMode>
                options={VIEW_OPTIONS}
                selected={props.viewMode}
                onSelect={props.onViewChange}
                ariaLabel='View mode'
              />
            </div>
          </Show>
        </div>

        <Show when={props.tab === 'cards'}>
          <Show when={orderedCards().length > 0} fallback={<EmptyState title='No cards in this report.' />}>
            <Show when={coreCards().length > 0}>
              <CardList
                title='Cards in ≥ 90% of lists'
                items={coreCards()}
                viewMode={props.viewMode}
                emptyMessage='No core cards above 90% inclusion in this archetype yet.'
              />
            </Show>
            <Show when={techCards().length > 0}>
              <CardList
                title='Cards in 30–90% of lists'
                items={techCards()}
                viewMode={props.viewMode}
                emptyMessage='No tech-tier cards in this archetype yet.'
              />
            </Show>
            <Show when={fringeCards().length > 0}>
              <CardList
                title='All other cards'
                items={fringeCards()}
                viewMode={props.viewMode}
                emptyMessage='No other cards in this report.'
                initialLimit={60}
              />
            </Show>
          </Show>
        </Show>

        <Show when={props.tab === 'matchups'}>
          <MatchupsPanel
            slug={props.slug}
            label={props.label}
            tournament={props.tournament}
            indexEntries={props.indexEntries}
            report={props.report}
          />
        </Show>

        <Show when={props.tab === 'advanced'}>
          <AdvancedPanel
            slug={props.slug}
            label={props.label}
            tournament={props.tournament}
            report={props.report}
            viewMode={props.viewMode}
          />
        </Show>
      </section>
    </>
  );
}

/** Format a YYYY-MM-DD snapshot date as "Month D, YYYY"; empty string when absent. */
function formatSnapshotDate(raw: string | null): string {
  if (!raw) {
    return '';
  }
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    return raw;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime())
    ? raw
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** One figure in the hero's stat band: a skeleton until its data lands. */
function Stat(props: {
  label: JSX.Element;
  loading?: boolean;
  lead?: boolean;
  muted?: boolean;
  children: JSX.Element;
}) {
  return (
    <div class='stat-band-item' classList={{ 'is-lead': props.lead, 'is-muted': props.muted }}>
      <dt>{props.label}</dt>
      <dd>
        <Show when={!props.loading} fallback={<Skeleton width='64px' height='1em' />}>
          {props.children}
        </Show>
      </dd>
    </div>
  );
}

/** Meta share, with its denominator in the label; the deck count when the scope has no share. */
function ShareStat(props: { share: string | null; total: number | null; decks: number }) {
  return (
    <Show when={props.share} fallback={<Stat label='decks'>{props.decks.toLocaleString()}</Stat>}>
      {share => (
        <Stat
          lead
          label={
            <>
              meta share <Show when={props.total}>{total => <small>· of {total().toLocaleString()}</small>}</Show>
            </>
          }
        >
          {share()}%
        </Stat>
      )}
    </Show>
  );
}

/**
 * Match win rate with the game count in the label. A thin sample shows a dash,
 * and anything short of solid is muted; the 95% interval is on hover.
 */
function WinRateStat(props: { loading: boolean; agg: WinRateAggregate | undefined }) {
  const games = () => props.agg?.games ?? 0;
  const interval = () => {
    const ci = props.agg ? matchPointWilson(props.agg.wins, props.agg.ties, props.agg.games) : null;
    return ci ? `95% interval ${formatRange(ci)}` : undefined;
  };
  const value = () => {
    const rate = props.agg?.winRate;
    return rate === null || rate === undefined || sampleTier(games()) === 'thin' ? '—' : `${rate.toFixed(1)}%`;
  };
  return (
    <Stat
      loading={props.loading}
      muted={games() > 0 && sampleTier(games()) !== 'solid'}
      label={
        <>
          win rate{' '}
          <Show when={games() > 0}>
            <small>· {games().toLocaleString()} games</small>
          </Show>
        </>
      }
    >
      <span title={interval()}>{value()}</span>
    </Stat>
  );
}

/** Change in meta share across the online trend window, in percentage points. */
function TrendStat(props: { loading: boolean; points: TrendTimelinePoint[] | null }) {
  const delta = () => {
    const pts = props.points;
    return pts ? pts[pts.length - 1].share - pts[0].share : null;
  };
  return (
    <Stat loading={props.loading} label='30-day trend'>
      <Show when={delta() !== null} fallback='—'>
        <span class={deltaClass(delta()!)}>{formatDelta(delta()!)}</span>
      </Show>
    </Stat>
  );
}

function deltaClass(d: number): string {
  if (Math.abs(d) < 0.1) {
    return 'arche-delta';
  }
  return d > 0 ? 'arche-delta is-up' : 'arche-delta is-down';
}

function formatDelta(d: number): string {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  return `${sign}${Math.abs(d).toFixed(1)} pp`;
}

/** Market price of a typical list; a dash when price coverage is too thin to say. */
function CostStat(props: { loading: boolean; cost: number | null }) {
  return (
    <Stat loading={props.loading} label='typical list'>
      {props.cost === null ? '—' : `$${Math.round(props.cost).toLocaleString()}`}
    </Stat>
  );
}

function ArchetypeSkeleton() {
  return (
    <>
      <section class='hero'>
        <Skeleton width='280px' height='44px' />
        {/* Stands in for the stat band, so the page doesn't drop a row when
            the report lands. */}
        <div style={{ 'margin-top': '18px' }}>
          <Skeleton height='65px' />
        </div>
      </section>
      <section>
        <Skeleton height='44px' />
        <div style={{ 'margin-top': '24px' }}>
          <Skeleton height='320px' />
        </div>
      </section>
    </>
  );
}
