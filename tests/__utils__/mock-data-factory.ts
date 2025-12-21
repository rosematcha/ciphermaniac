/**
 * Mock data factory for tests
 * Provides functions to generate tournaments, decks, cards, and malicious inputs.
 * This file is intended for use in unit and integration tests.
 */

import fs from 'fs';
import path from 'path';

/**
 * Card category enumeration.
 */
export type CardCategory = 'Monster' | 'Spell' | 'Trap' | 'Extra' | 'Other';

/**
 * Represents a single card in a deck.
 */
export interface Card {
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
export interface Tournament {
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

// Fixed test date for deterministic mock data generation
const FIXED_MOCK_DATE = '2025-01-15T12:00:00.000Z';

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
export function generateMockCard(overrides: Partial<Card> = {}): Card {
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
 * Generate a mock tournament with defaults. Optionally attach decks.
 * @param overrides Partial fields to override
 */
export function generateMockTournament(overrides: Partial<Tournament> = {}): Tournament {
  const defaults: Tournament = {
    id: makeId('tourn'),
    name: `Tournament ${Math.random().toString(36).slice(2, 6)}`,
    date: FIXED_MOCK_DATE,
    format: ['Advanced', 'Traditional', 'Unlimited'][Math.floor(Math.random() * 3)],
    platform: ['Tabletop', 'Online', 'Event'][Math.floor(Math.random() * 3)],
    players: Math.floor(Math.random() * 256) + 4
  };

  return { ...defaults, ...overrides };
}

/**
 * Generate a large tournament with a given number of decks. Useful for performance tests.
 * This will produce a Tournament with the `decks` property populated.
 * @param deckCount number of decks to generate
 * @param deckOverrides optional deck-level overrides applied to each generated deck
 */
export function generateLargeTournament(deckCount: number, deckOverrides: Partial<Deck> = {}): Tournament {
  if (!Number.isFinite(deckCount) || deckCount < 0) {
    throw new TypeError('deckCount must be a non-negative number');
  }

  const tournament = generateMockTournament();
  const decks: Deck[] = [];
  for (let i = 0; i < deckCount; i++) {
    const deck = generateMockDeck({
      tournament: { id: tournament.id, name: tournament.name, date: tournament.date },
      placement: Math.floor(Math.random() * Math.max(1, Math.ceil(deckCount / 10))) + 1,
      ...deckOverrides
    });
    decks.push(deck);
  }

  const result: Tournament = { ...tournament, decks };
  return result;
}

/**
 * Create a realistic card distribution for a deck list.
 * Returns an object keyed by card name with counts.
 */
export function generateCardDistribution(): Record<string, number> {
  const poolSize = 60;
  const unique = Math.floor(Math.random() * 30) + 20; // 20..50 unique cards
  const distribution: Record<string, number> = {};

  for (let i = 0; i < unique; i++) {
    const name = `Card_${i}_${Math.random().toString(36).slice(2, 5)}`;
    // realistic count distribution: many singles, some doubles, few triples
    const randomValue = Math.random();
    const count = randomValue < 0.6 ? 1 : randomValue < 0.9 ? 2 : 3;
    distribution[name] = count;
  }

  // Adjust to pool size by adding singleton filler cards if necessary
  const total = Object.values(distribution).reduce((sum, num) => sum + num, 0);
  let remain = poolSize - total;
  let idx = unique;
  while (remain > 0) {
    const name = `Filler_${idx++}`;
    distribution[name] = 1;
    remain--;
  }

  return distribution;
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

/**
 * Register a file path created during tests so it can be cleaned up later.
 * @param pathStr absolute or relative file path that was created
 */
export function registerGeneratedFile(pathStr: string) {
  generatedFileRegistry.add(pathStr);
}

/**
 * Convenience helper to write a temporary JSON file for tests and register it for cleanup.
 * Returns the path written to.
 */
export function writeTempJson(data: unknown, dir?: string, fileName = `test-data-${makeId('tmp')}.json`): string {
  const base = dir ? dir : process.cwd();
  const filePath = path.resolve(base, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  registerGeneratedFile(filePath);
  return filePath;
}

export default {
  generateMockCard,
  generateMockDeck,
  generateMockTournament,
  generateMaliciousInput,
  generateLargeTournament,
  generateCardDistribution,
  writeTempJson,
  registerGeneratedFile,
  generatedFileRegistry
};
