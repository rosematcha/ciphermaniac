import { A, useLocation } from '@solidjs/router';
import { type JSX, Show } from 'solid-js';
import { eventsOn } from '../../shared/live/schedule';
import type { LiveEvent } from '../../shared/live/types';
import { fetchLiveIndex } from '../lib/data/live';
import { createPolled } from '../lib/livePoll';
import { latestValue } from '../lib/resource';

/**
 * Renders its child for the event that is on, and nothing on any other day.
 * Lives here, in the app shell's own module, so the live rows can share it
 * without the shell importing them and their player matching.
 */
export function WhileEventOn(props: { children: (event: LiveEvent) => JSX.Element }) {
  const [event] = eventsOn(new Date());
  return <Show when={event}>{on => props.children(on())}</Show>;
}

/**
 * Site-wide strip while a listed event is on. Whether to show it is a date
 * check, so it is there from first paint and never shifts the page; the round
 * fills in once the index lands. Off on the live page itself.
 */
export function LiveBanner() {
  return <WhileEventOn>{event => <Banner event={event} />}</WhileEventOn>;
}

function Banner(props: { event: LiveEvent }) {
  const location = useLocation();
  const index = createPolled(() => props.event.labsCode, fetchLiveIndex);
  return (
    <Show when={!location.pathname.startsWith('/live/')}>
      <A class='live-banner' href={`/live/${props.event.labsCode}`}>
        <span class='live-banner-mark'>Live</span>
        <span class='live-banner-name'>{props.event.name}</span>
        <Show when={latestValue(index)}>
          {current => (
            <span class='live-banner-meta'>
              Round {current().round} · {current().playing.toLocaleString()} tables playing
            </span>
          )}
        </Show>
      </A>
    </Show>
  );
}
