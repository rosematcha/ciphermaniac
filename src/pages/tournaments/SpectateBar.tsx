/**
 * What a spectator narrows the pairings to: every table, the ones still
 * playing, or the players they follow (once they follow anyone, from a
 * player's sheet), and where decks are public, one archetype.
 */

import { For, Show } from 'solid-js';
import { Segmented } from '../../components/Segmented';
import type { Showing, SpectateFilter } from '../../lib/tournament/spectate';

export function SpectateBar(props: {
  filter: SpectateFilter;
  /** The archetypes played this round, most played first. */
  decks: readonly string[];
  following: number;
  onFilter: (filter: SpectateFilter) => void;
}) {
  const options = () => [
    { value: 'all' as const, label: 'All' },
    { value: 'playing' as const, label: 'In progress' },
    ...(props.following > 0 ? [{ value: 'following' as const, label: `Following ${props.following}` }] : [])
  ];
  return (
    <div class='tm-box-bar tm-spectate'>
      <Segmented
        options={options()}
        selected={props.filter.showing}
        onSelect={(showing: Showing) => props.onFilter({ ...props.filter, showing })}
        ariaLabel='Show tables'
      />
      <Show when={props.decks.length > 0}>
        <select
          class='tm-select'
          aria-label='Deck'
          onChange={e => props.onFilter({ ...props.filter, deck: e.currentTarget.value || null })}
        >
          <option value='' selected={props.filter.deck === null}>
            All decks
          </option>
          <For each={props.decks}>
            {deck => (
              <option value={deck} selected={props.filter.deck === deck}>
                {deck}
              </option>
            )}
          </For>
        </select>
      </Show>
    </div>
  );
}
