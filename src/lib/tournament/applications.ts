/**
 * An account's Application to run events, as the apply page, Settings and
 * /host read and send it: where the account stands (applicantStage), and the
 * calls behind it. The proof goes up as the file itself the moment it is
 * picked, and the Application only says whether to send it.
 */

import type { AccountRole } from '../../../shared/accounts/roles';
import type { ApplicationState, MyApplication, ProofSlot } from '../../../shared/accounts/types';
import { call, json } from './api';

/** The account's latest Application, a proof uploaded for the next, and whether it may apply. */
export const fetchApplication = () => call<ApplicationState>('/api/applications/mine');

/** Uploads the proof the next Application will carry, in place of one uploaded before. */
export const uploadProof = (file: Blob) =>
  call<{ proof: ProofSlot }>('/api/applications/proof', { method: 'PUT', body: file });

export const removeProof = () => call<null>('/api/applications/proof', { method: 'DELETE' });

/** Sends the Application: the explanation, and the uploaded proof when `proof` says so. */
export const sendApplication = (explanation: string, proof: boolean) =>
  call<{ application: MyApplication }>('/api/applications', json('POST', { explanation, proof }));

/** Withdraws the pending Application, its proof with it. */
export const withdrawApplication = () => call<null>('/api/applications/mine', { method: 'DELETE' });

/**
 * Where an account stands as an applicant: none yet, pending, not approved,
 * an Organizer, one whose access was removed, or an Admin.
 */
export type ApplicantStage = 'none' | 'pending' | 'rejected' | 'organizer' | 'revoked' | 'admin';

/**
 * The stage, from the account's role and its latest Application. A role
 * that runs events outranks any Application; then a pending or rejected
 * Application, being newer than any role change; then the role itself. An
 * approved Application under an account read as a player means the page
 * read the account before the decision.
 */
export function applicantStage(role: AccountRole | null, latest: MyApplication | null): ApplicantStage {
  if (role === 'admin' || role === 'organizer') {
    return role;
  }
  const status = latest?.status;
  if (status === 'pending' || status === 'rejected') {
    return status;
  }
  return status === 'approved' && role === null ? 'organizer' : (role ?? 'none');
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
