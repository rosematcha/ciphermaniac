/**
 * The admin page's Events tab: every event on the site, stores' and those
 * run under an account's own name alike, the last changed first, with who
 * runs it, its date, how far along it is and how many play. Each opens on
 * its public page.
 */

import { A } from '@solidjs/router';
import { createResource, For, Show } from 'solid-js';
import type { AdminEvent } from '../../../shared/accounts/types';
import { parseTomDate } from '../../../shared/tournament/divisions';
import { Skeleton } from '../../components/Skeleton';
import { fetchAllEvents } from '../../lib/tournament/admin';
import { errorText } from '../../lib/tournament/api';
import { resolved } from '../../lib/resource';
import { ErrorLine } from './Field';

const dateOf = (startDate: string) =>
  parseTomDate(startDate)?.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' }) ?? '';

const phaseOf = (event: AdminEvent) => {
  if (event.finished) {
    return 'Finished';
  }
  return event.rounds > 0 ? `Round ${event.rounds}` : 'Registration';
};

function EventRow(props: { event: AdminEvent }) {
  const e = () => props.event;
  return (
    <tr>
      <td>
        <A href={`/t/${e().code}`}>{e().name || e().code}</A>
      </td>
      <td>
        <Show when={e().store} fallback={<span class='muted'>{e().owner}</span>}>
          {store => <A href={`/stores/${store().id}`}>{store().name}</A>}
        </Show>
      </td>
      <td class='muted-cell tm-num tm-nowrap'>{dateOf(e().startDate)}</td>
      <td class='tm-nowrap'>{phaseOf(e())}</td>
      <td class='num'>{e().players}</td>
    </tr>
  );
}

export function AdminEvents() {
  const [list, { refetch }] = createResource(() => fetchAllEvents().then(answer => answer.events));
  return (
    <Show
      when={resolved(list)}
      fallback={
        <Show when={list.error} fallback={<Skeleton height='160px' />}>
          <ErrorLine message={errorText(list.error)} />
          <button type='button' class='btn btn-secondary tm-small' onClick={() => void refetch()}>
            Retry
          </button>
        </Show>
      }
    >
      {events => (
        <section class='tm-box'>
          <Show when={events().length > 0} fallback={<p class='tm-empty muted'>No events yet</p>}>
            <div class='table-wrap'>
              <table class='data tm-admin-events'>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Run by</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th class='num'>Players</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={events()}>{event => <EventRow event={event} />}</For>
                </tbody>
              </table>
            </div>
          </Show>
        </section>
      )}
    </Show>
  );
}
