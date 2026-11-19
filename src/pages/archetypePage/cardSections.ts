/**
 * The archetype page's card sections, in deck order.
 *
 * Producers write each archetype's cards in deck order (shared/data/cardOrder),
 * so grouping keeps the order the cards arrive in. An older report arrives in
 * usage order and groups the same way: sections from its categories, usage
 * within each, and no evolution lines.
 * @module src/pages/archetypePage/cardSections
 */

import { type DeckSection, deckSection, type OrderableCard } from '../../../shared/data/cardOrder';

const TITLES = ['Pokémon', 'Supporters', 'Items', 'Tools', 'Stadiums', 'Energy'];

/** Where each deck-list section shows; a trainer of unknown subtype joins the items. */
const SHOWN_IN: Record<DeckSection, number> = {
  pokemon: 0,
  supporter: 1,
  item: 2,
  trainerOther: 2,
  tool: 3,
  stadium: 4,
  energySpecial: 5,
  energyBasic: 5
};

/**
 * Group a report's cards into the page's sections, keeping their order.
 * @param items - The report's cards, in the order they arrived
 * @returns The non-empty sections, in deck order
 */
export function cardSections<T extends OrderableCard>(items: readonly T[]): { title: string; items: T[] }[] {
  const sections = TITLES.map(title => ({ title, items: [] as T[] }));
  for (const item of items) {
    sections[SHOWN_IN[deckSection(item, null)]].items.push(item);
  }
  return sections.filter(section => section.items.length > 0);
}
