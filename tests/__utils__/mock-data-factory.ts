/**
 * Mock data factory for tests
 * Provides functions to generate tournaments, decks, and cards.
 * This file is intended for use in unit and integration tests.
 */

/**
 * Card category enumeration.
 */
type CardCategory = 'Monster' | 'Spell' | 'Trap' | 'Extra' | 'Other';

/**
 * Represents a single card in a deck.
 */
interface Card {
  id: string;
  name: string;
  set?: string;
  number?: string;
  count: number;
  category: CardCategory;
}

/**
 * Minimal tournament information attached to decks.
 */
interface Tournament {
  id: string;
  name: string;
  date: string; // ISO date string
  format: string;
  platform: string;
  players: number;
  decks?: Deck[];
}

/**
 * A deck submitted to a tournament.
 */
export interface Deck {
  id: string;
  archetype: string;
  cards: Card[];
  tournament?: Pick<Tournament, 'id' | 'name' | 'date'>;
  placement?: number | null;
}

let nextId = 0;

/**
 * Generate a deterministic identifier string.
 * @param prefix optional prefix for the id
 */
function makeId(prefix = 'id'): string {
  nextId += 1;
  return `${prefix}_${nextId}`;
}

/**
 * Generate a mock card with sensible defaults.
 * @param overrides Partial fields to override
 */
function generateMockCard(overrides: Partial<Card> = {}): Card {
  const id = makeId('card');
  const ordinal = nextId % 500 || 500;
  const defaults: Card = {
    id,
    name: `Card ${id}`,
    set: `SET${String(nextId % 100 || 100).padStart(3, '0')}`,
    number: String(ordinal),
    count: 1,
    category: ['Monster', 'Spell', 'Trap', 'Extra', 'Other'][nextId % 5] as CardCategory
  };
  return { ...defaults, ...overrides };
}

/**
 * Generate a mock deck for tests.
 * @param overrides Partial fields to override
 */
export function generateMockDeck(overrides: Partial<Deck> = {}): Deck {
  const defaultCards = Array.from({ length: 40 }, () => generateMockCard({ count: 1 }));

  const defaults: Deck = {
    id: makeId('deck'),
    archetype: `Archetype ${nextId}`,
    cards: defaultCards,
    tournament: undefined,
    placement: null
  };

  return { ...defaults, ...overrides };
}
