/**
 * Reading a published live round: finding one player in it, filtering it, and
 * ranking it. RK9 gives a pairing no player ID, so a seat is matched on name
 * and country, and a name that two players in the round share matches nobody: a
 * stranger's record on someone's page is worse than none.
 * @module shared/live/view
 */

import { foldName } from './fold';
import type { LiveMatch, LiveResult, LiveRound, LiveSeat } from './types';

export { foldName };

/** Name and country are all a seat is identified by. */
export type SeatRef = Pick<LiveSeat, 'name' | 'country'>;

export interface SeatView {
  match: LiveMatch;
  seat: LiveSeat;
  /** Absent for a bye or an unpaired loss. */
  opponent?: LiveSeat;
}

function seatsNamed(matches: readonly LiveMatch[], names: readonly string[], countries: readonly string[]): SeatView[] {
  const wanted = new Set(names.map(foldName));
  const found: SeatView[] = [];
  for (const match of matches) {
    match.seats.forEach((seat, i) => {
      const countryFits = countries.length === 0 || !seat.country || countries.includes(seat.country);
      if (countryFits && wanted.has(foldName(seat.name))) {
        found.push({ match, seat, opponent: match.seats[1 - i] });
      }
    });
  }
  return found;
}

/**
 * The player's seat in the round, or null when absent or ambiguous.
 * @param matches - The round's tables
 * @param names - Every name the player may be registered under (see `seatAliases`)
 * @param countries - Countries that do not contradict the player; empty accepts any
 * @returns The one matching seat, or null
 */
export function findSeat(
  matches: readonly LiveMatch[],
  names: readonly string[],
  countries: readonly string[]
): SeatView | null {
  const found = seatsNamed(matches, names, countries);
  return found.length === 1 ? found[0] : null;
}

/**
 * Every seat the names match, for telling a visitor that two players share one.
 * @param matches - The round's tables
 * @param names - Every name the player may be registered under
 * @param countries - Countries that do not contradict the player
 * @returns The matching seats, in table order
 */
export function findSeats(
  matches: readonly LiveMatch[],
  names: readonly string[],
  countries: readonly string[]
): SeatView[] {
  return seatsNamed(matches, names, countries);
}

/**
 * Names a seat answers to beyond the one printed on the pairing — the career
 * name, for a seat the alias table corrects. Folded, and worked out once per
 * round rather than per keystroke.
 */
export type ExtraNames = (match: LiveMatch) => readonly string[] | undefined;

/**
 * Tables the query names. An all-digit query is a table number as well as a
 * name fragment: "what table is 412" is the question people ask at a venue, and
 * the table number is the first column on the page.
 * @param matches - The round's tables
 * @param query - Raw search text
 * @param extra - Further folded names per table, e.g. an aliased seat's career name
 * @returns The matching tables, in their published order
 */
export function filterMatches(matches: readonly LiveMatch[], query: string, extra?: ExtraNames): readonly LiveMatch[] {
  const q = foldName(query);
  if (!q) {
    return matches;
  }
  return matches.filter(match => matchNamed(match, q, extra));
}

/** True when the table answers to the folded query, by number or by either seat. */
function matchNamed(match: LiveMatch, q: string, extra?: ExtraNames): boolean {
  if (/^\d+$/.test(q) && String(match.table) === q) {
    return true;
  }
  return (
    match.seats.some(seat => foldName(seat.name).includes(q)) ||
    (extra?.(match)?.some(name => name.includes(q)) ?? false)
  );
}

export function recordLabel(seat: Pick<LiveSeat, 'wins' | 'losses' | 'ties'>): string {
  return `${seat.wins}-${seat.losses}-${seat.ties}`;
}

export type MatchStatus = 'final' | 'submitted' | 'playing';

export function matchStatus(match: LiveMatch): MatchStatus {
  if (match.complete) {
    return 'final';
  }
  return match.submitted ? 'submitted' : 'playing';
}

/** What the status filter offers: everything, the tables still on, or the ones settled. */
export type StatusFilter = 'all' | 'playing' | 'decided';

export function filterByStatus(matches: readonly LiveMatch[], status: StatusFilter): readonly LiveMatch[] {
  if (status === 'all') {
    return matches;
  }
  return matches.filter(match => (status === 'decided' ? isDecided(match) : !isDecided(match)));
}

