import { createMemo, createResource, For, type JSX, onMount, Show } from 'solid-js';
import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { fetchPlayerIndexSlim } from '../lib/data';
import { resolved } from '../lib/resource';
import { Section } from '../components/Section';
import { SearchInput } from '../components/Chip';
import { Pagination } from '../components/Pagination';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { createPagination, createQueryPageSignal } from '../lib/pagination';
import { debounced } from '../lib/debounce';
import { prefetchPlayerProfilePage } from '../lib/prefetch';
import type { PlayerIndexSlimEntry } from '../types';
import { foldSearch } from '../utils/searchFold';
import {
  comparePlayers,
  DAY2_RATE_MIN_EVENTS,
  day2Rate,
  type PlayerSortDir,
  type PlayerSortKey
} from '../utils/playerSort';
import '../styles/pages/players-tables.css';

const PAGE_SIZE = 50;
const SORT_KEYS: readonly PlayerSortKey[] = ['events', 'day2s', 'topCuts', 'titles', 'day2Rate'];
const DEFAULT_SORT: PlayerSortKey = 'day2s';

export function PlayersPage() {
  const [index] = createResource(fetchPlayerIndexSlim);
  const navigate = useNavigate();

  // Filter/sort/page state lives in the URL so a refresh, a shared link, or
  // coming back from a profile lands on the same view. Every write replaces —
  // typing and re-sorting must not pile up history entries. Defaults are
  // omitted from the URL so the bare /players stays canonical.
  const [params, setParams] = useSearchParams<{
    q?: string;
    country?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>();
  const query = () => (typeof params.q === 'string' ? params.q : '');
  const debouncedQuery = debounced(query, 120);
  const setQuery = (v: string) => setParams({ q: v || undefined, page: undefined }, { replace: true });
  const country = () => (typeof params.country === 'string' ? params.country : '');
  const setCountry = (v: string) => setParams({ country: v || undefined, page: undefined }, { replace: true });
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

  // Country codes present in the index, with player counts for the filter menu.
  const countries = createMemo(() => {
    const counts = new Map<string, number>();
    for (const p of indexData() ?? []) {
      if (p.country) {
        counts.set(p.country, (counts.get(p.country) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

  const filtered = createMemo<PlayerIndexSlimEntry[]>(() => {
    const q = foldSearch(debouncedQuery().trim());
    const c = country();
    const rows = indexData() ?? [];
    if (!q && !c) {
      return rows;
    }
    const folded = foldedNames();
    return rows.filter((entry, index) => (!q || folded[index].includes(q)) && (!c || entry.country === c));
  });

  const sorted = createMemo(() => [...filtered()].sort(comparePlayers(sortKey(), sortDir())));

  const pageParam = createQueryPageSignal(
    () => params.page,
    page => setParams({ page }, { replace: true })
  );
  // No resetOn list: setQuery and setSort already clear `page` themselves.
  const { page, totalPages, pageItems: pageRows, setPage } =
    // eslint-disable-next-line solid/reactivity -- createPagination reads `sorted` inside its own createMemo (a tracked scope); the analyzer can't see through the helper
    createPagination(sorted, PAGE_SIZE, undefined, pageParam);

  function setSort(next: PlayerSortKey) {
    const dir: PlayerSortDir = sortKey() === next ? (sortDir() === 'asc' ? 'desc' : 'asc') : 'desc';
    setParams(
      {
        sort: next === DEFAULT_SORT ? undefined : next,
        dir: dir === 'desc' ? undefined : dir,
        page: undefined
      },
      { replace: true }
    );
  }

  const ariaSort = (key: PlayerSortKey): 'ascending' | 'descending' | 'none' =>
    sortKey() === key ? (sortDir() === 'asc' ? 'ascending' : 'descending') : 'none';

  const profileHref = (p: PlayerIndexSlimEntry) => `/players/${encodeURIComponent(p.playerId)}`;

  return (
    <>
      <Section>
        <div class='filter-bar'>
          <div class='filter-row'>
            <SearchInput value={query()} onInput={setQuery} placeholder='Search by player name...' />
            <select
              class='fb-select country-select'
              aria-label='Filter by country'
              value={country()}
              onChange={e => setCountry(e.currentTarget.value)}
            >
              <option value=''>All countries</option>
              <For each={countries()}>
                {([code, count]) => <option value={code}>{`${code} (${count.toLocaleString()})`}</option>}
              </For>
            </select>
          </div>
        </div>
      </Section>

      <Section right={`${filtered().length.toLocaleString()} matching`}>
        <Show
          when={indexData()}
          fallback={
            <Show when={index.error || indexData() === null} fallback={<TableSkeleton />}>
              <EmptyState
                title='Player data unavailable'
                description="Player data for this event isn't available yet. Check back after the next data update."
              />
            </Show>
          }
        >
          <Show
            when={pageRows().length > 0}
            fallback={
              <EmptyState
                title='No players match.'
                description='Try clearing the search or country filter.'
                actions={
                  <button
                    class='btn btn-secondary'
                    type='button'
                    onClick={() => setParams({ q: undefined, country: undefined, page: undefined }, { replace: true })}
                  >
                    Reset
                  </button>
                }
              />
            }
          >
            <div class='table-wrap'>
              <table class='data'>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Country</th>
                    <SortableTh ariaSort={ariaSort('events')} onSort={() => setSort('events')}>
                      Events
                    </SortableTh>
                    <SortableTh ariaSort={ariaSort('day2s')} onSort={() => setSort('day2s')}>
                      Day 2s
                    </SortableTh>
                    <SortableTh ariaSort={ariaSort('day2Rate')} onSort={() => setSort('day2Rate')}>
                      Day 2 rate
                    </SortableTh>
                    <SortableTh ariaSort={ariaSort('topCuts')} onSort={() => setSort('topCuts')}>
                      Top cuts
                    </SortableTh>
                    <SortableTh ariaSort={ariaSort('titles')} onSort={() => setSort('titles')}>
                      Titles
                    </SortableTh>
                  </tr>
                </thead>
                <tbody>
                  <For each={pageRows()}>
                    {p => (
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
                        <td>
                          <A href={profileHref(p)} class='cardname' onFocus={prefetchPlayerProfilePage}>
                            {p.name}
                          </A>
                        </td>
                        <td class='muted-cell'>{p.country ?? '—'}</td>
                        <td class='num'>{p.eventCount.toLocaleString()}</td>
                        <td class='num'>{p.day2s.toLocaleString()}</td>
                        <td class='num' classList={{ 'stat-dim': p.eventCount < DAY2_RATE_MIN_EVENTS }}>
                          {p.eventCount > 0 ? `${Math.round(day2Rate(p) * 100)}%` : '—'}
                        </td>
                        <td class='num'>{p.topCuts.toLocaleString()}</td>
                        <td class='num'>{p.tournamentWins.toLocaleString()}</td>
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
    <div class='table-wrap'>
      <table class='data'>
        <thead>
          <tr>
            <th>Player</th>
            <th>Country</th>
            <th class='num'>Events</th>
            <th class='num'>Day 2s</th>
            <th class='num'>Day 2 rate</th>
            <th class='num'>Top cuts</th>
            <th class='num'>Titles</th>
          </tr>
        </thead>
        <tbody>
          <For each={Array.from({ length: 10 })}>
            {() => (
              <tr>
                <td>
                  <Skeleton width='60%' />
                </td>
                <td>
                  <Skeleton width='40px' />
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
                <td class='num'>
                  <Skeleton width='32px' />
                </td>
                <td class='num'>
                  <Skeleton width='32px' />
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
