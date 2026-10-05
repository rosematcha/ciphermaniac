/**
 * GET /api/auth/login/:provider?next=/path — starts sign-in.
 *
 * Google and Discord redirect to the provider with a fresh `state`, which is
 * also set in a ten-minute cookie alongside where to return afterwards. The
 * dev provider (local only, see lib/auth/oauth.ts) signs in straight away as
 * `?name=`, born on `?birth=` (YYYY-MM-DD; an adult's date when absent, and
 * refused when it is a minor's), or with `?gate=1` waits at the age check as
 * a provider's new sign-up does.
 */

import { birthYearOfDate, isAdult } from '../../../../shared/accounts/age.js';
import { birthDateOfYear } from '../../../../shared/tournament/divisions.js';
import {
  cookie,
  OAUTH_COOKIE,
  redirectWithCookies,
  safeNext,
  SESSION_COOKIE,
  SIGNUP_COOKIE
} from '../../../lib/auth/cookies.js';
import { type Context, param } from '../../../lib/auth/env.js';
import { authorizeUrl, devLoginEnabled, devProfile, isProviderId } from '../../../lib/auth/oauth.js';
import { createSession, currentUser, randomToken, SESSION_SECONDS, upsertUser } from '../../../lib/auth/session.js';
import { holdSignup, SIGNUP_SECONDS } from '../../../lib/auth/signup.js';
import { jsonError } from '../../../lib/api/responses.js';

const STATE_SECONDS = 10 * 60;

/** A dev account's birth date when the sign-in names none: an adult's. */
const DEV_BIRTH = '1990-01-01';

async function devSignIn({ request, env }: Context<'provider'>, next: string): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!devLoginEnabled(env) || !db) {
    return jsonError('Not found', 404);
  }
  const query = new URL(request.url).searchParams;
  const profile = devProfile(query.get('name') ?? '');
  if (query.get('gate') === '1') {
    const token = await holdSignup(db, profile, next);
    return redirectWithCookies('/welcome', [cookie(request, SIGNUP_COOKIE, token, SIGNUP_SECONDS)]);
  }
  const birth = query.get('birth') ?? DEV_BIRTH;
  const now = new Date();
  const year = birthYearOfDate(birth, now);
  if (year === null || !isAdult(birth, now)) {
    return jsonError('Accounts are for adults', 403);
  }
  const userId = await upsertUser(db, profile, birthDateOfYear(year));
  const token = await createSession(db, userId);
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
  const linking = new URL(context.request.url).searchParams.get('link') === '1';
  if (linking && (!context.env.TOURNAMENT_DB || !(await currentUser(context.env.TOURNAMENT_DB, context.request)))) {
    return jsonError('Sign in first', 401);
  }
  const state = randomToken(16);
  const url = authorizeUrl(context.env, context.request, provider, state);
  if (!url) {
    return jsonError(`${provider} sign-in is not configured`, 503);
  }
  return redirectWithCookies(url, [
    cookie(context.request, OAUTH_COOKIE, `${state} ${next} ${linking ? 'link' : 'login'}`, STATE_SECONDS)
  ]);
}
