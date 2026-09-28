/**
 * Which player on the event's list someone is, from what they typed. A
 * sanctioned event knows players by Player ID; an unsanctioned one only by
 * name, so there a last name finds them, with the first name to tell apart
 * two who share it.
 */

import type { Player, Tournament } from './types.js';

/** What a player types to say who they are. */
export interface PlayerClaim {
  popId?: string;
  lastName?: string;
  firstName?: string;
}

export type Found = { ok: true; id: string } | { ok: false; error: string; ambiguous?: boolean };

/** Case, accents and surrounding space aside, so "Pena" finds "Peña". */
export function nameKey(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').trim().toLowerCase();
}

const named = (players: readonly Player[], key: 'firstName' | 'lastName', name: string) =>
  players.filter(player => nameKey(player[key]) === nameKey(name));

function byName(tournament: Tournament, claim: PlayerClaim): Found {
  const sameLast = named(tournament.players, 'lastName', claim.lastName ?? '');
  if (sameLast.length === 0) {
    return { ok: false, error: 'No player by that last name is in this event' };
  }
  const found = sameLast.length === 1 ? sameLast : named(sameLast, 'firstName', claim.firstName ?? '');
  const [player] = found;
  if (found.length === 1 && player) {
    return { ok: true, id: player.id };
  }
  return { ok: false, error: 'More than one player has that last name; add your first name', ambiguous: true };
}

export function findPlayer(tournament: Tournament, sanctioned: boolean, claim: PlayerClaim): Found {
  if (!sanctioned) {
    return byName(tournament, claim);
  }
  const popId = claim.popId?.trim() ?? '';
  const player = popId ? tournament.players.find(p => p.id === popId) : undefined;
  return player ? { ok: true, id: player.id } : { ok: false, error: 'No player with that Player ID is in this event' };
}

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

/** Whether `name` starts with `prefix`, as nameKey compares them. */
const startsAs = (name: string, prefix: string) => nameKey(name).startsWith(nameKey(prefix));

/** The shortest start of `last` that no rival's last name shares; the whole name when none will do. */
function shortest(last: string, rivals: readonly Player[]): string {
  for (let n = 1; n < last.length; n += 1) {
    if (!rivals.some(rival => startsAs(rival.lastName, last.slice(0, n)))) {
      return `${last.slice(0, n)}.`;
    }
  }
  return last;
}

/**
 * Each player's last name as an unsanctioned event shows it publicly: an
 * initial, or as many letters as it takes to tell two players with the same
 * first name apart (Ash Ket. and Ash Kel.).
 */
export function shortLastNames(players: readonly Player[]): Map<string, string> {
  return new Map(
    players.map(player => {
      const rivals = players.filter(o => o !== player && nameKey(o.firstName) === nameKey(player.firstName));
      return [player.id, shortest(player.lastName.trim(), rivals)];
    })
  );
}
