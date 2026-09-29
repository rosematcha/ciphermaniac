import { createSignal, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { getArchetypeIconMap, normalizeArchetypeKey, resolveArchetypeIcons } from '../../lib/data';

/**
 * Sprites for archetypes the site's own icon map does not name, as a past
 * format's archetypes give them (see deckOptions). Learned once the format's
 * list loads, so every name on the page draws the sprites it was picked with.
 */
const [learned, setLearned] = createSignal(new Map<string, string[]>());

export function learnDeckIcons(decks: readonly { label: string; icons?: string[] }[]): void {
  const next = new Map(learned());
  for (const deck of decks) {
    if (deck.icons?.length) {
      next.set(normalizeArchetypeKey(deck.label), deck.icons);
    }
  }
  setLearned(next);
}

/** A player's archetype the way the site writes one: its sprites, the name kept for assistive tech. */
export function DeckIcons(props: { label: string | undefined; size?: number }) {
  const slugs = (label: string) =>
    learned().get(normalizeArchetypeKey(label)) ?? resolveArchetypeIcons({ label }, getArchetypeIconMap());
  return (
    <Show when={props.label}>
      {label => (
        <span class='tm-deck' title={label()}>
          <ArchetypeIcons slugs={slugs(label())} size={props.size ?? 20} />
          <span class='sr-only'>{label()}</span>
        </span>
      )}
    </Show>
  );
}
