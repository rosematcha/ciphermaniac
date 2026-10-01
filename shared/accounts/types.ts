/**
 * What the account functions answer, as the pages read it. Types only, so
 * nothing loads this module at run time.
 */

import type { TournamentMode } from '../tournament/view.js';

/**
 * One event in an account's History. Place, record, deck and the rounds are
 * not here: the page reads them out of the event's published copy by `key`.
 */
export interface HistoryEntry {
  code: string;
  /** The player's public key in the event. */
  key: string;
  name: string;
  /** MM/DD/YYYY, as TOM writes it. */
  startDate: string;
  /** The organizer's start time, as a datetime-local input gives it; '' when unset. */
  startsAt: string;
  format: string;
  mode: TournamentMode;
  /** Finished once the organizer closes it, live from its first round, upcoming before. */
  status: 'upcoming' | 'live' | 'finished';
}

/** A public profile: the account's name and picture, and its History. Never its POP ID or email. */
export interface PublicProfile {
  name: string;
  avatar: string | null;
  entries: HistoryEntry[];
}
