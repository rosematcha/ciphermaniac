/**
 * GET /api/admin/stores — every store, by name, with its status and its
 * Managers, for an Admin.
 */

import { openForAdmin } from '../../../lib/auth/admin.js';
import type { Context } from '../../../lib/auth/env.js';
import { adminStores } from '../../../lib/stores/admin.js';
import { privateJson } from '../../../lib/tournaments/access.js';

export async function onRequestGet(context: Context): Promise<Response> {
  const access = await openForAdmin(context);
  return access instanceof Response ? access : privateJson({ stores: await adminStores(access.db) });
}
