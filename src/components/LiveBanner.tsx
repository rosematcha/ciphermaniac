import { A, useLocation } from '@solidjs/router';
import { createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { eventsOn } from '../../shared/live/schedule';
import type { LiveEvent, LiveIndex } from '../../shared/live/types';
import { roundName } from '../../shared/live/rounds';
import { createLiveIndex } from '../lib/livePoll';
import { useLiveSchedule } from '../lib/liveSchedule';
import { latestValue } from '../lib/resource';

/**
 * Renders its child for each event that is on, and nothing on any other day.
 * Lives here, in the app shell's own module, so the live rows can share it
 * without the shell importing them and their player matching.
 */
export function WhileEventsOn(props: { children: (event: LiveEvent) => JSX.Element }) {
  const schedule = useLiveSchedule();
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 60_000);
  onCleanup(() => clearInterval(timer));
  const events = createMemo(() => eventsOn(schedule()?.events ?? [], new Date(now())));
  return <For each={events()}>{event => props.children(event)}</For>;
}

/**
 * Site-wide strip while a scheduled event is on. Whether to show it is a date
 * check against the stored schedule, so on a return visit it is there from
 * first paint; the round fills in once the index lands. Off on the live page.
 */
export function LiveBanner() {
  return <WhileEventsOn>{event => <Banner event={event} />}</WhileEventsOn>;
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
          {current => <span class='live-banner-meta'>{liveStatus(current())}</span>}
        </Show>
      </A>
    </Show>
  );
}

/** Where the event is, in a line: `Top 8 · 4 tables playing`, or that it is over. */
export function liveStatus(index: LiveIndex): string {
  return index.finished
    ? 'Finished'
    : `${roundName(index.round, index.cut)} · ${index.playing.toLocaleString()} tables playing`;
}
