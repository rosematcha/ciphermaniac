/**
 * The age check between a provider's sign-in and an account. Ciphermaniac
 * holds no accounts for minors (shared/accounts/age.ts), so a sign-in that
 * would make an account, or reach one made before the check existed, makes
 * nothing yet: the provider's answer waits here, under a token in a cookie,
 * for a birth date. An adult's becomes the account with the year alone kept;
 * anyone else's is deleted. Each wait is used once and lasts fifteen minutes;
 * one that ran out goes at the next sign-up, age check or idle sweep, which
 * runs every fifteen minutes.
 */

import type { D1Like } from '../types.js';
import type { Profile } from './oauth.js';
import { randomToken, sha256 } from './session.js';

export const SIGNUP_SECONDS = 15 * 60;

/** A sign-up taken back out of its wait: the provider's answer, and where to go once in. */
export interface HeldSignup {
  profile: Profile;
  next: string;
}

/**
 * Whether this sign-in has to pass the age check first: no account has the
 * identity or its verified email, or the one that does never passed it (made
 * before the check existed). One read: the identity's owner, else the email's.
 */
export async function needsAgeCheck(db: D1Like, profile: Profile): Promise<boolean> {
  const email = profile.emailVerified ? profile.email?.trim().toLowerCase() || null : null;
  const row = await db
    .prepare(
      'SELECT age_checked_at FROM users WHERE id = COALESCE(' +
        '(SELECT user_id FROM identities WHERE provider = ? AND subject = ?), ' +
        '(SELECT id FROM users WHERE email IS NOT NULL AND email = ?))'
    )
    .bind(profile.provider, profile.subject, email)
    .first<{ age_checked_at: number | null }>();
  return !row?.age_checked_at;
}

/**
 * Keeps the provider's answer for the age check and returns the cookie's
 * token. A provider's display name is never kept (accounts start with a
 * random username), so it is dropped here too, except a dev sign-in's.
 */
export async function holdSignup(db: D1Like, profile: Profile, next: string, now = Date.now()): Promise<string> {
  const token = randomToken();
  const kept: Profile = { ...profile, name: profile.provider === 'dev' ? profile.name : '' };
  await db.batch([
    sweepSignups(db, now),
    db
      .prepare('INSERT INTO pending_signups (token_hash, profile, next, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(token), JSON.stringify(kept), next, now + SIGNUP_SECONDS * 1000)
  ]);
  return token;
}

function readProfile(value: string): Profile | null {
  try {
    const parsed = JSON.parse(value) as Partial<Profile>;
    return typeof parsed.provider === 'string' && typeof parsed.subject === 'string' ? (parsed as Profile) : null;
  } catch {
    return null;
  }
}

/** Deletes every wait that ran out. Each sign-up, each age check and the idle sweep run it. */
export const sweepSignups = (db: D1Like, now: number) =>
  db.prepare('DELETE FROM pending_signups WHERE expires_at <= ?').bind(now);

/**
 * Takes the wait out, once: two requests with one token cannot both make an
 * account, as only one delete returns the row. Null when there is none or it
 * ran out.
 */
export async function takeSignup(db: D1Like, token: string, now = Date.now()): Promise<HeldSignup | null> {
  const [taken] = await db.batch([
    db
      .prepare('DELETE FROM pending_signups WHERE token_hash = ? AND expires_at > ? RETURNING profile, next')
      .bind(await sha256(token), now),
    sweepSignups(db, now)
  ]);
  const row = (taken?.results as { profile: string; next: string }[] | undefined)?.[0] ?? null;
  const profile = row ? readProfile(row.profile) : null;
  return row && profile ? { profile, next: row.next } : null;
}
