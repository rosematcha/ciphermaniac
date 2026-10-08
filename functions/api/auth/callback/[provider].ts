/**
 * GET /api/auth/callback/:provider — where Google or Discord sends the browser
 * back. The `state` must match the cookie set when sign-in started; then the
 * code is exchanged and the account found, or a provider added to the
 * signed-in one. A sign-in with no account behind it yet (or one made before
 * accounts asked a birth date) makes none here: it waits for the age check at
 * /welcome (see lib/auth/signup.ts).
 */

import { clearCookie, OAUTH_COOKIE, readCookie, redirectWithCookies, safeNext } from '../../../lib/auth/cookies.js';
import { type Context, param } from '../../../lib/auth/env.js';
import { finishSignIn, type Started } from '../../../lib/auth/finish.js';
import { exchangeCode, isRedirectProvider } from '../../../lib/auth/oauth.js';
import { jsonError } from '../../../lib/api/responses.js';

/** The `next` path the login started with, when the callback's state matches it. */
function startedHere(request: Request, state: string | null): Started | null {
  const [expected, next, intent] = (readCookie(request, OAUTH_COOKIE) ?? '').split(' ');
  return state && expected && state === expected ? { next: safeNext(next ?? null), linking: intent === 'link' } : null;
}

export async function onRequestGet({ request, env, params }: Context<'provider'>): Promise<Response> {
  const provider = param(params.provider);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const started = startedHere(request, url.searchParams.get('state'));
  if (!env.TOURNAMENT_DB) {
    return jsonError('Sign-in is not available', 503);
  }
  if (!isRedirectProvider(provider) || provider === 'dev' || !code || !started) {
    return redirectWithCookies('/settings?signin=failed', [clearCookie(request, OAUTH_COOKIE)]);
  }
  try {
    const profile = await exchangeCode({ env, request, provider, code });
    return await finishSignIn(env.TOURNAMENT_DB, request, profile, {
      ...started,
      cookies: [clearCookie(request, OAUTH_COOKIE)]
    });
  } catch (error) {
    console.error('Sign-in failed', error);
    return redirectWithCookies('/settings?signin=failed', [clearCookie(request, OAUTH_COOKIE)]);
  }
}
