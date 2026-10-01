/**
 * GET /api/applications/mine — the signed-in account's Application to run
 * events as it stands: its latest one, pending or decided, with the admin's
 * note; a proof it has uploaded and not yet sent; and whether it may apply
 * (a complete profile, and no Organizer or Admin role already).
 * DELETE /api/applications/mine — withdraws the pending Application, its
 * proof with it. A decided one stays, as the record of the decision.
 */

import { profileComplete } from '../../../shared/accounts/applications.js';
import { canApply } from '../../../shared/accounts/roles.js';
import type { ApplicationState } from '../../../shared/accounts/types.js';
import { dropProof, isPending, myApplication, openApplicant, proofIn } from '../../lib/accounts/applications.js';
import { jsonError, noContent } from '../../lib/api/responses.js';
import type { Context } from '../../lib/auth/env.js';
import { rowsChanged } from '../../lib/d1.js';
import { privateJson } from '../../lib/tournaments/access.js';

export async function onRequestGet(context: Context): Promise<Response> {
  const applicant = await openApplicant(context);
  if (applicant instanceof Response) {
    return applicant;
  }
  const { user, latest } = applicant;
  const state: ApplicationState = {
    application: latest && myApplication(latest),
    proof: isPending(applicant) ? null : await proofIn(context.env.PROOFS, user.id),
    eligible: { profile: profileComplete(user), role: canApply(user.role) }
  };
  return privateJson(state);
}

export async function onRequestDelete(context: Context): Promise<Response> {
  const applicant = await openApplicant(context);
  if (applicant instanceof Response) {
    return applicant;
  }
  const { db, user } = applicant;
  const withdrawn = await db
    .prepare("DELETE FROM applications WHERE user_id = ? AND status = 'pending'")
    .bind(user.id)
    .run();
  if (rowsChanged(withdrawn) === 0) {
    return jsonError('Nothing pending', 404);
  }
  await dropProof(context, user.id);
  return noContent();
}
