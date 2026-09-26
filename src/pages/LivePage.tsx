import { A, useNavigate, useParams, useSearchParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, Show } from 'solid-js';
import type { LiveMatch } from '../../shared/live/types';
import { aliasedPlayerId } from '../../shared/live/seatAliases';
import { roundName } from '../../shared/live/rounds';
import {
  createProfileLookup,
  filterByDeck,
  filterByStatus,
  filterMatches,
  filterStandings,
  foldName,
  followedMatches,
  type SeatRef,
  standings,
  type StatusFilter
} from '../../shared/live/view';
import { EmptyState } from '../components/EmptyState';
import { Pagination } from '../components/Pagination';
import { Section } from '../components/Section';
import { Skeleton } from '../components/Skeleton';
import { fetchPlayerIndexSlim } from '../lib/data';
import { fetchLiveRound } from '../lib/data/live';
import { debounced } from '../lib/debounce';
import { useLiveFollows } from '../lib/liveFollows';
import { createLiveIndex, createPolled, liveDelay } from '../lib/livePoll';
import { roundVersion } from '../lib/liveRounds';
import { createPagination, createQueryPageSignal } from '../lib/pagination';
import { latestValue, resolved } from '../lib/resource';
import { useDeckReports } from './live/deckReports';
import { LiveControls, type LiveFilters, type LiveView } from './live/LiveControls';
import { seatHref } from './live/links';
import { PairingsTable, type SeatPresenter } from './live/PairingsTable';
import { StandingsTable } from './live/StandingsTable';
import type { ReportedDeck } from './live/LiveDeck';
import '../styles/pages/players-tables.css';
import '../styles/pages/players.css';
import '../styles/pages/live.css';

const PAGE_SIZE = 50;

interface LiveParams extends Record<string, string | undefined> {
  q?: string;
  round?: string;
  page?: string;
  view?: string;
  status?: string;
  deck?: string;
  following?: string;
  /** The old inline-run link shape; redirected to the seat's own page. */
  player?: string;
  cc?: string;
}

/**
 * /live/:slug — a listed event's pairings as RK9 posts them, a round at a time,
 * or the same round ranked. The index names the current round and is polled;
 * the round itself is refetched on the same beat, under the index hash.
 *
 * A player's run is not here: it lives on their career page, or on their own
 * page under this event when the site knows no career for them.
 */
