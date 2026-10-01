/**
 * GET /api/admin/organizers — every account with a role, by name: the
 * Organizers, those whose access was removed, and the Admins, each with how
 * many events it owns. Admins are listed, not changed here.
 */

import { roleHolders } from '../../../lib/accounts/organizers.js';
import { openForAdmin } from '../../../lib/auth/admin.js';
import type { Context } from '../../../lib/auth/env.js';
import { privateJson } from '../../../lib/tournaments/access.js';

export async function onRequestGet(context: Context): Promise<Response> {
  const access = await openForAdmin(context);
  return access instanceof Response ? access : privateJson({ accounts: await roleHolders(access.db) });
}