/** Tables where a seat is playing the named archetype, by the reports in hand. */
export function filterByDeck(
  matches: readonly LiveMatch[],
  deck: string,
  deckOf: (seat: SeatRef) => string | undefined
): readonly LiveMatch[] {
  return matches.filter(match => match.seats.some(seat => deckOf(seat) === deck));
}

interface NamedPlayer {
  playerId: string;
  name: string;
  country?: string;
}

/** The career a seat belongs to: the id its profile lives under, and the name it publishes. */
export interface SeatProfile {
  playerId: string;
  name: string;
}

/**
 * Career profile for a seat, by the same rule as `findSeat` turned around: only
 * a name exactly one known player carries, from a country that does not
 * contradict the seat's. `aliasOf` overrides that for the seats whose
 * registered name is not the one their career publishes.
 * @param players - The slim player index
 * @param aliasOf - Seat to canonical player id, for registered names that differ
 * @returns A lookup from seat to career, or null when no single career fits
 */
export function createProfileLookup(
  players: readonly NamedPlayer[],
  aliasOf: (seat: SeatRef) => string | null = () => null
): (seat: SeatRef) => SeatProfile | null {
  const byName = new Map<string, NamedPlayer | null>();
  const byId = new Map<string, NamedPlayer>();
  for (const player of players) {
    const key = foldName(player.name);
    byName.set(key, byName.has(key) ? null : player);
    byId.set(player.playerId, player);
  }
  const profile = (player: NamedPlayer): SeatProfile => ({ playerId: player.playerId, name: player.name });
  return seat => {
    const aliased = aliasOf(seat);
    if (aliased) {
      const known = byId.get(aliased);
      return known ? profile(known) : null;
    }
    const player = byName.get(foldName(seat.name));
    const contradicts = player?.country && seat.country && player.country !== seat.country;
    return player && !contradicts ? profile(player) : null;
  };
}

/** Identity of a seat across rounds and events: folded name and country. */
export function seatKey(seat: SeatRef): string {
  return `${foldName(seat.name)}|${seat.country}`;
}

/**
 * A seat as a URL segment: the folded name hyphenated, then the country after a
 * double hyphen.
 *
 * The doubled separator is what keeps the country segment honest. Folding
 * collapses every run of non-alphanumerics to one hyphen, so `--` cannot occur
 * inside a name — and with a single one, `alan-lee` would be both Alan Lee with
 * no country and Alan from Lebanon.
 */
