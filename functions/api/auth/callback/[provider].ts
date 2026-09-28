/**
 * GET /api/auth/callback/:provider — where Google or Discord sends the browser
 * back. The `state` must match the cookie set when sign-in started; then the
 * code is exchanged, the account found or created, and a session begun.
 */

import {
  clearCookie,
  cookie,
  OAUTH_COOKIE,
  readCookie,
  redirectWithCookies,
  safeNext,
  SESSION_COOKIE
} from '../../../lib/auth/cookies.js';
import { type Context, param } from '../../../lib/auth/env.js';
import { exchangeCode, isProviderId, type Profile } from '../../../lib/auth/oauth.js';
import { createSession, currentUser, linkIdentity, SESSION_SECONDS, upsertUser } from '../../../lib/auth/session.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { D1Like } from '../../../lib/types.js';

/** The `next` path the login started with, when the callback's state matches it. */
function startedHere(request: Request, state: string | null): { next: string; linking: boolean } | null {
  const [expected, next, intent] = (readCookie(request, OAUTH_COOKIE) ?? '').split(' ');
  return state && expected && state === expected ? { next: safeNext(next ?? null), linking: intent === 'link' } : null;
}

async function accountForCallback(db: D1Like, request: Request, profile: Profile, linking: boolean) {
  if (!linking) {
    return { userId: await upsertUser(db, profile), error: null };
  }
  const user = await currentUser(db, request);
  if (!user) {
    return { userId: null, error: 'signin=failed' };
  }
  const linked = await linkIdentity(db, profile, user.id);
  return { userId: linked ? user.id : null, error: linked ? null : 'link=used' };
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
    const { userId, error } = await accountForCallback(env.TOURNAMENT_DB, request, profile, started.linking);
    if (!userId) {
      return redirectWithCookies(`/settings?${error}`, [clearCookie(request, OAUTH_COOKIE)]);
    }
    const token = await createSession(env.TOURNAMENT_DB, userId);
    return redirectWithCookies(started.next, [
      clearCookie(request, OAUTH_COOKIE),
      cookie(request, SESSION_COOKIE, token, SESSION_SECONDS)
    ]);
  } catch (error) {
    console.error('Sign-in failed', error);
    return redirectWithCookies('/settings?signin=failed', [clearCookie(request, OAUTH_COOKIE)]);
  }
}
