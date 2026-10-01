/**
 * GET /api/me — who is signed in, and which sign-in buttons to show.
 * PUT /api/me — saves the player profile (POP ID, name, birth date) that
 * decklist submission and "find my pairing" read. One account holds a POP ID,
 * the first to save it: another account saving it gets a 409 and none of its
 * profile is saved. An account that changes its POP ID lets go of the players
 * it was at events as the old one.
 */

import { type PlayerProfile, readProfile } from '../../shared/tournament/profile.js';
import { readJsonBody, readJsonObject } from '../lib/api/body.js';
import { jsonError, jsonResponse } from '../lib/api/responses.js';
import { type Context, sameOrigin } from '../lib/auth/env.js';
import { availableProviders } from '../lib/auth/oauth.js';
import { currentAccount, type User } from '../lib/auth/session.js';
import { rowsChanged } from '../lib/d1.js';
import type { D1Like } from '../lib/types.js';

const PRIVATE = { cacheControl: 'no-store', cors: false } as const;

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const user = env.TOURNAMENT_DB ? await currentAccount(env.TOURNAMENT_DB, request) : null;
  return jsonResponse({ user, providers: availableProviders(env) }, PRIVATE);
}

/**
 * The writes that save a profile, the profile itself first. The unique POP ID
 * index makes the update ignore a POP ID another account holds, and it counts
 * a row it matched as changed even when nothing in it differs, so no change
 * means the POP ID is taken. With a new POP ID, the account's reporter rows
 * under the old one go too, but only once the update has landed.
 */
function profileWrites(db: D1Like, user: User, profile: PlayerProfile) {
  const update = db
    .prepare('UPDATE OR IGNORE users SET pop_id = ?, first_name = ?, last_name = ?, birth_date = ? WHERE id = ?')
    .bind(profile.popId, profile.firstName, profile.lastName, profile.birthDate, user.id);
  if (!user.popId || user.popId === profile.popId) {
    return [update];
  }
  const release = db
    .prepare(
      'DELETE FROM report_devices WHERE user_id = ? AND player_id = ? ' +
        'AND EXISTS (SELECT 1 FROM users WHERE id = ? AND pop_id = ?)'
    )
    .bind(user.id, user.popId, user.id, profile.popId);
  return [update, release];
}

export async function onRequestPut({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!db || !sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  const user = await currentAccount(db, request);
  if (!user) {
    return jsonError('Sign in first', 401);
  }
  const body = await readJsonBody(request, 2048);
  const profile = body.ok ? readProfile(body.value) : null;
  if (!profile) {
    return jsonError('Not a valid profile', 400);
  }
  const [saved] = await db.batch(profileWrites(db, user, profile));
  if (rowsChanged(saved) === 0) {
    return jsonResponse({ error: 'This POP ID is on another account', popIdTaken: true }, { ...PRIVATE, status: 409 });
  }
  return jsonResponse({ user: { ...user, ...profile } }, PRIVATE);
}

export async function onRequestPatch({ request, env }: Context): Promise<Response> {
  if (!env.TOURNAMENT_DB || !sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  const user = await currentAccount(env.TOURNAMENT_DB, request);
  if (!user) {
    return jsonError('Sign in first', 401);
  }
  const value = (await readJsonObject(request, 256))?.name;
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 40) {
    return jsonError('Enter a name up to 40 characters', 400);
  }
  await env.TOURNAMENT_DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
  return jsonResponse({ user: { ...user, name } }, PRIVATE);
}
