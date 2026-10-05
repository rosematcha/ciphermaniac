/**
 * What the account functions answer, as the pages read it. Types only, so
 * nothing loads this module at run time.
 */

import type { TournamentMode } from '../tournament/view.js';
import type { AccountRole } from './roles.js';
import type { LeagueNight, NightException, StoreApplication, StoreDetails, StoreRole, StoreStatus } from './stores.js';

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

/** A public profile: the name it shows, the account's username and picture, and its History. Never its POP ID or email. */
export interface PublicProfile {
  name: string;
  handle: string;
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
  /** The store it asks for; null on one sent before Applications were for stores. */
  store: StoreApplication | null;
}

/** GET /api/applications/mine: the account's latest Application, a proof uploaded for the next, and whether it may apply. */
export interface ApplicationState {
  application: MyApplication | null;
  /** A proof uploaded and not yet sent; null while an Application is pending, since its proof is the one sent. */
  proof: ProofSlot | null;
  eligible: { profile: boolean };
}

/** An Application as an admin sees it: who sent it, as they are now and as they applied. */
export interface AdminApplication extends MyApplication {
  account: { id: string; name: string; email: string | null; popId: string | null; role: AccountRole | null };
  /** The profile as it stood when the account applied. */
  applied: { popId: string; firstName: string; lastName: string };
  /** Whether the proof file is still there to see; it is deleted once the Application is decided. */
  hasProof: boolean;
  decidedBy: { id: string; name: string } | null;
  /** The store that already holds the league it asks for, when one does: approving it would clash. */
  leagueTaken: { id: string; name: string } | null;
}

/** An account with a role, as the admin's list of Organizers and Admins shows it. */
export interface RoleHolder {
  id: string;
  name: string;
  email: string | null;
  popId: string | null;
  role: AccountRole;
  /** When the role last changed; null when a migration set it. */
  roleAt: number | null;
  /** How many events the account owns. */
  events: number;
}

/** An account an admin looked up. */
export interface FoundAccount {
  id: string;
  name: string;
  email: string | null;
  popId: string | null;
  role: AccountRole | null;
  createdAt: number;
}

/** A store as its members and admins see it (shared/accounts/stores.ts). */
export interface Store extends StoreDetails {
  id: string;
  leagueId: string;
  status: StoreStatus;
  lat: number | null;
  lon: number | null;
  timeZone: string;
  nights: LeagueNight[];
  exceptions: NightException[];
}

/** A store the signed-in account belongs to, and as what. */
export interface MyStore {
  id: string;
  name: string;
  leagueId: string;
  status: StoreStatus;
  timeZone: string;
  role: StoreRole;
}

/** Someone who belongs to a store, as its managers see them. */
export interface StoreMember {
  id: string;
  name: string;
  /** Whether they have a POP ID on file, so they can be an event's organizer of record. */
  hasPopId: boolean;
  role: StoreRole;
  addedAt: number;
}

/** An invite link still open, named by the start of its hash: enough to withdraw it, nothing to join with. */
export interface StoreInvite {
  id: string;
  role: StoreRole;
  createdAt: number;
  expiresAt: number;
}

/** What anyone may read about a store: no contact details beyond what it lists for players. */
export interface PublicStore {
  id: string;
  leagueId: string;
  name: string;
  address: string;
  city: string;
  region: string;
  postal: string;
  country: string;
  lat: number | null;
  lon: number | null;
  timeZone: string;
  website: string;
  discord: string;
  details: string;
  nights: LeagueNight[];
  exceptions: NightException[];
  /** Its events on the site that have not ended, soonest first. */
  events: StoreEvent[];
}

/** One of a store's events on the site. */
export interface StoreEvent {
  code: string;
  name: string;
  /** MM/DD/YYYY, as TOM writes it. */
  startDate: string;
  startsAt: string;
  sanctioned: boolean;
  status: 'upcoming' | 'live' | 'finished';
}

/** One event pokemon.com lists for a league, for a store to run on the site. */
export interface Listing {
  /** The Play! Pokémon sanction ID, e.g. 26-09-019067. */
  sanctionId: string;
  kind: 'cup' | 'challenge' | 'prerelease' | 'local';
  name: string;
  /** Store-local YYYY-MM-DD. */
  date: string;
  /** Store-local HH:MM, or '' when unlisted. */
  time: string;
}

/** What the locator knows of a league, to start a store application from. */
export interface LeagueFound {
  leagueId: string;
  shop: string;
  address: string;
  city: string;
  region: string;
  cc: string;
  lat: number;
  lon: number;
  timeZone: string;
}
