/**
 * Which player on the event's list someone is. A sanctioned event knows
 * players by Player ID; an unsanctioned one only by name.
 */

import type { Player, Tournament } from './types.js';

/** Case, accents and surrounding space aside, so "Pena" finds "Peña". */
export function nameKey(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').trim().toLowerCase();
}

const named = (players: readonly Player[], key: 'firstName' | 'lastName', name: string) =>
  players.filter(player => nameKey(player[key]) === nameKey(name));

/** The player a decklist belongs to: by Player ID, or unsanctioned, by first and last name. */
export function decklistPlayer(
  tournament: Tournament,
  list: { popId: string; firstName: string; lastName: string },
  sanctioned: boolean
): string | undefined {
  if (sanctioned) {
    return tournament.players.find(p => p.id === list.popId)?.id;
  }
  const matches = named(named(tournament.players, 'lastName', list.lastName), 'firstName', list.firstName);
  return matches.length === 1 ? matches[0]?.id : undefined;
}
