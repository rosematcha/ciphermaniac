/**
 * Store Applications: an account asking for a store to run sanctioned events
 * (shared/accounts/stores.ts), and an admin's decision on it. An account
 * sends one at a time, saying which league and what it is, confirming it is
 * a certified organizer or works with one, and optionally with proof of the
 * certification and a note; the row keeps its POP ID and name as they stood
 * when it applied. Approving makes the store, with the applicant its Manager.
 *
 * The proof is a file in the private PROOFS bucket. Every upload is a file
 * of its own, under a key never used again (`proofs/<account id>/<random>`),
 * so nothing written later can change or delete the file an Application was
 * sent with. An account holds one upload not yet sent (`proof_uploads`): a
 * new one takes its place and the old file goes. Sending the Application
 * moves the key onto it, and the file goes once the Application is decided
 * or withdrawn; one left out of an Application goes when it is sent.
 */

import { profileComplete } from '../../../shared/accounts/applications.js';
import { readAccountRole } from '../../../shared/accounts/roles.js';
import type { StoreApplication } from '../../../shared/accounts/stores.js';
import type { AdminApplication, ApplicationStatus, MyApplication, ProofSlot } from '../../../shared/accounts/types.js';
import { jsonError } from '../api/responses.js';
import { type Context, sameOrigin } from '../auth/env.js';
import { randomToken, sessionHash, sessionUserQuery, type User, userFromRow, type UserRow } from '../auth/session.js';
import { firstRow } from '../d1.js';
import { displayNameSql } from './handles.js';
import { privateJson } from '../tournaments/access.js';
import type { D1Like } from '../types.js';

/** A key for one upload of the account's, never given to another. */
export const newProofKey = (userId: string) => `proofs/${userId}/${randomToken(12)}`;

export interface ApplicationRow {
  id: string;
  user_id: string;
  status: ApplicationStatus;
  pop_id: string;
  first_name: string;
  last_name: string;
  explanation: string;
  proof_key: string | null;
  proof_type: string | null;
  proof_size: number | null;
  created_at: number;
  decided_at: number | null;
  decided_by: string | null;
  note: string | null;
  store: string | null;
}

/** An application's columns, the table being `a`. */
export const APPLICATION_COLUMNS =
  'a.id, a.user_id, a.status, a.pop_id, a.first_name, a.last_name, a.explanation, a.proof_key, ' +
  'a.proof_type, a.proof_size, a.created_at, a.decided_at, a.decided_by, a.note, a.store';

/** The store an Application asks for; null on one sent before Applications were for stores. */
export const storeOf = (row: Pick<ApplicationRow, 'store'>): StoreApplication | null =>
  row.store ? (JSON.parse(row.store) as StoreApplication) : null;

export const myApplication = (row: ApplicationRow): MyApplication => ({
  id: row.id,
  status: row.status,
  explanation: row.explanation,
  proofType: row.proof_type,
  createdAt: row.created_at,
  decidedAt: row.decided_at,
  note: row.note,
  store: storeOf(row)
});

/** An application with the account that sent it, as it is now, and the name of the admin who decided it. */
export interface AdminApplicationRow extends ApplicationRow {
  name: string;
  email: string | null;
  role: string | null;
  account_pop_id: string | null;
  decider_name: string | null;
  taken_id: string | null;
  taken_name: string | null;
}

/**
 * The read of applications as admins see them, with the store that already
 * holds the league asked for, when one does; the caller adds the WHERE.
 */
export const ADMIN_APPLICATIONS =
  `SELECT ${APPLICATION_COLUMNS}, ${displayNameSql('u')} AS name, u.email, u.role, u.pop_id AS account_pop_id, ` +
  `${displayNameSql('d')} AS decider_name, t.id AS taken_id, t.name AS taken_name ` +
  'FROM applications a JOIN users u ON u.id = a.user_id LEFT JOIN users d ON d.id = a.decided_by ' +
  "LEFT JOIN stores t ON t.league_id = json_extract(a.store, '$.leagueId')";

