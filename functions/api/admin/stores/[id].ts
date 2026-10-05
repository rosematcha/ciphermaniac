/**
 * POST /api/admin/stores/:id — an Admin acts on a store: { status: 'active' |
 * 'revoked' } (a revoked store starts no events, its events run on, and it
 * leaves the event locator), { manager: <account id> }, which makes that
 * account one of the store's Managers, joining it if need be: how a store
 * gets a Manager back when it lost touch with its own, or { owner: <account
 * id> }, which hands the store to that account, joining it if need be: how a
 * store changes hands when its Owner cannot hand it over.
 * Answers { store } as the Admin's list shows it.
 */

import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import { openForAdmin } from '../../../lib/auth/admin.js';
import { type Context, param } from '../../../lib/auth/env.js';
import { adminStore, makeManager, makeOwner } from '../../../lib/stores/admin.js';
import { setStatus } from '../../../lib/stores/db.js';
import { publishStores } from '../../../lib/stores/publish.js';
import { privateJson } from '../../../lib/tournaments/access.js';
import type { D1Like } from '../../../lib/types.js';

export async function onRequestPost(context: Context<'id'>): Promise<Response> {
  const access = await openForAdmin(context);
  if (access instanceof Response) {
    return access;
  }
  const { db, admin } = access;
  const id = param(context.params.id);
  const body = (await readJsonObject(context.request, 512)) ?? {};
  const acting = act(db, { id, adminId: admin.id, body });
  if (acting === null) {
    return jsonError('Set a status, a manager or an owner', 400);
  }
  if (!(await acting)) {
    return jsonError('No such store or account', 404);
  }
  await publishStores(context);
  const store = await adminStore(db, id);
  return store ? privateJson({ store }) : jsonError('No such store', 404);
}

/** Does what the body asks: whether it landed, or null when it asks nothing this route does. */
function act(
  db: D1Like,
  asked: { id: string; adminId: string; body: Record<string, unknown> }
): Promise<boolean> | null {
  const { id, adminId, body } = asked;
  const { status, manager, owner } = body;
  if (status === 'active' || status === 'revoked') {
    return setStatus(db, id, status, adminId);
  }
  if (typeof manager === 'string' && manager) {
    return makeManager(db, id, manager);
  }
  return typeof owner === 'string' && owner ? makeOwner(db, id, owner) : null;
}
