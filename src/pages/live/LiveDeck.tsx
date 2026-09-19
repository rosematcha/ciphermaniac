import { createMemo, createSignal, For, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { getArchetypeIconMap, resolveArchetypeIcons } from '../../lib/data';
import type { ArchetypeIndexEntry } from '../../types';

/** A reported archetype: its sprites, and its name unless the cell is too tight for one. */
export function LiveDeck(props: { entry: ArchetypeIndexEntry; iconsOnly?: boolean }) {
  const slugs = () => resolveArchetypeIcons(props.entry, getArchetypeIconMap());
  return (
    <span class='round-deck' title={props.iconsOnly ? props.entry.label : undefined}>
      <ArchetypeIcons slugs={slugs()} size={16} />
      <Show when={!props.iconsOnly}>
        <span>{props.entry.label}</span>
      </Show>
    </span>
  );
}

/**
 * Picks the deck a player is on from the archetype index, most played first.
 * A native select: thirty-odd options need no typeahead, and phones get their
 * own picker for free.
 */
export function DeckReporter(props: {
  archetypes: readonly ArchetypeIndexEntry[];
  onReport: (archetype: string) => Promise<void>;
}) {
  const [state, setState] = createSignal<'idle' | 'sending' | 'failed'>('idle');
  const options = createMemo(() => [...props.archetypes].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0)));
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
      <For each={options()}>{entry => <option value={entry.name}>{entry.label}</option>}</For>
    </select>
  );
}
