/**
 * POST /api/tournaments/:code/staff — joins the event's staff with the invite
 * token the organizer shared ({ token }), or, for the organizer, replaces the
 * token and removes every current staff member ({ rotate: true }).
 * GET — the organizer sees everyone the invite link let in, and when.
 * DELETE ?user=<id> — the organizer removes one of them.
 */

import { readJsonBody } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../../lib/auth/env.js';
import { randomToken } from '../../../lib/auth/session.js';
import { type Access, manageView, open, openForStaff, privateJson } from '../../../lib/tournaments/access.js';
import { addStaff, clearStaff, listStaff, mutate, removeStaff } from '../../../lib/tournaments/store.js';

/** The event, when the organizer is the one asking; the refusal otherwise. */
async function openForOwner(context: Context<'code'>): Promise<Access | Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  return access.role === 'owner' ? access : jsonError('Only the organizer can do that', 403);
}

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await openForOwner(context);
  if (access instanceof Response) {
    return access;
  }
  return privateJson({ staff: await listStaff(access.db, access.row.code) });
}

export async function onRequestDelete(context: Context<'code'>): Promise<Response> {
  const access = await openForOwner(context);
  if (access instanceof Response) {
    return access;
  }
  const user = new URL(context.request.url).searchParams.get('user') ?? '';
  if (!user) {
    return jsonError('Say who to remove', 400);
  }
  await removeStaff(access.db, access.row.code, user);
  return privateJson({ staff: await listStaff(access.db, access.row.code) });
}

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
