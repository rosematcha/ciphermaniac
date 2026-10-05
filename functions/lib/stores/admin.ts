/** Stores as an Admin's page lists them: each with its status and its Managers' names. */

import type { StoreStatus } from '../../../shared/accounts/stores.js';
import { displayNameSql } from '../accounts/handles.js';
import { rowsChanged } from '../d1.js';
import type { D1Like } from '../types.js';

export interface AdminStore {
  id: string;
  leagueId: string;
  name: string;
  city: string;
  region: string;
  status: StoreStatus;
  managers: { id: string; name: string }[];
  createdAt: number;
}

interface Row {
  id: string;
  league_id: string;
  name: string;
  city: string;
  region: string;
  status: string;
  created_at: number;
  managers: string | null;
}

const COLUMNS =
  's.id, s.league_id, s.name, s.city, s.region, s.status, s.created_at, ' +
  `(SELECT json_group_array(json_object('id', u.id, 'name', ${displayNameSql('u')})) FROM store_members m ` +
  "JOIN users u ON u.id = m.user_id WHERE m.store_id = s.id AND m.role = 'manager') AS managers";

function fromRow(row: Row): AdminStore {
  return {
    id: row.id,
    leagueId: row.league_id,
    name: row.name,
    city: row.city,
    region: row.region,
    status: row.status === 'revoked' ? 'revoked' : 'active',
    managers: JSON.parse(row.managers ?? '[]') as AdminStore['managers'],
    createdAt: row.created_at
  };
}

export async function adminStores(db: D1Like): Promise<AdminStore[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM stores s WHERE s.status IN ('active', 'revoked') ORDER BY s.name LIMIT 1000`)
    .all<Row>();
  return results.map(fromRow);
}

export async function adminStore(db: D1Like, id: string): Promise<AdminStore | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM stores s WHERE s.id = ?`).bind(id).first<Row>();
  return row && fromRow(row);
}

/** Makes the account a Manager of the store, joining it if it was not in it; false when either is missing. */
export async function makeManager(db: D1Like, storeId: string, userId: string): Promise<boolean> {
  const done = await db
    .prepare(
      "INSERT INTO store_members (store_id, user_id, role, added_at) SELECT s.id, u.id, 'manager', ? " +
        'FROM stores s JOIN users u ON u.id = ? WHERE s.id = ? ' +
        "ON CONFLICT (store_id, user_id) DO UPDATE SET role = 'manager'"
    )
    .bind(Date.now(), userId, storeId)
    .run();
  return rowsChanged(done) === 1;
}
