import { createMemo, createResource, createSignal, For, type JSX, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { fetchPlayerIndex } from '../lib/data';
import { Section } from '../components/Section';
import { SearchInput } from '../components/Chip';
import { Pagination } from '../components/Pagination';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { createPagination } from '../lib/pagination';
import type { PlayerIndexEntry } from '../types';

type SortKey = 'events' | 'day2s' | 'topCuts' | 'wins';

const PAGE_SIZE = 50;

export function PlayersPage() {
  const [index] = createResource(fetchPlayerIndex);
  const [query, setQuery] = createSignal('');
  const [sortKey, setSortKey] = createSignal<SortKey>('events');
  const navigate = useNavigate();

  onMount(() => {
    document.title = 'Players — Ciphermaniac';
  });

  const filtered = createMemo<PlayerIndexEntry[]>(() => {
    const list = index() ?? [];
    const q = query().trim().toLowerCase();
    if (!q) {
      return list;
    }
    return list.filter(p => p.name.toLowerCase().includes(q));
  });

  const sorted = createMemo(() => {
    const list = [...filtered()];
    const key = sortKey();
    const cmp = (a: PlayerIndexEntry, b: PlayerIndexEntry): number => {
      switch (key) {
        case 'day2s':
          return b.day2s - a.day2s;
        case 'topCuts':
          return b.topCuts - a.topCuts;
        case 'wins':
          return b.tournamentWins - a.tournamentWins;
        case 'events':
        default:
          return b.eventCount - a.eventCount;
      }
    };
    return list.sort(cmp);
  });

  const { page, totalPages, pageItems: pageRows, setPage } = createPagination(sorted, PAGE_SIZE, [query, sortKey]);

  function setSort(next: SortKey) {
    setSortKey(next);
  }

  return (
    <>
      <section class='hero'>
        <h1>Players</h1>
        <div class='hero-meta'>
          <Show when={index()} fallback={<Skeleton width='240px' height='13px' />}>
            <span>{(index() ?? []).length.toLocaleString()} players across all tournaments</span>
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
          when={index() && !index.error}
          fallback={
            <Show when={index.error || index() === null} fallback={<TableSkeleton />}>
              <EmptyState
                title="Player index isn't available yet."
                description="`players/index.json` hasn't been written. Run the meta builder to generate it."
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
                    <SortableTh active={sortKey() === 'events'} onSort={() => setSort('events')} num>
                      Events
                    </SortableTh>
                    <SortableTh active={sortKey() === 'day2s'} onSort={() => setSort('day2s')} num>
                      Day 2s
                    </SortableTh>
                    <SortableTh active={sortKey() === 'topCuts'} onSort={() => setSort('topCuts')} num>
                      Top cuts
                    </SortableTh>
                    <SortableTh active={sortKey() === 'wins'} onSort={() => setSort('wins')} num>
                      Wins
                    </SortableTh>
                  </tr>
                </thead>
                <tbody>
                  <For each={pageRows()}>
                    {p => (
                      <tr
                        class='is-link'
                        onClick={() => navigate(`/players/${p.playerId}`)}
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
                        <td class='num'>{p.eventCount}</td>
                        <td class='num'>{p.day2s}</td>
                        <td class='num'>{p.topCuts}</td>
                        <td class='num'>{p.tournamentWins}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <Show when={totalPages() > 1}>
              <Pagination page={page()} totalPages={totalPages()} onChange={setPage} />
            </Show>
          </Show>
        </Show>
      </Section>
    </>
  );
}

function SortableTh(props: { active: boolean; onSort: () => void; num?: boolean; children: JSX.Element }) {
  return (
    <th
      class='sortable'
      classList={{ num: props.num }}
      onClick={props.onSort}
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onSort();
        }
      }}
    >
      {props.children}
      <Show when={props.active}>
        <span class='sort-mark'>↓</span>
      </Show>
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
            <th class='num'>Top cuts</th>
            <th class='num'>Wins</th>
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
