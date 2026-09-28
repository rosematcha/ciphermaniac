/**
 * GET /api/me — who is signed in, and which sign-in buttons to show.
 * PUT /api/me — saves the player profile (POP ID, name, birth date) that
 * decklist submission and "find my pairing" read.
 */

import { readProfile } from '../../shared/tournament/profile.js';
import { readJsonBody } from '../lib/api/body.js';
import { jsonError, jsonResponse } from '../lib/api/responses.js';
import { type Context, sameOrigin } from '../lib/auth/env.js';
import { availableProviders } from '../lib/auth/oauth.js';
import { currentUser } from '../lib/auth/session.js';

const PRIVATE = { cacheControl: 'no-store', cors: false } as const;

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const user = env.TOURNAMENT_DB ? await currentUser(env.TOURNAMENT_DB, request) : null;
  return jsonResponse({ user, providers: availableProviders(env) }, PRIVATE);
}

export async function onRequestPut({ request, env }: Context): Promise<Response> {
  if (!env.TOURNAMENT_DB || !sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  const user = await currentUser(env.TOURNAMENT_DB, request);
  if (!user) {
    return jsonError('Sign in first', 401);
  }
  const body = await readJsonBody(request, 2048);
  const profile = body.ok ? readProfile(body.value) : null;
  if (!profile) {
    return jsonError('Not a valid profile', 400);
  }
  await env.TOURNAMENT_DB.prepare(
    'UPDATE users SET pop_id = ?, first_name = ?, last_name = ?, birth_date = ? WHERE id = ?'
  )
    .bind(profile.popId, profile.firstName, profile.lastName, profile.birthDate, user.id)
    .run();
  return jsonResponse({ user: { ...user, ...profile } }, PRIVATE);
}
