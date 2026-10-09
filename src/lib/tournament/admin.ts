/**
 * The admin page's calls: the queue of Applications and their decisions,
 * the accounts with a role and their access, and the account lookup and
 * POP ID moves that settle a dispute. Every one answers 401 to someone
 * signed out and 403 to anyone else but an Admin.
 */

import type { AccountRole } from '../../../shared/accounts/roles';
import type {
  AdminApplication,
  AdminEvent,
  ApplicationStatus,
  FoundAccount,
  RoleHolder
} from '../../../shared/accounts/types';
import { call, json } from './api';

/** A role as the admin page names it. */
export const ROLE_WORDS: Record<AccountRole, string> = {
  community: 'Community organizer',
  revoked: 'Revoked',
  admin: 'Admin'
};

const path = (id: string) => `/api/admin/applications/${encodeURIComponent(id)}`;

/** Applications by status: pending ones oldest first, decided ones newest first. */
export const fetchApplications = (status: ApplicationStatus) =>
  call<{ applications: AdminApplication[] }>(`/api/admin/applications?status=${status}`);

/** Approves or rejects a pending Application, with the Admin's note to the applicant ('' for none). */
export const decideApplication = (id: string, decision: 'approve' | 'reject', note: string) =>
  call<{ application: AdminApplication }>(path(id), json('POST', { decision, note }));

/** Where an Application's proof is read: an image shows inline, a PDF downloads. */
export const proofUrl = (id: string) => `${path(id)}/proof`;

/** Every account with a role, by name, with the events it owns. */
export const fetchRoleHolders = () => call<{ accounts: RoleHolder[] }>('/api/admin/organizers');

/** Removes a Community organizer's access ('revoked') or gives it back ('community'). */
export const setOrganizerAccess = (id: string, role: 'community' | 'revoked') =>
  call<{ account: RoleHolder }>(`/api/admin/organizers/${encodeURIComponent(id)}`, json('POST', { role }));

/** Every event on the site, the last changed first. */
export const fetchAllEvents = () => call<{ events: AdminEvent[] }>('/api/admin/events');

/**
 * What a lookup's text is: a POP ID (up to ten digits), an email (it has an
 * @) or else an account ID, as the query that asks for it.
 */
export function lookupQuery(text: string): string {
  const value = text.trim();
  if (/^\d{1,10}$/.test(value)) {
    return new URLSearchParams({ popId: value }).toString();
  }
  return new URLSearchParams(value.includes('@') ? { email: value } : { id: value }).toString();
}

/** The accounts a POP ID, email or account ID names, matched exactly. */
export const findAccounts = (text: string) =>
  call<{ accounts: FoundAccount[] }>(`/api/admin/accounts?${lookupQuery(text)}`);

/** Moves a POP ID to an account, or with null takes it off whoever holds it. */
export const movePopId = (popId: string, accountId: string | null) =>
  call<{ from: string | null; to: string | null }>('/api/admin/pop-ids', json('POST', { popId, accountId }));
