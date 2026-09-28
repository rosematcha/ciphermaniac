/**
 * What the field is playing and how each deck has done: players on it, their
 * share of the field, and match win rate with ties counted as half. The match
 * count sits beside the rate, so one lucky match does not read as a 100% deck.
 */

import { A } from '@solidjs/router';
import { For, Show } from 'solid-js';
import type { Tournament } from '../../../shared/tournament/types';
import { deckBreakdown } from '../../lib/tournament/present';
import { DeckIcons } from './DeckIcons';

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** The site's archetype page for a label: the index names archetypes with underscores for spaces. */
const archetypeHref = (label: string) => `/archetypes/${encodeURIComponent(label.replace(/ /g, '_'))}`;

export function DeckStats(props: { tournament: Tournament; decks: Record<string, string> }) {
  const rows = () => deckBreakdown(props.tournament, props.decks);
  const total = () => props.tournament.players.length || 1;
  return (
    <Show when={rows().length} fallback={<p class='muted tm-empty'>No decks to show yet.</p>}>
      <div class='table-wrap tm-deck-stats'>
        <table class='data'>
          <thead>
            <tr>
              <th>Deck</th>
              <th class='num'>Players</th>
              <th class='num tm-share-col'>Share</th>
              <th class='num'>Matches</th>
              <th class='num'>Win rate</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {row => (
                <tr>
                  <td>
                    <A class='tm-seat-inner tm-deck-link' href={archetypeHref(row.label)}>
                      <DeckIcons label={row.label} />
                      <span>{row.label}</span>
                    </A>
                  </td>
                  <td class='num'>{row.players}</td>
                  <td class='num tm-share-col'>
                    <span class='tm-share'>
                      <span class='tm-bar' aria-hidden='true'>
                        <span class='tm-bar-fill' style={{ width: percent(row.players / total()) }} />
                      </span>
                      <span class='tm-share-value'>{percent(row.players / total())}</span>
                    </span>
                  </td>
                  <td class='num muted-cell'>{row.matches}</td>
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
