import { normalizeCardNumber } from '../../card/routing.js';
import { CARD_COUNT_BASIC_ENERGY_MAX, CARD_COUNT_DEFAULT_MAX } from '../constants.js';
import { getState } from '../state.js';
import type { CardItemData, CardLookupEntry } from '../types.js';

/**
 * Build a lookup map of cardId to card metadata from the current state.
 */
export function buildCardLookup(): Map<string, CardLookupEntry> {
  const state = getState();
  state.cardLookup = new Map();

  const deckTotal = state.defaultDeckTotal || state.archetypeDeckTotal || 0;

  state.allCards.forEach(card => {
    const cardId = buildCardId(card);
    if (!cardId) {
      return;
    }

    const found = Number(card.found ?? 0);
    const total = Number(card.total ?? deckTotal);
    const pct = total > 0 ? (found / total) * 100 : 0;
    const alwaysIncluded = total > 0 && found === total;
    const normalizedNumber = normalizeCardNumber(card.number);
    const normalizedCategory = typeof card.category === 'string' ? card.category.toLowerCase() : null;
    const normalizedEnergyType = typeof card.energyType === 'string' ? card.energyType.toLowerCase() : null;

    state.cardLookup.set(cardId, {
      id: cardId,
      name: card.name || cardId,
      set: card.set || null,
      number: normalizedNumber || null,
      found,
      total,
      pct: Math.round(pct * 100) / 100,
      alwaysIncluded,
      category: normalizedCategory,
      energyType: normalizedEnergyType
    });
  });

  return state.cardLookup;
}

/**
 * Determine whether a card is treated as basic energy.
 * @param cardInfo - Card metadata entry.
 */
export function isBasicEnergyCard(cardInfo: CardLookupEntry | undefined): boolean {
  if (!cardInfo) {
    return false;
  }
  const energyType = typeof cardInfo.energyType === 'string' ? cardInfo.energyType : '';
  if (energyType === 'basic') {
    return true;
  }
  const category = typeof cardInfo.category === 'string' ? cardInfo.category : '';
  if (category.startsWith('energy/basic')) {
    return true;
  }
  const isSVEnergy = typeof cardInfo.set === 'string' && cardInfo.set.toUpperCase() === 'SVE';
  return category === 'energy' && isSVEnergy;
}

/**
 * Get the maximum allowed copies for a given card.
 * @param cardId - Card identifier.
 */
export function getMaxCopiesForCard(cardId: string | null): number {
  if (!cardId) {
    return CARD_COUNT_DEFAULT_MAX;
  }
  const state = getState();
  const info = state.cardLookup.get(cardId);
  return isBasicEnergyCard(info) ? CARD_COUNT_BASIC_ENERGY_MAX : CARD_COUNT_DEFAULT_MAX;
}

/**
 * Build a canonical cardId from set and number.
 * @param card - Card item data.
 */
export function buildCardId(card: CardItemData): string | null {
  const setCode = String(card?.set ?? '')
    .toUpperCase()
    .trim();
  if (!setCode) {
    return null;
  }
  const number = normalizeCardNumber(card?.number);
  if (!number) {
    return null;
  }
  return `${setCode}~${number}`;
}
