import { createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { fetchArchetypes, getArchetypeIconMap, prettyTournamentName, resolveArchetypeIcons } from '../lib/data';
import { useTournament } from '../lib/tournamentContext';
import { ONLINE_META_LABEL, ONLINE_META_NAME } from '../lib/constants';
import type { ArchetypeIndexEntry } from '../types';
import { Section } from '../components/Section';
import { SearchInput } from '../components/Chip';
import { Segmented } from '../components/Segmented';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { ArchetypeCard } from '../components/ArchetypeCard';
import { ArchetypeIcons } from '../components/ArchetypeIcon';
import { createPersistentViewMode } from '../lib/persistentSignal';
import { formatPercent } from '../lib/format';
import { latestValue } from '../lib/resource';
import { prefetchArchetypePage } from '../lib/prefetch';
import { fetchAllArchetypeWinRates, type WinRateAggregate, WR_MIN_GAMES, WR_MUTE_GAMES } from '../lib/archetypeWinRate';
import '../styles/pages/archetype.css';

type ViewMode = 'grid' | 'list';
const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' }
];

export function ArchetypesIndexPage() {
  const { tournament } = useTournament();
  const [archetypes] = createResource(tournament, fetchArchetypes);
  // For event views, fetch the online-meta archetypes as an image fallback when
  // the event index ships without thumbnails/signature cards.
  const [onlineArchetypes] = createResource(
    () => tournament() !== ONLINE_META_NAME,
    needFallback => (needFallback ? fetchArchetypes(ONLINE_META_NAME) : [])
  );
  // Non-suspending reads: tournament-scoped, so keep the old grid in place
  // while a tournament switch refetches (see lib/resource.ts).
  const archetypesData = () => latestValue(archetypes);
  const onlineArchetypesData = () => latestValue(onlineArchetypes);
  const onlineByName = createMemo(() => {
    const map = new Map<string, ArchetypeIndexEntry>();
    for (const a of onlineArchetypesData() ?? []) {
      map.set(a.name, a);
    }
    return map;
  });
  const iconMap = getArchetypeIconMap();
  const [query, setQuery] = createSignal('');
  const [viewMode, setViewMode] = createPersistentViewMode('cm:archetypesView');
  const navigate = useNavigate();

  // Win rates are only shown in the list view's column. Gate the fetch on that
  // view (and on the full index, not the filtered subset, so typing doesn't
  // refetch) — majors resolve in one request; the online meta fans out per
  // archetype, so we don't want it firing behind the grid.
  const [winRates] = createResource(
    () => {
      const list = archetypesData();
      return viewMode() === 'list' && list ? { t: tournament(), entries: list } : null;
    },
    ({ t, entries }) => fetchAllArchetypeWinRates(t, entries)
  );
  const winRateData = () => latestValue(winRates);

  // Field total behind every archetype's meta share (the caption denominator).
  const totalDecks = createMemo(() => {
    const list = archetypesData();
    if (!list || list.length === 0) {
      return null;
    }
    return list.reduce((sum, a) => sum + (a.deckCount ?? 0), 0);
  });

  onMount(() => {
    document.title = 'Archetypes — Ciphermaniac';
  });

  const filtered = createMemo(() => {
    const list = archetypesData() ?? [];
    const q = query().trim().toLowerCase();
    if (!q) {
      return list;
    }
    return list.filter(a => (a.label || a.name).toLowerCase().includes(q));
  });

  const scopeLabel = () => (tournament() === ONLINE_META_NAME ? ONLINE_META_LABEL : prettyTournamentName(tournament()));

  return (
    <>
      <section class='hero'>
        <h1>Archetypes</h1>
        <div class='hero-meta'>
          <Show when={archetypesData()} fallback={<Skeleton width='200px' height='13px' />}>
            <span>{archetypesData()!.length.toLocaleString()} active archetypes</span>
            <span class='dot'>·</span>
            <span>{scopeLabel()}</span>
          </Show>
        </div>
      </section>

      <Section>
        <div class='filter-bar'>
          <div class='filter-row'>
            <SearchInput value={query()} onInput={setQuery} placeholder='Search archetypes by name...' />
            <A href='/matchups' class='filter-link'>
              Matchup matrix →
            </A>
            <Segmented<ViewMode>
              options={VIEW_OPTIONS}
              selected={viewMode()}
              onSelect={setViewMode}
              ariaLabel='View mode'
            />
          </div>
        </div>
      </Section>

      <Section right={`${filtered().length.toLocaleString()} matching`}>
        <Show
          when={archetypesData()}
          fallback={
            <Show when={viewMode() === 'grid'} fallback={<ListSkeleton />}>
              <div class='gallery-grid'>
                <For each={Array.from({ length: 8 })}>{() => <Skeleton height='240px' />}</For>
              </div>
            </Show>
          }
        >
          <Show
            when={filtered().length > 0}
            fallback={
              <EmptyState
                title='No archetypes match.'
                description='Try a different search term, or clear the filter to see everything.'
                actions={
                  <button class='btn btn-secondary' type='button' onClick={() => setQuery('')}>
                    Clear filter
                  </button>
                }
              />
            }
          >
            <Show
              when={viewMode() === 'grid'}
              fallback={
                <ArchetypesListView
                  items={filtered()}
                  iconMap={iconMap}
                  winRates={winRateData()}
                  totalDecks={totalDecks()}
                  scopeLabel={scopeLabel()}
                  onSelect={slug => navigate(`/archetypes/${encodeURIComponent(slug)}`)}
                />
              }
            >
              <div class='gallery-grid'>
                <For each={filtered()}>
                  {(a, i) => <ArchetypeCard entry={a} online={onlineByName().get(a.name)} eagerImage={i() < 8} />}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </Section>
    </>
  );
}