export function LivePage() {
  const params = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams<LiveParams>();

  const index = createLiveIndex(() => params.slug);
  const indexData = () => latestValue(index);
  const current = () => indexData()?.round ?? 0;
  // A pinned round stays pinned even once the event catches up with it, so a
  // shared link keeps showing the round it was shared about.
  const pinned = () => {
    const asked = Number(searchParams.round);
    return Number.isInteger(asked) && asked >= 1 && asked <= current() ? asked : null;
  };
  const round = () => pinned() ?? current();
  const roundFile = createPolled(
    () => (round() ? ([params.slug, round(), roundVersion(indexData(), round())] as const) : null),
    ([code, n, version]) => fetchLiveRound(code, n, version),
    () => liveDelay(indexData())
  );
  const matches = () => latestValue(roundFile)?.matches;

  // Only the career link needs the index, and only once a seat resolves to one;
  // it is a megabyte, so it waits for the round rather than the page.
  const [players] = createResource(
    () => (matches() ? 'players' : null),
    () => fetchPlayerIndexSlim()
  );
  const profileOf = createMemo(() => createProfileLookup(resolved(players) ?? [], aliasedPlayerId));

  const reports = useDeckReports(() => params.slug, indexData);
  const present = (): SeatPresenter => ({
    slug: params.slug,
    profileOf: seat => profileOf()(seat),
    deckOf: reports.deckOf
  });

  const { follows } = useLiveFollows();
  const view = (): LiveView => (searchParams.view === 'standings' ? 'standings' : 'pairings');
  const status = (): StatusFilter =>
    searchParams.status === 'playing' || searchParams.status === 'decided' ? searchParams.status : 'all';
  const query = () => searchParams.q ?? '';
  const debouncedQuery = debounced(query, 150);

  /** Every filter write resets the page, or a narrowed list lands on page nine of two. */
  const set = (next: Partial<LiveParams>) => setSearchParams({ ...next, page: undefined }, { replace: true });
  const on = {
    setQuery: (q: string) => set({ q: q || undefined }),
    // Landing on the round the event is on is not pinning it: writing the param
    // there would stop the page following the event when the next round posts.
    setRound: (n: number | null) => set({ round: n === null || n === current() ? undefined : String(n) }),
    setView: (next: LiveView) => set({ view: next === 'pairings' ? undefined : next }),
    setStatus: (next: StatusFilter) => set({ status: next === 'all' ? undefined : next }),
    setDeck: (deck: string | null) => set({ deck: deck ?? undefined }),
    setFollowing: (mode: boolean) => set({ following: mode ? '1' : undefined }),
    clear: () => set({ round: undefined, status: undefined, deck: undefined, following: undefined })
  };
  const filters = (): LiveFilters => ({
    query: query(),
    round: round(),
    current: current(),
    cut: indexData()?.cut,
    pinned: pinned() !== null,
    view: view(),
    status: status(),
    deck: searchParams.deck ?? '',
    following: searchParams.following === '1'
  });

  /**
   * A seat the alias table corrects answers to its career name as well as the
   * one RK9 prints — otherwise typing the name on screen finds nothing. Worked
   * out per round rather than per keystroke, and empty for almost every table.
   */
  const aliasNames = createMemo(() => {
    const found = new Map<LiveMatch, string[]>();
    for (const match of matches() ?? []) {
      const names = match.seats
        .filter(seat => aliasedPlayerId(seat))
        .map(seat => profileOf()(seat)?.name)
        .filter((name): name is string => Boolean(name))
        .map(foldName);
      if (names.length > 0) {
        found.set(match, names);
      }
    }
    return found;
  });
  const extraNames = (match: LiveMatch) => aliasNames().get(match);

  /** Everything but the search, which the two views apply differently. */
  const narrowed = createMemo<readonly LiveMatch[]>(() => {
    const deck = searchParams.deck ?? '';
    let kept = filterByStatus(matches() ?? [], status());
    if (deck) {
      kept = filterByDeck(kept, deck, seat => reports.deckOf(seat)?.label);
    }
    return searchParams.following === '1' ? followedMatches(kept, follows()) : kept;
  });
  const tables = createMemo<readonly LiveMatch[]>(() => filterMatches(narrowed(), debouncedQuery(), extraNames));
  /**
   * Places come from the whole round, then the filters take rows away. Ranking
   * the filtered field instead would make a search for one player put them
   * first, which is the one thing the `#` column must never say.
   */
  const ranked = createMemo(() => {
    const kept = new Set(narrowed());
    const field = standings(matches() ?? []).filter(row => kept.has(row.match));
    return filterStandings(field, debouncedQuery(), extraNames);
  });
  const rows = createMemo<readonly unknown[]>(() => (view() === 'standings' ? ranked() : tables()));

  /** The archetypes actually reported in this round, most reported first. */
  const reportedDecks = createMemo<ReportedDeck[]>(() => {
    const counts = new Map<string, number>();
    for (const match of matches() ?? []) {
      for (const seat of match.seats) {
        const label = reports.deckOf(seat)?.label;
        if (label) {
          counts.set(label, (counts.get(label) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label]) => ({ label }));
  });

  const pageParam = createQueryPageSignal(
    () => searchParams.page,
    page => setSearchParams({ page }, { replace: true })
  );
  const { page, totalPages, pageItems, setPage } = createPagination(rows, PAGE_SIZE, undefined, pageParam);

  /**
   * Whether a legacy `?player=` link can be sent on yet.
   *
   * Not until the career index has settled, either way: redirecting before it
   * lands sends a player who has a career to the seat page instead, and the
   * `replace` leaves them no way back to the link they followed. But it must
   * still fire when there is nothing to wait for — an event whose round files
   * R2 has pruned resolves to null, and the link would otherwise sit on a page
   * that no longer has anywhere to send it.
   */
  const canRedirect = () =>
    players.state === 'ready' ||
    players.state === 'errored' ||
    indexData() === null ||
    (roundFile.state !== 'pending' && roundFile.state !== 'unresolved' && matches() === undefined);

  // Links to the old inline-run shape are already in the wild; send them on.
  createEffect(() => {
    const name = searchParams.player;
    if (name && canRedirect()) {
      const seat: SeatRef = { name, country: searchParams.cc ?? '' };
      navigate(seatHref(params.slug, seat, profileOf()(seat)), { replace: true });
    }
  });

  createEffect(() => {
    document.title = `${indexData()?.name ?? 'Live'} — Ciphermaniac`;
  });

  const noun = () => (view() === 'standings' ? 'player' : 'table');

  return (
    <>
      <section class='hero'>
        <h1>{indexData()?.name ?? 'Live rounds'}</h1>
        <div class='hero-meta'>
          <Show when={indexData()} fallback={<Skeleton width='260px' height='13px' />}>
            {live => (
              <>
                {/* Always the round the event is on, said so. The table may be
                    showing a pinned round, and the two used to contradict each
                    other with nothing saying which was which. */}
                <Show
                  when={!live().finished}
                  fallback={
                    <>
                      <span>Finished</span>
                      <span class='dot'>·</span>
                    </>
                  }
                >
                  <span>Live: {roundName(live().round, live().cut)}</span>
                  <span class='dot'>·</span>
                  <span>
                    {live().playing.toLocaleString()} of {live().matches.toLocaleString()} tables playing
                  </span>
                  <span class='dot'>·</span>
                </Show>
                <span>updated {new Date(live().updatedAt).toLocaleTimeString([], { timeStyle: 'short' })}</span>
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
              <A href='/events/majors' class='btn btn-secondary'>
                Tournaments
              </A>
            }
          />
        }
      >
        <Show when={current() > 0} fallback={<div class='live-bar' />}>
          <LiveControls filters={filters()} on={on} decks={reportedDecks()} count={rows().length} />
        </Show>

        <Section
          right={
            matches() ? `${rows().length.toLocaleString()} ${rows().length === 1 ? noun() : `${noun()}s`}` : undefined
          }
        >
          <Show when={matches()} fallback={<Skeleton height='420px' />}>
            <Show
              when={pageItems().length > 0}
              fallback={<NothingLeft onClear={on.clear} noFollows={filters().following && follows().size === 0} />}
            >
              <Show
                when={view() === 'standings'}
                fallback={<PairingsTable matches={pageItems() as LiveMatch[]} present={present()} />}
              >
                <StandingsTable rows={pageItems() as ReturnType<typeof standings>} present={present()} />
              </Show>
              <Pagination page={page()} totalPages={totalPages()} onChange={setPage} />
            </Show>
          </Show>
        </Section>
      </Show>
    </>
  );
}

/**
 * Says what emptied the list, since five of the six controls are not spelling.
 * Following-only with nothing followed gets its own line, because it is the one
 * empty state a visitor reaches without having typed or picked anything.
 */
function NothingLeft(props: { onClear: () => void; noFollows: boolean }) {
  return (
    <EmptyState
      title={props.noFollows ? 'You are not following anyone yet.' : 'Nothing matches.'}
      description={
        props.noFollows
          ? 'Follow a player from their row and they will show up here.'
          : 'No table here fits the search and filters in play.'
      }
      actions={
        <button type='button' class='btn btn-secondary' onClick={() => props.onClear()}>
          Clear filters
        </button>
      }
    />
  );
}
