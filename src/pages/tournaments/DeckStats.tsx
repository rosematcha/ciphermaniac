/**
 * What the field is playing and how each deck has done: players on it, their
 * share of the field, and match win rate with ties counted as half.
 */

import { For, Show } from 'solid-js';
import type { Tournament } from '../../../shared/tournament/types';
import { deckBreakdown } from '../../lib/tournament/present';
import { DeckIcons } from './DeckIcons';

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function DeckStats(props: { tournament: Tournament; decks: Record<string, string> }) {
  const rows = () => deckBreakdown(props.tournament, props.decks);
  const total = () => props.tournament.players.length || 1;
  return (
    <Show when={rows().length} fallback={<p class='muted'>No decks to show yet.</p>}>
      <div class='table-wrap'>
        <table class='data'>
          <thead>
            <tr>
              <th>Deck</th>
              <th class='num'>Players</th>
              <th class='num'>Share</th>
              <th class='num'>Win rate</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {row => (
                <tr>
                  <td>
                    <span class='tm-seat-inner'>
                      <DeckIcons label={row.label} />
                      <span>{row.label}</span>
                    </span>
                  </td>
                  <td class='num'>{row.players}</td>
                  <td class='num'>
                    <span class='tm-share'>
                      <span class='tm-bar' aria-hidden='true'>
                        <span class='tm-bar-fill' style={{ width: percent(row.players / total()) }} />
                      </span>
                      {percent(row.players / total())}
                    </span>
                  </td>
                  <td class='num'>{row.winRate === null ? '—' : percent(row.winRate)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  );
}
