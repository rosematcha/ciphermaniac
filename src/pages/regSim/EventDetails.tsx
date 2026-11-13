import { For, Show } from 'solid-js';
import type { SimCity } from './data';
import { addDays, type Division, type Draw, localPrice, USD_PRICE, zonedInstant } from './model';
import { money, weekendRange, zonedDateTime } from './format';

const DIVISIONS: { key: Division; label: string }[] = [
  { key: 'junior', label: 'Junior division' },
  { key: 'senior', label: 'Senior division' },
  { key: 'masters', label: 'Masters division' }
];

export function divisionPrice(city: SimCity, division: Division): string {
  return money(localPrice(USD_PRICE[division], city.rate), city.currency);
}

/**
 * The tournament page: dates, prices, venue, organizer, and, once
 * registration has opened, the way in.
 */
export function EventDetails(props: { city: SimCity; draw: Draw; open: boolean; onRegister: () => void }) {
  const zone = () => props.city.timezone;
  const saturday = () => props.draw.saturday;
  const at = (hour: number, minute: number) => zonedDateTime(zonedInstant(saturday(), hour, minute, zone()), zone());
  // Registration closes at the end of the Wednesday before the event.
  const closes = () => zonedDateTime(zonedInstant(addDays(saturday(), -3), 23, 59, zone()), zone());

  return (
    <article class='regsim-event'>
      <header class='regsim-title'>
        <h1>
          {saturday().year} {props.city.city} Regional Championships
        </h1>
        <p class='regsim-dates'>{weekendRange(saturday())}</p>
      </header>

      <section>
        <h2>Tournament details</h2>
        <dl class='regsim-rows'>
          <dt>Event dates</dt>
          <dd>{weekendRange(saturday())}</dd>
          <Show
            when={props.open}
            fallback={
              <>
                <dt>Registration opens</dt>
                <dd>{zonedDateTime(props.draw.opensAt, zone())}</dd>
              </>
            }
          >
            <dt>Registration closes</dt>
            <dd>{closes()}</dd>
          </Show>
          <dt>List submission closes</dt>
          <dd>{at(7, 30)}</dd>
          <dt>Tournament start</dt>
          <dd>{at(8, 30)}</dd>
          <dt class='regsim-sub'>Junior division</dt>
          <dd>{at(9, 0)}</dd>
          <dt class='regsim-sub'>Senior division</dt>
          <dd>{at(9, 0)}</dd>
        </dl>
      </section>

      <section>
        <h2>Price</h2>
        <dl class='regsim-rows'>
          <For each={DIVISIONS}>
            {division => (
              <>
                <dt>{division.label}</dt>
                <dd>{divisionPrice(props.city, division.key)}</dd>
              </>
            )}
          </For>
        </dl>
        <p>[COPY: refund policy]</p>
        <p>[COPY: registrations are not transferable]</p>
      </section>

      <section class='regsim-pair'>
        <div>
          <h2>Venue</h2>
          <address>
            {props.city.venue}
            <Show when={props.city.street}>
              {street => (
                <>
                  <br />
                  {street()}
                </>
              )}
            </Show>
            <br />
            {props.city.locality}
            <br />
            {props.city.country}
          </address>
          <Show when={props.city.website}>
            {website => (
              <a href={website()} target='_blank' rel='noopener noreferrer'>
                Venue website
              </a>
            )}
          </Show>
        </div>
        <div>
          <h2>Host organizer</h2>
          <p>Gaming Generations</p>
        </div>
      </section>

      <section>
        <h2>Competitor agreement</h2>
        <p>[COPY: competitor agreement]</p>
      </section>

      <Show
        when={props.open}
        fallback={<p class='regsim-muted'>Registration opens {zonedDateTime(props.draw.opensAt, zone())}.</p>}
      >
        <button type='button' class='btn btn-primary regsim-go' onClick={() => props.onRegister()}>
          Go to registration
        </button>
      </Show>

      <p class='regsim-code'>{props.draw.code}</p>
    </article>
  );
}
