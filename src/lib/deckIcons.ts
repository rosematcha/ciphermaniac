/**
 * A reported deck's sprites, wherever one is drawn, and every Pokémon a deck
 * can be named for. The Pokémon are a chunk of their own, loaded the first time
 * a deck list or a deck the icon map does not know asks for them, so a page
 * whose decks are all in the icon map never pays for them.
 * @module src/lib/deckIcons
 */

import { createSignal } from 'solid-js';
import { getArchetypeIconMap, resolveArchetypeIcons } from './data';

type Species = typeof import('../../shared/pokemon/species');

const [species, setSpecies] = createSignal<Species>();
let loading: Promise<Species> | null = null;

/** Every Pokémon a deck can be named for, loaded once a page. */
export function loadSpecies(): Promise<Species> {
  loading ??= import('../../shared/pokemon/species').then(module => {
    setSpecies(() => module);
    return module;
  });
  return loading;
}

/**
 * The deck's own sprites, the icon map's, or, for a deck named for one Pokémon
 * alone, that Pokémon's, drawn once the Pokémon have loaded.
 */
export function deckIcons(deck: { label: string; icons?: string[] }): string[] {
  const icons = resolveArchetypeIcons(deck, getArchetypeIconMap());
  if (icons.length > 0) {
    return icons;
  }
  const known = species();
  if (!known) {
    // A chunk that fails to load leaves the deck without a sprite, as before there were any.
    loadSpecies().catch(() => undefined);
    return [];
  }
  return known.speciesIcons(deck.label);
}
