/**
 * An account's Application to run events, as the apply page, Settings and
 * /host read and send it: where the account stands (applicantStage), and the
 * calls behind it. The proof goes up as the file itself the moment it is
 * picked, and the Application only says whether to send it.
 */

import type { AccountRole } from '../../../shared/accounts/roles';
import type { ApplicationState, MyApplication, ProofSlot } from '../../../shared/accounts/types';
import { call } from './api';

/** The account's latest Application, a proof uploaded for the next, and whether it may apply. */
export const fetchApplication = () => call<ApplicationState>('/api/applications/mine');

/** Uploads the proof the next Application will carry, in place of one uploaded before. */
export const uploadProof = (file: Blob) =>
  call<{ proof: ProofSlot }>('/api/applications/proof', { method: 'PUT', body: file });

export const removeProof = () => call<null>('/api/applications/proof', { method: 'DELETE' });

/** Withdraws the pending Application, its proof with it. */
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

const KINDS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP'
};

/** A proof's type as a word: PDF, PNG, JPEG or WebP. */
export const proofKind = (type: string) => KINDS[type] ?? 'File';

const MB = 1024 * 1024;

/** A file's size as a person reads it: whole kilobytes under a megabyte, then tenths of one. */
export const fileSize = (bytes: number) =>
  bytes < MB ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / MB).toFixed(1)} MB`;

/** A day, as "Oct 1, 2026" in the reader's own order. */
export const dayOf = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
