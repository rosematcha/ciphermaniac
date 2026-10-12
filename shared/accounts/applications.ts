/**
 * What an Application to run events may carry, checked the same way on the
 * page and in the functions. Only an account whose profile is complete, its
 * POP ID included, may apply, with an optional explanation.
 */

import { readProfile } from '../tournament/profile.js';

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
