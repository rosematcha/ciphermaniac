import { A } from '@solidjs/router';
import { type JSX, lazy, Show } from 'solid-js';
import type { LiveEvent } from '../../shared/live/types';
import { fetchLiveIndex } from '../lib/data/live';
import { createPolled } from '../lib/livePoll';
import { latestValue } from '../lib/resource';
import { WhileEventOn } from './LiveBanner';

/**
 * The run drags in the deck reporter and the typeahead behind it. A career page
 * is opened far more often on a day with no event than on one with, so none of
 * that belongs in the profile's own bundle.
 */
const PlayerRun = lazy(() => import('../pages/live/PlayerRun').then(m => ({ default: m.PlayerRun })));

/** A tournament row that leads to the live page, in the list's own markup. */
function LiveRow(props: { event: LiveEvent; detail: JSX.Element; aside?: JSX.Element }) {
  return (
    <A class='tournament-row tournament-row-link' href={`/live/${props.event.slug}`}>
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

/**
 * A player's run at the event that is on, on their career page.
 *
 * This is where the run lives now — the live page used to open it inline above
 * a seven-hundred-row table, which on a phone meant the list jumped out from
 * under the finger that tapped it.
 */
export function LivePlayerRun(props: { playerId: string; name: string; countries: readonly string[] }) {
  return <WhileEventOn>{event => <PlayerRun event={event} {...props} />}</WhileEventOn>;
}
