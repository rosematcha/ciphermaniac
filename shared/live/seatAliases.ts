/**
 * Live seats whose registered name is not the name their career is published
 * under.
 *
 * RK9 prints whatever a player typed into the registration form, and that is
 * sometimes not the name their Limitless career carries. `createProfileLookup`
 * matches on the name alone, so without a correction the seat gets no career
 * link and the career page finds no seat — the player is simply absent from the
 * live event on their own profile.
 *
 * Deliberately not part of `PLAYER_IDENTITY_OVERRIDES`: that table maps
 * Limitless id to Limitless id and its `IDENTITY_OVERRIDES_REVISION` is a
 * rebuild trigger for the aggregator. A seat alias changes nothing about
 * aggregation and would buy a full re-aggregation for no content change.
 *
 * The seat key (`shared/live/view.ts`) keeps deriving from the name RK9 prints,
 * never from the alias: follows, the D1 vote tally and the published
 * `reports.json` are all keyed by it, and rewriting the key mid-event orphans
 * every one of them.
 * @module shared/live/seatAliases
 */

import { foldName } from './fold';

export interface SeatAlias {
  /** Canonical Limitless `playerId` whose career the seat belongs to. */
  playerId: string;
  /** The name exactly as RK9 prints it on the pairing. */
  seatName: string;
  /**
   * Country on the pairing. Required when it differs from the career's, since
   * the lookup otherwise refuses a seat whose country contradicts the profile.
   */
  country: string;
}

/**
 * The corrections themselves. Each entry is a claim about a real person that
 * the data cannot verify; keep the list short and sourced.
 */
export const SEAT_ALIASES: readonly SeatAlias[] = [
  // Registers as Cali; her career is published as Caitlin White.
  { playerId: '9397', seatName: 'Cali White', country: 'CA' }
];

const key = (name: string, country: string): string => `${foldName(name)}|${country}`;

const PLAYER_BY_SEAT = new Map(SEAT_ALIASES.map(alias => [key(alias.seatName, alias.country), alias.playerId]));

const SEATS_BY_PLAYER = new Map<string, string[]>();
for (const alias of SEAT_ALIASES) {
  SEATS_BY_PLAYER.set(alias.playerId, [...(SEATS_BY_PLAYER.get(alias.playerId) ?? []), alias.seatName]);
}

/**
 * The career a seat belongs to when its registered name is an alias.
 * @param seat - Name and country as RK9 prints them
 * @returns The canonical player id, or null when the seat is not aliased
 */
export function aliasedPlayerId(seat: { name: string; country: string }): string | null {
  return PLAYER_BY_SEAT.get(key(seat.name, seat.country)) ?? null;
}

/**
 * Every name a player's seat may be registered under, their career name first.
 * @param playerId - Canonical player id
 * @param careerName - The name the career is published under
 * @returns Names to match a seat against, without repeats
 */
export function seatNamesFor(playerId: string, careerName: string): string[] {
  const aliases = SEATS_BY_PLAYER.get(playerId) ?? [];
  const seen = new Set([foldName(careerName)]);
  return [careerName, ...aliases.filter(name => !seen.has(foldName(name)) && Boolean(seen.add(foldName(name))))];
}
