/**
 * A pod's standings, one box per division when the pod plays several
 * together: place, player (sprites, and the deck under the name), record and
 * points. Staff, who seed a cut from them, also get OWP and OOWP
 * (`tiebreakers`); players read those in a player's sheet.
 *
 * A line marks the top cut. For staff it says what split the last player in
 * from the first one out, since that is the question at the cut. Once the
 * top cut is under way, the console can hold back the cut players' decks
 * (`hideCutDecks`) until the event ends, unless the event shows archetypes
 * to everyone; one note says so rather than every row.
 */

import { For, type JSX, Show } from 'solid-js';
import { percentLabel, recordLabel, type Standing } from '../../../shared/tournament/standings';
import type { Division, Pod, Tournament } from '../../../shared/tournament/types';
import { recommendedStructure } from '../../../shared/tournament/structure';
import { cutSplit, divisionHeading, podStandings } from '../../lib/tournament/present';
import { DeckIcons } from './DeckIcons';

interface TableProps {
  tournament: Tournament;
  pod: Pod;
  names: Map<string, string>;
  decks: Record<string, string>;
  divisionOf: (id: string) => Division;
  me?: string | null;
  query?: string;
  onPlayer?: (id: string) => void;
  /** Show OWP and OOWP as columns, and what split the cut. */
  tiebreakers?: boolean;
  /** Hold back the decks of the players in a cut already under way. */
  hideCutDecks?: boolean;
  /**
   * The public page's division switch and search: in the box's bar when there
   * is one box, or in a bar of its own above them all when there are several,
   * since it narrows every one of them.
   */
  bar?: JSX.Element;
  /** A muted line at the foot of each box. */
  note?: string | undefined;
}

export function StandingsTable(props: TableProps) {
  const groups = () => podStandings(props.tournament, props.pod, props.divisionOf);
  const hasDecks = () => Object.keys(props.decks).length > 0;
  const matches = (id: string) =>
    !props.query?.trim() || (props.names.get(id) ?? '').toLowerCase().includes(props.query.trim().toLowerCase());
  /**
   * The cut this division plays to: the one set, or before it is, the one its
   * attendance calls for while enough are still in, as the console offers it
   * (see divisionCuts).
   */
  const cutOf = (rows: readonly Standing[]) => {
    const { cut } = recommendedStructure(rows.length);
    return props.pod.cut || (cut <= rows.filter(row => !row.dropped).length ? cut : 0);
  };
  const cutStarted = () => props.pod.rounds.some(round => round.kind === 'elimination');
  const colspan = () => (props.tiebreakers ? 6 : 4);
  const several = () => groups().length > 1;
  return (
    <>
      <Show when={several() && props.bar}>
        <div class='tm-standings-bar'>{props.bar}</div>
      </Show>
      <For each={groups()}>
        {(group, index) => {
          const cut = () => cutOf(group.rows);
          const hidden = (row: Standing) => Boolean(props.hideCutDecks) && cutStarted() && row.place <= cut();
          const split = () => (props.tiebreakers && !cutStarted() ? cutSplit(group.rows, cut()) : null);
          return (
            <section class='tm-standings' classList={{ 'has-decks': hasDecks() }}>
              <Show when={group.division}>
                <h2 class='tm-subhead'>{divisionHeading(group.division)}</h2>
              </Show>
              <div class='tm-box'>
                <Show when={index() === 0 && !several() && props.bar}>
                  <div class='tm-box-bar'>{props.bar}</div>
                </Show>
                <Show when={props.hideCutDecks && cutStarted() && cut() > 0}>
                  <div class='tm-box-bar'>
                    <span class='muted'>Top {cut()} decks hidden until the event ends</span>
                  </div>
                </Show>
                <div class='table-wrap'>
                  <table class='data'>
                    <thead>
                      <tr>
                        <th class='num tm-table-col'>#</th>
                        <th>Player</th>
                        <th class='num'>Record</th>
                        <th class='num'>Pts</th>
                        <Show when={props.tiebreakers}>
                          <th class='num tm-wide-col'>OWP</th>
                          <th class='num tm-wide-col'>OOWP</th>
                        </Show>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={group.rows.filter(row => matches(row.playerId))}>
                        {row => (
                          <>
                            <tr classList={{ 'is-me': row.playerId === props.me, 'is-in': row.place <= cut() }}>
                              <td class='num tm-table-col tm-place'>{row.place}</td>
                              <td>
                                <button
                                  type='button'
                                  class='tm-seat-link'
                                  onClick={() => props.onPlayer?.(row.playerId)}
                                >
                                  <DeckIcons label={hidden(row) ? undefined : props.decks[row.playerId]} />
                                  <span class='tm-who'>
                                    <span class='tm-who-name'>
                                      <span class='tm-name'>{props.names.get(row.playerId) ?? row.playerId}</span>
                                      <Show when={row.dropped}>
                                        <span class='tm-flag'>Dropped</span>
                                      </Show>
                                    </span>
                                    <Show when={hasDecks() && !hidden(row)}>
                                      <span class='tm-who-sub'>{props.decks[row.playerId] ?? 'No deck'}</span>
                                    </Show>
                                  </span>
                                </button>
                              </td>
                              <td class='num'>{recordLabel(row.record)}</td>
                              <td class='num tm-points'>{row.points}</td>
                              <Show when={props.tiebreakers}>
                                <td class='num muted-cell tm-wide-col'>{percentLabel(row.owp)}</td>
                                <td class='num muted-cell tm-wide-col'>{percentLabel(row.oowp)}</td>
                              </Show>
                            </tr>
                            <Show when={row.place === cut() && group.rows.length > cut() && !props.query?.trim()}>
                              <tr class='tm-cut-line'>
                                <td colSpan={colspan()}>
                                  <span class='tm-cut-top'>Top {cut()}</span>
                                  <Show when={split()}>{text => <span class='muted'>{text()}</span>}</Show>
                                </td>
                              </tr>
                            </Show>
                          </>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
                <Show when={props.note}>
                  <p class='tm-box-bar tm-box-note muted'>{props.note}</p>
                </Show>
              </div>
            </section>
          );
        }}
      </For>
    </>
  );
}
