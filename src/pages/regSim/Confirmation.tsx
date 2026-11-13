import type { JSX } from 'solid-js';
import type { SimCity } from './data';
import { type Draw, zonedInstant } from './model';
import { clockFor, elapsed, weekendRange, zonedTime } from './format';
import { EventTitle } from './EventDetails';

const DIVISION_NAMES = { junior: 'Junior', senior: 'Senior', masters: 'Masters' } as const;

/** "Saturday, January 9, 2027" in the event's zone. */
function longDate(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(instant);
}

/** A grey box holding one date and time, under an optional caption. */
function DateBox(props: { instant: number; city: SimCity; caption?: JSX.Element }) {
  return (
    <div class='regsim-datebox'>
      {props.caption}
      <b>{longDate(props.instant, props.city.timezone)}</b>
      <span>{zonedTime(props.instant, props.city.timezone, clockFor(props.city.country))}</span>
    </div>
  );
}

function Detail(props: { label: string; children: JSX.Element }) {
  return (
    <div class='regsim-detail'>
      <b>{props.label}</b>
      <span>{props.children}</span>
    </div>
  );
}

/**
 * The page after registering: the confirmation, what to do next, and the
 * registration itself, with a way to cancel and go again.
 */
export function Confirmation(props: { city: SimCity; draw: Draw; registeredAt: number; onCancel: () => void }) {
  const at = (hour: number, minute: number) => zonedInstant(props.draw.saturday, hour, minute, props.city.timezone);
  const division = () => DIVISION_NAMES[props.draw.division ?? 'masters'];

  return (
    <article>
      <EventTitle city={props.city} draw={props.draw} withZone />
      <section class='regsim-card regsim-confirmed'>
        <div class='regsim-banner'>
          <h2>Registration confirmed!</h2>
          <p>
            {props.draw.saturday.year} {props.city.city} Regional Championships
            <br />
            {weekendRange(props.draw.saturday)}
          </p>
          <p class='regsim-banner-time'>
            Registered {elapsed(props.registeredAt - props.draw.opensAt)} after registration opened
          </p>
        </div>
        <div class='regsim-card-body'>
          <div class='regsim-alert'>
            <p>
              <b>Important</b>
            </p>
            <p>[COPY: important notice]</p>
          </div>
          <h3 class='regsim-todo-head'>What You Need to Do</h3>
          <ol class='regsim-todo'>
            <li>
              <b>Deck list submission</b>
              <p>[COPY: deck list instructions]</p>
              <DateBox instant={at(7, 30)} city={props.city} />
            </li>
            <li>
              <b>Venue Entry</b>
              <p>[COPY: venue entry]</p>
            </li>
            <li>
              <b>First Day of Play</b>
              <DateBox instant={at(8, 30)} city={props.city} caption={<u>Masters begin their first day of play:</u>} />
              <DateBox
                instant={at(9, 0)}
                city={props.city}
                caption={<u>Juniors and Seniors begin their first day of play:</u>}
              />
            </li>
          </ol>
        </div>
      </section>

      <section class='regsim-card regsim-player'>
        <div class='regsim-card-head regsim-card-head-grey'>
          <h2>Player registration details</h2>
        </div>
        <div class='regsim-card-body'>
          <Detail label='Player ID'>{props.draw.playerId ?? ''}</Detail>
          <Detail label='Name'>[COPY: player name]</Detail>
          <Detail label='Birthdate'>[COPY: birthdate]</Detail>
          <Detail label='Division'>{division()}</Detail>
          <Detail label='Email'>[COPY: email]</Detail>
          <hr />
          <div class='regsim-go'>
            <button type='button' class='regsim-btn regsim-btn-warning' onClick={() => props.onCancel()}>
              Cancel registration and initiate refund
            </button>
          </div>
          <hr />
          <p>[COPY: support footnote]</p>
        </div>
      </section>
    </article>
  );
}
