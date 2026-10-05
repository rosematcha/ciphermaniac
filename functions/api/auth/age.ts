/**
 * POST /api/auth/age — the age check a new sign-up waits on (see
 * lib/auth/signup.ts): { birthDate: 'YYYY-MM-DD' } with the cookie the
 * callback set. 18 or older makes the account, keeping the birth year and
 * nothing finer, starts a session and answers where to go ({ next }).
 * Younger makes nothing and deletes what the provider sent (403, { minor:
 * true }). A date that is no date is refused without using the wait up; a
 * wait that is gone or ran out asks for sign-in again (410).
 */

import { birthYearOfDate, isAdult } from '../../../shared/accounts/age.js';
import { birthDateOfYear } from '../../../shared/tournament/divisions.js';
import { readJsonObject } from '../../lib/api/body.js';
import { jsonError } from '../../lib/api/responses.js';
import { clearCookie, cookie, readCookie, SESSION_COOKIE, SIGNUP_COOKIE } from '../../lib/auth/cookies.js';
import { type Context, sameOrigin } from '../../lib/auth/env.js';
import { createSession, SESSION_SECONDS, upsertUser } from '../../lib/auth/session.js';
import { rejectSignup } from '../../lib/auth/rejection.js';
import { takeSignup } from '../../lib/auth/signup.js';

/** What a minor is told; nothing about them was kept. */
export const ADULTS_ONLY = 'Ciphermaniac accounts are for people 18 and older.';

function answer(status: number, body: unknown, cookies: readonly string[]): Response {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  for (const value of cookies) {
    headers.append('Set-Cookie', value);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!db || !sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  const token = readCookie(request, SIGNUP_COOKIE);
  const body = await readJsonObject(request, 256);
  const birthDate = typeof body?.birthDate === 'string' ? body.birthDate : '';
  const now = new Date();
  const year = birthYearOfDate(birthDate, now);
  if (year === null) {
    return jsonError('Enter your birth date', 400);
  }
  const held = token ? await takeSignup(db, token, now.getTime()) : null;
  const cleared = clearCookie(request, SIGNUP_COOKIE);
  if (!held) {
    return answer(410, { error: 'Sign in again to continue' }, [cleared]);
  }
  if (!isAdult(birthDate, now)) {
    await rejectSignup(db, held.profile, env.PROOFS);
    return answer(403, { error: ADULTS_ONLY, minor: true }, [cleared]);
  }
  const userId = await upsertUser(db, held.profile, birthDateOfYear(year));
  const session = await createSession(db, userId);
  return answer(200, { next: held.next }, [cleared, cookie(request, SESSION_COOKIE, session, SESSION_SECONDS)]);
}
