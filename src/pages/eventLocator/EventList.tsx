import { For, Show } from 'solid-js';
import type { EventKind } from '../../../shared/events/types';
import { type EventDay, type PlacedEvent, venueKey } from '../../lib/events/filter';
import { type DistanceUnit, formatDistance } from '../../lib/events/geo';
import { dayHeading, formatClock, formatFee, isWeekend, relativeDay, titleCase } from '../../lib/events/format';
import { EventDetails } from './EventDetails';

export const KIND_LABEL: Record<EventKind, string> = {
  cup: 'Cup',
  challenge: 'Challenge',
  prerelease: 'Prerelease',
  local: 'Local'
};

export interface EventListProps {
  days: EventDay[];
  unit: DistanceUnit;
  today: string;
  expanded: string | null;
  highlighted: string | null;
  onToggle: (id: string) => void;
  onHover: (venue: string | null) => void;
}

export function eventPanelId(id: string): string {
  return `event-${id}`;
}

/** Listed events grouped by day. Each row opens in place to the store's details. */
export function EventList(props: EventListProps) {
  return (
    <div class='el-days'>
      <For each={props.days}>
        {day => (
          <section class='el-day' classList={{ weekend: isWeekend(day.date) }} aria-labelledby={`el-day-${day.date}`}>
            <h3 class='el-day-head' id={`el-day-${day.date}`}>
              <span>{dayHeading(day.date)}</span>
              <span class='el-when'>{relativeDay(props.today, day.date)}</span>
              <span class='el-n'>{day.events.length}</span>
            </h3>
            <ul class='el-list'>
              <For each={day.events}>
                {event => (
                  <EventRow
                    event={event}
                    unit={props.unit}
                    open={props.expanded === event.id}
                    hot={props.highlighted === venueKey(event)}
                    onToggle={props.onToggle}
                    onHover={props.onHover}
                  />
                )}
              </For>
            </ul>
          </section>
        )}
      </For>
    </div>
  );
}

function EventRow(props: {
  event: PlacedEvent;
  unit: DistanceUnit;
  open: boolean;
  hot: boolean;
  onToggle: (id: string) => void;
  onHover: (venue: string | null) => void;
}) {
  const distance = () => formatDistance(props.event.distanceKm, props.unit);
  return (
    <li
      class='el-item'
      classList={{ hot: props.hot, open: props.open }}
      onPointerEnter={() => props.onHover(venueKey(props.event))}
      onPointerLeave={() => props.onHover(null)}
    >
      <button
        type='button'
        class='el-row'
        aria-expanded={props.open}
        aria-controls={eventPanelId(props.event.id)}
        onClick={() => props.onToggle(props.event.id)}
      >
        <span class='el-time'>{formatClock(props.event.time, props.event.cc) || '—'}</span>
        <span class='el-main'>
          <span class='el-name'>{titleCase(props.event.name)}</span>
          <span class='el-venue'>
            {titleCase(props.event.shop)}
            <Show when={props.event.city}> · {titleCase(props.event.city)}</Show>
            <span class='el-venue-dist'> · {distance()}</span>
          </span>
        </span>
        <span class={`badge el-kind ${props.event.kind}`}>{KIND_LABEL[props.event.kind]}</span>
        <span class='el-dist'>{distance()}</span>
        <span class='el-fee'>{props.event.fee ? formatFee(props.event.fee, props.event.cc) : ''}</span>
      </button>
      <Show when={props.open}>
        <EventDetails event={props.event} id={eventPanelId(props.event.id)} />
      </Show>
    </li>
  );
}
