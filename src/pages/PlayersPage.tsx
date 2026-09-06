import { createMemo, createResource, For, type JSX, onMount, Show } from 'solid-js';
import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { fetchPlayerIndexSlim } from '../lib/data';
import { resolved } from '../lib/resource';
import { Section } from '../components/Section';
import { Segmented } from '../components/Segmented';
import { SearchInput } from '../components/Chip';
import { Pagination } from '../components/Pagination';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { createPagination, createQueryPageSignal } from '../lib/pagination';
import { debounced } from '../lib/debounce';
import { prefetchPlayerProfilePage } from '../lib/prefetch';
import type { PlayerIndexSlimEntry } from '../types';
import { foldSearch } from '../utils/searchFold';
import { comparePlayers, type PlayerSortDir, type PlayerSortKey, RATE_MIN_EVENTS, winPct } from '../utils/playerSort';
import '../styles/pages/players-tables.css';
import '../styles/pages/players.css';

const PAGE_SIZE = 50;
const SORT_KEYS: readonly PlayerSortKey[] = ['events', 'day2s', 'winPct'];
const DEFAULT_SORT: PlayerSortKey = 'day2s';
/** The two rankings the bar offers; Events sorts from its header only. */
const RANK_OPTIONS: { value: PlayerSortKey; label: string }[] = [
  { value: 'day2s', label: 'Day 2s' },
  { value: 'winPct', label: 'Win %' }
];

/**
 * /players — every player with two or more events, ranked. Search and the
 * rank switch share one bar that stays put while the table scrolls; the table
 * is rank, player, events, Day 2s, win rate, and keeps those columns on a
 * phone too.
 */
