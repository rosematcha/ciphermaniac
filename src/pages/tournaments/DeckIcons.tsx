import { Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { getArchetypeIconMap, resolveArchetypeIcons } from '../../lib/data';

/** A player's archetype the way the site writes one: its sprites, the name kept for assistive tech. */
export function DeckIcons(props: { label: string | undefined; size?: number }) {
  return (
    <Show when={props.label}>
      {label => (
        <span class='tm-deck' title={label()}>
          <ArchetypeIcons
            slugs={resolveArchetypeIcons({ label: label() }, getArchetypeIconMap())}
            size={props.size ?? 20}
          />
          <span class='sr-only'>{label()}</span>
        </span>
      )}
    </Show>
  );
}
