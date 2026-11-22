/**
 * Strict reads for a player build that must cover every event.
 * @module shared/onlineMeta/requiredEventBodies
 */

import { isRecord } from '../data/validate';

/** Event bodies without which a slice would quietly drop the event's players, decklists or date. */
const REQUIRED_EVENT_BODY = /^reports\/\d{4}-\d{2}-\d{2},[^/]+\/(players|decks|meta)\.json$/;

/** An id the player join can use, by the join's own rule: not blank, not a stringified null. */
function joinableId(value: unknown): boolean {
  const id = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  return id !== '' && id !== 'null' && id !== 'undefined';
}

function namedRow(row: unknown): row is Record<string, unknown> {
  return isRecord(row) && joinableId(row.playerId);
}

function countedCard(card: unknown): boolean {
  return isRecord(card) && typeof card.name === 'string' && card.name !== '' && Number.isFinite(card.count);
}

/** Rows the join would drop: such an event would read as players or decklists that disappeared. */
const SHAPES: Record<string, (value: unknown) => boolean> = {
  // A participant without a name still joins (under a placeholder), so only the id is required.
  players: value => Array.isArray(value) && value.every(namedRow),
  decks: value =>
    Array.isArray(value) &&
    value.every(row => namedRow(row) && Array.isArray(row.cards) && row.cards.every(countedCard)),
  meta: isRecord
};

interface BodyObject {
  text(): Promise<string>;
}

/**
 * A bucket on which an event's missing or malformed `players.json` (rows with an id),
 * `decks.json` (rows with an id and counted, named cards; an empty list is fine) or `meta.json`
 * (an object) reads as a failure, which aborts the run, rather than as an event with no
 * decks. For builds that must cover every event.
 * @param bucket - The storage binding the aggregator reads through
 * @returns The same binding with strict reads of those bodies
 */
export function requireEventBodies<B extends { get(key: string): Promise<unknown> }>(bucket: B): B {
  return {
    ...bucket,
    get: async (key: string) => {
      const object = await bucket.get(key);
      const body = REQUIRED_EVENT_BODY.exec(key)?.[1];
      if (!body) {
        return object;
      }
      if (!object) {
        throw new Error(`${key} is missing`);
      }
      // Read once here to check the shape, then hand the reader the same text.
      const text = await (object as BodyObject).text();
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error(`${key} is not JSON`);
      }
      if (!SHAPES[body](value)) {
        throw new Error(`${key} has the wrong shape`);
      }
      return { text: async () => text, json: async () => JSON.parse(text) as unknown };
    }
  };
}
