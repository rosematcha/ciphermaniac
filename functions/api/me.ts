/**
 * GET /api/me — who is signed in, and which sign-in buttons to show.
 * PUT /api/me — saves the player profile (POP ID, name, birth date) that
 * decklist submission and "find my pairing" read. One account holds a POP ID,
 * the first to save it: another account saving it gets a 409 and none of its
 * profile is saved. An account that changes its POP ID lets go of the players
 * it was at events as the old one.
 * PATCH /api/me — one change to the account itself: its name ({ name }), or
 * its public profile on or off ({ publicProfile }).
 */

import { type PlayerProfile, readProfile } from '../../shared/tournament/profile.js';
import { setPublicProfile } from '../lib/accounts/publicProfile.js';
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
 * The writes that save a profile. The unique POP ID index makes the update
 * ignore a POP ID another account holds, and it counts a row it matched as
 * changed even when nothing in it differs, so no change means the POP ID is
 * taken. A new POP ID lets go of the account's reporter rows under the old
 * one: the release goes first and reads the POP ID the account holds as the
 * batch runs, not the one this request read, since another change may have
 * landed between, and it lands only where the update will.
 */
function profileWrites(db: D1Like, user: User, profile: PlayerProfile) {
  const release = db
    .prepare(
      'DELETE FROM report_devices WHERE user_id = ?1 AND player_id = (SELECT pop_id FROM users WHERE id = ?1) ' +
        'AND player_id IS NOT ?2 AND NOT EXISTS (SELECT 1 FROM users WHERE pop_id = ?2 AND id <> ?1)'
    )
    .bind(user.id, profile.popId);
  const update = db
    .prepare('UPDATE OR IGNORE users SET pop_id = ?, first_name = ?, last_name = ?, birth_date = ? WHERE id = ?')
    .bind(profile.popId, profile.firstName, profile.lastName, profile.birthDate, user.id);
  return [release, update];
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
  const [, saved] = await db.batch(profileWrites(db, user, profile));
  if (rowsChanged(saved) === 0) {
    return jsonResponse({ error: 'This POP ID is on another account', popIdTaken: true }, { ...PRIVATE, status: 409 });
  }
  return jsonResponse({ user: { ...user, ...profile } }, PRIVATE);
}

type AccountChange = { name: string } | { publicProfile: boolean };

/** The one change a PATCH body asks for, or why it asks for none. */
function readChange(body: Record<string, unknown>): AccountChange | string {
  if ('publicProfile' in body) {
    if ('name' in body) {
      return 'Change one thing at a time';
    }
    return typeof body.publicProfile === 'boolean' ? { publicProfile: body.publicProfile } : 'Not a valid change';
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  return name && name.length <= 40 ? { name } : 'Enter a name up to 40 characters';
}

/** Makes the change, and answers the fields of the account it changed. */
async function applyChange(db: D1Like, user: User, change: AccountChange): Promise<Partial<User>> {
  if ('publicProfile' in change) {
    return { publicSlug: await setPublicProfile(db, user, change.publicProfile) };
  }
  await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(change.name, user.id).run();
  return { name: change.name };
}

export async function onRequestPatch({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!db || !sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  const user = await currentAccount(db, request);
  if (!user) {
    return jsonError('Sign in first', 401);
  }
  const change = readChange((await readJsonObject(request, 256)) ?? {});
  if (typeof change === 'string') {
    return jsonError(change, 400);
  }
  return jsonResponse({ user: { ...user, ...(await applyChange(db, user, change)) } }, PRIVATE);
}
