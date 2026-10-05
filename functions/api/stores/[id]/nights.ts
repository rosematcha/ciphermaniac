/**
 * PUT /api/stores/:id/nights — a Manager replaces the store's league nights
 * and the dates they don't run as usual: { nights, exceptions }
 * (shared/accounts/stores.ts). Past exceptions are dropped as they are
 * saved. The event locator shows the change within minutes.
 */

import { dateIn, readExceptions, readNights } from '../../../../shared/accounts/stores.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { openStore } from '../../../lib/stores/access.js';
import { saveNights } from '../../../lib/stores/db.js';
import { publishStores } from '../../../lib/stores/publish.js';
import { privateJson } from '../../../lib/tournaments/access.js';

export async function onRequestPut(context: Context<'id'>): Promise<Response> {
  const access = await openStore(context, 'manager');
  if (access instanceof Response) {
    return access;
  }
  const body = await readJsonObject(context.request, 16 * 1024);
  const nights = readNights(body?.nights);
  const exceptions = nights && readExceptions(body?.exceptions ?? [], nights);
  if (!nights || !exceptions) {
    return jsonError('Check the league nights', 400);
  }
  const today = dateIn(access.store.timeZone, Date.now());
  const ahead = exceptions.filter(exception => exception.date >= today);
  if (!(await saveNights(access.db, access.store.id, { nights, exceptions: ahead }, access.guard('manager')))) {
    return jsonError('Only this store’s managers can do that', 403);
  }
  await publishStores(context);
  return privateJson({ nights, exceptions: ahead });
}
