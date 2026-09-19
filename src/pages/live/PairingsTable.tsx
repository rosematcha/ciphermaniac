import { A } from '@solidjs/router';
import { For, Show } from 'solid-js';
import type { LiveMatch, LiveSeat } from '../../../shared/live/types';
import {
  matchStatus,
  recordLabel,
  seatKey,
  type SeatOutcome,
  seatOutcome,
  type SeatProfile,
  type SeatRef
} from '../../../shared/live/view';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { useLiveFollows } from '../../lib/liveFollows';
import { deckIcons, type ReportedDeck } from './LiveDeck';
import { seatHref, seatName } from './links';
import { OutcomeMark, STATUS_LABEL } from './LiveRun';

export interface SeatPresenter {
  slug: string;
  profileOf: (seat: SeatRef) => SeatProfile | null;
  deckOf: (seat: SeatRef) => ReportedDeck | undefined;
}

/**
 * The round's tables. Four columns on a desktop; on a phone each row restacks
 * into two lines — your seat over your opponent's — because the four columns
 * measure about 580px and a phone has 366, and the overflow put the opponent,
 * the whole point of a pairings page, behind a hidden scrollbar.
 */
export function PairingsTable(props: { matches: readonly LiveMatch[]; present: SeatPresenter }) {
  return (
    <div class='table-wrap live-table'>
      <table class='data'>
        <thead>
          <tr>
            <th class='num live-table-col'>Table</th>
            <th>Player</th>
            <th>Opponent</th>
            <th class='num'>Status</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.matches}>{match => <MatchRow match={match} present={props.present} />}</For>
        </tbody>
      </table>
    </div>
  );
}

function MatchRow(props: { match: LiveMatch; present: SeatPresenter }) {
  // Both seats reserve the sprite slot when either has a deck, so the two names
  // in a row start at the same place; a row with no report gives the space back.
  const reserve = () => props.match.seats.some(seat => props.present.deckOf(seat));
  const decided = () => props.match.seats.some((_, i) => seatOutcome(props.match, i));
  return (
    <tr classList={{ 'has-deck': reserve(), 'has-result': decided() }}>
      <td class='num muted-cell live-table-col'>{props.match.table || '—'}</td>
      <For each={[0, 1]}>
        {i => (
          <td class='live-seat-cell'>
            <Show when={props.match.seats[i]} fallback={<span class='muted-cell live-bye'>Bye</span>}>
              {seat => <SeatCell seat={seat()} outcome={seatOutcome(props.match, i)} present={props.present} />}
            </Show>
          </td>
        )}
      </For>
      <td class='num muted-cell live-status-cell' data-status={matchStatus(props.match)}>
        {STATUS_LABEL[matchStatus(props.match)]}
      </td>
    </tr>
  );
}

/**
 * Icon, name, record — the row shape this page was asked for. The reported
 * deck's sprites lead, in a slot every row keeps so names line up.
 *
 * The archetype is sprites and nothing else, the way the rest of the site
 * writes one, so its name is carried for assistive tech rather than left in a
 * `title` that a finger can never reach.
 */
export function SeatCell(props: { seat: LiveSeat; outcome: SeatOutcome | null; present: SeatPresenter }) {
  const profile = () => props.present.profileOf(props.seat);
  const deck = () => props.present.deckOf(props.seat);
  return (
    <span class='arche-name-cell live-seat'>
      <span class='live-seat-icons' title={deck()?.label}>
        <ArchetypeIcons slugs={deck() ? deckIcons(deck()!) : []} size={22} />
        <Show when={deck()}>{current => <span class='sr-only'>{current().label}</span>}</Show>
      </span>
      <Show when={props.outcome}>{outcome => <OutcomeMark outcome={outcome()} />}</Show>
      <A href={seatHref(props.present.slug, props.seat, profile())} class='cardname'>
        {seatName(props.seat, profile())}
      </A>
      <span
        class='muted-cell live-seat-record'
        classList={{ 'is-dropped': props.seat.dropped }}
        title={props.seat.dropped ? 'Dropped' : undefined}
      >
        {recordLabel(props.seat)}
        <Show when={props.seat.dropped}>
          <span class='sr-only'>, dropped</span>
        </Show>
      </span>
      <FollowButton seat={props.seat} />
    </span>
  );
}

/**
 * Following from the row itself. Until now a follow could only be set from
 * inside an open run, so following eight players meant opening eight of them —
 * and the "following only" filter was unusable until you had.
 */
export function FollowButton(props: { seat: LiveSeat }) {
  const { follows, toggle } = useLiveFollows();
  const key = () => seatKey(props.seat);
  const followed = () => follows().has(key());
  return (
    <button
      type='button'
      class='live-follow'
      classList={{ 'is-on': followed() }}
      aria-pressed={followed()}
      aria-label={`${followed() ? 'Unfollow' : 'Follow'} ${props.seat.name}`}
      onClick={() => toggle(key())}
    >
      <svg
        width='14'
        height='14'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        stroke-width='2'
        aria-hidden='true'
      >
        <path d='M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.8L6.7 20l1-6L3.4 9.9 9.4 9z' />
      </svg>
    </button>
  );
}
