import { A } from '@solidjs/router';
import { createMemo, createResource, For, Show } from 'solid-js';
import { aliasedPlayerId, seatNamesFor } from '../../../shared/live/seatAliases';
import type { LiveEvent } from '../../../shared/live/types';
import {
  createProfileLookup,
  findSeats,
  lastSeatInEvent,
  recordLabel,
  type SeatProfile,
  type SeatRef,
  seatSlug,
  type SeatView
} from '../../../shared/live/view';
import { Section } from '../../components/Section';
import { fetchPlayerIndexSlim } from '../../lib/data';
import { fetchLiveIndex, fetchLiveRound } from '../../lib/data/live';
import { createPolled } from '../../lib/livePoll';
import { latestValue, resolved } from '../../lib/resource';
import { useDeckReports } from './deckReports';
import { LiveRun } from './LiveRun';
import '../../styles/pages/players.css';
import '../../styles/pages/live.css';

export interface PlayerRunProps {
  playerId: string;
  name: string;
  countries: readonly string[];
  event: LiveEvent;
}

/**
 * A player's run at the event that is on, for their career page.
 *
 * Its own lazily-loaded module: the run pulls in the deck reporter and the
 * typeahead behind it, and a career page is opened far more often on a day
 * with no event than on one with.
 */
export function PlayerRun(props: PlayerRunProps) {
  const index = createPolled(() => props.event.slug, fetchLiveIndex);
  const current = () => latestValue(index)?.round;
  const round = createPolled(current, n => fetchLiveRound(props.event.slug, n));
  // Every name this player registers under, so a seat RK9 prints differently
  // still finds them (`shared/live/seatAliases.ts`).
  const names = createMemo(() => seatNamesFor(props.playerId, props.name));
  const playing = createMemo(() => findSeats(latestValue(round)?.matches ?? [], names(), [...props.countries]));
  // A run that has ended is worth as much as one still going, so dropping out
  // of the draw must not take it off the page. Only for a player the current
  // round does not have, and keyed by the round number alone: a poll that
  // changes nothing must not re-run the search.
  const [ended] = createResource(
    () => (latestValue(round) && playing().length === 0 ? (current() ?? null) : null),
    // eslint-disable-next-line solid/reactivity -- a fetcher reads props on each run, which is when they matter
    at => lastSeatInEvent(at, n => fetchLiveRound(props.event.slug, n), names(), [...props.countries])
  );
  const seats = createMemo((): readonly SeatView[] => {
    const tail = playing().length > 0 ? null : latestValue(ended);
    return tail ? [tail.view] : playing();
  });
  const reports = useDeckReports(() => props.event.slug);
  // The opponents' careers, so their rows lead to a profile rather than a seat
  // page. A megabyte, so it waits until this player is actually in the event.
  const [players] = createResource(
    () => (seats().length === 1 ? 'players' : null),
    () => fetchPlayerIndexSlim()
  );
  const profileOf = createMemo(() => createProfileLookup(resolved(players) ?? [], aliasedPlayerId));

  return (
    <Show when={seats().length > 0 && latestValue(index)}>
      {live => (
        <Section title={`Live · ${props.event.name}`} right={<A href={`/live/${props.event.slug}`}>All tables</A>}>
          <Show when={seats().length === 1} fallback={<Namesakes slug={props.event.slug} seats={seats()} />}>
            <LiveRun
              slug={props.event.slug}
              names={names()}
              countries={[...props.countries]}
              rounds={live().round}
              version={live().hash}
              reports={reports}
              profileOf={(seat: SeatRef): SeatProfile | null => profileOf()(seat)}
            />
          </Show>
        </Section>
      )}
    </Show>
  );
}

/**
 * Two players in the event share this name, so no run can be shown without
 * guessing. Naming their tables lets the reader pick the right one instead of
 * the page silently showing nothing.
 */
function Namesakes(props: { slug: string; seats: readonly SeatView[] }) {
  return (
    <div class='live-namesakes'>
      <p class='muted-cell'>More than one player in this event is registered under this name.</p>
      <ul class='live-namesake-list'>
        <For each={props.seats}>
          {view => (
            <li>
              <A href={`/live/${props.slug}/player/${seatSlug(view.seat)}`}>
                Table {view.match.table || '—'}
                <span class='muted-cell'>
                  {' '}
                  · {recordLabel(view.seat)}
                  {view.seat.country ? ` · ${view.seat.country}` : ''}
                </span>
              </A>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
