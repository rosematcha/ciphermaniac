/**
 * An account's public profile: its history, shown at /u/<slug> to anyone with
 * the link. The address is the whole switch, one column and one index: NULL
 * keeps the history private.
 */

import type { User } from '../auth/session.js';
import { rowsChanged } from '../d1.js';
import { newCode } from '../tournaments/store.js';
import type { D1Like } from '../types.js';

/** Eight characters of the event-code alphabet: easy to read out, and too many to stumble on. */
const SLUG_LENGTH = 8;

/** A new address for the account's profile, drawn again while the unique index refuses one another account holds. */
async function drawSlug(db: D1Like, userId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = newCode(SLUG_LENGTH);
    const set = await db.prepare('UPDATE OR IGNORE users SET public_slug = ? WHERE id = ?').bind(slug, userId).run();
    if (rowsChanged(set) === 1) {
      return slug;
    }
  }
  throw new Error('Could not find a free profile address');
}

/**
 * Turns the profile on or off, and answers its address (null when off). A
 * profile already on keeps its address. Off forgets the address, so turning
 * it on again gives a new one and a link shared before stays dead.
 */
export async function setPublicProfile(db: D1Like, user: User, on: boolean): Promise<string | null> {
  if (on) {
    return user.publicSlug ?? drawSlug(db, user.id);
  }
  await db.prepare('UPDATE users SET public_slug = NULL WHERE id = ?').bind(user.id).run();
  return null;
}
