import { A, useParams, useSearchParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { reportableArchetypes } from '../../shared/live/reports';
import type { LiveMatch, LiveSeat } from '../../shared/live/types';
import {
  createProfileLookup,
  filterMatches,
  followedMatches,
  matchStatus,
  type MatchStatus,
  recordLabel,
  seatKey
} from '../../shared/live/view';
import { Chip, ChipGroup, SearchInput } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { Pagination } from '../components/Pagination';
import { Section } from '../components/Section';
import { Skeleton } from '../components/Skeleton';
import { fetchArchetypeLabels, fetchOnlineArchetypes, fetchPlayerIndexSlim } from '../lib/data';
import { fetchLiveIndex, fetchLiveReports, fetchLiveRound, submitDeckReport } from '../lib/data/live';
import { debounced } from '../lib/debounce';
import { liveVoterId, useLiveFollows } from '../lib/liveFollows';
import { createPolled } from '../lib/livePoll';
import { createPagination, createQueryPageSignal } from '../lib/pagination';
import { latestValue, resolved } from '../lib/resource';
import { LiveDeck, type ReportedDeck } from './live/LiveDeck';
import { LiveRun, type RunPlayer } from './live/LiveRun';
import '../styles/pages/players-tables.css';
import '../styles/pages/players.css';

const PAGE_SIZE = 50;

const STATUS_LABEL: Record<MatchStatus, string> = { final: 'Final', submitted: 'Submitted', playing: 'Playing' };
const RESULT_LETTER = { win: 'W', loss: 'L', tie: 'T' } as const;

/**
 * /live/:slug — a listed event's pairings as RK9 posts them, a round at a time.
 * The index names the current round and is polled; the round itself is
 * refetched on the same beat, and older rounds are a chip away.
 */
export function LivePage() {
  const params = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams<{
    q?: string;
    round?: string;
    page?: string;
    player?: string;
    cc?: string;
    following?: string;
  }>();

  const index = createPolled(() => params.slug, fetchLiveIndex);
  const indexData = () => latestValue(index);
  const round = () => Number(searchParams.round) || indexData()?.round;
  const roundFile = createPolled(
    () => (round() ? ([params.slug, round()!] as const) : null),
    ([code, n]) => fetchLiveRound(code, n)
  );
  const matches = () => latestValue(roundFile)?.matches;

  // An open run links to the player's career where the name is unambiguous;
  // nothing waits on the index.
  const [players] = createResource(fetchPlayerIndexSlim);
  const profileOf = createMemo(() => createProfileLookup(resolved(players) ?? []));

  const query = () => searchParams.q ?? '';
  const setQuery = (q: string) => setSearchParams({ q: q || undefined, page: undefined }, { replace: true });
  const debouncedQuery = debounced(query, 150);
  // Reported decks: the published picks, plus whatever this visitor's own
  // report came back as, so a report shows at once rather than a poll later.
  const reports = createPolled(() => params.slug, fetchLiveReports);
  const [archetypes] = createResource(fetchOnlineArchetypes);
  const [reported, setReported] = createSignal<Record<string, string | null>>({});
  const [iconLabels] = createResource(fetchArchetypeLabels);
  // Most played first; the index's own icons beat the icon map's for a label both carry.
  const indexed = createMemo(() =>
    [...(resolved(archetypes) ?? [])].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))
  );
  const labels = createMemo(() =>
    reportableArchetypes(
      indexed().map(entry => entry.label),
      resolved(iconLabels) ?? []
    )
  );
  const iconsByLabel = createMemo(() => new Map(indexed().map(entry => [entry.label, entry.icons])));
  const deckOf = (seat: RunPlayer): ReportedDeck | undefined => {
    const key = seatKey(seat);
    const label = key in reported() ? reported()[key] : latestValue(reports)?.decks[key];
    return label ? { label, icons: iconsByLabel().get(label) } : undefined;
  };
  const reportDeck = async (seat: RunPlayer, archetype: string) => {
    const shown = await submitDeckReport({ slug: params.slug, seat: seatKey(seat), archetype, voter: liveVoterId() });
    setReported(current => ({ ...current, [seatKey(seat)]: shown }));
  };

  const { follows } = useLiveFollows();
  const followingOnly = () => searchParams.following === '1';
  const filtered = createMemo(() => {
    const named = filterMatches(matches() ?? [], debouncedQuery());
    return followingOnly() ? followedMatches(named, follows()) : named;
  });

  // The open run lives in the URL, so a run can be linked to and Back closes it.
  const runPlayer = (): RunPlayer | null =>
    searchParams.player ? { name: searchParams.player, country: searchParams.cc ?? '' } : null;
  const runHref = (seat: RunPlayer | null) => {
    const next = new URLSearchParams(location.search);
    next.delete('player');
    next.delete('cc');
    if (seat) {
      next.set('player', seat.name);
      next.set('cc', seat.country);
    }
    const query = next.toString();
    return `/live/${params.slug}${query ? `?${query}` : ''}`;
  };

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
    document.title = `${indexData()?.name ?? 'Live'} — Ciphermaniac`;
  });

  return (
    <>
      <section class='hero'>
        <h1>{indexData()?.name ?? 'Live rounds'}</h1>
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
        <Show when={runPlayer() && indexData()}>
          <LiveRun
            slug={params.slug}
            player={runPlayer()!}
            rounds={indexData()!.round}
            version={indexData()!.hash}
            playerId={profileOf()({ ...runPlayer()!, wins: 0, losses: 0, ties: 0, points: 0 })}
            hrefFor={runHref}
            closeHref={runHref(null)}
            labels={labels()}
            leading={indexed().length}
            deckOf={deckOf}
            onReport={archetype => reportDeck(runPlayer()!, archetype)}
          />
        </Show>

        <div class='players-bar'>
          <SearchInput value={query()} onInput={setQuery} placeholder='Search by player name...' />
          <Chip
            pressed={followingOnly()}
            onClick={() =>
              setSearchParams({ following: followingOnly() ? undefined : '1', page: undefined }, { replace: true })
            }
          >
            Following
          </Chip>
          <ChipGroup options={roundOptions()} selected={String(round() ?? '')} onSelect={selectRound} />
        </div>

        <Section
          right={
            matches()
              ? `${filtered().length.toLocaleString()} ${filtered().length === 1 ? 'table' : 'tables'}`
              : undefined
          }
        >
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
                    <For each={pageItems()}>
                      {match => <MatchRow match={match} hrefFor={runHref} deckOf={deckOf} />}
                    </For>
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

function MatchRow(props: {
  match: LiveMatch;
  hrefFor: (seat: RunPlayer) => string;
  deckOf: (seat: RunPlayer) => ReportedDeck | undefined;
}) {
  return (
    <tr>
      <td class='num muted-cell players-rank'>{props.match.table || '—'}</td>
      <For each={[0, 1]}>
        {i => (
          <td class='players-name'>
            <Show when={props.match.seats[i]} fallback={<span class='muted-cell'>Bye</span>}>
              {seat => <SeatCell seat={seat()} href={props.hrefFor(seat())} deck={props.deckOf(seat())} />}
            </Show>
          </td>
        )}
      </For>
      <td class='num muted-cell'>{STATUS_LABEL[matchStatus(props.match)]}</td>
    </tr>
  );
}

function SeatCell(props: { seat: LiveSeat; href: string; deck?: ReportedDeck }) {
  return (
    <span class='players-ident'>
      <Show when={props.seat.result}>
        {result => <b class={`round-outcome ${result()}`}>{RESULT_LETTER[result()]}</b>}
      </Show>
      <A href={props.href} class='cardname'>
        {props.seat.name}
      </A>
      <span class='players-country'>{props.seat.country}</span>
      <Show when={props.deck}>{deck => <LiveDeck deck={deck()} iconsOnly />}</Show>
      <span class='muted-cell'>
        {recordLabel(props.seat)}
        {props.seat.dropped ? ' · dropped' : ''}
      </span>
    </span>
  );
}
