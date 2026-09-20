import { createSignal, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { Combo, splitMatch } from '../../components/Combo';
import { getArchetypeIconMap, resolveArchetypeIcons } from '../../lib/data';

/** An archetype a report can name, by label, with the index's own icons when it has an entry there. */
export interface ReportedDeck {
  label: string;
  icons?: string[];
  /** Share of the online meta, 0 to 100, for the decks that have one. */
  percent?: number | null;
  /**
   * Whether anyone is on this deck now: it is in the online meta, or someone
   * at this event has been reported on it. The rest of the icon map is every
   * archetype of the last two years, so without this the box offers a decade
   * of dead decks on the same footing as the twelve in the room.
   */
  played?: boolean;
}

export function deckIcons(deck: ReportedDeck): string[] {
  return resolveArchetypeIcons(deck, getArchetypeIconMap());
}

/** A reported archetype the way the rest of the site writes one: sprites, then the name. */
export function LiveDeck(props: { deck: ReportedDeck; class?: string }) {
  return (
    <span class={`arche-name-cell live-deck ${props.class ?? ''}`}>
      <ArchetypeIcons slugs={deckIcons(props.deck)} size={20} />
      <span>{props.deck.label}</span>
    </span>
  );
}

/**
 * The deck typeahead, wherever a deck is named: sprites in the field and in the
 * list, what the format is playing browsable and ranked first, the long tail of
 * the icon map under a rule.
 */
export function DeckCombo(props: {
  decks: readonly ReportedDeck[];
  /** The deck the box stands for while it is not being typed in. */
  selected?: ReportedDeck;
  placeholder: string;
  width?: string;
  onPick: (deck: ReportedDeck) => void;
}) {
  return (
    <Combo<ReportedDeck>
      placeholder={props.placeholder}
      options={props.decks}
      browse={props.decks.filter(deck => deck.played)}
      label={deck => deck.label}
      weight={deck => deck.percent ?? 0}
      tier={deck => (deck.played ? 0 : 1)}
      selected={props.selected}
      adorn={deck => <ArchetypeIcons slugs={deckIcons(deck)} size={20} />}
      onPick={props.onPick}
      width={props.width}
    >
      {(deck, query) => <DeckOption deck={deck} query={query} />}
    </Combo>
  );
}

/**
 * This device's report for a player. Idle, the box stands for the deck you
 * reported, sprites and all; focused, it is a search over every archetype the
 * site names, the decks in play offered first. A pick is only sent once it is
 * confirmed, since the row under a finger is not always the row meant, and a
 * report can be changed or taken back afterwards.
 */
export function DeckReporter(props: {
  decks: readonly ReportedDeck[];
  /** What this device has reported for the player, if anything. */
  mine?: ReportedDeck;
  onReport: (archetype: string | null) => Promise<void>;
}) {
  const [pending, setPending] = createSignal<ReportedDeck>();
  const [state, setState] = createSignal<'idle' | 'sending' | 'failed'>('idle');
  // The list's own object, so the box can mark the row it stands for.
  const selected = () => props.decks.find(deck => deck.label === props.mine?.label) ?? props.mine;
  const send = async (archetype: string | null) => {
    setState('sending');
    try {
      await props.onReport(archetype);
      setPending(undefined);
      setState('idle');
    } catch {
      setState('failed');
    }
  };
  return (
    <span class='live-deck-picker'>
      <Show
        when={pending()}
        fallback={
          <>
            <DeckCombo
              placeholder={state() === 'failed' ? 'Report failed, try again' : 'Report deck...'}
              decks={props.decks}
              selected={selected()}
              onPick={setPending}
            />
            <Show when={props.mine}>
              <button
                type='button'
                class='btn btn-secondary'
                disabled={state() === 'sending'}
                onClick={() => void send(null)}
              >
                Remove
              </button>
            </Show>
          </>
        }
      >
        {deck => (
          <>
            <LiveDeck deck={deck()} />
            <button
              type='button'
              class='btn btn-primary'
              disabled={state() === 'sending'}
              onClick={() => void send(deck().label)}
            >
              {state() === 'failed' ? 'Try again' : 'Report'}
            </button>
            <button type='button' class='btn btn-secondary' onClick={() => setPending(undefined)}>
              Cancel
            </button>
          </>
        )}
      </Show>
    </span>
  );
}

function DeckOption(props: { deck: ReportedDeck; query: string }) {
  const parts = () => splitMatch(props.deck.label, props.query);
  return (
    <>
      <ArchetypeIcons slugs={deckIcons(props.deck)} size={26} reserveSlot />
      <b>
        {parts()[0]}
        <mark>{parts()[1]}</mark>
        {parts()[2]}
      </b>
      <span>
        <Show when={props.deck.percent}>{share => `${Math.round(share())}%`}</Show>
      </span>
    </>
  );
}
