/**
 * Custom assertion helpers for tests.
 */

import assert from 'node:assert/strict';
import { Deck, Tournament } from './mock-data-factory';

/**
 * Report shape used by some tests. Add fields as needed.
 */
export interface Report {
  tournaments?: Tournament[];
  decks?: Deck[];
  generatedAt?: string;
  summary?: Record<string, unknown>;
}

/**
 * Assert that a tournament object has the expected structure and types.
 * Throws an assertion error with a helpful message on failure.
 * @param tournament Tournament object to validate
 */
export function assertValidTournament(tournament: unknown): asserts tournament is Tournament {
  assert.ok(tournament && typeof tournament === 'object', 'Tournament must be an object');
  const tour = tournament as Tournament;
  assert.ok(typeof tour.id === 'string' && tour.id.length > 0, 'Tournament.id must be a non-empty string');
  assert.ok(typeof tour.name === 'string', 'Tournament.name must be a string');
  assert.ok(
    typeof tour.date === 'string' && !Number.isNaN(Date.parse(tour.date)),
    'Tournament.date must be an ISO date string'
  );
  assert.ok(typeof tour.format === 'string', 'Tournament.format must be a string');
  assert.ok(typeof tour.platform === 'string', 'Tournament.platform must be a string');
  assert.ok(Number.isFinite(tour.players) && tour.players >= 0, 'Tournament.players must be a non-negative number');
  if (tour.decks !== undefined) {
    assert.ok(Array.isArray(tour.decks), 'Tournament.decks must be an array if present');
    for (const deck of tour.decks) {
      assertValidDeck(deck);
    }
  }
}

/**
 * Assert that a deck object has the expected structure and types.
 * @param deck Deck object to validate
 */
export function assertValidDeck(deck: unknown): asserts deck is Deck {
  assert.ok(deck && typeof deck === 'object', 'Deck must be an object');
  const deckObj = deck as Deck;
  assert.ok(typeof deckObj.id === 'string' && deckObj.id.length > 0, 'Deck.id must be a non-empty string');
  assert.ok(typeof deckObj.archetype === 'string', 'Deck.archetype must be a string');
  assert.ok(Array.isArray(deckObj.cards), 'Deck.cards must be an array');
  assert.ok(deckObj.cards.length > 0, 'Deck.cards should contain at least one card');
  for (const card of deckObj.cards) {
    assert.ok(typeof card.id === 'string', 'Card.id must be a string');
    assert.ok(typeof card.name === 'string', 'Card.name must be a string');
    assert.ok(Number.isFinite(card.count) && card.count >= 0, 'Card.count must be a non-negative number');
  }
  if (deckObj.tournament !== undefined) {
    assert.ok(typeof deckObj.tournament.id === 'string', 'Deck.tournament.id must be a string');
    assert.ok(typeof deckObj.tournament.name === 'string', 'Deck.tournament.name must be a string');
  }
}

/**
 * Assert the shape of a report object used in tests.
 * @param report Report object to validate
 */
export function assertValidReport(report: unknown): asserts report is Report {
  assert.ok(report && typeof report === 'object', 'Report must be an object');
  const reportObj = report as Report;
  if (reportObj.tournaments !== undefined) {
    assert.ok(Array.isArray(reportObj.tournaments), 'Report.tournaments must be an array');
    for (const tour of reportObj.tournaments) {
      assertValidTournament(tour);
    }
  }
  if (reportObj.decks !== undefined) {
    assert.ok(Array.isArray(reportObj.decks), 'Report.decks must be an array');
    for (const deckItem of reportObj.decks) {
      assertValidDeck(deckItem);
    }
  }
  if (reportObj.generatedAt !== undefined) {
    assert.ok(
      typeof reportObj.generatedAt === 'string' && !Number.isNaN(Date.parse(reportObj.generatedAt)),
      'Report.generatedAt must be a valid date string'
    );
  }
}

/**
 * Basic security assertion: ensures the input does not contain obvious malicious substrings.
 * This is a heuristic for tests to verify sanitization code paths.
 * @param input String or object to inspect
 */
export function assertSecuritySafe(input: unknown): void {
  const serialized = typeof input === 'string' ? input : JSON.stringify(input);

  // Known dangerous patterns
  const patterns = [
    /<script\b/i,
    /on\w+=/i,
    /\bSELECT\b/i,
    /\bINSERT\b/i,
    /\bDROP\b/i,
    /\bDELETE\b/i,
    /\.\./, // path traversal
    /\bexec\b|\brm\b/, // command-like
    /<!DOCTYPE\s+lolz/i // xml bomb pattern used in tests
  ];

  for (const pattern of patterns) {
    assert.ok(!pattern.test(serialized), `Security check failed: input matches dangerous pattern ${pattern}`);
  }
}

/**
 * Assert that a synchronous or asynchronous function completes within maxMs milliseconds.
 * @param fn Function that may return a promise
 * @param maxMs Maximum allowed milliseconds
 */
export async function assertPerformance(fn: () => unknown | Promise<unknown>, maxMs: number): Promise<void> {
  const start = Date.now();
  await Promise.resolve().then(() => fn());
  const duration = Date.now() - start;
  assert.ok(duration <= maxMs, `Function exceeded time budget: ${duration}ms > ${maxMs}ms`);
}

export default {
  assertValidTournament,
  assertValidDeck,
  assertValidReport,
  assertSecuritySafe,
  assertPerformance
};
