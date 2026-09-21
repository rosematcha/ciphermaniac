import { A, useLocation } from '@solidjs/router';
import { createMemo, type JSX, Show } from 'solid-js';
import { eventsOn } from '../../shared/live/schedule';
import type { LiveEvent } from '../../shared/live/types';
import { createLiveIndex } from '../lib/livePoll';
import { useLiveSchedule } from '../lib/liveSchedule';
import { latestValue } from '../lib/resource';

/**
 * Renders its child for the event that is on, and nothing on any other day.
 * Lives here, in the app shell's own module, so the live rows can share it
 * without the shell importing them and their player matching.
 */
export function WhileEventOn(props: { children: (event: LiveEvent) => JSX.Element }) {
  const schedule = useLiveSchedule();
  const event = createMemo(() => eventsOn(schedule()?.events ?? [], new Date())[0]);
  return <Show when={event()}>{on => props.children(on())}</Show>;
}

/**
 * Site-wide strip while a scheduled event is on. Whether to show it is a date
 * check against the stored schedule, so on a return visit it is there from
 * first paint; the round fills in once the index lands. Off on the live page.
 */
export function LiveBanner() {
  return <WhileEventOn>{event => <Banner event={event} />}</WhileEventOn>;
}

function Banner(props: { event: LiveEvent }) {
  const location = useLocation();
  const index = createLiveIndex(() => props.event.slug);
  return (
    <Show when={!location.pathname.startsWith('/live/')}>
      <A class='live-banner' href={`/live/${props.event.slug}`}>
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
