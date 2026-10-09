/**
 * GET /api/admin/events — every event on the site, stores' and those run
 * under an account's own name alike, the last changed first: who runs it,
 * how far along it is and how many play.
 */

import type { AdminEvent } from '../../../shared/accounts/types.js';
import { displayNameSql } from '../../lib/accounts/handles.js';
import { openForAdmin } from '../../lib/auth/admin.js';
import type { Context } from '../../lib/auth/env.js';
import { privateJson } from '../../lib/tournaments/access.js';
import { pairedRounds } from '../../lib/tournaments/store.js';

/** More events than the list is any use past; a bound on the read. */
const MAX_EVENTS = 500;

interface EventRow {
  code: string;
  name: string | null;
  store_id: string | null;
  store_name: string | null;
  owner: string | null;
  players: number | null;
  start_date: string | null;
  finished: number | null;
  rounds: number | null;
  updated_at: number;
}

const eventOf = (row: EventRow): AdminEvent => ({
  code: row.code,
  name: row.name ?? '',
  store: row.store_id === null ? null : { id: row.store_id, name: row.store_name ?? '' },
  owner: row.owner ?? '',
  players: row.players ?? 0,
  startDate: row.start_date ?? '',
  finished: row.finished === 1,
  rounds: row.rounds ?? 0,
  updatedAt: row.updated_at
});

const QUERY =
  "SELECT t.code, json_extract(t.state, '$.info.name') AS name, t.store_id, s.name AS store_name, " +
  `${displayNameSql('u')} AS owner, json_array_length(t.state, '$.players') AS players, ` +
  "json_extract(t.state, '$.info.startDate') AS start_date, json_extract(t.settings, '$.finished') AS finished, " +
  `${pairedRounds('t.state')} AS rounds, t.updated_at FROM tournaments t ` +
  'LEFT JOIN stores s ON s.id = t.store_id LEFT JOIN users u ON u.id = t.owner_id ' +
  `ORDER BY t.updated_at DESC LIMIT ${MAX_EVENTS}`;

export async function onRequestGet(context: Context): Promise<Response> {
  const access = await openForAdmin(context);
  if (access instanceof Response) {
    return access;
  }
  const { results } = await access.db.prepare(QUERY).all<EventRow>();
  return privateJson({ events: results.map(eventOf) });
}
