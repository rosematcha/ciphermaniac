import { A } from '@solidjs/router';
import { For, Show } from 'solid-js';
import { matchStatus, recordLabel, type Standing } from '../../../shared/live/view';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { deckIcons } from './LiveDeck';
import { seatHref, seatName } from './links';
import { FollowButton, type SeatPresenter } from './PairingsTable';
import { STATUS_LABEL } from './LiveRun';

/**
 * The round's field ranked rather than paired.
 *
 * The records are the ones going into the round with this round's result folded
 * in, so the list agrees with itself while a round is half-reported: a player
 * RK9 still prints as 6-1-0 with a win in hand reads 7-1-0 here, and sorts
 * where that puts them.
 */
export function StandingsTable(props: { rows: readonly Standing[]; present: SeatPresenter }) {
  return (
    <div class='table-wrap live-table live-standings'>
      <table class='data'>
        <thead>
          <tr>
            <th class='num live-table-col'>#</th>
            <th>Player</th>
            <th class='num live-wide-col'>Record</th>
            <th class='num live-wide-col'>Pts</th>
            <th class='num'>Status</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>{row => <StandingRow row={row} present={props.present} />}</For>
        </tbody>
      </table>
    </div>
  );
}

function StandingRow(props: { row: Standing; present: SeatPresenter }) {
  const seat = () => props.row.seat;
  const profile = () => props.present.profileOf(seat());
  const deck = () => props.present.deckOf(seat());
  const status = () => matchStatus(props.row.match);
  return (
    <tr>
      <td class='num muted-cell live-table-col'>{props.row.place}</td>
      <td class='live-seat-cell'>
        <span class='arche-name-cell live-seat'>
          <span class='live-seat-icons' title={deck()?.label}>
            <ArchetypeIcons slugs={deck() ? deckIcons(deck()!) : []} size={22} />
            <Show when={deck()}>{current => <span class='sr-only'>{current().label}</span>}</Show>
          </span>
          <A href={seatHref(props.present.slug, seat(), profile())} class='cardname'>
            {seatName(seat(), profile())}
          </A>
          <span
            class='live-seat-inline muted-cell'
            classList={{ 'is-dropped': seat().dropped }}
            title={seat().dropped ? 'Dropped' : undefined}
          >
            {recordLabel(props.row)}
          </span>
          <Show when={seat().dropped}>
            <span class='sr-only'>, dropped</span>
          </Show>
          <FollowButton seat={seat()} />
        </span>
      </td>
      <td class='num live-wide-col'>{recordLabel(props.row)}</td>
      <td class='num live-wide-col'>{props.row.points}</td>
      <td class='num muted-cell'>
        <Show when={status() === 'final'} fallback={STATUS_LABEL[status()]}>
          {props.row.match.table ? `Table ${props.row.match.table}` : 'Bye'}
        </Show>
      </td>
    </tr>
  );
}
