/**
 * Age divisions. Play! Pokémon places a player by birth year against the
 * season's cutoffs: a season is named for the year it ends, starts on
 * September 1 of the year before (Handbook §5.1.3; it was July 1 until 2026),
 * and splits Juniors, Seniors and Masters at fixed ages.
 */

import type { Division, Tournament } from './types.js';

/** The season (named for the year it ends) an event on this date belongs to. */
export function seasonOf(date: Date): number {
  return date.getUTCMonth() >= 8 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
}

/** Birth year from TOM's MM/DD/YYYY, or null when unreadable. */
export function birthYear(birthDate: string): number | null {
  const match = /^\d{1,2}\/\d{1,2}\/(\d{4})$/.exec(birthDate.trim());
  return match ? Number(match[1]) : null;
}

/**
 * Juniors were born in the season's year minus 12 or later, Seniors in the
 * four years before that, Masters before that. For the 2027 season: 2015 and
 * later, 2011 to 2014, 2010 and earlier. No birth date reads as Masters.
 */
export function divisionFor(birthDate: string, season: number): Division {
  const year = birthYear(birthDate);
  if (year === null || year <= season - 17) {
    return 'masters';
  }
  return year >= season - 12 ? 'junior' : 'senior';
}

/** MM/DD/YYYY from TOM, as a Date at UTC midnight; null when unreadable. */
export function parseTomDate(value: string): Date | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value.trim());
  if (!match) {
    return null;
  }
  const date = new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])));
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** A date and time as TOM writes them: MM/DD/YYYY HH:mm:ss, in the clock's own time. */
export function tomDateTime(date: Date): string {
  return (
    `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

const TOM_DATE_TIME_RE = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/;

export function isTomDateTime(value: unknown): value is string {
  return typeof value === 'string' && TOM_DATE_TIME_RE.test(value);
}

/** Every player's age division in the event's season. */
export function divisionLookup(tournament: Tournament): (id: string) => Division {
  const season = seasonOf(parseTomDate(tournament.info.startDate) ?? new Date());
  const births = new Map(tournament.players.map(p => [p.id, p.birthDate]));
  return id => divisionFor(births.get(id) ?? '', season);
}
