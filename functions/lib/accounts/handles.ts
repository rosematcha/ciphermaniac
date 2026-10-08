/**
 * Changing an account's Username (shared/accounts/handle.ts). The change and
 * its record go in one batch, and the record's insert is the whole check: it
 * lands only while the account has changes left today, no one else holds the
 * username or let it go within the day, and the username is new to the
 * account. The update lands only where this request's record did, found by
 * a token of its own, so a request that lost cannot borrow another's record
 * made in the same millisecond. D1 runs one batch at
 * a time, so two requests cannot both pass a check the other changes.
 */

import { DAY_MS, handleKey, RENAMES_PER_DAY } from '../../../shared/accounts/handle.js';
import { randomToken } from '../auth/session.js';
import { rowsChanged } from '../d1.js';
import type { D1Like } from '../types.js';

/** `handleKey` in SQL, written as the users_by_handle_key index is, so a lookup by key uses it. */
export const handleKeySql = (column: string) => `replace(replace(replace(${column}, '.', ''), '-', ''), '_', '')`;

/** The name the site calls the account in `alias` by, as `displayName` makes it. */
export const displayNameSql = (alias: string) =>
  `COALESCE(NULLIF(TRIM(COALESCE(${alias}.first_name, '') || ' ' || COALESCE(${alias}.last_name, '')), ''), ${alias}.handle)`;

export type RenameRefusal = 'taken' | 'limit';

function renameWrites(db: D1Like, userId: string, handle: string, now: number) {
  const token = randomToken(12);
  // The account's changes older than a day count for nothing now.
  const sweep = db.prepare('DELETE FROM handle_changes WHERE user_id = ? AND at <= ?').bind(userId, now - DAY_MS);
  // A change in the same millisecond as the account's last takes the next one, so the
  // (user_id, at) key never drops it and calls a free username taken.
  const record = db
    .prepare(
      `INSERT OR IGNORE INTO handle_changes (user_id, at, old_key, handle, token) ` +
        `SELECT u.id, max(?2, coalesce((SELECT max(at) + 1 FROM handle_changes WHERE user_id = ?1), ?2)), ` +
        `${handleKeySql('u.handle')}, ?3, ?5 FROM users u WHERE u.id = ?1 AND u.handle IS NOT ?3 ` +
        `AND (SELECT COUNT(*) FROM handle_changes WHERE user_id = ?1 AND at > ?2 - ${DAY_MS}) < ${RENAMES_PER_DAY} ` +
        `AND NOT EXISTS (SELECT 1 FROM users WHERE ${handleKeySql('handle')} = ?4 AND id <> ?1) ` +
        `AND NOT EXISTS (SELECT 1 FROM handle_changes WHERE old_key = ?4 AND at > ?2 - ${DAY_MS} AND user_id <> ?1)`
    )
    .bind(userId, now, handle, handleKey(handle), token);
  const update = db
    .prepare(
      'UPDATE users SET handle = ?2 WHERE id = ?1 ' +
        'AND EXISTS (SELECT 1 FROM handle_changes WHERE user_id = ?1 AND token = ?3)'
    )
    .bind(userId, handle, token);
  return [sweep, record, update];
}

/** Why a change that did not land was refused: the day's changes used up, or the username someone else's. */
async function refusal(db: D1Like, userId: string, now: number): Promise<RenameRefusal> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM handle_changes WHERE user_id = ? AND at > ?')
    .bind(userId, now - DAY_MS)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= RENAMES_PER_DAY ? 'limit' : 'taken';
}

/**
 * Changes the account's username to `handle` (normalized and checked by
 * `handleProblem`), or answers why not. A username the account already has
 * is no change and costs none of the day's.
 */
export async function renameAccount(
  db: D1Like,
  user: { id: string; handle: string },
  handle: string,
  now = Date.now()
): Promise<RenameRefusal | null> {
  if (handle === user.handle) {
    return null;
  }
  const [, , updated] = await db.batch(renameWrites(db, user.id, handle, now));
  return rowsChanged(updated) === 1 ? null : refusal(db, user.id, now);
}
