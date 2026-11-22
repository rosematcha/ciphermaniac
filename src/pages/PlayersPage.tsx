import { createMemo, createResource, For, onMount, Show } from 'solid-js';
import { A, useSearchParams } from '@solidjs/router';
import { fetchPlayerIndexSlim, fetchPlayerTop } from '../lib/data';
import { resolved } from '../lib/resource';
import { Section } from '../components/Section';
import { Segmented } from '@ciphermaniac/design/components/Segmented';
import { SearchInput } from '../components/Chip';
import { Pagination } from '../components/Pagination';
import { SortTh } from '@ciphermaniac/design/components/SortTh';
import { type SkeletonColumn, TableSkeleton } from '@ciphermaniac/design/components/TableSkeleton';
import { EmptyState } from '../components/EmptyState';
import { createPagination, createQueryPageSignal } from '../lib/pagination';
import { debounced } from '../lib/debounce';
import { prefetchPlayerProfilePage } from '../lib/prefetch';
import { followRowLink } from '../lib/rowLink';
import { formatPercent } from '../lib/format';
import type { PlayerIndexSlimEntry } from '../types';
import { foldSearch } from '../utils/searchFold';
import { filterSortedPlayers } from '../utils/playerSearch';
import { comparePlayers, type PlayerSortDir, type PlayerSortKey, RATE_MIN_EVENTS, winPct } from '../utils/playerSort';
import '../styles/pages/players-tables.css';
import '../styles/pages/players.css';

const PAGE_SIZE = 50;
const SORT_KEYS: readonly PlayerSortKey[] = ['events', 'day2s', 'topCuts', 'winPct'];
const DEFAULT_SORT: PlayerSortKey = 'day2s';
/** The two rankings the bar offers; Events sorts from its header only. */
const RANK_OPTIONS: { value: PlayerSortKey; label: string }[] = [
  { value: 'day2s', label: 'Day 2s' },
  { value: 'winPct', label: 'Win %' }
];

/**
 * /players — every player with two or more events, ranked. Search and the
 * rank switch share one bar that stays put while the table scrolls; the table
 * is rank, player, events, Day 2s, top cuts and win rate. A phone drops top
 * cuts and keeps the other five.
 */
