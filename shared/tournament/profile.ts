/**
 * What a signed-in player says about themselves: the name and POP ID an
 * organizer's player list knows them by, and a birth date for their division.
 * Checked the same way in the browser and in the function that stores it.
 */

export interface PlayerProfile {
  popId: string;
  firstName: string;
  lastName: string;
  /** MM/DD/YYYY, as TOM writes it. */
  birthDate: string;
}

export const NAME_MAX = 40;

const POP_ID_RE = /^\d{1,10}$/;
const DATE_RE = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(19|20)\d\d$/;

function field(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Why a profile cannot be saved, per field; empty when it can. An
 * unsanctioned event asks only for the name.
 */
export function profileErrors(profile: PlayerProfile, sanctioned = true): Partial<Record<keyof PlayerProfile, string>> {
  const errors: Partial<Record<keyof PlayerProfile, string>> = {};
  if (sanctioned && !POP_ID_RE.test(profile.popId)) {
    errors.popId = 'A POP ID is up to ten digits';
  }
  if (!profile.firstName || profile.firstName.length > NAME_MAX) {
    errors.firstName = 'Required';
  }
  if (!profile.lastName || profile.lastName.length > NAME_MAX) {
    errors.lastName = 'Required';
  }
  if (sanctioned && !DATE_RE.test(profile.birthDate)) {
    errors.birthDate = 'Use MM/DD/YYYY';
  }
  return errors;
}

/**
 * A profile out of a request body, or null when a field is missing or
 * malformed. Unsanctioned, the Player ID and birth date are left blank.
 */
export function readProfile(body: unknown, sanctioned = true): PlayerProfile | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const profile = {
    popId: sanctioned ? field(record, 'popId') : '',
    firstName: field(record, 'firstName'),
    lastName: field(record, 'lastName'),
    birthDate: sanctioned ? field(record, 'birthDate') : ''
  };
  return Object.keys(profileErrors(profile, sanctioned)).length === 0 ? profile : null;
}
