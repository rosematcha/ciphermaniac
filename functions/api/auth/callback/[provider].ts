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
import { exchangeCode, isProviderId } from '../../../lib/auth/oauth.js';
import { createSession, SESSION_SECONDS, upsertUser } from '../../../lib/auth/session.js';
import { jsonError } from '../../../lib/api/responses.js';

/** The `next` path the login started with, when the callback's state matches it. */
function startedHere(request: Request, state: string | null): string | null {
  const [expected, next] = (readCookie(request, OAUTH_COOKIE) ?? '').split(' ');
  return state && expected && state === expected ? safeNext(next ?? null) : null;
}

export async function onRequestGet({ request, env, params }: Context<'provider'>): Promise<Response> {
  const provider = param(params.provider);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = startedHere(request, url.searchParams.get('state'));
  if (!env.TOURNAMENT_DB) {
    return jsonError('Sign-in is not available', 503);
  }
  if (!isProviderId(provider) || provider === 'dev' || !code || next === null) {
    return redirectWithCookies('/settings?signin=failed', [clearCookie(request, OAUTH_COOKIE)]);
  }
  try {
    const profile = await exchangeCode({ env, request, provider, code });
    const userId = await upsertUser(env.TOURNAMENT_DB, profile);
    const token = await createSession(env.TOURNAMENT_DB, userId);
    return redirectWithCookies(next, [
      clearCookie(request, OAUTH_COOKIE),
      cookie(request, SESSION_COOKIE, token, SESSION_SECONDS)
    ]);
  } catch (error) {
    console.error('Sign-in failed', error);
    return redirectWithCookies('/settings?signin=failed', [clearCookie(request, OAUTH_COOKIE)]);
  }
}
