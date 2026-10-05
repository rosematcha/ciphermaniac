/**
 * The accounts with a role, as the admin page lists them: Community
 * organizers, those whose access was removed, and Admins, each with how many
 * events it owns.
 * The list reads the partial role index; each count reads the owner index.
 */

import { readAccountRole } from '../../../shared/accounts/roles.js';
import type { RoleHolder } from '../../../shared/accounts/types.js';
import { displayNameSql } from './handles.js';
import type { D1Like, D1Statement } from '../types.js';

export interface RoleHolderRow {
  id: string;
  name: string;
  email: string | null;
  pop_id: string | null;
  role: string | null;
  role_at: number | null;
  events: number;
}

const COLUMNS =
  `u.id, ${displayNameSql('u')} AS name, u.email, u.pop_id, u.role, u.role_at, ` +
  '(SELECT COUNT(*) FROM tournaments t WHERE t.owner_id = u.id) AS events';

/** More accounts with a role than the site will have for a long while; a bound on a read gone wrong. */
const MAX_ROLE_HOLDERS = 500;

export async function roleHolders(db: D1Like): Promise<RoleHolder[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM users u WHERE u.role IN ('community', 'revoked', 'admin') ` +
        `ORDER BY name LIMIT ${MAX_ROLE_HOLDERS}`
    )
    .all<RoleHolderRow>();
  return results.flatMap(row => holderOf(row) ?? []);
}

/** The read of one account as the list shows it, for a batch to answer with. */
export const roleHolderQuery = (db: D1Like, id: string): D1Statement =>
  db.prepare(`SELECT ${COLUMNS} FROM users u WHERE u.id = ?`).bind(id);

/** The account as the list shows it; null when it holds no role. */
export function holderOf(row: RoleHolderRow): RoleHolder | null {
  const role = readAccountRole(row.role);
  return (
    role && {
      id: row.id,
      name: row.name,
      email: row.email,
      popId: row.pop_id,
      role,
      roleAt: row.role_at,
      events: row.events
    }
  );
}
