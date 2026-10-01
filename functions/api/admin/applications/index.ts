/**
 * GET /api/admin/applications?status= — Applications to run events, for an
 * Admin to decide: the pending ones (the default) oldest first, so the queue
 * is worked in order, or the approved or rejected ones newest first. At most
 * 100; each carries the account as it is now and the profile it applied with.
 */

import type { ApplicationStatus } from '../../../../shared/accounts/types.js';
import { ADMIN_APPLICATIONS, adminApplication, type AdminApplicationRow } from '../../../lib/accounts/applications.js';
import { jsonError } from '../../../lib/api/responses.js';
import { openForAdmin } from '../../../lib/auth/admin.js';
import type { Context } from '../../../lib/auth/env.js';
import { privateJson } from '../../../lib/tournaments/access.js';

const STATUSES: readonly string[] = ['pending', 'approved', 'rejected'] satisfies ApplicationStatus[];

export async function onRequestGet(context: Context): Promise<Response> {
  const access = await openForAdmin(context);
  if (access instanceof Response) {
    return access;
  }
  const status = new URL(context.request.url).searchParams.get('status') ?? 'pending';
  if (!STATUSES.includes(status)) {
    return jsonError('Not a status', 400);
  }
  const order = status === 'pending' ? 'ASC' : 'DESC';
  const { results } = await access.db
    .prepare(`${ADMIN_APPLICATIONS} WHERE a.status = ? ORDER BY a.created_at ${order} LIMIT 100`)
    .bind(status)
    .all<AdminApplicationRow>();
  return privateJson({ applications: results.map(adminApplication) });
}
