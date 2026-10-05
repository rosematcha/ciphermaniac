/**
 * GET /api/stores/:id — what anyone may read about a store: where it is,
 * what it says about itself, its league nights, and its events on the site
 * that have not ended. Its Managers and Staff also get its phone and email,
 * and what they are in it ({ store, role, contact? }).
 * PATCH /api/stores/:id — a Manager changes what the store says about itself
 * ({ details, timeZone, place? }; shared/accounts/stores.ts), `place` being
 * where it is on the map, which the locator needs to show its league nights.
 * The league ID stays: a store moves to another league only by an Admin.
 */

import { isTimeZone, readPlace, readStoreDetails } from '../../../../shared/accounts/stores.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { openStore } from '../../../lib/stores/access.js';
import { loadStore, publicStore, saveDetails, storeEvents } from '../../../lib/stores/db.js';
import { publishStores } from '../../../lib/stores/publish.js';
import { privateJson } from '../../../lib/tournaments/access.js';
import { pairedRounds } from '../../../lib/tournaments/store.js';

export async function onRequestGet(context: Context<'id'>): Promise<Response> {
  const access = await openStore(context, 'anyone');
  if (access instanceof Response) {
    return access;
  }
  const { db, store, role } = access;
  const events = await storeEvents(db, store.id, pairedRounds('state'));
  const contact = role ? { phone: store.phone, email: store.email } : undefined;
  return privateJson({ store: publicStore(store, events), role, ...(contact ? { contact } : {}) });
}

export async function onRequestPatch(context: Context<'id'>): Promise<Response> {
  const access = await openStore(context, 'manager');
  if (access instanceof Response) {
    return access;
  }
  const body = await readJsonObject(context.request, 8 * 1024);
  const details = readStoreDetails(body?.details);
  const timeZone = typeof body?.timeZone === 'string' && isTimeZone(body.timeZone) ? body.timeZone : null;
  const place = readPlace(body?.place);
  if (!details || !timeZone || place === undefined) {
    return jsonError('Check the store’s details', 400);
  }
  const saved = await saveDetails(access.db, access.store.id, { details, timeZone, place }, access.guard('manager'));
  if (!saved) {
    return jsonError('Only this store’s managers can do that', 403);
  }
  await publishStores(context);
  const store = await loadStore(access.db, access.store.id);
  return store ? privateJson({ store }) : jsonError('No such store', 404);
}
