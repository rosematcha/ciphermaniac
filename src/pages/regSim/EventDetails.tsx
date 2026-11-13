import { For, type JSX, Show } from 'solid-js';
import type { SimCity } from './data';
import { addDays, type Division, type Draw, localPrice, USD_PRICE, zonedInstant } from './model';
import {
  clockFor,
  clockTime,
  isoDate,
  money,
  utcStamp,
  weekendRange,
  zoneAbbreviation,
  zonedDate,
  zonedTime
} from './format';
import { CardStackMark, RibbonMark } from './marks';

const DIVISIONS: { key: Division; label: string }[] = [
  { key: 'junior', label: 'Junior division' },
  { key: 'senior', label: 'Senior division' },
  { key: 'masters', label: 'Masters division' }
];

export function divisionPrice(city: SimCity, division: Division): string {
  return money(localPrice(USD_PRICE[division], city.rate), city.currency);
}

/** A date on one line and its time, with the zone, on the next. */
function When(props: { instant: number; city: SimCity }) {
  return (
    <>
      {zonedDate(props.instant, props.city.timezone)}
      <br />
      {zonedTime(props.instant, props.city.timezone, clockFor(props.city.country))}
    </>
  );
}

/** One label and its value: two of these sit side by side on a wide screen. */
function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class='regsim-row'>
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

/** The event's title row: a mark, the name and dates, and a second mark. */
export function EventTitle(props: { city: SimCity; draw: Draw; withZone?: boolean }) {
  const zone = () => props.city.timezone;
  return (
    <header class='regsim-title'>
      <CardStackMark />
      <h1>
        {props.draw.saturday.year} {props.city.city} Regional Championships
        <span class='regsim-title-dates'>{weekendRange(props.draw.saturday)}</span>
        <Show when={props.withZone}>
          <span class='regsim-badge regsim-badge-light'>
            Time zone: {zone()} {zoneAbbreviation(props.draw.opensAt, zone(), clockFor(props.city.country))}
          </span>
        </Show>
      </h1>
      <RibbonMark />
    </header>
  );
}

function Venue(props: { city: SimCity }) {
  return (
    <>
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
      <Show when={props.city.website}>
        {website => (
          <>
            <br />
            <a href={website()} target='_blank' rel='noopener noreferrer'>
              Venue website
            </a>
          </>
        )}
      </Show>
    </>
  );
}

/** The bordered card of dates, prices, venue and organizer. */
function DetailsCard(props: { city: SimCity; draw: Draw }) {
  const saturday = () => props.draw.saturday;
  const at = (hour: number, minute: number) => zonedInstant(saturday(), hour, minute, props.city.timezone);
  // Registration closes at the end of the Wednesday before the event.
  const closes = () => zonedInstant(addDays(saturday(), -3), 23, 59, props.city.timezone);

  return (
    <section class='regsim-card regsim-details'>
      <div class='regsim-card-head'>
        <h2>Tournament details</h2>
        <CardStackMark small />
      </div>
      <dl class='regsim-card-body regsim-rows'>
        <Row label='Event dates'>{weekendRange(saturday())}</Row>
        <Row label='Registration closes'>
          <When instant={closes()} city={props.city} />
        </Row>
        <Row label='List submission closes'>
          <When instant={at(7, 30)} city={props.city} />
        </Row>
        <Row label='Tournament start'>
          <When instant={at(8, 30)} city={props.city} />
          <For each={['Junior division', 'Senior division']}>
            {label => (
              <p class='regsim-division-start'>
                <b>{label}:</b> <When instant={at(9, 0)} city={props.city} />
              </p>
            )}
          </For>
        </Row>
        <Row label='Price'>
          <For each={DIVISIONS}>
            {division => (
              <>
                {division.label}: {divisionPrice(props.city, division.key)}
                <br />
              </>
            )}
          </For>
        </Row>
        <Row label='Refund policy'>
          Refunds are available until 11:59 PM the night before you want one, less a processing fee. The fee is 20% this
          week, 40% next week, and the whole entry after that.
        </Row>
        <Row label='Non-transferable'>
          Registrations are valid for the named player only. The named player may not change their name.
        </Row>
        <Row label='Venue'>
          <Venue city={props.city} />
        </Row>
        <Row label='Host organizer'>Gaming Generations</Row>
      </dl>
    </section>
  );
}

/** The yellow, disabled stand-in for the button until registration opens. */
function OpensButton(props: { city: SimCity; draw: Draw }) {
  const zone = () => props.city.timezone;
  const clock = () => clockFor(props.city.country);
  return (
    <button type='button' class='regsim-btn regsim-btn-waiting' disabled>
      Registration opens {isoDate(props.draw.opensAt, zone())} at {clockTime(props.draw.opensAt, zone(), clock())}
      <span class='regsim-badge'>
        Time zone: {zone()} {zoneAbbreviation(props.draw.opensAt, zone(), clock())}
      </span>
    </button>
  );
}

/**
 * The tournament page: the details, the agreement (already accepted), and the
 * button at the bottom that only turns green once registration has opened.
 */
export function EventDetails(props: { city: SimCity; draw: Draw; open: boolean; onRegister: () => void }) {
  return (
    <article>
      <EventTitle city={props.city} draw={props.draw} />
      <p>For complete and up-to-date information, keep refreshing this page.</p>
      <DetailsCard city={props.city} draw={props.draw} />
      <section class='regsim-card regsim-agreement'>
        <div class='regsim-card-head'>
          <h2>Competitor agreement</h2>
        </div>
        <div class='regsim-card-body'>
          <p>
            The MimiQ Competitor Agreement governs your participation in MimiQ tournaments, tournaments near MimiQ
            tournaments, and any tournament MimiQ hears about. You accepted it when this page loaded.
          </p>
          <p class='regsim-accepted'>Accepted {utcStamp(props.draw.createdAt)} UTC</p>
        </div>
      </section>
      <p class='regsim-alert'>
        Competitors may register for one tournament per event. MimiQ removes extra registrations, starting with the one
        you wanted.
      </p>
      <div class='regsim-go'>
        <Show when={props.open} fallback={<OpensButton city={props.city} draw={props.draw} />}>
          <button type='button' class='regsim-btn regsim-btn-go' onClick={() => props.onRegister()}>
            Go to registration
          </button>
        </Show>
      </div>
    </article>
  );
}
