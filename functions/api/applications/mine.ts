/**
 * GET /api/applications/mine — the signed-in account's Application for a
 * store as it stands: its latest one, pending or decided, with the admin's
 * note; and whether it may apply (a complete profile: a store's events need
 * its organizer's POP ID; and an email, which a username and password
 * account may lack).
 * DELETE /api/applications/mine — withdraws the pending Application. A
 * decided one stays, as the record of the decision.
 */

import { profileComplete } from '../../../shared/accounts/applications.js';
import type { ApplicationState } from '../../../shared/accounts/types.js';
import { myApplication, openApplicant } from '../../lib/accounts/applications.js';
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
    eligible: { profile: profileComplete(user), email: user.email !== null }
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
  return noContent();
}
