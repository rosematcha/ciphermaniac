/**
 * What an account may wipe of the data the site keeps on it, one part at a
 * time (functions/lib/accounts/wipe.ts):
 *
 * - `profile`: the player profile (POP ID, first and last name, birth year).
 * - `username`: the username, replaced with a random one and let go at once.
 * - `events`: the event history, which then lists only events made since.
 * - `organizer`: the events it organized and staffed, which keep their place
 *   in players' histories with the organizer's name taken off.
 */

export const WIPE_PARTS = ['profile', 'username', 'events', 'organizer'] as const;

export type WipePart = (typeof WIPE_PARTS)[number];

const isPart = (value: unknown): value is WipePart => WIPE_PARTS.includes(value as WipePart);

/** The parts a wipe asks for, each once, in WIPE_PARTS order; null unless it names at least one and only parts. */
export function readWipeParts(value: unknown): WipePart[] | null {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isPart)) {
    return null;
  }
  return WIPE_PARTS.filter(part => value.includes(part));
}

/** An event that holds up a wipe or a deletion until it ends. */
export interface RunningEvent {
  code: string;
  name: string;
}

/**
 * Why a wipe of organizer history, or a deletion, cannot go ahead yet: an
 * event the account runs, staffs or is named the organizer of has not ended,
 * or (deleting only) the account owns a store, which needs an Owner.
 */
export interface DataRefusal {
  error: string;
  running: RunningEvent[];
  ownedStores: string[];
}
