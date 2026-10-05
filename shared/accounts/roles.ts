/**
 * What an account may do beyond playing. A player has no role. A Community
 * organizer runs unsanctioned events under its own name, within limits
 * (shared/tournament/limits.ts); any adult account becomes one by asking. A
 * revoked one was a Community organizer, keeps the events it owns, and may
 * start no more. An Admin may do everything a Community organizer may, with
 * no limits, and decides store applications. Sanctioned events belong to a
 * Store (shared/accounts/stores.ts), never to a role; rights over one event
 * come from being its staff or its store's (shared/tournament/view.ts `Role`).
 */

export type AccountRole = 'community' | 'revoked' | 'admin';

const ROLES: readonly string[] = ['community', 'revoked', 'admin'] satisfies AccountRole[];

/** A stored role as one the code knows; anything else reads as no role at all. */
export function readAccountRole(value: unknown): AccountRole | null {
  return typeof value === 'string' && ROLES.includes(value) ? (value as AccountRole) : null;
}

/** Whether the account may start an event under its own name (an unsanctioned one). */
export function canRunCommunityEvents(role: AccountRole | null): boolean {
  return role === 'community' || role === 'admin';
}

/** Whether the account may become a Community organizer by asking: a player may; one whose access was removed may not. */
export function canJoinCommunity(role: AccountRole | null): boolean {
  return role === null;
}

export function isAdmin(role: AccountRole | null): boolean {
  return role === 'admin';
}
