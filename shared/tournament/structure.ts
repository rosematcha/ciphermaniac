/**
 * Play! Pokémon's recommended structure for an event: how many Swiss rounds
 * and how big a top cut its attendance calls for. Its own module, since the
 * console's settings ask for it without the rest of what the pages derive.
 */

import type { EventType, Tournament, TournamentInfo } from './types.js';

type Table = readonly (readonly [max: number, rounds: number, cut: number])[];

/** Tournament Rules Handbook §5.5.6, rev. September 1, 2026, by competitors per age division. */
const TABLES: Record<EventType, { rows: Table; beyond: number }> = {
  cup: {
    rows: [
      [8, 3, 0],
      [12, 4, 4],
      [20, 5, 4],
      [32, 5, 8],
      [64, 6, 8],
      [128, 7, 8],
      [226, 8, 8],
      [409, 9, 8]
    ],
    beyond: 10
  },
  // Swiss only: a League Challenge has no top cut.
  challenge: {
    rows: [
      [8, 3, 0],
      [16, 4, 0],
      [32, 5, 0],
      [64, 6, 0],
      [128, 7, 0],
      [256, 8, 0],
      [512, 9, 0]
    ],
    beyond: 10
  }
};

/** The recommended Swiss rounds and top cut for a division's attendance at an event of this type. */
export function recommendedStructure(players: number, type: EventType = 'cup'): { rounds: number; cut: number } {
  const { rows, beyond } = TABLES[type];
  const row = rows.find(([max]) => players <= max);
  return row ? { rounds: row[1], cut: row[2] } : { rounds: beyond, cut: type === 'cup' ? 8 : 0 };
}

/** The kind of event a tournament is; one from before the choice existed is a League Cup. */
export function eventTypeOf(tournament: Pick<Tournament, 'info'>): EventType {
  return tournament.info.eventType ?? 'cup';
}

/**
 * What a sanctioned event needs to be valid: at least four competitors and
 * three Swiss rounds (Tournament Rules Handbook §5.2), and rounds of at least
 * 30 minutes, the shortest the TCG handbook allows (a best-of-three round
 * needs 50, which the organizer sets).
 */
export const SANCTIONED = { players: 4, swissRounds: 3, minutes: 30 } as const;

/** Why a sanctioned event cannot have these round lengths, or null when it can. */
export function sanctionedMinutesError(info: Pick<TournamentInfo, 'roundTime' | 'finalsRoundTime'>): string | null {
  return info.roundTime < SANCTIONED.minutes || info.finalsRoundTime < SANCTIONED.minutes
    ? `A sanctioned event’s rounds are at least ${SANCTIONED.minutes} minutes`
    : null;
}
