/**
 * GET /api/admin/stores — every store, by name, with its status and its
 * Managers, for an Admin.
 * POST /api/admin/stores — an Admin makes an unsanctioned store, one with no
 * Play! Pokémon league yet: { owner: <account id>, details, timeZone, place? }
 * (shared/accounts/stores.ts). It runs unsanctioned events only and stays off
 * the locator until POST /api/admin/stores/:id gives it its league.
 * Answers { store } as the Admin's list shows it.
 */

import { readUnsanctionedStore } from '../../../../shared/accounts/stores.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import { openForAdmin } from '../../../lib/auth/admin.js';
import type { Context } from '../../../lib/auth/env.js';
import { randomToken } from '../../../lib/auth/session.js';
import { adminStore, adminStores } from '../../../lib/stores/admin.js';
import { storeInserts } from '../../../lib/stores/db.js';
import { privateJson } from '../../../lib/tournaments/access.js';

export async function onRequestGet(context: Context): Promise<Response> {
  const access = await openForAdmin(context);
  return access instanceof Response ? access : privateJson({ stores: await adminStores(access.db) });
}

export async function onRequestPost(context: Context): Promise<Response> {
  const access = await openForAdmin(context);
  if (access instanceof Response) {
    return access;
  }
  const { db } = access;
  const read = readUnsanctionedStore(await readJsonObject(context.request, 16 * 1024));
  if (typeof read === 'string') {
    return jsonError(read, 400);
  }
  const id = randomToken(12);
  const { owner, details, place, timeZone } = read;
  const store = { leagueId: null, details, lat: place?.lat ?? null, lon: place?.lon ?? null, timeZone, nights: [] };
  const guard = { sql: 'EXISTS (SELECT 1 FROM users WHERE id = ?)', values: [owner] };
  await db.batch(storeInserts(db, { id, store, member: { id: owner, role: 'owner' }, now: Date.now(), guard }));
  const made = await adminStore(db, id);
  return made ? privateJson({ store: made }, 201) : jsonError('No such account', 404);
}
