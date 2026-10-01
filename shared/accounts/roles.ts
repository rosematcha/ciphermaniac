/**
 * What an account may do beyond playing. A player has no role. An Organizer
 * may start events; a revoked one was an Organizer, keeps running the events
 * it owns, and may start no more. An Admin may do everything. Rights over one
 * event come from being its staff (shared/tournament/view.ts `Role`), never
 * from this.
 */

export type AccountRole = 'organizer' | 'revoked' | 'admin';

const ROLES: readonly string[] = ['organizer', 'revoked', 'admin'] satisfies AccountRole[];

/** A stored role as one the code knows; anything else reads as no role at all. */
export function readAccountRole(value: unknown): AccountRole | null {
  return typeof value === 'string' && ROLES.includes(value) ? (value as AccountRole) : null;
}

export function canCreateEvents(role: AccountRole | null): boolean {
  return role === 'organizer' || role === 'admin';
}

export function isAdmin(role: AccountRole | null): boolean {
  return role === 'admin';
}

/** Whether the account may apply to run events: a player may, and so may an Organizer whose access was removed. */
export function canApply(role: AccountRole | null): boolean {
  return role === null || role === 'revoked';
}