type SortCol = 'share' | 'decks' | 'winRate';
type SortDir = 'ascending' | 'descending';

// Single source of truth for the list table's column headers, shared by the
// real table and its loading skeleton so the two never drift.
const COLUMNS: { label: string; class?: string; sort?: SortCol }[] = [
  { label: '#', class: 'num' },
  { label: 'Archetype' },
  { label: 'Meta share', class: 'num', sort: 'share' },
  { label: 'Decks', class: 'num', sort: 'decks' },
  { label: 'Win rate', class: 'num', sort: 'winRate' }
];

function ArchetypesListView(props: {
  items: ArchetypeIndexEntry[];
  iconMap?: Map<string, string[]>;
  winRates?: Map<string, WinRateAggregate>;
  totalDecks: number | null;
  scopeLabel: string;
  onSelect: (slug: string) => void;
}) {
  const [sortCol, setSortCol] = createSignal<SortCol>('share');
  const [sortDir, setSortDir] = createSignal<SortDir>('descending');

  const winRateOf = (entry: ArchetypeIndexEntry): number | null => props.winRates?.get(entry.name)?.winRate ?? null;
  const gamesOf = (entry: ArchetypeIndexEntry): number => props.winRates?.get(entry.name)?.games ?? 0;

  function toggle(col: SortCol) {
    if (sortCol() === col) {
      setSortDir(d => (d === 'ascending' ? 'descending' : 'ascending'));
    } else {
      setSortCol(col);
      setSortDir('descending');
    }
  }
  const ariaSort = (col: SortCol): SortDir | 'none' => (sortCol() === col ? sortDir() : 'none');

  const sorted = createMemo(() => {
    const col = sortCol();
    const dir = sortDir() === 'ascending' ? 1 : -1;
    // Read the reactive inputs here in the memo body; the comparator below closes
    // over these locals so it stays a plain (non-tracked) function.
    const rates = props.winRates;
    const key = (e: ArchetypeIndexEntry): number | null =>
      col === 'share' ? e.percent : col === 'decks' ? e.deckCount : (rates?.get(e.name)?.winRate ?? null);
    // Nulls sort last regardless of direction.
    return [...props.items].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka === null && kb === null) {
        return 0;
      }
      if (ka === null) {
        return 1;
      }
      if (kb === null) {
        return -1;
      }
      return (ka - kb) * dir;
    });
  });

  const SortHeader = (p: { col: SortCol; label: string }) => (
    <th class='num sortable' aria-sort={ariaSort(p.col)}>
      <button type='button' class='th-sort' onClick={() => toggle(p.col)}>
        {p.label}
        <Show when={sortCol() === p.col}>
          <span class='sort-mark' aria-hidden='true'>
            {sortDir() === 'ascending' ? '▲' : '▼'}
          </span>
        </Show>
      </button>
    </th>
  );

  return (
    <div class='table-wrap'>
      <Show when={props.totalDecks}>
        {total => (
          <p class='table-caption'>
            Share of {total().toLocaleString()} decks · {props.scopeLabel}
          </p>
        )}
      </Show>
      <table class='data'>
        <thead>
          <tr>
            <For each={COLUMNS}>
              {col =>
                col.sort ? <SortHeader col={col.sort} label={col.label} /> : <th class={col.class}>{col.label}</th>
              }
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={sorted()}>
            {(entry, i) => (
              <tr
                class='is-link'
                onClick={() => props.onSelect(entry.name)}
                onMouseEnter={prefetchArchetypePage}
                onFocus={prefetchArchetypePage}
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    props.onSelect(entry.name);
                  }
                }}
              >
                <td class='num muted-cell'>{i() + 1}</td>
                <td>
                  <span class='arche-name-cell'>
                    <ArchetypeIcons slugs={resolveArchetypeIcons(entry, props.iconMap)} size={28} reserveSlot />
                    <span class='cardname'>{entry.label || entry.name}</span>
                  </span>
                </td>
                <td class='num'>{formatPercent(entry.percent)}</td>
                <td class='num muted-cell'>{entry.deckCount?.toLocaleString() ?? '—'}</td>
                <td class='num' classList={{ 'wr-cell': true, 'is-muted': gamesOf(entry) < WR_MUTE_GAMES }}>
                  <Show when={gamesOf(entry) >= WR_MIN_GAMES && winRateOf(entry) !== null} fallback={<span>—</span>}>
                    {formatPercent(winRateOf(entry))}
                    <span class='wr-games'>{gamesOf(entry).toLocaleString()}g</span>
                  </Show>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div class='table-wrap'>
      <table class='data'>
        <thead>
          <tr>
            <For each={COLUMNS}>{col => <th class={col.class}>{col.label}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={Array.from({ length: 12 })}>
            {() => (
              <tr>
                <td class='num'>
                  <Skeleton width='20px' />
                </td>
                <td>
                  <Skeleton width='60%' />
                </td>
                <td class='num'>
                  <Skeleton width='40px' />
                </td>
                <td class='num'>
                  <Skeleton width='48px' />
                </td>
                <td class='num'>
                  <Skeleton width='56px' />
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
