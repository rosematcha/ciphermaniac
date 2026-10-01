/**
 * POST /api/admin/applications/:id — an Admin decides a pending Application:
 * { decision: 'approve' | 'reject', note? }, the note being the Admin's own
 * words to the applicant. Approving makes the account an Organizer (an Admin
 * stays one); rejecting leaves its role alone. The proof file goes once the
 * decision lands; its type stays on the row as a record that one was seen.
 * Answers { application }; 409 when it was already decided.
 */

import { NOTE_MAX } from '../../../../shared/accounts/applications.js';
import {
  ADMIN_APPLICATIONS,
  adminApplication,
  type AdminApplicationRow,
  dropProof
} from '../../../lib/accounts/applications.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import { openForAdmin } from '../../../lib/auth/admin.js';
import { type Context, param } from '../../../lib/auth/env.js';
import { firstRow, rowsChanged } from '../../../lib/d1.js';
import { privateJson } from '../../../lib/tournaments/access.js';
import type { D1Like, D1Statement } from '../../../lib/types.js';

interface Decision {
  approve: boolean;
  /** Null when the Admin left none. */
  note: string | null;
}

/** The decision a body asks for, or why it asks for none. */
function readDecision(body: Record<string, unknown> | null): Decision | string {
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if (note.length > NOTE_MAX) {
    return `Up to ${NOTE_MAX} characters`;
  }
  const { decision } = body ?? {};
  return decision === 'approve' || decision === 'reject'
    ? { approve: decision === 'approve', note: note || null }
    : 'Approve or reject';
}

/**
 * The key of the proof the Application was sent with, the decision's writes,
 * then the Application read back. Each write holds only while the
 * Application is still pending, inside the one transaction a batch is, so
 * two Admins deciding at once cannot both land.
 */
function decisionWrites(db: D1Like, id: string, decision: Decision, adminId: string): D1Statement[] {
  const now = Date.now();
  const approve = db
    .prepare(
      "UPDATE users SET role = 'organizer', role_at = ?2, role_by = ?3 " +
        "WHERE id = (SELECT user_id FROM applications WHERE id = ?1 AND status = 'pending') " +
        "AND (role IS NULL OR role = 'revoked')"
    )
    .bind(id, now, adminId);
  const decide = db
    .prepare(
      'UPDATE applications SET status = ?2, decided_at = ?3, decided_by = ?4, note = ?5, proof_key = NULL ' +
        "WHERE id = ?1 AND status = 'pending'"
    )
    .bind(id, decision.approve ? 'approved' : 'rejected', now, adminId, decision.note);
  const read = db.prepare(`${ADMIN_APPLICATIONS} WHERE a.id = ?`).bind(id);
  const proof = db.prepare("SELECT proof_key FROM applications WHERE id = ? AND status = 'pending'").bind(id);
  return decision.approve ? [proof, approve, decide, read] : [proof, decide, read];
}

export async function onRequestPost(context: Context<'id'>): Promise<Response> {
  const access = await openForAdmin(context);
  if (access instanceof Response) {
    return access;
  }
  const decision = readDecision(await readJsonObject(context.request, 4096));
  if (typeof decision === 'string') {
    return jsonError(decision, 400);
  }
  const results = await access.db.batch(decisionWrites(access.db, param(context.params.id), decision, access.admin.id));
  const row = firstRow<AdminApplicationRow>(results.at(-1));
  if (!row) {
    return jsonError('No such application', 404);
  }
  if (rowsChanged(results.at(-2)) === 0) {
    return jsonError('Already decided', 409);
  }
  await dropProof(context, firstRow<{ proof_key: string | null }>(results[0])?.proof_key);
  return privateJson({ application: adminApplication(row) });
}
