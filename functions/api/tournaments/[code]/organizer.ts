/**
 * PUT /api/tournaments/:code/organizer — the event's staff name its
 * organizer of record, the certified organizer TOM writes into the .tdf
 * (<organizer popid name>) and Play! Pokémon reads results under: { user },
 * one of the store's Managers or Staff with a POP ID on file. Only a store's
 * Swiss event: a Community organizer's is never reported, and a TOM event's
 * organizer is whoever TOM says.
 */

import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { openForStaff } from '../../../lib/tournaments/access.js';
import { answerStaff } from '../../../lib/tournaments/answers.js';
import { mutate } from '../../../lib/tournaments/store.js';

interface Member {
  pop_id: string | null;
  first_name: string | null;
  last_name: string | null;
}

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const { db, row } = access;
  if (row.storeId === null || row.mode !== 'swiss') {
    return jsonError('Only a store’s Swiss event names its organizer here', 400);
  }
  const user = (await readJsonObject(context.request, 256))?.user;
  const member =
    typeof user === 'string'
      ? await db
          .prepare(
            'SELECT u.pop_id, u.first_name, u.last_name FROM store_members m JOIN users u ON u.id = m.user_id ' +
              'WHERE m.store_id = ? AND m.user_id = ?'
          )
          .bind(row.storeId, user)
          .first<Member>()
      : null;
  if (!member?.pop_id) {
    return jsonError('Pick someone from the store with a POP ID on file', 400);
  }
  const organizerName = [member.first_name, member.last_name].filter(Boolean).join(' ');
  const organizer = { organizerPopId: member.pop_id, organizerName };
  const outcome = await mutate(db, row, current => ({
    tournament: { ...current.tournament, info: { ...current.tournament.info, ...organizer } }
  }));
  return answerStaff(context, access, outcome);
}
