import { createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { fetchParticipants, prettyTournamentName } from '../lib/data';
import { useTournament } from '../lib/tournamentContext';
import { ONLINE_META_NAME } from '../lib/constants';
import { Section } from '../components/Section';
import { ChipGroup, SearchInput } from '../components/Chip';
import { Pagination } from '../components/Pagination';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { createPagination } from '../lib/pagination';
import type { TournamentParticipant } from '../types';
import { formatRecord } from '../lib/format';
import { latestValue } from '../lib/resource';
import '../styles/pages/players-tables.css';

type Filter = 'all' | 'topCut' | 'phase2';
type SortKey = 'placement' | 'record' | 'points';
type SortDir = 'asc' | 'desc';
const PAGE_SIZE = 50;

function participantSortValue(p: TournamentParticipant, key: SortKey): number {
  switch (key) {
    case 'record':
      return p.wins ?? 0;
    case 'points':
      return p.points ?? 0;
    case 'placement':
    default:
      return p.placement ?? 9999;
  }
}

export function PlayersIndexPage() {
  const { tournament } = useTournament();
  const [participants] = createResource(tournament, fetchParticipants);
  const [query, setQuery] = createSignal('');
  const [filter, setFilter] = createSignal<Filter>('all');
  const [sortKey, setSortKey] = createSignal<SortKey>('placement');
  const [sortDir, setSortDir] = createSignal<SortDir>('asc');
  const navigate = useNavigate();

  onMount(() => {
    document.title = 'Players — Ciphermaniac';
  });

  const isOnline = () => tournament() === ONLINE_META_NAME;

  // Non-suspending read (see lib/resource.ts). Tournament-scoped, so keep the
  // old table while a tournament switch refetches.
  const participantsData = () => latestValue(participants);

  const filtered = createMemo<TournamentParticipant[]>(() => {
    const list = participantsData() ?? [];
    const q = query().trim().toLowerCase();
    const f = filter();
    return list.filter(p => {
      if (f === 'topCut' && !p.madeTopCut) {
        return false;
      }
      if (f === 'phase2' && !(p.madePhase2 || p.madeTopCut)) {
        return false;
      }
      if (q && !((p.name ?? '').toLowerCase().includes(q) || (p.deckName ?? '').toLowerCase().includes(q))) {
        return false;
      }
      return true;
    });
  });

  const sorted = createMemo(() => {
    const key = sortKey();
    const factor = sortDir() === 'asc' ? 1 : -1;
    return [...filtered()].sort((a, b) => (participantSortValue(a, key) - participantSortValue(b, key)) * factor);
  });

  const { page, totalPages, pageItems: pageRows, setPage } =
    // eslint-disable-next-line solid/reactivity -- createPagination reads `sorted` inside its own createMemo (a tracked scope); the analyzer can't see through the helper
    createPagination(sorted, PAGE_SIZE, [query, filter, tournament, sortKey, sortDir]);

  function setSort(next: SortKey, defaultDir: SortDir) {
    if (sortKey() === next) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(next);
      setSortDir(defaultDir);
    }
  }

  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey() === key ? (sortDir() === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <>
      <section class='hero'>
        <h1>Players</h1>
        <div class='hero-meta'>
          <Show when={!isOnline()} fallback={<span>Pick a tournament from the selector to see participants.</span>}>
            <Show when={participantsData()} fallback={<Skeleton width='240px' height='13px' />}>
              <span>{(participantsData() ?? []).length.toLocaleString()} participants</span>
              <span class='dot'>·</span>
              <span>{prettyTournamentName(tournament())}</span>
            </Show>
          </Show>
        </div>
      </section>

      <Show when={isOnline()}>
        <Section>
          <EmptyState
            title='No participant list for the rolling online window.'
            description="The Online — Last 14 Days aggregate doesn't carry per-player data. Switch to any historical tournament from the selector in the top bar to see its players."
            actions={
              <A href='/tournaments' class='btn btn-primary'>
                Browse tournaments
              </A>
            }
          />
        </Section>
      </Show>

      <Show when={!isOnline()}>
        <Section>
          <div class='filter-bar'>
            <div class='filter-row'>
              <SearchInput value={query()} onInput={setQuery} placeholder='Search by player or deck...' />
            </div>
            <div class='filter-row'>
              <ChipGroup
                options={[
                  { value: 'all', label: 'All players' },
                  { value: 'phase2', label: 'Phase 2' },
                  { value: 'topCut', label: 'Top cut' }
                ]}
                selected={filter()}
                onSelect={v => setFilter(v as Filter)}
              />
            </div>
          </div>
        </Section>

        <Section right={`${filtered().length.toLocaleString()} matching`}>
          <Show
            when={participantsData()}
            fallback={
              <Show when={participants.error || participantsData() === null} fallback={<TableSkeleton />}>
                <EmptyState
                  title='No player data for this tournament.'
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
                  description='Try clearing the filter or search term.'
                  actions={
                    <button
                      class='btn btn-secondary'
                      type='button'
                      onClick={() => {
                        setQuery('');
                        setFilter('all');
                      }}
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
                      <th class='num'>#</th>
                      <th>Player</th>
                      <th>Country</th>
                      <th>Archetype</th>
                      <th aria-sort={ariaSort('record')} class='sortable num'>
                        <button type='button' class='th-sort' onClick={() => setSort('record', 'desc')}>
                          Record
                        </button>
                      </th>
                      <th aria-sort={ariaSort('points')} class='sortable num'>
                        <button type='button' class='th-sort' onClick={() => setSort('points', 'desc')}>
                          Points
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={pageRows()}>
                      {p => (
                        <tr
                          class='is-link'
                          onClick={() => navigate(`/standings/${p.tpId}`)}
                          tabIndex={0}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              navigate(`/standings/${p.tpId}`);
                            }
                          }}
                        >
                          <td class='num muted-cell'>{p.placement ?? '—'}</td>
                          <td>
                            <span class='cardname'>{p.name ?? '—'}</span>
                          </td>
                          <td class='muted-cell'>{p.country ?? '—'}</td>
                          <td class='muted-cell'>{p.deckName ?? '—'}</td>
                          <td class='num'>{formatRecord(p)}</td>
                          <td class='num'>{p.points != null ? p.points.toLocaleString() : '—'}</td>
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
      </Show>
    </>
  );
}

function TableSkeleton() {
  return (
    <div class='table-wrap'>
      <table class='data'>
        <thead>
          <tr>
            <th class='num'>#</th>
            <th>Player</th>
            <th>Country</th>
            <th>Archetype</th>
            <th class='num'>Record</th>
            <th class='num'>Points</th>
          </tr>
        </thead>
        <tbody>
          <For each={Array.from({ length: 10 })}>
            {() => (
              <tr>
                <td class='num'>
                  <Skeleton width='24px' />
                </td>
                <td>
                  <Skeleton width='60%' />
                </td>
                <td>
                  <Skeleton width='40px' />
                </td>
                <td>
                  <Skeleton width='50%' />
                </td>
                <td class='num'>
                  <Skeleton width='60px' />
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
