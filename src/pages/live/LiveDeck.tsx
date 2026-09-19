import { createSignal, For, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { getArchetypeIconMap, resolveArchetypeIcons } from '../../lib/data';

/** A reported archetype, by label, with the index's own icons when it has an entry there. */
export interface ReportedDeck {
  label: string;
  icons?: string[];
}

/** A reported archetype: its sprites, and its name unless the cell is too tight for one. */
export function LiveDeck(props: { deck: ReportedDeck; iconsOnly?: boolean }) {
  const slugs = () => resolveArchetypeIcons(props.deck, getArchetypeIconMap());
  return (
    <span class='round-deck' title={props.iconsOnly ? props.deck.label : undefined}>
      <ArchetypeIcons slugs={slugs()} size={16} />
      <Show when={!props.iconsOnly || slugs().length === 0}>
        <span>{props.deck.label}</span>
      </Show>
    </span>
  );
}

/**
 * Picks the deck a player is on: the online meta's archetypes first, most
 * played first, then every other archetype the site names. A native select, so
 * typing jumps to a name and phones get their own picker.
 */
export function DeckReporter(props: {
  /** Labels, in the order to offer them; the first `leading` are the online meta's. */
  labels: readonly string[];
  leading: number;
  onReport: (archetype: string) => Promise<void>;
}) {
  const [state, setState] = createSignal<'idle' | 'sending' | 'failed'>('idle');
  let select: HTMLSelectElement | undefined;
  const report = async (archetype: string) => {
    setState('sending');
    try {
      await props.onReport(archetype);
      setState('idle');
    } catch {
      setState('failed');
    }
  };
  return (
    <select
      ref={select}
      class='fb-select live-deck-select'
      aria-label='Report deck'
      disabled={state() === 'sending'}
      onChange={() => {
        const value = select?.value;
        if (select && value) {
          // Back to the prompt: the pick shows beside the name, not in the control.
          select.value = '';
          void report(value);
        }
      }}
    >
      <option value=''>{state() === 'failed' ? 'Report failed, try again' : 'Report deck...'}</option>
      <optgroup label='Online meta'>
        <For each={props.labels.slice(0, props.leading)}>{label => <option value={label}>{label}</option>}</For>
      </optgroup>
      <optgroup label='Everything else'>
        <For each={props.labels.slice(props.leading)}>{label => <option value={label}>{label}</option>}</For>
      </optgroup>
    </select>
  );
}
