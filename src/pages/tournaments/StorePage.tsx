/**
 * /stores/:id: what anyone sees of a store. Its name and league over a map
 * of where it is, beside its address, its links and its own words; its
 * weekly league nights with the dates coming up that differ; then its events
 * on the site that have not ended, and those that have by month. Its Managers also get the way to its
 * settings.
 */

import { byMonth, playersWord } from './storeHistory';
import { A } from '@solidjs/router';
import { createEffect, createResource, For, Show } from 'solid-js';
import { dateIn, managesStore } from '../../../shared/accounts/stores';
import type { PastEvent, PublicStore, StoreEvent } from '../../../shared/accounts/types';
import { Skeleton } from '../../components/Skeleton';
import { errorText } from '../../lib/tournament/api';
import {
  addressOf,
  bareLink,
  byWeek,
  clock,
  exceptionChange,
  fetchStore,
  shortDay,
  storeEventWhen,
  WEEKDAYS,
  zoneName
} from '../../lib/tournament/stores';
import { latestValue } from '../../lib/resource';
import { ErrorLine } from './Field';
import { TournamentHero } from './Hero';
import { StoreMap } from './StoreMap';
import '../../styles/pages/tournament-store-page.css';

/** Third-party links from store-entered data: no referrer, no endorsement. */
const STORE_LINK_REL = 'noopener noreferrer nofollow ugc';

const STATUS_WORDS: Record<StoreEvent['status'], string> = {
  upcoming: 'Registration',
  live: 'Running',
  finished: 'Finished'
};

function Where(props: { store: PublicStore }) {
  const links = () =>
    [
      { href: props.store.website, label: bareLink(props.store.website) },
      { href: props.store.discord, label: 'Discord' }
    ].filter(link => link.href);
  return (
    <div class='tm-storepage-where'>
      <address class='tm-storepage-address'>
        <span>{props.store.address}</span>
        <span>{addressOf({ ...props.store, address: '' })}</span>
      </address>
      <Show when={links().length > 0}>
        <p class='tm-storepage-links'>
          <For each={links()}>
            {link => (
              <a href={link.href} target='_blank' rel={STORE_LINK_REL}>
                {link.label}
              </a>
            )}
          </For>
        </p>
      </Show>
      <Show when={props.store.details}>
        <p class='tm-storepage-about'>{props.store.details}</p>
      </Show>
    </div>
  );
}

function Nights(props: { store: PublicStore }) {
  const today = () => dateIn(props.store.timeZone, Date.now());
  const ahead = () => props.store.exceptions.filter(item => item.date >= today());
  return (
    <section class='tm-storepage-nights' aria-labelledby='storepage-nights'>
      <h2 class='tm-subhead tm-box-head' id='storepage-nights'>
        League nights
      </h2>
      <Show when={props.store.nights.length > 0} fallback={<p class='muted tm-storepage-none'>None listed</p>}>
        <ul class='tm-storepage-list'>
          <For each={byWeek(props.store.nights)}>
            {night => (
              <li>
                <strong>{WEEKDAYS[night.weekday]}s</strong>
                <span class='tm-num'>{clock(night.time)}</span>
                <span class='muted tm-storepage-night-name'>{night.name}</span>
                <span class='muted tm-num'>{night.fee}</span>
              </li>
            )}
          </For>
        </ul>
        <p class='muted tm-storepage-zone'>{zoneName(props.store.timeZone)}</p>
      </Show>
      <Show when={ahead().length > 0}>
        <ul class='tm-storepage-list tm-storepage-changes'>
          <For each={ahead()}>
            {item => (
              <li>
                <strong class='tm-num'>{shortDay(item.date)}</strong>
                <span>{exceptionChange(item)}</span>
                <span class='muted tm-storepage-night-name'>{item.note}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function Events(props: { events: readonly StoreEvent[] }) {
  return (
    <section class='tm-storepage-events' aria-labelledby='storepage-events'>
      <h2 class='tm-subhead tm-box-head' id='storepage-events'>
        Upcoming events
      </h2>
      <Show when={props.events.length > 0} fallback={<p class='muted tm-storepage-none'>None on Ciphermaniac</p>}>
        <ul class='tm-storepage-history'>
          <For each={props.events}>
            {event => (
              <li>
                <span class='tm-num'>{storeEventWhen(event.startDate, event.startsAt)}</span>
                <EventName code={event.code} name={event.name} sanctioned={event.sanctioned} />
                <span class='muted'>{STATUS_WORDS[event.status]}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function EventName(props: { code: string; name: string; sanctioned: boolean }) {
  return (
    <span class='tm-storepage-event'>
      <A href={`/t/${props.code}`}>{props.name || props.code}</A>
      <Show when={props.sanctioned}>
        <span class='tm-flag'>Sanctioned</span>
      </Show>
    </span>
  );
}

function Past(props: { events: readonly PastEvent[] }) {
  return (
    <Show when={props.events.length > 0}>
      <section class='tm-storepage-events' aria-labelledby='storepage-past'>
        <h2 class='tm-subhead tm-box-head' id='storepage-past'>
          Past events
        </h2>
        <For each={byMonth(props.events)}>
          {month => (
            <>
              <h3 class='muted tm-storepage-month'>{month.label}</h3>
              <ul class='tm-storepage-history is-past'>
                <For each={month.events}>
                  {event => (
                    <li>
                      <span class='tm-num'>{shortDay(event.date)}</span>
                      <EventName code={event.code} name={event.name} sanctioned={event.sanctioned} />
                      <span class='muted tm-num'>{playersWord(event.players)}</span>
                      <span class='tm-storepage-winner'>{event.winners.join(', ')}</span>
                    </li>
                  )}
                </For>
              </ul>
            </>
          )}
        </For>
      </section>
    </Show>
  );
}

/** The store's league, or that it has none yet. */
function LeagueLine(props: { leagueId: string | null }) {
  return (
    <Show when={props.leagueId} fallback={<span>Unsanctioned store</span>}>
      {id => <span class='tm-num'>League {id()}</span>}
    </Show>
  );
}

export function StorePage(props: { id: string }) {
  const [read] = createResource(() => props.id, fetchStore);
  const current = () => latestValue(read);
  createEffect(() => {
    document.title = `${current()?.store.name ?? 'Store'} — Ciphermaniac`;
  });
  return (
    <div class='tm-page tm-storepage'>
      <Show
        when={current()}
        fallback={
          <Show when={read.error} fallback={<Skeleton height='320px' />}>
            <ErrorLine message={errorText(read.error)} />
          </Show>
        }
      >
        {answer => (
          <>
            <TournamentHero
              title={answer().store.name}
              meta={<LeagueLine leagueId={answer().store.leagueId} />}
              action={
                <Show when={managesStore(answer().role)}>
                  <A class='btn btn-secondary' href={`/stores/${answer().store.id}/settings`}>
                    Store settings
                  </A>
                </Show>
              }
            />
            <div class='tm-storepage-top' classList={{ 'has-map': answer().store.lat !== null }}>
              <Show when={answer().store.lat !== null && answer().store.lon !== null}>
                <StoreMap lat={answer().store.lat ?? 0} lon={answer().store.lon ?? 0} label={answer().store.name} />
              </Show>
              <div class='tm-storepage-side'>
                <Where store={answer().store} />
                <Nights store={answer().store} />
              </div>
            </div>
            <Events events={answer().store.events} />
            <Past events={answer().store.past} />
          </>
        )}
      </Show>
    </div>
  );
}