export function seatSlug(seat: SeatRef): string {
  const name = foldName(seat.name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return seat.country ? `${name}--${seat.country.toLowerCase()}` : name;
}

/**
 * True when the seat is the one the slug names.
 *
 * Deliberately one-way: a slug is folded and hyphenated, so reading a name and
 * a country back out of it cannot be done — `alan-lee` is Alan Lee with no
 * country just as plausibly as Alan from Lebanon. Matching seats against a
 * freshly-made slug has no such ambiguity.
 */
export function seatMatchesSlug(seat: SeatRef, slug: string): boolean {
  return seatSlug(seat) === slug;
}

export interface RunRound {
  round: number;
  /** Null when the player is not in the round, or cannot be told from a namesake. */
  view: SeatView | null;
}

/**
 * One player's path through the rounds posted so far, oldest first.
 * @param rounds - Round files, in any order; nulls are rounds not yet posted
 * @param names - Every name the player may be registered under
 * @param countries - Countries that do not contradict the player
 * @returns One entry per posted round, oldest first
 */
export function playerRun(
  rounds: readonly (LiveRound | null)[],
  names: readonly string[],
  countries: readonly string[]
): RunRound[] {
  return rounds
    .filter((round): round is LiveRound => round !== null)
    .map(round => ({ round: round.round, view: findSeat(round.matches, names, countries) }))
    .sort((a, b) => a.round - b.round);
}

export interface RunSeatEntry {
  /** The round the seat was met in; 0 for the player's own seat. */
  round: number;
  seat: Pick<LiveSeat, 'name' | 'country'>;
}

/**
 * Every seat a run can name a deck for: the player, then each opponent in the
 * order they were played. A seat met twice, as a cut can do, is listed once,
 * since a report names a seat rather than a round.
 */
export function runSeats(player: Pick<LiveSeat, 'name' | 'country'>, run: readonly RunRound[]): RunSeatEntry[] {
  const seen = new Set([seatKey(player)]);
  const seats: RunSeatEntry[] = [{ round: 0, seat: player }];
  for (const { round, view } of run) {
    const opponent = view?.opponent;
    if (opponent && !seen.has(seatKey(opponent))) {
      seen.add(seatKey(opponent));
      seats.push({ round, seat: opponent });
    }
  }
  return seats;
}

/** Matches with at least one followed seat. */
export function followedMatches(matches: readonly LiveMatch[], follows: ReadonlySet<string>): readonly LiveMatch[] {
  return matches.filter(match => match.seats.some(seat => follows.has(seatKey(seat))));
}

export interface SeatOutcome {
  result: LiveResult;
  /** Reported by a player and not yet confirmed by staff. */
  provisional: boolean;
}

/**
 * How a seat's match went: the confirmed result, or else the one a player has
 * submitted. Staff confirmation can lag a round by half an hour, and a
 * submitted result is almost always the one confirmed.
 */
export function seatOutcome(match: LiveMatch, index: number): SeatOutcome | null {
  const confirmed = match.seats[index]?.result;
  if (confirmed) {
    return { result: confirmed, provisional: false };
  }
  if (!match.submitted || match.complete) {
    return null;
  }
  if (match.submitted === 'tie') {
    return { result: 'tie', provisional: true };
  }
  const winner = match.submitted === 'p1' ? 0 : 1;
  return { result: index === winner ? 'win' : 'loss', provisional: true };
}

/** A table whose result is known, confirmed or submitted. */
export function isDecided(match: LiveMatch): boolean {
  return match.complete || match.submitted !== undefined;
}

/** Points a result is worth: the game's own three, one and zero. */
const RESULT_POINTS: Record<LiveResult, number> = { win: 3, tie: 1, loss: 0 };

export interface Standing {
  seat: LiveSeat;
  match: LiveMatch;
  /** This round's result, once it is known. */
  outcome: SeatOutcome | null;
  /** Record and points with this round folded in, where RK9's are the ones going into it. */
  wins: number;
  losses: number;
  ties: number;
  points: number;
  /** Shared by everyone on the same points. */
  place: number;
}

/**
 * The round's field ranked rather than paired.
 *
 * RK9 posts the record a player carried *into* the round, so a table showing
 * "6-1-0 L" is a player on 6-2-0. Folding this round's result in is the only
 * way the list agrees with itself; a table still playing keeps the record it
 * came in on. Ties in points keep RK9's own order, which is the standings order
 * it paired by.
 * @param matches - The round's tables
 * @returns One row per seated player, best first
 */
export function standings(matches: readonly LiveMatch[]): Standing[] {
  const rows: Standing[] = [];
  for (const match of matches) {
    match.seats.forEach((seat, i) => {
      const outcome = seatOutcome(match, i);
      const result = outcome?.result;
      rows.push({
        seat,
        match,
        outcome,
        wins: seat.wins + (result === 'win' ? 1 : 0),
        losses: seat.losses + (result === 'loss' ? 1 : 0),
        ties: seat.ties + (result === 'tie' ? 1 : 0),
        points: seat.points + (result ? RESULT_POINTS[result] : 0),
        place: 0
      });
    });
  }
  // A bye is table 0, and it is not the top of its points bracket — it has no
  // standing at all, so it goes last among equals rather than first.
  const seatedAt = (row: Standing) => row.match.table || Number.MAX_SAFE_INTEGER;
  rows.sort((a, b) => b.points - a.points || seatedAt(a) - seatedAt(b));
  let place = 0;
  let previous: number | null = null;
  rows.forEach((row, i) => {
    if (row.points !== previous) {
      place = i + 1;
      previous = row.points;
    }
    row.place = place;
  });
  return rows;
}

/**
 * Standings rows the query names, by player or by the table they are at.
 * @param rows - Ranked rows
 * @param query - Raw search text
 * @param extra - Further folded names per table, as for {@link filterMatches}
 * @returns The matching rows, in their ranked order
 */
export function filterStandings(rows: readonly Standing[], query: string, extra?: ExtraNames): readonly Standing[] {
  const q = foldName(query);
  if (!q) {
    return rows;
  }
  return rows.filter(
    row =>
      (/^\d+$/.test(q) && String(row.match.table) === q) ||
      foldName(row.seat.name).includes(q) ||
      (extra?.(row.match)?.some(name => name.includes(q)) ?? false)
  );
}