export const adminApplication = (row: AdminApplicationRow): AdminApplication => ({
  ...myApplication(row),
  account: {
    id: row.user_id,
    name: row.name,
    email: row.email,
    popId: row.account_pop_id,
    role: readAccountRole(row.role)
  },
  applied: { popId: row.pop_id, firstName: row.first_name, lastName: row.last_name },
  hasProof: row.proof_key !== null,
  decidedBy: row.decided_by ? { id: row.decided_by, name: row.decider_name ?? '' } : null,
  leagueTaken: row.taken_id ? { id: row.taken_id, name: row.taken_name ?? '' } : null
});

/** The signed-in account, its latest Application, and the proof it has uploaded and not yet sent. */
export interface Applicant {
  db: D1Like;
  user: User;
  latest: ApplicationRow | null;
  upload: ProofSlot | null;
}

/** The account a session belongs to, its newest Application and its upload, read in one round trip. */
async function readApplicant(db: D1Like, hash: string): Promise<Omit<Applicant, 'db'> | null> {
  const now = Date.now();
  const [account, latest, upload] = await db.batch([
    sessionUserQuery(db, hash, now),
    db
      .prepare(
        `SELECT ${APPLICATION_COLUMNS} FROM sessions s JOIN applications a ON a.user_id = s.user_id ` +
          'WHERE s.token_hash = ? AND s.expires_at > ? ORDER BY a.created_at DESC LIMIT 1'
      )
      .bind(hash, now),
    db
      .prepare(
        'SELECT p.type, p.size FROM sessions s JOIN proof_uploads p ON p.user_id = s.user_id ' +
          'WHERE s.token_hash = ? AND s.expires_at > ?'
      )
      .bind(hash, now)
  ]);
  const row = firstRow<UserRow>(account);
  return row
    ? { user: userFromRow(row), latest: firstRow<ApplicationRow>(latest), upload: firstRow<ProofSlot>(upload) }
    : null;
}

/** The applicant asking, or the answer that turns the request away. */
export async function openApplicant(context: Context): Promise<Applicant | Response> {
  const { request, env } = context;
  const db = env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('Applications are not available', 503);
  }
  if (!sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  const hash = await sessionHash(request);
  const applicant = hash ? await readApplicant(db, hash) : null;
  return applicant ? { db, ...applicant } : jsonError('Sign in first', 401);
}

export const isPending = (applicant: Applicant) => applicant.latest?.status === 'pending';

/** While an Application is pending its proof stays as sent, so an admin never sees it change. */
export const pendingRefusal = () => jsonError('Your application is pending', 409);

/** Why the account may not apply, or upload a proof to apply with; null when it may. */
export function applyRefusal(applicant: Applicant): Response | null {
  const { user } = applicant;
  if (!profileComplete(user)) {
    // `profile` tells the page to send the account to its profile, not show the message alone.
    return privateJson({ error: 'Complete your profile first', profile: true }, 400);
  }
  if (!user.email) {
    // A username and password account may have no email; an organizer has to be reachable.
    return privateJson({ error: 'Add an email first', email: true }, 400);
  }
  return isPending(applicant) ? pendingRefusal() : null;
}

/** The key of the account's upload not yet sent; the batch it goes in decides which upload that is. */
export const heldUpload = (db: D1Like, userId: string) =>
  db.prepare('SELECT key FROM proof_uploads WHERE user_id = ?').bind(userId);

/**
 * Deletes the proof file under `key`, if any, after the answer, where the
 * runtime keeps the function alive for it. The key is the one the request
 * took off its Application or upload, never one read again later, so a late
 * delete cannot touch a file uploaded since. A delete that fails fails
 * nothing else; the file is left over.
 */
export function dropProof(context: Pick<Context, 'env' | 'waitUntil'>, key: string | null | undefined): Promise<void> {
  if (!key) {
    return Promise.resolve();
  }
  const dropped = Promise.resolve(context.env.PROOFS?.delete(key)).then(
    () => undefined,
    (error: unknown) => console.error('Proof delete failed', error)
  );
  if (!context.waitUntil) {
    return dropped;
  }
  context.waitUntil(dropped);
  return Promise.resolve();
}
