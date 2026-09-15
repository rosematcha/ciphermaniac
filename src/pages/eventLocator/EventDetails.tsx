import { Show } from 'solid-js';
import type { LocatorEvent } from '../../../shared/events/types';
import { calendarFileName, eventCalendar } from '../../lib/events/calendar';
import { addressLine, formatFee, formatWallTime, titleCase } from '../../lib/events/format';

/** Third-party links from store-entered data: no referrer, no endorsement. */
const STORE_LINK_REL = 'noopener noreferrer nofollow ugc';

function divisionFees(event: LocatorEvent): string | null {
  const fees = event.divisionFees;
  if (!fees) {
    return null;
  }
  const parts = [
    fees.juniors && `Juniors ${formatFee(fees.juniors, event.cc)}`,
    fees.seniors && `Seniors ${formatFee(fees.seniors, event.cc)}`,
    fees.masters && `Masters ${formatFee(fees.masters, event.cc)}`
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function entry(event: LocatorEvent): string | null {
  const base = event.fee ? formatFee(event.fee, event.cc) : null;
  return [base, divisionFees(event)].filter(Boolean).join(' · ') || null;
}

function registrationWindow(event: LocatorEvent): string | null {
  const opens = event.regOpens ? formatWallTime(event.regOpens, event.cc) : null;
  const closes = event.regCloses ? formatWallTime(event.regCloses, event.cc) : null;
  if (opens && closes) {
    return `${opens} to ${closes}`;
  }
  if (closes) {
    return `Closes ${closes}`;
  }
  return opens ? `Opens ${opens}` : null;
}

function directionsUrl(event: LocatorEvent): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${event.lat},${event.lon}`;
}

function downloadCalendar(event: LocatorEvent): void {
  const url = URL.createObjectURL(new Blob([eventCalendar(event)], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = calendarFileName(event);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The store's details for one event. Registration is run by each store, so
 * the store's own registration link leads when it has one; pokemon.com holds
 * the official listing and the rest of the event's details.
 */
export function EventDetails(props: { event: LocatorEvent; id: string }) {
  const event = () => props.event;
  const storeSite = () =>
    event().website && event().website !== event().registrationUrl ? event().website : undefined;
  return (
    <div class='el-details' id={props.id}>
      <dl class='el-facts'>
        <div>
          <dt>Store</dt>
          <dd>
            {titleCase(event().shop)}
            <Show when={event().address}>
              <span class='el-address'>{addressLine(event().address, event().cc)}</span>
            </Show>
          </dd>
        </div>
        <Show when={entry(event())}>
          {text => (
            <div>
              <dt>Entry</dt>
              <dd>{text()}</dd>
            </div>
          )}
        </Show>
        <Show when={registrationWindow(event())}>
          {text => (
            <div>
              <dt>Registration</dt>
              <dd>{text()}</dd>
            </div>
          )}
        </Show>
        <Show when={event().email || event().phone}>
          <div>
            <dt>Contact</dt>
            <dd class='el-contact'>
              <Show when={event().email}>{email => <a href={`mailto:${email()}`}>{email()}</a>}</Show>
              <Show when={event().phone}>
                {phone => <a href={`tel:${phone().replace(/[^\d+]/g, '')}`}>{phone()}</a>}
              </Show>
            </dd>
          </div>
        </Show>
      </dl>
      <Show when={event().details}>{text => <p class='el-desc'>{text()}</p>}</Show>
      <div class='el-actions'>
        <Show when={event().registrationUrl}>
          {url => (
            <a class='btn btn-primary' href={url()} target='_blank' rel={STORE_LINK_REL}>
              Register with the store
            </a>
          )}
        </Show>
        <a
          class='btn'
          classList={{ 'btn-primary': !event().registrationUrl, 'btn-secondary': Boolean(event().registrationUrl) }}
          href={event().url}
          target='_blank'
          rel='noopener'
        >
          Event details on pokemon.com
        </a>
        <Show when={storeSite()}>
          {url => (
            <a class='btn btn-secondary' href={url()} target='_blank' rel={STORE_LINK_REL}>
              Store website
            </a>
          )}
        </Show>
        <a class='btn btn-ghost' href={directionsUrl(event())} target='_blank' rel='noopener noreferrer'>
          Directions
        </a>
        <button type='button' class='btn btn-ghost' onClick={() => downloadCalendar(event())}>
          Add to calendar
        </button>
      </div>
    </div>
  );
}
