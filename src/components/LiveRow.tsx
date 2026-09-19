import { A } from '@solidjs/router';
import { createMemo, type JSX, Show } from 'solid-js';
import type { LiveEvent } from '../../shared/live/types';
import { findSeat, recordLabel, type SeatView } from '../../shared/live/view';
import { fetchLiveIndex, fetchLiveRound } from '../lib/data/live';
import { createPolled } from '../lib/livePoll';
import { latestValue } from '../lib/resource';
import { WhileEventOn } from './LiveBanner';

/** A tournament row that leads to the live page, in the list's own markup. */
function LiveRow(props: { event: LiveEvent; query?: string; detail: JSX.Element; aside?: JSX.Element }) {
  const href = () => `/live/${props.event.slug}${props.query ? `?q=${encodeURIComponent(props.query)}` : ''}`;
  return (
    <A class='tournament-row tournament-row-link' href={href()}>
      <span class='date'>Live</span>
      <span class='name'>
        {props.event.name} <span class='muted-cell'>· {props.detail}</span>
      </span>
      <span class='players'>{props.aside}</span>
    </A>
  );
}

/** The event that is on, for the top of the tournaments list. */
export function LiveEventRow() {
  return <WhileEventOn>{event => <EventRow event={event} />}</WhileEventOn>;
}

function EventRow(props: { event: LiveEvent }) {
  const index = createPolled(() => props.event.slug, fetchLiveIndex);
  return (
    <Show when={latestValue(index)}>
      {current => (
        <LiveRow
          event={props.event}
          detail={`Round ${current().round}`}
          aside={`${current().playing.toLocaleString()} tables playing`}
        />
      )}
    </Show>
  );
}

function pairingLabel(round: number, view: SeatView): string {
  const versus = view.opponent ? `vs ${view.opponent.name}, table ${view.match.table}` : 'no opponent';
  return `Round ${round} ${versus}`;
}

/** A player's current pairing, on their profile, when they are in the event that is on. */
export function LivePlayerRow(props: { name: string; countries: readonly string[] }) {
  return (
    <WhileEventOn>{event => <PlayerRow event={event} name={props.name} countries={props.countries} />}</WhileEventOn>
  );
}

function PlayerRow(props: { event: LiveEvent; name: string; countries: readonly string[] }) {
  const index = createPolled(() => props.event.slug, fetchLiveIndex);
  const round = createPolled(
    () => latestValue(index)?.round,
    n => fetchLiveRound(props.event.slug, n)
  );
  const seat = createMemo(() => findSeat(latestValue(round)?.matches ?? [], props.name, props.countries));
  return (
    <Show when={seat()}>
      {view => (
        <div class='tournament-list live-player-row'>
          <LiveRow
            event={props.event}
            query={props.name}
            detail={pairingLabel(latestValue(round)!.round, view())}
            aside={recordLabel(view().seat)}
          />
        </div>
      )}
    </Show>
  );
}
