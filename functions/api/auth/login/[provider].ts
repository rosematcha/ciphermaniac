/**
 * GET /api/auth/login/:provider?next=/path — starts sign-in.
 *
 * Google and Discord redirect to the provider with a fresh `state`, which is
 * also set in a ten-minute cookie alongside where to return afterwards. The
 * dev provider (local only, see lib/auth/oauth.ts) signs in straight away as
 * `?name=`.
 */

import { cookie, OAUTH_COOKIE, redirectWithCookies, safeNext, SESSION_COOKIE } from '../../../lib/auth/cookies.js';
import { type Context, param } from '../../../lib/auth/env.js';
import { authorizeUrl, devLoginEnabled, devProfile, isProviderId } from '../../../lib/auth/oauth.js';
import { createSession, randomToken, SESSION_SECONDS, upsertUser } from '../../../lib/auth/session.js';
import { jsonError } from '../../../lib/api/responses.js';

const STATE_SECONDS = 10 * 60;

async function devSignIn({ request, env }: Context<'provider'>, next: string): Promise<Response> {
  if (!devLoginEnabled(env) || !env.TOURNAMENT_DB) {
    return jsonError('Not found', 404);
  }
  const name = new URL(request.url).searchParams.get('name') ?? '';
  const userId = await upsertUser(env.TOURNAMENT_DB, devProfile(name));
  const token = await createSession(env.TOURNAMENT_DB, userId);
  return redirectWithCookies(next, [cookie(request, SESSION_COOKIE, token, SESSION_SECONDS)]);
}

export async function onRequestGet(context: Context<'provider'>): Promise<Response> {
  const provider = param(context.params.provider);
  const next = safeNext(new URL(context.request.url).searchParams.get('next'));
  if (!isProviderId(provider)) {
    return jsonError('Unknown sign-in provider', 404);
  }
  if (provider === 'dev') {
    return devSignIn(context, next);
  }
  const state = randomToken(16);
  const url = authorizeUrl(context.env, context.request, provider, state);
  if (!url) {
    return jsonError(`${provider} sign-in is not configured`, 503);
  }
  return redirectWithCookies(url, [cookie(context.request, OAUTH_COOKIE, `${state} ${next}`, STATE_SECONDS)]);
}
