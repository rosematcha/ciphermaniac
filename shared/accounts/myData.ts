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

/**
 * What an export may hold: the parts a wipe takes, and `account`, the rest
 * of what is kept (the account itself, sign-ins, sessions, Applications and
 * stores).
 */
export const EXPORT_PARTS = [...WIPE_PARTS, 'account'] as const;

export type ExportPart = (typeof EXPORT_PARTS)[number];

/** The parts an export asks for as a comma list, in EXPORT_PARTS order; every part when none is asked, null on any unknown one. */
export function readExportParts(list: string | null): ExportPart[] | null {
  if (list === null) {
    return [...EXPORT_PARTS];
  }
  const asked = list.split(',');
  const known = EXPORT_PARTS.filter(part => asked.includes(part));
  return known.length > 0 && asked.every(part => known.includes(part as ExportPart)) ? known : null;
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
