import { createMemo, createResource, createSignal, For, type JSX, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { fetchPlayerIndexSlim } from '../lib/data';
import { resolved } from '../lib/resource';
import { Section } from '../components/Section';
import { SearchInput } from '../components/Chip';
import { Pagination } from '../components/Pagination';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { createPagination } from '../lib/pagination';
import { prefetchPlayerProfilePage } from '../lib/prefetch';
import type { PlayerIndexSlimEntry } from '../types';
import '../styles/pages/players-tables.css';

type SortKey = 'events' | 'day2s' | 'topCuts' | 'titles' | 'day2Rate';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 50;
const DAY2_RATE_MIN_EVENTS = 5;

function day2Rate(p: PlayerIndexSlimEntry): number {
  return p.eventCount > 0 ? p.day2s / p.eventCount : 0;
}

function sortValue(p: PlayerIndexSlimEntry, key: SortKey): number {
  switch (key) {
    case 'day2s':
      return p.day2s;
    case 'topCuts':
      return p.topCuts;
    case 'titles':
      return p.tournamentWins;
    case 'day2Rate':
      return day2Rate(p);
    case 'events':
    default:
      return p.eventCount;
  }
}

export function PlayersPage() {
  const [index] = createResource(fetchPlayerIndexSlim);
  const [query, setQuery] = createSignal('');
  const [sortKey, setSortKey] = createSignal<SortKey>('day2s');
  const [sortDir, setSortDir] = createSignal<SortDir>('desc');
  const navigate = useNavigate();

  onMount(() => {
    document.title = 'Players — Ciphermaniac';
  });

  // Non-suspending read: keeps navigation instant and lets the skeleton /
  // error fallbacks below actually render (see lib/resource.ts).
  const indexData = () => resolved(index);

  const filtered = createMemo<PlayerIndexSlimEntry[]>(() => {
    const list = indexData() ?? [];
    const q = query().trim().toLowerCase();
    if (!q) {
      return list;
    }
    return list.filter(p => p.name.toLowerCase().includes(q));
  });

  const sorted = createMemo(() => {
    const list = [...filtered()];
    const key = sortKey();
    const factor = sortDir() === 'asc' ? 1 : -1;
    return list.sort((a, b) => (sortValue(a, key) - sortValue(b, key)) * factor);
  });

  const { page, totalPages, pageItems: pageRows, setPage } =
    // eslint-disable-next-line solid/reactivity -- createPagination reads `sorted` inside its own createMemo (a tracked scope); the analyzer can't see through the helper
    createPagination(sorted, PAGE_SIZE, [query, sortKey, sortDir]);

  function setSort(next: SortKey) {
    if (sortKey() === next) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(next);
      setSortDir('desc');
    }
  }

  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey() === key ? (sortDir() === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <>
      <section class='hero hero-collapsible'>
        <h1>Players</h1>
        <div class='hero-meta'>
          <Show when={indexData()} fallback={<Skeleton width='240px' height='13px' />}>
            <span>{(indexData() ?? []).length.toLocaleString()} players across all tournaments</span>
          </Show>
        </div>
      </section>

      <Section>
        <div class='filter-bar'>
          <div class='filter-row'>
            <SearchInput value={query()} onInput={setQuery} placeholder='Search by player name...' />
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
                description='Try clearing the search term.'
                actions={
                  <button class='btn btn-secondary' type='button' onClick={() => setQuery('')}>
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
                        onClick={() => navigate(`/players/${p.playerId}`)}
                        onMouseEnter={prefetchPlayerProfilePage}
                        onFocus={prefetchPlayerProfilePage}
                        tabIndex={0}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            navigate(`/players/${p.playerId}`);
                          }
                        }}
                      >
                        <td>
                          <span class='cardname'>{p.name}</span>
                        </td>
                        <td class='muted-cell'>{p.country ?? '—'}</td>
                        <td class='num'>{p.eventCount.toLocaleString()}</td>
                        <td class='num'>{p.day2s.toLocaleString()}</td>
                        <td class='num' classList={{ 'stat-dim': p.eventCount < DAY2_RATE_MIN_EVENTS }}>
                          {p.eventCount > 0 ? `${(day2Rate(p) * 100).toFixed(1)}%` : '—'}
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
