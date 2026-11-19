import type { CardItem } from '../types';

/**
 * Which part of the card a compact tile frames: the illustration window,
 * measured per card type on SV and Mega era prints. A basic energy frames its
 * type symbol. Each frame's crop lives in archetype-tiers.css.
 */
export type CropFrame = 'pokemon' | 'pokemon-ex' | 'trainer' | 'energy-special' | 'energy-basic';

/**
 * The frame for a card, from its category path. Rows built from decks on the
 * Filters tab carry a bare `energy` or `trainer` category with the subtype in
 * `energyType`/`trainerType`, and older rows may only have a supertype.
 * @param card - The card to frame
 * @returns Its crop frame
 */
export function cropFrame(
  card: Pick<CardItem, 'name' | 'category' | 'supertype' | 'energyType' | 'trainerType'>
): CropFrame {
  const [main = '', sub = ''] = (card.category ?? '').toLowerCase().split('/');
  const type = main || (card.supertype ?? '').toLowerCase();
  if (type === 'energy') {
    return (sub || card.energyType) === 'special' ? 'energy-special' : 'energy-basic';
  }
  if (type === 'trainer' || card.trainerType) {
    return 'trainer';
  }
  // ex cards run the art up behind the name and ability box, so they frame lower.
  return / ex$/.test(card.name) ? 'pokemon-ex' : 'pokemon';
}
