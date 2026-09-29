/**
 * Staff naming the archetype a player is on, from the Players tab or a
 * pairing: the event format's archetypes (see deckOptions), a name typed in
 * where the list has none, and Clear once one is set.
 */

import { createSignal, Show } from 'solid-js';
import { createDeckOptions } from './deckOptions';
import { SETTINGS_LIMITS } from '../../../shared/tournament/view';
import { type Manage, setDeck } from '../../lib/tournament/api';
import { DeckCombo, type ReportedDeck } from '../live/LiveDeck';
import { ErrorLine } from './Field';
import type { ManageState } from './manageState';

export function DeckPicker(props: {
  state: ManageState;
  manage: Manage;
  playerId: string;
  decks: readonly ReportedDeck[];
}) {
  const [error, setError] = createSignal<string | null>(null);
  const label = () => props.manage.decks[props.playerId];
  // The list's own entry, so the box draws its sprites and marks its row.
  const selected = () => {
    const current = label();
    return current ? (props.decks.find(deck => deck.label === current) ?? { label: current }) : undefined;
  };
  async function pick(archetype: string | null) {
    setError(null);
    const { code } = props.manage;
    const id = props.playerId;
    if (!(await props.state.run(() => setDeck(code, id, archetype)))) {
      setError('Could not save the deck');
    }
  }
  return (
    <>
      {/* live-deck-picker: the shared sprite treatment for the list and field (components.css). */}
      <span class='tm-deck-pick live-deck-picker'>
        <DeckCombo
          decks={props.decks}
          selected={selected()}
          placeholder='Deck'
          custom={SETTINGS_LIMITS.archetype}
          onPick={deck => void pick(deck.label)}
        />
        <Show when={label()} fallback={<span />}>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => void pick(null)}>
            Clear
          </button>
        </Show>
      </span>
      <ErrorLine message={error()} />
    </>
  );
}

/** The picker with its own list of the event's decks, for a seat in the pairings. */
export function EventDeckPicker(props: { state: ManageState; manage: Manage; playerId: string }) {
  const decks = createDeckOptions(
    () => props.manage.settings.format,
    () => Object.values(props.manage.decks)
  );
  return <DeckPicker state={props.state} manage={props.manage} playerId={props.playerId} decks={decks()} />;
}
