/**
 * The sample event the /host home page plays: real Swiss pairings from the
 * engine events run on, with each table's result drawn at random. The page
 * steps through the rounds a result at a time.
 */

import { pairSwiss } from '../../../shared/tournament/pairing';
import type { Random } from '../../../shared/tournament/random';

/** The sample's sixteen players, friends of the site who lent their names. */
export const SAMPLE_PLAYERS: readonly string[] = [
  'Annie Haberstroh',
  'Olivia Battaglia',
  'Lake Lubrano',
  'Andrew Hedrick',
  'Iris Morgan',
  'Sky Delsol',
  'Colby Rose',
  'James Musser',
  'Emma Hagen',
  'Jasmine Dickinson',
  'Reese Lundquist',
  'Macey Marlowe',
  'Christopher Dilday',
  'Jessie Espinoza',
  'Kaycee Adams',
  'Chris Colunga'
];

export interface SampleTable {
  p1: string;
  /** Null for the bye. */
  p2: string | null;
  /** Null for a tie. */
  winner: string | null;
}

export interface SampleStanding {
  name: string;
  points: number;
  wins: number;
  losses: number;
  ties: number;
}

/** About as many first seats win as second seats; one table in seventeen ties. */
function decide(p1: string, p2: string | null, random: Random): string | null {
  if (p2 === null) {
    return p1;
  }
  const roll = random();
  if (roll < 0.47) {
    return p1;
  }
  return roll < 0.94 ? p2 : null;
}

/** Points a table gives a player: 3 for a win, 1 for a tie. */
function pointsFrom(table: SampleTable, name: string): number {
  if (table.winner === null) {
    return 1;
  }
  return table.winner === name ? 3 : 0;
}

/** Adds a table's result to the points and pairing history the next round pairs on. */
function enter(
  table: SampleTable,
  points: Map<string, number>,
  opponents: Map<string, Set<string>>,
  byes: Set<string>
) {
  if (table.p2 === null) {
    byes.add(table.p1);
  } else {
    opponents.get(table.p1)?.add(table.p2);
    opponents.get(table.p2)?.add(table.p1);
  }
  for (const name of [table.p1, table.p2]) {
    if (name !== null) {
      points.set(name, (points.get(name) ?? 0) + pointsFrom(table, name));
    }
  }
}

/**
 * `rounds` Swiss rounds of `players`, each paired on the points the rounds
 * before it gave. Tables come in the engine's order: the top of the field
 * first, the bye last.
 */
export function playSampleEvent(players: readonly string[], rounds: number, random: Random): SampleTable[][] {
  const points = new Map(players.map(name => [name, 0]));
  const opponents = new Map(players.map(name => [name, new Set<string>()]));
  const byes = new Set<string>();
  const played: SampleTable[][] = [];
  for (let round = 0; round < rounds; round += 1) {
    const entrants = players.map(id => ({ id, points: points.get(id) ?? 0 }));
    const tables = pairSwiss(entrants, { opponents, byes }, random).map(({ p1, p2 }) => ({
      p1,
      p2,
      winner: decide(p1, p2, random)
    }));
    for (const table of tables) {
      enter(table, points, opponents, byes);
    }
    played.push(tables);
  }
  return played;
}

/** One player's line after `tables`. */
function standingOf(name: string, tables: readonly SampleTable[]): SampleStanding {
  const line = { name, points: 0, wins: 0, losses: 0, ties: 0 };
  for (const table of tables) {
    if (table.p1 !== name && table.p2 !== name) {
      continue;
    }
    line.points += pointsFrom(table, name);
    if (table.winner === null) {
      line.ties += 1;
    } else if (table.winner === name) {
      line.wins += 1;
    } else {
      line.losses += 1;
    }
  }
  return line;
}

/**
 * Everyone's line after the results in `tables`, most points first. Players
 * level on points keep the order they were seated in, so a row only moves
 * when a result moves it.
 */
export function sampleStandings(players: readonly string[], tables: readonly SampleTable[]): SampleStanding[] {
  const seat = new Map(players.map((name, i) => [name, i]));
  return players
    .map(name => standingOf(name, tables))
    .sort((a, b) => b.points - a.points || (seat.get(a.name) ?? 0) - (seat.get(b.name) ?? 0));
}
