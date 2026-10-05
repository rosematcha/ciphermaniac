/** Stores as an Admin's page lists them: each with its status, its Owner, and its Managers' names (the Owner's among them). */

import type { StoreStatus } from '../../../shared/accounts/stores.js';
import { displayNameSql } from '../accounts/handles.js';
import { rowsChanged } from '../d1.js';
import { handOver } from './db.js';
import type { D1Like } from '../types.js';

export interface AdminStore {
  id: string;
  leagueId: string;
  name: string;
  city: string;
  region: string;
  status: StoreStatus;
  owner: { id: string; name: string } | null;
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
  owner: string | null;
  managers: string | null;
}

const COLUMNS =
  's.id, s.league_id, s.name, s.city, s.region, s.status, s.created_at, ' +
  `(SELECT json_object('id', u.id, 'name', ${displayNameSql('u')}) FROM store_members m ` +
  "JOIN users u ON u.id = m.user_id WHERE m.store_id = s.id AND m.role = 'owner') AS owner, " +
  `(SELECT json_group_array(json_object('id', u.id, 'name', ${displayNameSql('u')})) FROM store_members m ` +
  "JOIN users u ON u.id = m.user_id WHERE m.store_id = s.id AND m.role IN ('owner', 'manager')) AS managers";

function fromRow(row: Row): AdminStore {
  return {
    id: row.id,
    leagueId: row.league_id,
    name: row.name,
    city: row.city,
    region: row.region,
    status: row.status === 'revoked' ? 'revoked' : 'active',
    owner: row.owner ? (JSON.parse(row.owner) as AdminStore['owner']) : null,
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

/**
 * Makes the account a Manager of the store, joining it if it was not in it;
 * its Owner stays its Owner. False when either is missing.
 */
export async function makeManager(db: D1Like, storeId: string, userId: string): Promise<boolean> {
  const done = await db
    .prepare(
      "INSERT INTO store_members (store_id, user_id, role, added_at) SELECT s.id, u.id, 'manager', ? " +
        'FROM stores s JOIN users u ON u.id = ? WHERE s.id = ? ' +
        "ON CONFLICT (store_id, user_id) DO UPDATE SET role = CASE store_members.role WHEN 'owner' THEN 'owner' " +
        "ELSE 'manager' END"
    )
    .bind(Date.now(), userId, storeId)
    .run();
  return rowsChanged(done) === 1;
}

/**
 * Hands the store to the account, joining it first if it was not in it: how
 * a store changes hands when its Owner cannot do it. The Owner before becomes
 * a Manager. False when the store or the account is missing.
 */
export async function makeOwner(db: D1Like, storeId: string, userId: string): Promise<boolean> {
  return (
    (await makeManager(db, storeId, userId)) && ((await handOver(db, storeId, userId)) || isOwner(db, storeId, userId))
  );
}

async function isOwner(db: D1Like, storeId: string, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS yes FROM store_members WHERE store_id = ? AND user_id = ? AND role = 'owner'")
    .bind(storeId, userId)
    .first<{ yes: number }>();
  return row !== null;
}
