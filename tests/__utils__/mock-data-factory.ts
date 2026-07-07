/**
 * Mock data factory for tests
 * Provides functions to generate tournaments, decks, cards, and malicious inputs.
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

/**
 * Type of malicious payload to generate.
 */
export type MaliciousType = 'xss' | 'path-traversal' | 'sql-injection' | 'command-injection' | 'xml-bomb' | 'all';

/**
 * Map of named malicious payloads.
 */
export interface MaliciousPayloads {
  type: MaliciousType;
  payload: string | Record<string, string>;
  description: string;
}

// Internal registry of file paths created during tests that may need cleanup.
export const generatedFileRegistry = new Set<string>();

/**
 * Generate a simple random identifier string.
 * @param prefix optional prefix for the id
 */
function makeId(prefix = 'id'): string {
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/**
 * Generate a mock card with sensible defaults.
 * @param overrides Partial fields to override
 */
function generateMockCard(overrides: Partial<Card> = {}): Card {
  const defaults: Card = {
    id: makeId('card'),
    name: `Card ${Math.random().toString(36).slice(2, 8)}`,
    set: `SET${(Math.floor(Math.random() * 100) + 1).toString().padStart(3, '0')}`,
    number: `${Math.floor(Math.random() * 500) + 1}`,
    count: 1,
    category: ['Monster', 'Spell', 'Trap', 'Extra', 'Other'][Math.floor(Math.random() * 5)] as CardCategory
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
    archetype: `Archetype ${Math.random().toString(36).slice(2, 6)}`,
    cards: defaultCards,
    tournament: undefined,
    placement: null
  };

  return { ...defaults, ...overrides };
}

/**
 * Generate malicious input payloads for testing security handling.
 * @param type the kind of payload to generate, or "all" for a mixed set
 */
export function generateMaliciousInput(type: MaliciousType = 'all'): MaliciousPayloads {
  const xss: MaliciousPayloads = {
    type: 'xss',
    payload: "\"><script>/*xss*/alert('xss')</script>",
    description: 'Basic script tag XSS payload'
  };

  const pathTraversal: MaliciousPayloads = {
    type: 'path-traversal',
    payload: '../../../../etc/passwd\0',
    description: 'Path traversal attempt with null byte'
  };

  const sqlInjection: MaliciousPayloads = {
    type: 'sql-injection',
    payload: "' OR 1=1; --",
    description: 'Classic SQL injection payload'
  };

  const commandInjection: MaliciousPayloads = {
    type: 'command-injection',
    payload: '; rm -rf / #',
    description: 'Shell command injection attempt'
  };

  const xmlBomb: MaliciousPayloads = {
    type: 'xml-bomb',
    payload:
      '<?xml version="1.0"?><!DOCTYPE lolz [ <!ENTITY lol "lol"> ]><lolz>&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;</lolz>',
    description: 'Small XML bomb-like payload'
  };

  const all: MaliciousPayloads = {
    type: 'all',
    payload: {
      xss: xss.payload as string,
      pathTraversal: pathTraversal.payload as string,
      sqlInjection: sqlInjection.payload as string,
      commandInjection: commandInjection.payload as string,
      xmlBomb: xmlBomb.payload as string
    },
    description: 'Collection of common malicious payloads'
  };

  const map: Record<MaliciousType, MaliciousPayloads> = {
    xss,
    'path-traversal': pathTraversal,
    'sql-injection': sqlInjection,
    'command-injection': commandInjection,
    'xml-bomb': xmlBomb,
    all
  };

  return map[type];
}
