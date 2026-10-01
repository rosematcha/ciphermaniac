/**
 * What the account functions answer, as the pages read it. Types only, so
 * nothing loads this module at run time.
 */

import type { TournamentMode } from '../tournament/view.js';
import type { AccountRole } from './roles.js';

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

/** An uploaded proof: its type, and its size in bytes. */
export interface ProofSlot {
  type: string;
  size: number;
}

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

/** An Application as the account that sent it sees it. */
export interface MyApplication {
  id: string;
  status: ApplicationStatus;
  explanation: string;
  /** The proof's type, kept as a record that one was sent after the file itself is deleted; null without one. */
  proofType: string | null;
  createdAt: number;
  decidedAt: number | null;
  /** The deciding admin's note to the applicant. */
  note: string | null;
}

/** GET /api/applications/mine: the account's latest Application, a proof uploaded for the next, and whether it may apply. */
export interface ApplicationState {
  application: MyApplication | null;
  /** A proof uploaded and not yet sent; null while an Application is pending, since its proof is the one sent. */
  proof: ProofSlot | null;
  eligible: { profile: boolean; role: boolean };
}

/** An Application as an admin sees it: who sent it, as they are now and as they applied. */
export interface AdminApplication extends MyApplication {
  account: { id: string; name: string; email: string | null; popId: string | null; role: AccountRole | null };
  /** The profile as it stood when the account applied. */
  applied: { popId: string; firstName: string; lastName: string };
  /** Whether the proof file is still there to see; it is deleted once the Application is decided. */
  hasProof: boolean;
  decidedBy: { id: string; name: string } | null;
}
