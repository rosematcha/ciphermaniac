/**
 * POST /api/admin/stores/:id — an Admin acts on a store: { status: 'active' |
 * 'revoked' } (a revoked store starts no events, its events run on, and it
 * leaves the event locator), or { manager: <account id> }, which makes that
 * account one of the store's Managers, joining it if need be: how a store
 * changes hands, or gets a Manager back when it lost touch with its own.
 * Answers { store } as the Admin's list shows it.
 */

import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import { openForAdmin } from '../../../lib/auth/admin.js';
import { type Context, param } from '../../../lib/auth/env.js';
import { adminStore, makeManager } from '../../../lib/stores/admin.js';
import { setStatus } from '../../../lib/stores/db.js';
import { publishStores } from '../../../lib/stores/publish.js';
import { privateJson } from '../../../lib/tournaments/access.js';

export async function onRequestPost(context: Context<'id'>): Promise<Response> {
  const access = await openForAdmin(context);
  if (access instanceof Response) {
    return access;
  }
  const { db, admin } = access;
  const id = param(context.params.id);
  const body = (await readJsonObject(context.request, 512)) ?? {};
  const { status, manager } = body;
  let done = false;
  if (status === 'active' || status === 'revoked') {
    done = await setStatus(db, id, status, admin.id);
  } else if (typeof manager === 'string' && manager) {
    done = await makeManager(db, id, manager);
  } else {
    return jsonError('Set a status or a manager', 400);
  }
  if (!done) {
    return jsonError('No such store or account', 404);
  }
  await publishStores(context);
  const store = await adminStore(db, id);
  return store ? privateJson({ store }) : jsonError('No such store', 404);
}
