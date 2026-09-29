/**
 * A round's tables, for players and staff alike. Each row is the table, the
 * two players with the record they brought into the round, and a mark by
 * whoever won. The public page adds whether each table is still playing, on
 * desktop. Staff get the result controls: a player's name is the button that
 * reports them as the winner, which is one press at the table (and a second
 * to confirm, or a double click, see RoundPanel).
 *
 * On a phone a row restacks into two lines under its table number, as the
 * site's live pairings do, so the opponent is never behind a sideways scroll.
 */

import { For, type JSX, Show, Switch, Match as When } from 'solid-js';
import { sortMatches } from '../../../shared/tournament/rounds';
import type { Match, Outcome, Pod, Round } from '../../../shared/tournament/types';
import type { PendingResult } from '../../../shared/tournament/view';
import { recordsBefore, seatMark, shownOutcome } from '../../lib/tournament/present';
import { DeckIcons } from './DeckIcons';

export interface MatchTableProps {
  pod: Pod;
  round: Round;
  matches: readonly Match[];
  names: Map<string, string>;
  decks: Record<string, string>;
  pending: readonly PendingResult[];
  /** The viewer's own player ID, whose row is marked. */
  me?: string | null;
  onPlayer?: (id: string) => void;
  /** Staff only: report `outcome` for the match. */
  onReport?: (match: Match, outcome: Outcome) => void;
  /** Staff only: record `outcome` at once, from a double click on the winner. */
  onRecord?: (match: Match, outcome: Outcome) => void;
  /** Staff only: the deck picker for a player, drawn in their seat in place of the result button. */
  deckPicker?: (id: string) => JSX.Element;
  /** Staff only: the extra cell at the end of each row. */
  extra?: (match: Match) => JSX.Element;
  /** The public page: a Status column saying which tables are still playing, on desktop. */
  status?: boolean;
  /** Players picked for a swap, drawn as selected. */
  selected?: ReadonlySet<string>;
  /** The result waiting for staff to confirm it, previewed in its row. */
  confirming?: { table: number; p1: string; outcome: Outcome } | null;
}

const winnerOutcome = (seat: 1 | 2): Outcome => (seat === 1 ? 'p1' : 'p2');

const isConfirming = (props: MatchTableProps, match: Match) =>
  props.confirming?.table === match.table && props.confirming.p1 === match.p1;

function SeatCell(props: MatchTableProps & { match: Match; seat: 1 | 2; records: Map<string, string> }) {
  const id = () => (props.seat === 1 ? props.match.p1 : props.match.p2);
  const shown = () => {
    const preview = isConfirming(props, props.match) ? props.confirming : null;
    return preview
      ? { outcome: preview.outcome, unconfirmed: true }
      : shownOutcome(props.match, props.pod, props.round, props.pending);
  };
  const mark = () => seatMark(shown().outcome, props.seat);
  const name = (playerId: string) => props.names.get(playerId) ?? playerId;
  const content = (playerId: string) => (
    <>
      <DeckIcons label={props.decks[playerId]} />
      <span class='tm-name'>{name(playerId)}</span>
      <Show when={props.status && playerId === props.me}>
        <span class='tm-flag is-you'>You</span>
      </Show>
      <span class='muted-cell tm-record'>{props.records.get(playerId) ?? ''}</span>
    </>
  );
  const reportable = () => props.onReport && props.match.p2 !== null;
  return (
    <td class='tm-seat' classList={{ 'is-selected': props.selected?.has(id() ?? '') }}>
      <Show
        when={id()}
        fallback={<span class='muted-cell'>{props.match.outcome === 'bye' ? 'Bye' : 'Missed round'}</span>}
      >
        {playerId => (
          <span class='tm-seat-inner'>
            <span class='tm-mark' classList={{ 'is-win': mark() === 'W', 'is-unconfirmed': shown().unconfirmed }}>
              {mark()}
              <Show when={mark() && shown().unconfirmed}>
                <span class='sr-only'> (not yet confirmed)</span>
              </Show>
            </span>
            <Switch
              fallback={
                <button type='button' class='tm-seat-link' onClick={() => props.onPlayer?.(playerId())}>
                  {content(playerId())}
                </button>
              }
            >
              <When when={props.deckPicker}>
                {picker => (
                  <span class='tm-seat-deck'>
                    <span class='tm-name'>{name(playerId())}</span>
                    {picker()(playerId())}
                  </span>
                )}
              </When>
              <When when={reportable()}>
                <button
                  type='button'
                  class='tm-seat-link'
                  classList={{ 'is-winner': mark() === 'W' }}
                  aria-label={`Report ${name(playerId())} as the winner`}
                  onClick={() => props.onReport?.(props.match, winnerOutcome(props.seat))}
                  onDblClick={() => props.onRecord?.(props.match, winnerOutcome(props.seat))}
                >
                  {content(playerId())}
                </button>
              </When>
            </Switch>
          </span>
        )}
      </Show>
    </td>
  );
}

/**
 * Whether a table is still playing, for whoever is watching the room: the
 * marks beside the names already say who won. A bye or a missed round has
 * nothing to play.
 */
function StatusCell(props: MatchTableProps & { match: Match }) {
  const outcome = () => shownOutcome(props.match, props.pod, props.round, props.pending).outcome;
  return (
    <td class='tm-status-col'>
      <Show when={props.match.p2 !== null}>
        <Show when={outcome() === 'pending'} fallback={<span class='muted-cell'>Done</span>}>
          <strong>Playing</strong>
        </Show>
      </Show>
    </td>
  );
}

export function MatchTable(props: MatchTableProps) {
  const records = () => recordsBefore(props.pod, props.round);
  const hasDecks = () => Object.keys(props.decks).length > 0;
  const mine = (match: Match) => props.me != null && (match.p1 === props.me || match.p2 === props.me);
  return (
    <div class='table-wrap tm-matches' classList={{ 'has-extra': Boolean(props.extra), 'has-decks': hasDecks() }}>
      <table class='data'>
        <thead>
          <tr>
            <th class='num tm-table-col'>Table</th>
            <th>Player</th>
            <th>Opponent</th>
            <Show when={props.extra}>
              <th class='tm-extra-col'>Result</th>
            </Show>
            <Show when={props.status && !props.extra}>
              <th class='tm-status-col'>Status</th>
            </Show>
          </tr>
        </thead>
        <tbody>
          <For each={sortMatches(props.matches)}>
            {match => (
              <tr classList={{ 'is-me': mine(match), 'is-confirming': isConfirming(props, match) }}>
                <td class='num muted-cell tm-table-col'>{match.table || '—'}</td>
                <SeatCell {...props} match={match} seat={1} records={records()} />
                <SeatCell {...props} match={match} seat={2} records={records()} />
                <Show when={props.extra}>{extra => <td class='tm-extra-col'>{extra()(match)}</td>}</Show>
                <Show when={props.status && !props.extra}>
                  <StatusCell {...props} match={match} />
                </Show>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
