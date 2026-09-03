import { A, useNavigate, useParams, useSearchParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import {
  fetchArchetype,
  fetchArchetypes,
  fetchOnlineTrendReport,
  fetchPrices,
  fetchRotationIndex,
  normalizeArchetypeKey,
  prettyTournamentName,
  snapshotDateForArchetype,
  snapshotSourceKey,
  type TrendTimelinePoint
} from '../lib/data';
import { useTournament } from '../lib/tournamentContext';
import { ONLINE_META_LABEL, ONLINE_META_NAME } from '../lib/constants';
import type { ArchetypeIndexEntry, ArchetypeReport, CardItem } from '../types';
import { Tabs } from '../components/Tabs';
import { Segmented } from '../components/Segmented';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { InfoTip } from '../components/InfoTip';
import { CardList, type ViewMode } from '../components/CardList';
import { AdvancedPanel } from '../components/AdvancedPanel';
import { MatchupsPanel } from '../components/MatchupsPanel';
import { createPersistentSignal, createPersistentViewMode } from '../lib/persistentSignal';
import { latestValue, resolved } from '../lib/resource';
import { fetchArchetypeWinRate, WR_MIN_GAMES, WR_MUTE_GAMES } from '../lib/archetypeWinRate';
import { estimateDeckCost } from '../lib/deckCost';
import { fetchCardFacets } from '../lib/data/cardFacets';
import { sortByDeckOrder } from '../lib/cardOrder';
import '../styles/pages/archetype.css';

type ArchTab = 'core' | 'tech' | 'cards' | 'matchups' | 'advanced';

const TAB_OPTIONS: { value: ArchTab; label: string }[] = [
  { value: 'core', label: 'Core list' },
  { value: 'tech', label: 'Tech choices' },
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
  const { tournament, setTournament } = useTournament();
  const [searchParams, setSearchParams] = useSearchParams();

  // A shared link carries the tournament as `tour`. Adopt it *before* the report
  // resource first reads tournament(), so data loads in the right scope, then
  // strip it on mount so it can't override a later manual switch on reload.
  const sharedTour = typeof searchParams.tour === 'string' ? searchParams.tour.trim() : '';
  if (sharedTour && sharedTour !== tournament()) {
    setTournament(sharedTour);
  }
  onMount(() => {
    if (searchParams.tour || searchParams.tab) {
      setSearchParams({ tour: undefined, tab: undefined }, { replace: true });
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
  const TAB_VALUES: readonly ArchTab[] = ['core', 'tech', 'cards', 'matchups', 'advanced'];
  const sharedTab =
    typeof searchParams.tab === 'string' && (TAB_VALUES as readonly string[]).includes(searchParams.tab)
      ? (searchParams.tab as ArchTab)
      : null;
  const [tab, setTab] = createSignal<ArchTab>(sharedTab ?? (sharedFilters ? 'advanced' : 'core'));
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
  const scopeLabel = () =>
    props.tournament === ONLINE_META_NAME ? ONLINE_META_LABEL : prettyTournamentName(props.tournament);

  // Aggregate event win rate — same source the Matchups tab uses.
  const [winRate] = createResource(
    () => ({ t: props.tournament, slug: props.slug, label: props.label }),
    ({ t, slug, label }) => fetchArchetypeWinRate(t, slug, label)
  );
  const wr = () => resolved(winRate);
  const wrGames = () => wr()?.games ?? 0;

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
        <h1>{props.label}</h1>
        <div class='hero-meta'>
          <span>{props.report.deckTotal.toLocaleString()} decks</span>
          <Show when={sharePct()}>
            <span class='dot'>·</span>
            <span class='arche-stat'>
              <span>
                {sharePct()}%<Show when={metaTotal()}>{total => <> of {total().toLocaleString()}</>}</Show> in{' '}
                {scopeLabel()}
              </span>
              <InfoTip marker='i' label='Meta share'>
                This archetype's share of all decks in the report.
              </InfoTip>
            </span>
          </Show>
          {/* Win rate comes from its own request, and it sits in the middle of a
              line that wraps on a phone — inserting it on arrival pushed the
              cost chip onto a second row and took the tabs and the whole card
              list down with it. The slot holds its width from first paint and
              only collapses if the request comes back with no games, which
              trades a shift on every archetype for one on the few without
              recorded matches. */}
          <Show when={winRate.loading || wrGames() > 0}>
            <span class='arche-stat-slot' classList={{ 'is-pending': winRate.loading }}>
              <span class='dot'>·</span>
              <span class='arche-stat' classList={{ 'is-muted': wrGames() > 0 && wrGames() < WR_MUTE_GAMES }}>
                <Show when={wr()} keyed>
                  {agg => (
                    <>
                      <span class='arche-stat-lead'>
                        {agg.games < WR_MIN_GAMES || agg.winRate === null ? '—' : `${agg.winRate.toFixed(1)}%`} win rate
                        · {agg.games.toLocaleString()} games
                      </span>
                      <InfoTip marker='i' label='Win rate'>
                        Match win rate across all recorded games, mirrors excluded. Ties count as one third of a win.
                      </InfoTip>
                    </>
                  )}
                </Show>
              </span>
            </span>
          </Show>
          {/* Reserved on the same terms as the win-rate chip above: prices are a
              separate file, and on a phone this arriving took the hero to a
              second line. */}
          <Show when={prices.loading || deckCost() !== null}>
            <span class='arche-stat-slot arche-stat-slot-cost' classList={{ 'is-pending': prices.loading }}>
              <span class='dot'>·</span>
              <span class='arche-stat'>
                <Show when={deckCost()} keyed>
                  {cost => (
                    <>
                      <span class='arche-stat-lead'>≈ ${Math.round(cost.cost).toLocaleString()} typical list</span>
                      <InfoTip marker='i' label='Typical list cost'>
                        Market price of a typical list: cards in at least half of lists, at their most common copy
                        count. TCGPlayer prices.
                      </InfoTip>
                    </>
                  )}
                </Show>
              </span>
            </span>
          </Show>
        </div>
        {/* The timeline arrives on a second request, and letting the sparkline
            appear from nothing pushed every tab and card below it down a row.
            Eligible archetypes hold the space; ineligible scopes (an event, a
            snapshot) never render it, so they pay nothing. */}
        <Show when={trendEligible()}>
          <Show when={trendTimeline()} keyed fallback={<UsageSparklinePending />}>
            {points => <UsageSparkline points={points} />}
          </Show>
        </Show>
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

        <Show when={props.tab === 'tech'}>
          <p class='arche-tab-note'>
            <span>
              Cards in {TECH_THRESHOLD} to {CORE_THRESHOLD} percent of lists
            </span>
            <InfoTip marker='i' label='What counts as a tech card'>
              Cards in {TECH_THRESHOLD} to {CORE_THRESHOLD} percent of lists. Below {TECH_THRESHOLD} percent a card is
              closer to a one-off experiment than a tech choice.
            </InfoTip>
          </p>
        </Show>

        <Show when={props.tab === 'core'}>
          <CardList
            title='Cards in ≥ 90% of lists'
            items={coreCards()}
            viewMode={props.viewMode}
            emptyMessage='No core cards above 90% inclusion in this archetype yet.'
          />
        </Show>

        <Show when={props.tab === 'tech'}>
          <CardList
            title='Cards in 30–90% of lists'
            items={techCards()}
            viewMode={props.viewMode}
            emptyMessage='No tech-tier cards in this archetype yet.'
          />
        </Show>

        <Show when={props.tab === 'cards'}>
          <CardList
            title='All cards observed'
            items={orderedCards()}
            viewMode={props.viewMode}
            emptyMessage='No cards in this report.'
            initialLimit={60}
          />
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

/**
 * Inline 30-day usage sparkline for the archetype hero: the archetype's daily
 * meta-share trajectory with a start-to-end delta chip. The line breaks at any
 * day the archetype dropped out of the report (no interpolation across gaps),
 * mirroring the Trends chart. Purely presentational, so the SVG is aria-hidden
 * and the delta is restated as text for screen readers.
 */
/**
 * Stand-in that holds the sparkline's space until its timeline lands.
 *
 * Built from the same three children at the same widths rather than given a
 * fixed height: the row wraps below about 440px, so any single min-height is
 * wrong at one width or the other. Matching the shape means it wraps where the
 * real one will, at every width, without a breakpoint to keep in sync.
 */
function UsageSparklinePending() {
  return (
    <div class='arche-spark' aria-hidden='true'>
      <span class='arche-spark-label'>Usage, last 30 days</span>
      <Skeleton width={`${SPARK_W}px`} height={`${SPARK_H}px`} />
      <span class='arche-spark-delta'>
        <Skeleton width='151px' height='1em' />
      </span>
    </div>
  );
}

/** Sparkline canvas size, shared with the pending stand-in above. */
const SPARK_W = 132;
const SPARK_H = 30;

function UsageSparkline(props: { points: TrendTimelinePoint[] }) {
  const W = SPARK_W;
  const H = SPARK_H;
  const PAD = 3;
  const shares = createMemo(() => props.points.map(p => p.share));
  const start = () => shares()[0];
  const end = () => shares()[shares().length - 1];
  const deltaPp = () => end() - start();
  // Scale y to the series' own min/max with a little headroom, so a small deck's
  // 1–3% movement is still legible rather than pinned flat against a 0–100 axis.
  const bounds = createMemo(() => {
    const ys = shares();
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const pad = Math.max(0.25, (hi - lo) * 0.15);
    return { lo: lo - pad, hi: hi + pad };
  });
  const x = (i: number) => PAD + (i / (props.points.length - 1)) * (W - 2 * PAD);
  const y = (share: number) => {
    const { lo, hi } = bounds();
    const t = hi === lo ? 0.5 : (share - lo) / (hi - lo);
    return H - PAD - t * (H - 2 * PAD);
  };
  // Break the path into segments at missing days so a gap never draws a
  // straight interpolated line. A day counts as present when it has decks.
  const segments = createMemo(() => {
    const segs: string[] = [];
    let cur: string[] = [];
    props.points.forEach((p, i) => {
      if (p.decks > 0) {
        cur.push(`${cur.length === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.share).toFixed(1)}`);
      } else if (cur.length) {
        segs.push(cur.join(' '));
        cur = [];
      }
    });
    if (cur.length) {
      segs.push(cur.join(' '));
    }
    return segs;
  });
  const deltaClass = () => (Math.abs(deltaPp()) < 0.1 ? 'flat' : deltaPp() > 0 ? 'up' : 'down');
  const deltaText = () => `${deltaPp() > 0 ? '+' : deltaPp() < 0 ? '' : '±'}${deltaPp().toFixed(1)} pp`;

  return (
    <div class='arche-spark'>
      <span class='arche-spark-label'>Usage, last 30 days</span>
      <svg class='arche-spark-svg' width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden='true'>
        <For each={segments()}>{d => <path class='arche-spark-line' d={d} fill='none' />}</For>
        <circle class='arche-spark-dot' cx={x(props.points.length - 1)} cy={y(end())} r='2.4' />
      </svg>
      <span class='arche-spark-delta' classList={{ [deltaClass()]: true }}>
        {start().toFixed(1)}% → {end().toFixed(1)}%<span class='arche-spark-chip'>{deltaText()}</span>
      </span>
    </div>
  );
}

function ArchetypeSkeleton() {
  return (
    <>
      <section class='hero'>
        <Skeleton width='280px' height='32px' />
        <div style={{ 'margin-top': '6px' }}>
          <Skeleton width='220px' height='13px' />
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
