/**
 * One table for a stream (`/t/:code?stream=table&table=N`, with `&pod=` to
 * pick a division where several play): the two players with their decks and
 * records, the round and its clock, and once the table is done, who won. Its
 * page is transparent around one bar, so a browser source in OBS lays it over
 * the game as it is; it follows the table into each new round on its own.
 */

import { createMemo, onCleanup, onMount, Show } from 'solid-js';
import type { PodCategory, Round } from '../../../shared/tournament/types';
import type { TournamentView } from '../../../shared/tournament/view';
import { cutSeeds } from '../../lib/tournament/bracket';
import { namesById, recordsBefore, roundLabel, seatMark, shownOutcome } from '../../lib/tournament/present';
import { streamDecks, streamTable } from '../../lib/tournament/spectate';
import { withSwiss } from '../../../shared/tournament/rounds';
import { Clock } from './Clock';
import { DeckIcons } from './DeckIcons';
import '../../styles/pages/tournament-stream.css';

const MARK_WORDS: Record<string, string> = { W: 'Won', L: 'Lost', T: 'Tie' };

function StreamSeat(props: {
  name: string;
  deck: string | undefined;
  record: string;
  seed: number | undefined;
  mark: string;
  side: 'left' | 'right';
}) {
  return (
    <div
      class={`tm-stream-seat is-${props.side}`}
      classList={{ 'is-win': props.mark === 'W', 'is-out': props.mark === 'L' }}
    >
      <DeckIcons label={props.deck} size={36} />
      <div class='tm-stream-who'>
        <span class='tm-stream-name'>
          <Show when={props.seed}>{seed => <small class='num'>{seed()}</small>}</Show>
          {props.name}
        </span>
        <span class='tm-stream-detail num'>{[props.record, props.deck].filter(Boolean).join(' · ')}</span>
      </div>
      <Show when={props.mark}>
        {mark => (
          <span class='tm-stream-mark' aria-label={MARK_WORDS[mark()]}>
            {mark()}
          </span>
        )}
      </Show>
    </div>
  );
}

export function StreamOverlay(props: { view: TournamentView; table: number; pod?: PodCategory }) {
  onMount(() => {
    document.body.classList.add('tm-stream-mode');
    onCleanup(() => document.body.classList.remove('tm-stream-mode'));
  });
  const shown = createMemo(() => streamTable(props.view.tournament, props.table, props.pod));
  const names = createMemo(() => namesById(props.view.tournament));
  const decks = createMemo(() => streamDecks(props.view));
  return (
    <div class='tm-stream'>
      <Show
        when={shown()}
        fallback={
          <div class='tm-stream-bar is-empty'>
            <span>Table {props.table} is not in play</span>
          </div>
        }
      >
        {table => {
          const played = () => withSwiss(props.view.tournament, table().pod);
          const records = () => recordsBefore(played(), table().round);
          const seeds = () =>
            table().round.kind === 'elimination' ? cutSeeds(props.view.tournament, table().pod) : new Map();
          const outcome = () => shownOutcome(table().match, table().pod, table().round, props.view.pending).outcome;
          const mark = (seat: 1 | 2) => (table().match.p2 === null ? '' : seatMark(outcome(), seat));
          const seat = (id: string | null, side: 'left' | 'right') => (
            <StreamSeat
              name={id ? (names().get(id) ?? id) : 'Bye'}
              deck={id ? decks()[id] : undefined}
              record={id ? (records().get(id) ?? '') : ''}
              seed={id ? seeds().get(id) : undefined}
              mark={mark(side === 'left' ? 1 : 2)}
              side={side}
            />
          );
          return (
            <div class='tm-stream-bar'>
              {seat(table().match.p1, 'left')}
              <div class='tm-stream-mid'>
                <span class='tm-stream-round'>{roundLabel(table().round, table().pod)}</span>
                <span class='tm-stream-table num'>Table {props.table}</span>
                <Show when={!props.view.settings.finished}>
                  <Clock round={table().round as Round} class='tm-stream-clock' />
                </Show>
              </div>
              {seat(table().match.p2, 'right')}
            </div>
          );
        }}
      </Show>
    </div>
  );
}