export function PlayersPage() {
  const [index] = createResource(fetchPlayerIndexSlim);
  // The first page, a few KB, to show while the full index (about 300 KB) loads.
  const [top] = createResource(fetchPlayerTop);

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
  const defaultView = () => !query() && !params.sort && !params.dir && (!params.page || params.page === '1');
  // While the index loads, the default view shows the published first page; anything else waits,
  // and an index that failed shows its error rather than 50 rows passing for the whole list.
  const indexFailed = () => Boolean(index.error) || indexData() === null;
  const rowsSource = () => (indexFailed() ? undefined : (indexData() ?? (defaultView() ? resolved(top) : undefined)));

  // Fold once per index load; lookup stays aligned when the ranking changes.
  const foldedNames = createMemo(() => new Map((rowsSource() ?? []).map(entry => [entry, foldSearch(entry.name)])));

  // Search never invalidates this memo: only data or ranking changes re-sort.
  const sortedBase = createMemo(() => [...(rowsSource() ?? [])].sort(comparePlayers(sortKey(), sortDir())));

  const filtered = createMemo<PlayerIndexSlimEntry[]>(() => {
    const q = foldSearch(debouncedQuery().trim());
    return filterSortedPlayers(sortedBase(), foldedNames(), q);
  });

  const pageParam = createQueryPageSignal(
    () => params.page,
    page => setParams({ page }, { replace: true })
  );
  // No resetOn list: setQuery and the sort setters already clear `page` themselves.
  const {
    page,
    totalPages,
    pageItems: pageRows,
    setPage
  } = createPagination(filtered, PAGE_SIZE, undefined, pageParam);

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
  const winLabel = (p: PlayerIndexSlimEntry) => (p.wins + p.losses > 0 ? formatPercent(winPct(p) * 100) : '—');
  /* Many of 1,500 careers have no top cut. Printing the zeros gave a column of
     "0"; blank leaves them reading as marks against a quiet field, the same way
     the profile's Day 2 column does. */
  const markLabel = (n: number) => (n > 0 ? n.toLocaleString() : <span class='players-nil'>—</span>);

  return (
    <>
      <section class='hero'>
        {/* Compare had no entry point outside a profile, so reaching it meant
            picking a player you didn't want first. */}
        <div class='player-ident'>
          <div>
            <h1>Players</h1>
            <div class='hero-meta'>
              <Show when={indexData()}>
                <span>{indexData()!.length.toLocaleString()} players with two or more events</span>
              </Show>
            </div>
          </div>
          <A href='/players/compare' class='btn btn-secondary player-compare'>
            Compare two players
          </A>
        </div>
      </section>

      <div class='players-bar'>
        <SearchInput value={query()} onInput={setQuery} placeholder='Search by player name...' />
        <Segmented<PlayerSortKey> options={RANK_OPTIONS} selected={sortKey()} onSelect={rankBy} ariaLabel='Rank by' />
      </div>

      <Section>
        <Show
          when={rowsSource()}
          fallback={
            <Show when={index.error || indexData() === null} fallback={<TableSkeleton columns={COLUMNS} />}>
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
            <div class='table-wrap'>
              <table class='data' aria-label='Players'>
                <thead>
                  <tr>
                    <th class='num col-rank'>#</th>
                    <th class='col-name'>Player</th>
                    <SortTh class='num' sort={ariaSort('events')} onSort={() => toggleSort('events')}>
                      Events
                    </SortTh>
                    <SortTh class='num' sort={ariaSort('day2s')} onSort={() => toggleSort('day2s')}>
                      Day 2s
                    </SortTh>
                    <SortTh class='num col-secondary' sort={ariaSort('topCuts')} onSort={() => toggleSort('topCuts')}>
                      Top cuts
                    </SortTh>
                    <SortTh class='num' sort={ariaSort('winPct')} onSort={() => toggleSort('winPct')}>
                      Win %
                    </SortTh>
                  </tr>
                </thead>
                <tbody>
                  <For each={pageRows()}>
                    {(p, i) => (
                      <tr class='is-link' onClick={followRowLink} onMouseEnter={prefetchPlayerProfilePage}>
                        <td class='num col-rank'>{rankOf(i())}</td>
                        <th scope='row' class='col-name players-name'>
                          <span class='players-ident'>
                            <A href={profileHref(p)} class='cardname' onFocus={prefetchPlayerProfilePage}>
                              {p.name}
                            </A>
                            <Show when={p.country}>
                              <span class='players-country'>{p.country}</span>
                            </Show>
                          </span>
                        </th>
                        <td class='num'>{p.eventCount.toLocaleString()}</td>
                        <td class='num'>{p.day2s.toLocaleString()}</td>
                        <td class='num col-secondary'>{markLabel(p.topCuts)}</td>
                        <td class='num' classList={{ 'stat-dim': p.eventCount < RATE_MIN_EVENTS }}>
                          {winLabel(p)}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <Show when={indexData() && totalPages() > 1}>
              <Pagination page={page()} totalPages={totalPages()} onChange={setPage} />
            </Show>
          </Show>
        </Show>
      </Section>
    </>
  );
}

const COLUMNS: SkeletonColumn[] = [
  { label: '#', class: 'num col-rank', width: '20px' },
  { label: 'Player', class: 'col-name', width: '55%' },
  { label: 'Events', class: 'num', width: '32px' },
  { label: 'Day 2s', class: 'num', width: '32px' },
  { label: 'Top cuts', class: 'num col-secondary', width: '24px' },
  { label: 'Win %', class: 'num', width: '40px' }
];
