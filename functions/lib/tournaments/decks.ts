/** Archetype labels players are on, keyed by POP ID. */

import { SETTINGS_LIMITS } from '../../../shared/tournament/view.js';

/** A label, trimmed; null clears; undefined when the value is neither. */
export function archetypeLabel(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const label = value.trim();
  return label && label.length <= SETTINGS_LIMITS.archetype ? label : undefined;
}

export function withDeck(
  decks: Record<string, string>,
  playerId: string,
  label: string | null
): Record<string, string> {
  const next = { ...decks };
  if (label === null) {
    delete next[playerId];
  } else {
    next[playerId] = label;
  }
  return next;
}
