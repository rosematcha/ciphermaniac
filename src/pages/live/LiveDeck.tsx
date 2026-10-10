import { createSignal, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { Combo, splitMatch } from '../../components/Combo';
import { deckIcons, loadedSpecies } from '../../lib/deckIcons';
import { pairSearch } from './deckPairs';
import type { ReportedDeck } from './reportedDeck';

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
 * the icon map under a rule. Once one Pokémon's whole name and a space are
 * typed, the rest of the query names a second (see pairSearch).
 */
export function DeckCombo(props: {
  decks: readonly ReportedDeck[];
  /** The deck the box stands for while it is not being typed in. */
  selected?: ReportedDeck;
  placeholder: string;
  width?: string;
  /** Whether a name the list lacks can be typed in and picked as it is, up to `custom` characters. */
  custom?: number;
  onPick: (deck: ReportedDeck) => void;
}) {
  const create = () => {
    const max = props.custom;
    return max ? (query: string) => ({ label: query.trim().slice(0, max), custom: true }) : undefined;
  };
  const weight = (deck: ReportedDeck) => deck.percent ?? 0;
  const tier = (deck: ReportedDeck) => (deck.custom ? 2 : deck.played ? 0 : 1);
  const search = (query: string) => {
    const species = loadedSpecies();
    return species ? pairSearch(props.decks, query, species, { weight, tier }) : undefined;
  };
  return (
    <Combo<ReportedDeck>
      placeholder={props.placeholder}
      options={props.decks}
      browse={props.decks.filter(deck => deck.played)}
      label={deck => deck.label}
      weight={weight}
      tier={tier}
      search={search}
      selected={props.selected}
      adorn={deck => <ArchetypeIcons slugs={deckIcons(deck)} size={20} />}
      onPick={deck => props.onPick(deck.pair ? { label: deck.pair } : deck)}
      create={create()}
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
        <Show when={!props.deck.custom} fallback='Custom'>
          <Show when={props.deck.percent}>{share => `${Math.round(share())}%`}</Show>
        </Show>
      </span>
    </>
  );
}
