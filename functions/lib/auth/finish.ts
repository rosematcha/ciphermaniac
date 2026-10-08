/**
 * The end of every sign-in, once something has said who this is: a profile
 * from Google or Discord's callback, or from a Clerk token
 * (functions/api/auth/clerk.ts). A new sign-up waits for the age check; a
 * known account gets a session; a link adds the identity to the signed-in
 * account.
 */

import { cookie, redirectWithCookies, SESSION_COOKIE, SIGNUP_COOKIE } from './cookies.js';
import type { Profile } from './oauth.js';
import { createSession, currentUser, linkIdentity, SESSION_SECONDS, upsertUser } from './session.js';
import { holdSignup, needsAgeCheck, SIGNUP_SECONDS } from './signup.js';
import type { D1Like } from '../types.js';

export interface Started {
  next: string;
  linking: boolean;
  /** Set along the way whatever the outcome, such as clearing the OAuth state cookie. */
  cookies?: readonly string[];
}

/** Adds the identity to the signed-in account; the error query when it can't. */
async function linkToCurrent(db: D1Like, request: Request, profile: Profile) {
  const user = await currentUser(db, request);
  if (!user) {
    return { userId: null, error: 'signin=failed' };
  }
  const linked = await linkIdentity(db, profile, user.id);
  return { userId: linked ? user.id : null, error: linked ? null : 'link=used' };
}

/** Where the browser goes, with its cookies. */
export async function finishSignIn(
  db: D1Like,
  request: Request,
  profile: Profile,
  started: Started
): Promise<Response> {
  const cookies = started.cookies ?? [];
  if (!started.linking && (await needsAgeCheck(db, profile))) {
    const token = await holdSignup(db, profile, started.next);
    return redirectWithCookies('/welcome', [...cookies, cookie(request, SIGNUP_COOKIE, token, SIGNUP_SECONDS)]);
  }
  const { userId, error } = started.linking
    ? await linkToCurrent(db, request, profile)
    : { userId: await upsertUser(db, profile), error: null };
  if (!userId) {
    return redirectWithCookies(`/settings?${error}`, cookies);
  }
  const token = await createSession(db, userId);
  return redirectWithCookies(started.next, [...cookies, cookie(request, SESSION_COOKIE, token, SESSION_SECONDS)]);
}
