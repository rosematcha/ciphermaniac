/**
 * A pod's standings, one table per division when the pod plays several
 * together: place, player, record and points. Players read the tiebreaker
 * percentages in a player's sheet; staff, who seed a cut from them and have no
 * sheet, get them as columns (`tiebreakers`).
 */

import { For, Show } from 'solid-js';
import { percentLabel, recordLabel } from '../../../shared/tournament/standings';
import type { Division, Pod, Tournament } from '../../../shared/tournament/types';
import { divisionHeading, podStandings } from '../../lib/tournament/present';
import { DeckIcons } from './DeckIcons';

export function StandingsTable(props: {
  tournament: Tournament;
  pod: Pod;
  names: Map<string, string>;
  decks: Record<string, string>;
  divisionOf: (id: string) => Division;
  me?: string | null;
  query?: string;
  onPlayer?: (id: string) => void;
  /** Show OWP and OOWP as columns. */
  tiebreakers?: boolean;
}) {
  const groups = () => podStandings(props.tournament, props.pod, props.divisionOf);
  const matches = (id: string) =>
    !props.query?.trim() || (props.names.get(id) ?? '').toLowerCase().includes(props.query.trim().toLowerCase());
  return (
    <For each={groups()}>
      {group => (
        <section class='tm-standings' classList={{ 'has-decks': Object.keys(props.decks).length > 0 }}>
          <Show when={group.division}>
            <h2 class='tm-subhead'>{divisionHeading(group.division)}</h2>
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
                    <tr classList={{ 'is-me': row.playerId === props.me }}>
                      <td class='num muted-cell tm-table-col'>{row.place}</td>
                      <td>
                        <button type='button' class='tm-seat-link' onClick={() => props.onPlayer?.(row.playerId)}>
                          <DeckIcons label={props.decks[row.playerId]} />
                          <span class='tm-name'>{props.names.get(row.playerId) ?? row.playerId}</span>
                          <Show when={row.dropped}>
                            <span class='muted-cell tm-flag'>Dropped</span>
                          </Show>
                        </button>
                      </td>
                      <td class='num'>{recordLabel(row.record)}</td>
                      <td class='num'>{row.points}</td>
                      <Show when={props.tiebreakers}>
                        <td class='num muted-cell tm-wide-col'>{percentLabel(row.owp)}</td>
                        <td class='num muted-cell tm-wide-col'>{percentLabel(row.oowp)}</td>
                      </Show>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </For>
  );
}
