/**
 * POST /api/admin/applications/:id — an Admin decides a pending Application:
 * { decision: 'approve' | 'reject', note? }, the note being the Admin's own
 * words to the applicant. Approving makes the store it asks for, with the
 * applicant in it as the role their reason for applying gives them (an owner
 * its Owner, an organizer a Manager, a judge Staff); a league that already has a store is refused (409),
 * since a store changes hands only by an Admin moving it. The proof file goes
 * once the decision lands; its type stays on the row as a record that one was
 * seen. Answers { application }; 409 when it was already decided.
 */

import { NOTE_MAX } from '../../../../shared/accounts/applications.js';
import {
  ADMIN_APPLICATIONS,
  adminApplication,
  type AdminApplicationRow,
  dropProof,
  storeOf
} from '../../../lib/accounts/applications.js';
import { randomToken } from '../../../lib/auth/session.js';
import { breaksLeague, type Guard, storeInserts } from '../../../lib/stores/db.js';
import { publishStores } from '../../../lib/stores/publish.js';
import { roleForRelationship, type StoreApplication } from '../../../../shared/accounts/stores.js';
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
 * two Admins deciding at once cannot both land, and no store is made for an
 * Application someone else rejected meanwhile.
 */
function decisionWrites(
  db: D1Like,
  application: { id: string; userId: string; store: StoreApplication | null },
  decision: Decision,
  adminId: string
): D1Statement[] {
  const { id, userId, store } = application;
  const now = Date.now();
  const pending: Guard = {
    sql: "EXISTS (SELECT 1 FROM applications WHERE id = ? AND status = 'pending')",
    values: [id]
  };
  const made =
    decision.approve && store
      ? storeInserts(db, {
          id: randomToken(12),
          store: {
            leagueId: store.leagueId,
            details: store.details,
            lat: store.place?.lat ?? null,
            lon: store.place?.lon ?? null,
            timeZone: store.timeZone,
            nights: store.nights
          },
          member: { id: userId, role: roleForRelationship(store.relationship) },
          now,
          guard: pending
        })
      : [];
  const decide = db
    .prepare(
      'UPDATE applications SET status = ?2, decided_at = ?3, decided_by = ?4, note = ?5, proof_key = NULL ' +
        "WHERE id = ?1 AND status = 'pending'"
    )
    .bind(id, decision.approve ? 'approved' : 'rejected', now, adminId, decision.note);
  const read = db.prepare(`${ADMIN_APPLICATIONS} WHERE a.id = ?`).bind(id);
  const proof = db.prepare("SELECT proof_key FROM applications WHERE id = ? AND status = 'pending'").bind(id);
  return [proof, ...made, decide, read];
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
  const { db } = access;
  const found = await db
    .prepare(`${ADMIN_APPLICATIONS} WHERE a.id = ?`)
    .bind(param(context.params.id))
    .first<AdminApplicationRow>();
  if (!found) {
    return jsonError('No such application', 404);
  }
  const store = storeOf(found);
  if (decision.approve && !store) {
    return jsonError('This application asks for no store; reject it so they can apply again', 400);
  }
  const application = { id: found.id, userId: found.user_id, store };
  const results = await db.batch(decisionWrites(db, application, decision, access.admin.id)).catch((error: unknown) => {
    if (breaksLeague(error)) {
      return null;
    }
    throw error;
  });
  if (!results) {
    return jsonError('That league already has a store', 409);
  }
  const row = firstRow<AdminApplicationRow>(results.at(-1));
  if (!row) {
    return jsonError('No such application', 404);
  }
  if (rowsChanged(results.at(-2)) === 0) {
    return jsonError('Already decided', 409);
  }
  await dropProof(context, firstRow<{ proof_key: string | null }>(results[0])?.proof_key);
  if (decision.approve) {
    await publishStores(context);
  }
  return privateJson({ application: adminApplication(row) });
}
