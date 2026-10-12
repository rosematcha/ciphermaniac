/**
 * An account's Application to run events, as the apply page, Settings and
 * /host read and send it: where the account stands (applicantStage), and the
 * calls behind it.
 */

import type { AccountRole } from '../../../shared/accounts/roles';
import type { ApplicationState, MyApplication } from '../../../shared/accounts/types';
import { call } from './api';

/** The account's latest Application, and whether it may apply. */
export const fetchApplication = () => call<ApplicationState>('/api/applications/mine');

/** Withdraws the pending Application. */
export const withdrawApplication = () => call<null>('/api/applications/mine', { method: 'DELETE' });

/**
 * Where an account stands on running events: nothing yet, a store
 * Application pending or not approved, a store approved, a Community
 * organizer, one whose access was removed, or an Admin.
 */
export type ApplicantStage = 'none' | 'pending' | 'rejected' | 'store' | 'community' | 'revoked' | 'admin';

/**
 * The stage, from the account's role and its latest store Application. An
 * Admin is one whatever it applied for; then a pending or rejected
 * Application, being the newest news; then an approved one; then the role.
 */
export function applicantStage(role: AccountRole | null, latest: MyApplication | null): ApplicantStage {
  if (role === 'admin') {
    return role;
  }
  const status = latest?.status;
  if (status === 'pending' || status === 'rejected') {
    return status;
  }
  return status === 'approved' ? 'store' : (role ?? 'none');
}

/** A day, as "Oct 1, 2026" in the reader's own order. */
export const dayOf = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
