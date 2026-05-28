import { A, useNavigate, useParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, onMount, Show } from 'solid-js';
import {
  fetchArchetype,
  fetchArchetypes,
  fetchRotationIndex,
  snapshotDateForArchetype,
  snapshotSourceKey
} from '../lib/data';
import { useTournament } from '../lib/tournamentContext';
import type { ArchetypeIndexEntry, ArchetypeReport, CardItem } from '../types';
import { Breadcrumb } from '../components/Breadcrumb';
import { Tabs } from '../components/Tabs';
import { Segmented } from '../components/Segmented';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { CardList, type ViewMode } from '../components/CardList';
import { AdvancedPanel } from '../components/AdvancedPanel';
import { createPersistentViewMode } from '../lib/persistentSignal';
import { normalizePercent } from '../lib/format';

type ArchTab = 'core' | 'tech' | 'cards' | 'advanced';

const TAB_OPTIONS: { value: ArchTab; label: string }[] = [
  { value: 'core', label: 'Core list' },
  { value: 'tech', label: 'Tech choices' },
  { value: 'cards', label: 'All cards' },
  { value: 'advanced', label: 'Advanced' }
];
const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' }
];

const CORE_THRESHOLD = 90;
const TECH_THRESHOLD = 30;

// View mode preference is shared with the /cards page under `cm:cardsView` — a
// user who picks list view on /cards almost certainly wants it here too.

export function ArchetypePage() {
  const params = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { tournament } = useTournament();
  const [report] = createResource(
    () => ({ t: tournament(), slug: params.slug }),
    ({ t, slug }) => fetchArchetype(t, slug)
  );
  const [index] = createResource(tournament, fetchArchetypes);

  // Case-insensitive slug redirect: if the URL slug doesn't exist verbatim but
  // matches an index entry under a different casing, hop to the canonical URL.
  createEffect(() => {
    if (!report.error) {
      return;
    }
    const entries = index();
    if (!entries) {
      return;
    }
    const lower = params.slug.toLowerCase();
    const match = entries.find(a => a.name.toLowerCase() === lower);
    if (match && match.name !== params.slug) {
      navigate(`/archetypes/${match.name}`, { replace: true });
    }
  });
  const [rotationIndex] = createResource(fetchRotationIndex);
  const [tab, setTab] = createSignal<ArchTab>('core');
  const [viewMode, setViewMode] = createPersistentViewMode('cm:cardsView');

  // Pre-rotation snapshot fallback. Fires when the live archetype lookup has
  // settled with an error (404 from R2) and the rotation index knows where
  // this slug last appeared. The same archetype page renders, just sourced
  // from `/reports/Snapshots/{date}/` instead of the live folder.
  const liveReport = () => (report.error ? null : report());
  const snapshotDate = createMemo<string | null>(() => {
    if (liveReport()) {
      return null;
    }
    if (report.loading) {
      return null;
    }
    const idx = rotationIndex();
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

  const effectiveReport = createMemo<ArchetypeReport | null | undefined>(() => liveReport() ?? snapshotReport());
  const effectiveIndex = createMemo<ArchetypeIndexEntry[] | undefined>(() =>
    liveReport() ? index() : snapshotIndex()
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

  onMount(() => {
    document.title = `${label()} — Ciphermaniac`;
  });

  createEffect(() => {
    const l = label();
    if (l) {
      document.title = `${l} — Ciphermaniac`;
    }
  });

  return (
    <>
      <Breadcrumb crumbs={[{ label: 'Archetypes', href: '/archetypes' }, { label: label() }]} />

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
          tab={tab()}
          onTabChange={setTab}
          viewMode={viewMode()}
          onViewChange={setViewMode}
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
  tab: ArchTab;
  onTabChange: (t: ArchTab) => void;
  viewMode: ViewMode;
  onViewChange: (v: ViewMode) => void;
}

function ArchetypeBody(props: ArchetypeBodyProps) {
  const sortedByPct = createMemo(() =>
    [...(props.report.items as CardItem[])].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
  );
  const coreCards = createMemo(() => sortedByPct().filter(i => (i.pct ?? 0) >= CORE_THRESHOLD));
  const techCards = createMemo(() =>
    sortedByPct().filter(i => (i.pct ?? 0) < CORE_THRESHOLD && (i.pct ?? 0) >= TECH_THRESHOLD)
  );

  const sharePct = () => {
    const p = props.indexEntry?.percent;
    if (p === null || p === undefined || !Number.isFinite(p)) {
      return null;
    }
    return normalizePercent(p).toFixed(1);
  };

  return (
    <>
      <section class='hero'>
        <h1>{props.label}</h1>
        <div class='hero-meta'>
          <Show when={sharePct()}>
            <span>{sharePct()}% meta share</span>
            <span class='dot'>·</span>
          </Show>
          <span>{props.report.deckTotal.toLocaleString()} decks</span>
          <Show when={props.indexEntry?.signatureCards && props.indexEntry.signatureCards.length > 0}>
            <span class='dot'>·</span>
            <span>
              signature:{' '}
              {props
                .indexEntry!.signatureCards!.slice(0, 2)
                .map(s => s.name)
                .join(', ')}
            </span>
          </Show>
        </div>
      </section>

      <section>
        <div class='arche-toolbar'>
          <Tabs options={TAB_OPTIONS} selected={props.tab} onSelect={props.onTabChange} />
          <Segmented<ViewMode>
            options={VIEW_OPTIONS}
            selected={props.viewMode}
            onSelect={props.onViewChange}
            ariaLabel='View mode'
          />
        </div>

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
            items={sortedByPct()}
            viewMode={props.viewMode}
            emptyMessage='No cards in this report.'
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
