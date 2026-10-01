/**
 * What an Application to run events may carry, checked the same way on the
 * page and in the functions. Only an account whose profile is complete, its
 * POP ID included, may apply; it sends proof of organizer certification, an
 * explanation of why there is none, or both.
 */

import { readProfile } from '../tournament/profile.js';

/** The largest proof file: a full-size phone photo or screenshot, or a short PDF. */
export const PROOF_MAX_BYTES = 8 * 1024 * 1024;

/** The longest explanation, in characters as a text field counts them. */
export const EXPLANATION_MAX = 2000;

/** The longest note an admin leaves the applicant with a decision. */
export const NOTE_MAX = 500;

/** The profile fields an account holds, each unset until the player saves it. */
interface StoredProfile {
  popId: string | null;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
}

/** Whether every field a sanctioned event asks for is saved, each as the profile form would accept it. */
export function profileComplete(stored: StoredProfile): boolean {
  return readProfile(stored) !== null;
}
