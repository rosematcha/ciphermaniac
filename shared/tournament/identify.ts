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

function named(players: readonly Player[], key: 'firstName' | 'lastName', name: string): Player[] {
  const wanted = nameKey(name);
  return players.filter(player => nameKey(player[key]) === wanted);
}

/** A first and last name as one key. The two stay apart, so "Mary Ann" + "Smith" and "Mary" + "Ann Smith" are two people. */
export function fullNameKey(person: { firstName: string; lastName: string }): string {
  return JSON.stringify([nameKey(person.firstName), nameKey(person.lastName)]);
}

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

interface ListOwner {
  popId: string;
  firstName: string;
  lastName: string;
}

/**
 * Finds the player each decklist belongs to: by Player ID, or unsanctioned,
 * by first and last name when exactly one player has them. The roster is read
 * once, so matching an event's every list is a pass over the lists, not a
 * pass over the roster for each.
 */
export function decklistMatcher(tournament: Tournament, sanctioned: boolean): (list: ListOwner) => string | undefined {
  if (sanctioned) {
    const ids = new Set(tournament.players.map(player => player.id));
    return list => (ids.has(list.popId) ? list.popId : undefined);
  }
  const byName = new Map<string, string[]>();
  for (const player of tournament.players) {
    const key = fullNameKey(player);
    byName.set(key, [...(byName.get(key) ?? []), player.id]);
  }
  return list => {
    const ids = byName.get(fullNameKey(list)) ?? [];
    return ids.length === 1 ? ids[0] : undefined;
  };
}

/** The player one decklist belongs to (see decklistMatcher). */
export function decklistPlayer(tournament: Tournament, list: ListOwner, sanctioned: boolean): string | undefined {
  return decklistMatcher(tournament, sanctioned)(list);
}

/** The shortest start of `last` that none of `rivals` (last names, as nameKey has them) shares; the whole name when none will do. */
function shortest(last: string, rivals: readonly string[]): string {
  for (let n = 1; n < last.length; n += 1) {
    const prefix = nameKey(last.slice(0, n));
    if (!rivals.some(rival => rival.startsWith(prefix))) {
      return `${last.slice(0, n)}.`;
    }
  }
  return last;
}

/**
 * Each player's last name as an unsanctioned event shows it publicly: an
 * initial, or as many letters as it takes to tell two players with the same
 * first name apart (Ash Ket. and Ash Kel.). Players are grouped by first name
 * once, so a large field costs a pass over it, not a pass per player.
 */
export function shortLastNames(players: readonly Player[]): Map<string, string> {
  const sharing = new Map<string, Player[]>();
  for (const player of players) {
    const first = nameKey(player.firstName);
    const group = sharing.get(first);
    if (group) {
      group.push(player);
    } else {
      sharing.set(first, [player]);
    }
  }
  const short = new Map<string, string>();
  for (const group of sharing.values()) {
    const lasts = group.map(player => nameKey(player.lastName));
    group.forEach((player, i) => {
      const rivals = lasts.filter((_, other) => other !== i);
      short.set(player.id, shortest(player.lastName.trim(), rivals));
    });
  }
  return short;
}