export function PlayersPage() {
  const [index] = createResource(fetchPlayerIndexSlim);
  const navigate = useNavigate();

  // Filter/sort/page state lives in the URL so a refresh, a shared link, or
  // coming back from a profile lands on the same view. Every write replaces —
  // typing and re-sorting must not pile up history entries. Defaults are
  // omitted from the URL so the bare /players stays canonical.
  const [params, setParams] = useSearchParams<{ q?: string; sort?: string; dir?: string; page?: string }>();
  const query = () => (typeof params.q === 'string' ? params.q : '');
  const debouncedQuery = debounced(query, 120);
  const setQuery = (v: string) => setParams({ q: v || undefined, page: undefined }, { replace: true });
  const sortKey = (): PlayerSortKey => {
    const s = params.sort;
    return s && (SORT_KEYS as readonly string[]).includes(s) ? (s as PlayerSortKey) : DEFAULT_SORT;
  };
  const sortDir = (): PlayerSortDir => (params.dir === 'asc' ? 'asc' : 'desc');

  onMount(() => {
    document.title = 'Players — Ciphermaniac';
  });

  // Non-suspending read: keeps navigation instant and lets the skeleton /
  // error fallbacks below actually render (see lib/resource.ts).
  const indexData = () => resolved(index);

  // Fold names once per index load and retain only the strings. Avoiding a
  // second array of wrapper objects matters for this large, session-long index.
  const foldedNames = createMemo(() => (indexData() ?? []).map(entry => foldSearch(entry.name)));

  const filtered = createMemo<PlayerIndexSlimEntry[]>(() => {
    const q = foldSearch(debouncedQuery().trim());
    const rows = indexData() ?? [];
    if (!q) {
      return rows;
    }
    const folded = foldedNames();
    return rows.filter((_, i) => folded[i].includes(q));
  });

  const sorted = createMemo(() => [...filtered()].sort(comparePlayers(sortKey(), sortDir())));

  const pageParam = createQueryPageSignal(
    () => params.page,
    page => setParams({ page }, { replace: true })
  );
  // No resetOn list: setQuery and the sort setters already clear `page` themselves.
  const { page, totalPages, pageItems: pageRows, setPage } =
    // eslint-disable-next-line solid/reactivity -- createPagination reads `sorted` inside its own createMemo (a tracked scope); the analyzer can't see through the helper
    createPagination(sorted, PAGE_SIZE, undefined, pageParam);

  const writeSort = (key: PlayerSortKey, dir: PlayerSortDir) =>
    setParams(
      { sort: key === DEFAULT_SORT ? undefined : key, dir: dir === 'desc' ? undefined : dir, page: undefined },
      { replace: true }
    );
  /** A header click: same column flips direction, a new column starts descending. */
  const toggleSort = (next: PlayerSortKey) =>
    writeSort(next, sortKey() === next ? (sortDir() === 'asc' ? 'desc' : 'asc') : 'desc');
  /** The bar's switch always ranks from the top. */
  const rankBy = (next: PlayerSortKey) => writeSort(next, 'desc');

  const ariaSort = (key: PlayerSortKey): 'ascending' | 'descending' | 'none' =>
    sortKey() === key ? (sortDir() === 'asc' ? 'ascending' : 'descending') : 'none';

  const profileHref = (p: PlayerIndexSlimEntry) => `/players/${encodeURIComponent(p.playerId)}`;
  const rankOf = (i: number) => (page() - 1) * PAGE_SIZE + i + 1;
  const winLabel = (p: PlayerIndexSlimEntry) => (p.wins + p.losses > 0 ? `${Math.round(winPct(p) * 100)}%` : '—');

  return (
    <>
      <section class='hero'>
        <h1>Players</h1>
        <div class='hero-meta'>
          <Show when={indexData()}>
            <span>{indexData()!.length.toLocaleString()} players with two or more events</span>
          </Show>
        </div>
      </section>

      <div class='players-bar'>
        <SearchInput value={query()} onInput={setQuery} placeholder='Search by player name...' />
        <Segmented<PlayerSortKey> options={RANK_OPTIONS} selected={sortKey()} onSelect={rankBy} ariaLabel='Rank by' />
      </div>

      <Section>
        <Show
          when={indexData()}
          fallback={
            <Show when={index.error || indexData() === null} fallback={<TableSkeleton />}>
              <EmptyState
                title='Player data unavailable'
                description="Player data isn't available yet. Check back after the next data update."
              />
            </Show>
          }
        >
          <Show
            when={pageRows().length > 0}
            fallback={
              <EmptyState
                title='No players match.'
                description='Try a different spelling.'
                actions={
                  <button
                    class='btn btn-secondary'
                    type='button'
                    onClick={() => setParams({ q: undefined, page: undefined }, { replace: true })}
                  >
                    Clear search
                  </button>
                }
              />
            }
          >
            <div class='table-wrap players-table'>
              <table class='data'>
                <thead>
                  <tr>
                    <th class='num players-rank'>#</th>
                    <th>Player</th>
                    <SortableTh ariaSort={ariaSort('events')} onSort={() => toggleSort('events')}>
                      Events
                    </SortableTh>
                    <SortableTh ariaSort={ariaSort('day2s')} onSort={() => toggleSort('day2s')}>
                      Day 2s
                    </SortableTh>
                    <SortableTh ariaSort={ariaSort('winPct')} onSort={() => toggleSort('winPct')}>
                      Win %
                    </SortableTh>
                  </tr>
                </thead>
                <tbody>
                  <For each={pageRows()}>
                    {(p, i) => (
                      <tr
                        class='is-link'
                        onClick={e => {
                          // The name link handles its own (and modified) clicks.
                          if (e.target instanceof Element && e.target.closest('a')) {
                            return;
                          }
                          navigate(profileHref(p));
                        }}
                        onMouseEnter={prefetchPlayerProfilePage}
                      >
                        <td class='num muted-cell players-rank'>{rankOf(i())}</td>
                        <td class='players-name'>
                          <A href={profileHref(p)} class='cardname' onFocus={prefetchPlayerProfilePage}>
                            {p.name}
                          </A>
                          <Show when={p.country}>
                            <span class='players-country'>{p.country}</span>
                          </Show>
                        </td>
                        <td class='num'>{p.eventCount.toLocaleString()}</td>
                        <td class='num'>{p.day2s.toLocaleString()}</td>
                        <td class='num' classList={{ 'stat-dim': p.eventCount < RATE_MIN_EVENTS }}>
                          {winLabel(p)}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <Show when={totalPages() > 1}>
              <Pagination
                page={page()}
                totalPages={totalPages()}
                onChange={setPage}
                pageSize={PAGE_SIZE}
                totalItems={filtered().length}
              />
            </Show>
          </Show>
        </Show>
      </Section>
    </>
  );
}

function SortableTh(props: {
  ariaSort: 'ascending' | 'descending' | 'none';
  onSort: () => void;
  children: JSX.Element;
}) {
  return (
    <th aria-sort={props.ariaSort} class='sortable num'>
      <button type='button' class='th-sort' onClick={() => props.onSort()}>
        {props.children}
      </button>
    </th>
  );
}

function TableSkeleton() {
  return (
    <div class='table-wrap players-table'>
      <table class='data'>
        <thead>
          <tr>
            <th class='num players-rank'>#</th>
            <th>Player</th>
            <th class='num'>Events</th>
            <th class='num'>Day 2s</th>
            <th class='num'>Win %</th>
          </tr>
        </thead>
        <tbody>
          <For each={Array.from({ length: 10 })}>
            {() => (
              <tr>
                <td class='num'>
                  <Skeleton width='20px' />
                </td>
                <td>
                  <Skeleton width='60%' />
                </td>
                <td class='num'>
                  <Skeleton width='32px' />
                </td>
                <td class='num'>
                  <Skeleton width='32px' />
                </td>
                <td class='num'>
                  <Skeleton width='40px' />
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
