/**
 * GET /api/auth/callback/:provider — where Google or Discord sends the browser
 * back. The `state` must match the cookie set when sign-in started; then the
 * code is exchanged and the account found, or a provider added to the
 * signed-in one. A sign-in with no account behind it yet (or one made before
 * accounts asked a birth date) makes none here: it waits for the age check at
 * /welcome (see lib/auth/signup.ts).
 */

import {
  clearCookie,
  cookie,
  OAUTH_COOKIE,
  readCookie,
  redirectWithCookies,
  safeNext,
  SESSION_COOKIE,
  SIGNUP_COOKIE
} from '../../../lib/auth/cookies.js';
import { type Context, param } from '../../../lib/auth/env.js';
import { exchangeCode, isProviderId, type Profile } from '../../../lib/auth/oauth.js';
import { createSession, currentUser, linkIdentity, SESSION_SECONDS, upsertUser } from '../../../lib/auth/session.js';
import { holdSignup, needsAgeCheck, SIGNUP_SECONDS } from '../../../lib/auth/signup.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { D1Like } from '../../../lib/types.js';

interface Started {
  next: string;
  linking: boolean;
}

/** The `next` path the login started with, when the callback's state matches it. */
function startedHere(request: Request, state: string | null): Started | null {
  const [expected, next, intent] = (readCookie(request, OAUTH_COOKIE) ?? '').split(' ');
  return state && expected && state === expected ? { next: safeNext(next ?? null), linking: intent === 'link' } : null;
}

/** Adds the provider to the signed-in account; the error query when it can't. */
async function linkToCurrent(db: D1Like, request: Request, profile: Profile) {
  const user = await currentUser(db, request);
  if (!user) {
    return { userId: null, error: 'signin=failed' };
  }
  const linked = await linkIdentity(db, profile, user.id);
  return { userId: linked ? user.id : null, error: linked ? null : 'link=used' };
}

/** Where the browser goes, with its cookies, once the provider has said who this is. */
async function answer(db: D1Like, request: Request, profile: Profile, started: Started): Promise<Response> {
  const cleared = clearCookie(request, OAUTH_COOKIE);
  if (!started.linking && (await needsAgeCheck(db, profile))) {
    const token = await holdSignup(db, profile, started.next);
    return redirectWithCookies('/welcome', [cleared, cookie(request, SIGNUP_COOKIE, token, SIGNUP_SECONDS)]);
  }
  const { userId, error } = started.linking
    ? await linkToCurrent(db, request, profile)
    : { userId: await upsertUser(db, profile), error: null };
  if (!userId) {
    return redirectWithCookies(`/settings?${error}`, [cleared]);
  }
  const token = await createSession(db, userId);
  return redirectWithCookies(started.next, [cleared, cookie(request, SESSION_COOKIE, token, SESSION_SECONDS)]);
}

export async function onRequestGet({ request, env, params }: Context<'provider'>): Promise<Response> {
  const provider = param(params.provider);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const started = startedHere(request, url.searchParams.get('state'));
  if (!env.TOURNAMENT_DB) {
    return jsonError('Sign-in is not available', 503);
  }
  if (!isProviderId(provider) || provider === 'dev' || !code || !started) {
    return redirectWithCookies('/settings?signin=failed', [clearCookie(request, OAUTH_COOKIE)]);
  }
  try {
    const profile = await exchangeCode({ env, request, provider, code });
    return await answer(env.TOURNAMENT_DB, request, profile, started);
  } catch (error) {
    console.error('Sign-in failed', error);
    return redirectWithCookies('/settings?signin=failed', [clearCookie(request, OAUTH_COOKIE)]);
  }
}
