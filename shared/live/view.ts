/**
 * Reading a published live round: finding one player in it, and filtering it
 * by name. RK9 gives a pairing no player ID, so a seat is matched on name and
 * country, and a name that two players in the round share matches nobody: a
 * stranger's record on someone's page is worse than none.
 * @module shared/live/view
 */

import type { LiveMatch, LiveSeat } from './types';

/** Lower-cased and stripped of diacritics, the way the players search folds names. */
export function foldName(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

export interface SeatView {
  match: LiveMatch;
  seat: LiveSeat;
  /** Absent for a bye or an unpaired loss. */
  opponent?: LiveSeat;
}

function seatsNamed(matches: readonly LiveMatch[], name: string, countries: readonly string[]): SeatView[] {
  const wanted = foldName(name);
  const found: SeatView[] = [];
  for (const match of matches) {
    match.seats.forEach((seat, i) => {
      const countryFits = countries.length === 0 || !seat.country || countries.includes(seat.country);
      if (countryFits && foldName(seat.name) === wanted) {
        found.push({ match, seat, opponent: match.seats[1 - i] });
      }
    });
  }
  return found;
}

/** The player's seat in the round, or null when absent or ambiguous. */
export function findSeat(matches: readonly LiveMatch[], name: string, countries: readonly string[]): SeatView | null {
  const found = seatsNamed(matches, name, countries);
  return found.length === 1 ? found[0] : null;
}

export function filterMatches(matches: readonly LiveMatch[], query: string): readonly LiveMatch[] {
  const q = foldName(query);
  return q ? matches.filter(match => match.seats.some(seat => foldName(seat.name).includes(q))) : matches;
}

export function recordLabel(seat: LiveSeat): string {
  return `${seat.wins}-${seat.losses}-${seat.ties}`;
}

export type MatchStatus = 'final' | 'submitted' | 'playing';

export function matchStatus(match: LiveMatch): MatchStatus {
  if (match.complete) {
    return 'final';
  }
  return match.submitted ? 'submitted' : 'playing';
}

interface NamedPlayer {
  playerId: string;
  name: string;
  country?: string;
}

/**
 * Career profile for a seat, by the same rule as `findSeat` turned around: only
 * a name exactly one known player carries, from a country that does not
 * contradict the seat's.
 */
export function createProfileLookup(players: readonly NamedPlayer[]): (seat: LiveSeat) => string | null {
  const byName = new Map<string, NamedPlayer | null>();
  for (const player of players) {
    const key = foldName(player.name);
    byName.set(key, byName.has(key) ? null : player);
  }
  return seat => {
    const player = byName.get(foldName(seat.name));
    const contradicts = player?.country && seat.country && player.country !== seat.country;
    return player && !contradicts ? player.playerId : null;
  };
}
