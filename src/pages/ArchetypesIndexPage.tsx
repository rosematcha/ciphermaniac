import { formatIdFromKey } from '../../shared/formats/registry';
import { createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { fetchArchetypes, getArchetypeIconMap, prettyTournamentName, resolveArchetypeIcons } from '../lib/data';
import { useTournament } from '../lib/tournamentContext';
import { ONLINE_META_LABEL, ONLINE_META_NAME } from '../lib/constants';
import type { ArchetypeIndexEntry } from '../types';
import { Section } from '../components/Section';
import { SearchInput } from '../components/Chip';
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { SortTh } from '@ciphermaniac/design/components/SortTh';
import { type SkeletonColumn, TableSkeleton } from '@ciphermaniac/design/components/TableSkeleton';
import { EmptyState } from '../components/EmptyState';
import { ArchetypeCard, ArchetypeCardSkeleton } from '../components/ArchetypeCard';
import { ArchetypeIcons } from '../components/ArchetypeIcon';
import { createPersistentViewMode } from '../lib/persistentSignal';
import { formatPercent } from '../lib/format';
import { latestValue } from '../lib/resource';
import { prefetchArchetypePage } from '../lib/prefetch';
import { followRowLink } from '../lib/rowLink';
import { fetchAllArchetypeWinRates, type WinRateAggregate } from '../lib/archetypeWinRate';
import { matchPointWilson, sampleTier } from '../lib/confidence';
import { formatPlusMinus, formatRange } from '../components/matchupsPanel/model';
import { foldSearch } from '../utils/searchFold';
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
  // the event index ships without thumbnails/signature cards. A format's
  // archetypes are a different game, so Standard art would mislabel them.
  const [onlineArchetypes] = createResource(
    () => tournament() !== ONLINE_META_NAME && !formatIdFromKey(tournament()),
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
  const iconMap = getArchetypeIconMap;
  const [query, setQuery] = createSignal('');
  const [viewMode, setViewMode] = createPersistentViewMode('cm:archetypesView');

  // Online aggregates arrive with the index. Legacy majors load their shared
  // matchup profile only when its win-rate column is visible.
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
    const q = foldSearch(query().trim());
    if (!q) {
      return list;
    }
    return list.filter(a => foldSearch(a.label || a.name).includes(q));
  });

  const scopeLabel = () => (tournament() === ONLINE_META_NAME ? ONLINE_META_LABEL : prettyTournamentName(tournament()));

  return (
    <>
      <Section>
        <div class='filter-bar'>
          <div class='filter-row'>
            <SearchInput value={query()} onInput={setQuery} placeholder='Search archetypes by name...' />
            <Segmented<ViewMode>
              options={VIEW_OPTIONS}
              selected={viewMode()}
              onSelect={setViewMode}
              ariaLabel='View mode'
            />
          </div>
        </div>
      </Section>

      <Section>
        <Show
          when={archetypesData()}
          fallback={
            <Show when={viewMode() === 'grid'} fallback={<ListSkeleton />}>
              <div class='arche-gallery'>
                <div class='gallery-grid'>
                  <For each={Array.from({ length: 8 })}>{() => <ArchetypeCardSkeleton />}</For>
                </div>
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
                  iconMap={iconMap()}
                  winRates={winRateData()}
                  totalDecks={totalDecks()}
                  scopeLabel={scopeLabel()}
                />
              }
            >
              <div class='arche-gallery'>
                <div class='gallery-grid'>
                  <For each={filtered()}>
                    {(a, i) => <ArchetypeCard entry={a} online={onlineByName().get(a.name)} eagerImage={i() < 8} />}
                  </For>
                </div>
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
const COLUMNS: (SkeletonColumn & { sort?: SortCol })[] = [
  { label: '#', class: 'num col-rank', width: '20px' },
  { label: 'Archetype', class: 'col-name', width: '55%' },
  { label: 'Meta share', class: 'num', sort: 'share', width: '40px' },
  // Deck count is meta share counted a second way; it is the column a phone
  // drops so the two rates stay on screen.
  { label: 'Decks', class: 'num col-secondary', sort: 'decks', width: '48px' },
  { label: 'Win rate', class: 'num', sort: 'winRate', width: '56px' }
];

function ArchetypesListView(props: {
  items: ArchetypeIndexEntry[];
  iconMap?: Map<string, string[]>;
  winRates?: Map<string, WinRateAggregate>;
  totalDecks: number | null;
  scopeLabel: string;
}) {
  const [sortCol, setSortCol] = createSignal<SortCol>('share');
  const [sortDir, setSortDir] = createSignal<SortDir>('descending');

  const winRateOf = (entry: ArchetypeIndexEntry): number | null => props.winRates?.get(entry.name)?.winRate ?? null;
  const gamesOf = (entry: ArchetypeIndexEntry): number => props.winRates?.get(entry.name)?.games ?? 0;
  const intervalOf = (entry: ArchetypeIndexEntry) => {
    const aggregate = props.winRates?.get(entry.name);
    return aggregate ? matchPointWilson(aggregate.wins, aggregate.ties, aggregate.games) : null;
  };

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
    // eslint-disable-next-line solid/reactivity -- read here so the memo tracks it; `key` runs synchronously inside this same memo, never later
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

  return (
    <div class='table-wrap arche-list'>
      <table class='data' aria-label='Archetypes'>
        <thead>
          <tr>
            <For each={COLUMNS}>
              {col => (
                <Show when={col.sort} fallback={<th class={col.class}>{col.label}</th>}>
                  {sortCol => (
                    <SortTh class={col.class} sort={ariaSort(sortCol())} onSort={() => toggle(sortCol())}>
                      {col.label}
                    </SortTh>
                  )}
                </Show>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={sorted()}>
            {(entry, i) => (
              <tr class='is-link' onClick={followRowLink} onMouseEnter={prefetchArchetypePage}>
                <td class='num col-rank'>{i() + 1}</td>
                <th scope='row' class='col-name'>
                  <span class='arche-name-cell'>
                    <ArchetypeIcons slugs={resolveArchetypeIcons(entry, props.iconMap)} size={28} reserveSlot />
                    <A
                      href={`/archetypes/${encodeURIComponent(entry.name)}`}
                      class='cardname'
                      onFocus={prefetchArchetypePage}
                    >
                      {entry.label || entry.name}
                    </A>
                  </span>
                </th>
                <td class='num'>{formatPercent(entry.percent)}</td>
                <td class='num muted-cell col-secondary'>{entry.deckCount?.toLocaleString() ?? '—'}</td>
                <td class='num' classList={{ 'wr-cell': true, 'is-muted': sampleTier(gamesOf(entry)) !== 'solid' }}>
                  <Show
                    when={sampleTier(gamesOf(entry)) !== 'thin' && winRateOf(entry) !== null}
                    fallback={<span>—</span>}
                  >
                    <span title={`95% interval ${formatRange(intervalOf(entry))}`}>
                      {formatPercent(winRateOf(entry))}{' '}
                      <span class='wr-uncertainty'>{formatPlusMinus(intervalOf(entry))}</span>
                    </span>
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
  return <TableSkeleton class='arche-list' columns={COLUMNS} rows={12} />;
}
