/**
 * POST /api/tournaments/:code/staff — joins the event's staff with the invite
 * token the organizer shared ({ token }), or, for the organizer, replaces the
 * token and removes every current staff member ({ rotate: true }).
 */

import { readJsonBody } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../../lib/auth/env.js';
import { randomToken } from '../../../lib/auth/session.js';
import { type Access, manageView, open, privateJson } from '../../../lib/tournaments/access.js';
import { addStaff, clearStaff, mutate } from '../../../lib/tournaments/store.js';

/**
 * A new invite token, and nobody on staff: the old link stops working and
 * everyone who joined through it has to be invited again. Organizer only.
 */
async function rotate(access: Access): Promise<Response> {
  if (access.role !== 'owner') {
    return jsonError('Only the organizer can do that', 403);
  }
  await clearStaff(access.db, access.row.code);
  const outcome = await mutate(access.db, access.row.code, () => ({ staffToken: randomToken(16) }));
  return 'error' in outcome
    ? jsonError(outcome.error, outcome.status)
    : privateJson(manageView({ ...access, row: outcome.row }));
}

export async function onRequestPost(context: Context<'code'>): Promise<Response> {
  if (!sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  if (!access.user) {
    return jsonError('Sign in first', 401);
  }
  const body = await readJsonBody(context.request, 512);
  const value = body.ok && typeof body.value === 'object' && body.value ? (body.value as Record<string, unknown>) : {};
  if (value.rotate === true) {
    return rotate(access);
  }
  if (access.role) {
    return privateJson({ role: access.role });
  }
  if (typeof value.token !== 'string' || value.token !== access.row.staffToken) {
    return jsonError('That invite link is no longer valid', 403);
  }
  await addStaff(access.db, access.row.code, access.user.id);
  return privateJson({ role: 'staff' });
}
