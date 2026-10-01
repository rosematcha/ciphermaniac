/**
 * Every Pokémon as a deck can be named for it, with its sprite: the species of
 * the National Dex, and the Mega and regional forms cards are printed as. The
 * archetype lists only name decks someone has already played, so the niche
 * deck nobody has (Tyrantrum, say) takes its name and sprite from here.
 *
 * Names follow the icon map's (Hisuian Arcanine, Mega Charizard X), so a
 * species it already names is the same deck under the same label.
 * @module shared/pokemon/species
 */

import SPRITES from './sprites.json';
import { normalizeForLookup } from '../data/archetypes/identity';

/**
 * Names a slug cannot spell by capitalising its words. Each is a species even
 * where the slug reads as a form of another (Porygon-Z).
 */
const NAMES: Record<string, string> = {
  'nidoran-f': 'Nidoran ♀',
  'nidoran-m': 'Nidoran ♂',
  farfetchd: "Farfetch'd",
  'mr-mime': 'Mr. Mime',
  'porygon-z': 'Porygon-Z',
  'ho-oh': 'Ho-Oh',
  'mime-jr': 'Mime Jr.',
  flabebe: 'Flabébé',
  'type-null': 'Type: Null',
  'jangmo-o': 'Jangmo-o',
  'hakamo-o': 'Hakamo-o',
  'kommo-o': 'Kommo-o',
  sirfetchd: "Sirfetch'd",
  'mr-rime': 'Mr. Rime',
  'wo-chien': 'Wo-Chien',
  'chien-pao': 'Chien-Pao',
  'ting-lu': 'Ting-Lu',
  'chi-yu': 'Chi-Yu'
};

/** The forms a card is printed as, by sprite suffix, as the words around the species' name. */
const FORMS: Record<string, [string, string]> = {
  mega: ['Mega ', ''],
  'mega-x': ['Mega ', ' X'],
  'mega-y': ['Mega ', ' Y'],
  alola: ['Alolan ', ''],
  galar: ['Galarian ', ''],
  hisui: ['Hisuian ', ''],
  paldea: ['Paldean ', '']
};

const SLUGS = new Set<string>(SPRITES);

const capitalised = (slug: string): string =>
  slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/** The species a sprite is a form of, and the form, when the slug is one: `arcanine-hisui` → arcanine, hisui. */
function formOf(slug: string): { species: string; form: string } | null {
  if (NAMES[slug]) {
    return null;
  }
  const words = slug.split('-');
  for (let cut = words.length - 1; cut > 0; cut--) {
    const species = words.slice(0, cut).join('-');
    if (SLUGS.has(species)) {
      return { species, form: words.slice(cut).join('-') };
    }
  }
  return null;
}

const speciesName = (slug: string): string => NAMES[slug] ?? capitalised(slug);

/** A sprite's deck label, or null for a form no card is printed as (Gigantamax, Rotom's appliances, ...). */
function labelOf(slug: string): string | null {
  const form = formOf(slug);
  if (!form) {
    return speciesName(slug);
  }
  const words = FORMS[form.form];
  return words ? `${words[0]}${speciesName(form.species)}${words[1]}` : null;
}

const SPECIES = SPRITES.flatMap(slug => {
  const label = labelOf(slug);
  return label ? [{ label, slug }] : [];
}).sort((a, b) => a.label.localeCompare(b.label));

/** Every Pokémon's deck label, alphabetical. */
export const SPECIES_LABELS: readonly string[] = SPECIES.map(entry => entry.label);

/** Sprites by label, and by slug for a name typed without its punctuation ("Mr Mime", "Flabebe"). */
const BY_NAME = new Map(
  SPECIES.flatMap(({ label, slug }) => [
    [normalizeForLookup(label), slug],
    [slug.replace(/-/g, ' '), slug]
  ])
);

/** The sprite of the Pokémon a deck label names outright, or none when it names anything else. */
export function speciesIcons(label: string | null | undefined): string[] {
  const slug = BY_NAME.get(normalizeForLookup(label));
  return slug ? [slug] : [];
}
