import { A, useParams, useSearchParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, For, Show } from 'solid-js';
import { LIVE_EVENTS } from '../../shared/live/schedule';
import type { LiveMatch, LiveSeat } from '../../shared/live/types';
import { createProfileLookup, filterMatches, matchStatus, type MatchStatus, recordLabel } from '../../shared/live/view';
import { ChipGroup, SearchInput } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { Pagination } from '../components/Pagination';
import { Section } from '../components/Section';
import { Skeleton } from '../components/Skeleton';
import { fetchPlayerIndexSlim } from '../lib/data';
import { fetchLiveIndex, fetchLiveRound } from '../lib/data/live';
import { debounced } from '../lib/debounce';
import { createPolled } from '../lib/livePoll';
import { createPagination, createQueryPageSignal } from '../lib/pagination';
import { latestValue, resolved } from '../lib/resource';
import '../styles/pages/players-tables.css';
import '../styles/pages/players.css';

const PAGE_SIZE = 50;

const STATUS_LABEL: Record<MatchStatus, string> = { final: 'Final', submitted: 'Submitted', playing: 'Playing' };
const RESULT_LETTER = { win: 'W', loss: 'L', tie: 'T' } as const;

/**
 * /live/:code — a listed event's pairings as RK9 posts them, a round at a time.
 * The index names the current round and is polled; the round itself is
 * refetched on the same beat, and older rounds are a chip away.
 */
export function LivePage() {
  const params = useParams<{ code: string }>();
  const [searchParams, setSearchParams] = useSearchParams<{ q?: string; round?: string; page?: string }>();
  const event = () => LIVE_EVENTS.find(candidate => candidate.labsCode === params.code);

  const index = createPolled(() => params.code, fetchLiveIndex);
  const indexData = () => latestValue(index);
  const round = () => Number(searchParams.round) || indexData()?.round;
  const roundFile = createPolled(
    () => (round() ? ([params.code, round()!] as const) : null),
    ([code, n]) => fetchLiveRound(code, n)
  );
  const matches = () => latestValue(roundFile)?.matches;

  // Names link to careers where the match is unambiguous; the table stands
  // without the index, so it is never waited on.
  const [players] = createResource(fetchPlayerIndexSlim);
  const profileOf = createMemo(() => createProfileLookup(resolved(players) ?? []));

  const query = () => searchParams.q ?? '';
  const setQuery = (q: string) => setSearchParams({ q: q || undefined, page: undefined }, { replace: true });
  const debouncedQuery = debounced(query, 150);
  const filtered = createMemo(() => filterMatches(matches() ?? [], debouncedQuery()));

  const pageParam = createQueryPageSignal(
    () => searchParams.page,
    page => setSearchParams({ page }, { replace: true })
  );
  const { page, totalPages, pageItems, setPage } =
    // eslint-disable-next-line solid/reactivity -- createPagination reads `filtered` inside its own createMemo
    createPagination(filtered, PAGE_SIZE, undefined, pageParam);

  const roundOptions = () =>
    Array.from({ length: indexData()?.round ?? 0 }, (_, i) => ({ value: String(i + 1), label: `R${i + 1}` }));
  const selectRound = (value: string) =>
    setSearchParams(
      { round: Number(value) === indexData()?.round ? undefined : value, page: undefined },
      { replace: true }
    );

  createEffect(() => {
    document.title = `${event()?.name ?? 'Live'} — Ciphermaniac`;
  });

  return (
    <>
      <section class='hero'>
        <h1>{event()?.name ?? 'Live rounds'}</h1>
        <div class='hero-meta'>
          <Show when={indexData()} fallback={<Skeleton width='260px' height='13px' />}>
            {current => (
              <>
                <span>Round {current().round}</span>
                <span class='dot'>·</span>
                <span>
                  {current().playing.toLocaleString()} of {current().matches.toLocaleString()} tables playing
                </span>
                <span class='dot'>·</span>
                <span>updated {new Date(current().updatedAt).toLocaleTimeString([], { timeStyle: 'short' })}</span>
              </>
            )}
          </Show>
        </div>
      </section>

      <Show
        when={indexData() !== null}
        fallback={
          <EmptyState
            title='No rounds posted yet.'
            description='Pairings appear here once the first round is posted.'
            actions={
              <A href='/tournaments' class='btn btn-secondary'>
                Tournaments
              </A>
            }
          />
        }
      >
        <div class='players-bar'>
          <SearchInput value={query()} onInput={setQuery} placeholder='Search by player name...' />
          <ChipGroup options={roundOptions()} selected={String(round() ?? '')} onSelect={selectRound} />
        </div>

        <Section right={matches() ? `${filtered().length.toLocaleString()} tables` : undefined}>
          <Show when={matches()} fallback={<Skeleton height='420px' />}>
            <Show
              when={pageItems().length > 0}
              fallback={<EmptyState title='No players match.' description='Try a different spelling.' />}
            >
              <div class='table-wrap players-table'>
                <table class='data'>
                  <thead>
                    <tr>
                      <th class='num players-rank'>Table</th>
                      <th>Player</th>
                      <th>Opponent</th>
                      <th class='num'>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={pageItems()}>{match => <MatchRow match={match} profileOf={profileOf()} />}</For>
                  </tbody>
                </table>
              </div>
              <Pagination page={page()} totalPages={totalPages()} onChange={setPage} />
            </Show>
          </Show>
        </Section>
      </Show>
    </>
  );
}

function MatchRow(props: { match: LiveMatch; profileOf: (seat: LiveSeat) => string | null }) {
  return (
    <tr>
      <td class='num muted-cell players-rank'>{props.match.table || '—'}</td>
      <For each={[0, 1]}>
        {i => (
          <td class='players-name'>
            <Show when={props.match.seats[i]} fallback={<span class='muted-cell'>Bye</span>}>
              {seat => <SeatCell seat={seat()} playerId={props.profileOf(seat())} />}
            </Show>
          </td>
        )}
      </For>
      <td class='num muted-cell'>{STATUS_LABEL[matchStatus(props.match)]}</td>
    </tr>
  );
}

function SeatCell(props: { seat: LiveSeat; playerId: string | null }) {
  return (
    <span class='players-ident'>
      <Show when={props.seat.result}>
        {result => <b class={`round-outcome ${result()}`}>{RESULT_LETTER[result()]}</b>}
      </Show>
      <Show when={props.playerId} fallback={<span class='cardname'>{props.seat.name}</span>}>
        <A href={`/players/${encodeURIComponent(props.playerId!)}`} class='cardname'>
          {props.seat.name}
        </A>
      </Show>
      <span class='players-country'>{props.seat.country}</span>
      <span class='muted-cell'>
        {recordLabel(props.seat)}
        {props.seat.dropped ? ' · dropped' : ''}
      </span>
    </span>
  );
}
