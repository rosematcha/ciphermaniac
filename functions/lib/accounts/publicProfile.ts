/**
 * An account's public profile: its history, shown at /u/<slug> to anyone with
 * the link. The address is the whole switch, one column and one index: NULL
 * keeps the history private.
 */

import type { User } from '../auth/session.js';
import { firstRow } from '../d1.js';
import { isCode, newCode } from '../tournaments/store.js';
import type { D1Like } from '../types.js';

/** Eight characters of the event-code alphabet: easy to read out, and too many to stumble on. */
const SLUG_LENGTH = 8;

/** Whether `value` could be a profile's address, before asking the database whose it is. */
export const isProfileSlug = (value: string) => isCode(value, SLUG_LENGTH);

/**
 * The account's address, drawing one when it has none. The draw lands only
 * on an account with no address, and the read in the same batch answers what
 * is stored: when another request turned the profile on first, that address
 * stands and both answer it. Nothing stored means the unique index refused
 * an address another account holds, and the next draw tries again.
 */
async function drawSlug(db: D1Like, userId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [, stored] = await db.batch([
      db
        .prepare('UPDATE OR IGNORE users SET public_slug = ? WHERE id = ? AND public_slug IS NULL')
        .bind(newCode(SLUG_LENGTH), userId),
      db.prepare('SELECT public_slug FROM users WHERE id = ?').bind(userId)
    ]);
    const slug = firstRow<{ public_slug: string | null }>(stored)?.public_slug;
    if (slug) {
      return slug;
    }
  }
  throw new Error('Could not find a free profile address');
}

/**
 * Turns the profile on or off, and answers its address (null when off). A
 * profile already on keeps its address, as stored when the request lands,
 * not as this request read it. Off forgets the address, so turning it on
 * again gives a new one and a link shared before stays dead.
 */
export async function setPublicProfile(db: D1Like, user: User, on: boolean): Promise<string | null> {
  if (on) {
    return drawSlug(db, user.id);
  }
  await db.prepare('UPDATE users SET public_slug = NULL WHERE id = ?').bind(user.id).run();
  return null;
}
