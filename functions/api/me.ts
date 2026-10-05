/**
 * GET /api/me — who is signed in, and which sign-in buttons to show.
 * PUT /api/me — saves the player profile (POP ID, name, birth year) that
 * decklist submission and "find my pairing" read. One account holds a POP ID,
 * the first to save it: another account saving it gets a 409 and none of its
 * profile is saved. An account that changes its POP ID lets go of the players
 * it was at events as the old one.
 * PATCH /api/me — one change to the account itself: its username
 * ({ handle }; 409 when someone else holds it or let it go within the day,
 * 429 past the day's changes), its public profile on or off
 * ({ publicProfile }), or the name that profile shows ({ profileName }).
 */

import { adultYear } from '../../shared/accounts/age.js';
import { displayName, handleProblem, normalizeHandle } from '../../shared/accounts/handle.js';
import { birthYear, yearOnlyBirthDate } from '../../shared/tournament/divisions.js';
import { type PlayerProfile, readProfile } from '../../shared/tournament/profile.js';
import { renameAccount } from '../lib/accounts/handles.js';
import { readJsonBody, readJsonObject } from '../lib/api/body.js';
import { jsonError, jsonResponse } from '../lib/api/responses.js';
import { type Context, sameOrigin } from '../lib/auth/env.js';
import { availableProviders } from '../lib/auth/oauth.js';
import { currentAccount, type ProfileName, type User } from '../lib/auth/session.js';
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
  const read = body.ok ? readProfile(body.value) : null;
  if (!read) {
    return jsonError('Not a valid profile', 400);
  }
  // Accounts are for adults (shared/accounts/age.ts): a year only a minor could be born in is not one to keep.
  if (!adultYear(birthYear(read.birthDate), new Date())) {
    return jsonError('Accounts are for people 18 and older; check your birth year', 400);
  }
  const profile = { ...read, birthDate: yearOnlyBirthDate(read.birthDate) };
  const [, saved] = await db.batch(profileWrites(db, user, profile));
  if (rowsChanged(saved) === 0) {
    return jsonResponse({ error: 'This POP ID is on another account', popIdTaken: true }, { ...PRIVATE, status: 409 });
  }
  const updated = { ...user, ...profile };
  return jsonResponse({ user: { ...updated, name: displayName(updated) } }, PRIVATE);
}

type AccountChange = { handle: string } | { publicProfile: boolean } | { profileName: ProfileName };

const CHANGES = ['handle', 'publicProfile', 'profileName'] as const;

/** The one change a PATCH body asks for, or why it asks for none. */
function readChange(body: Record<string, unknown>): AccountChange | string {
  const asked = CHANGES.filter(key => key in body);
  if (asked.length !== 1) {
    return asked.length > 1 ? 'Change one thing at a time' : 'Not a valid change';
  }
  const { handle, publicProfile, profileName } = body;
  if (asked[0] === 'handle') {
    const wanted = typeof handle === 'string' ? normalizeHandle(handle) : '';
    return handleProblem(wanted) ?? { handle: wanted };
  }
  if (asked[0] === 'publicProfile') {
    return typeof publicProfile === 'boolean' ? { publicProfile } : 'Not a valid change';
  }
  return profileName === 'real' || profileName === 'handle' ? { profileName } : 'Not a valid change';
}

const REFUSED = {
  taken: { error: 'That username is taken', status: 409 },
  limit: { error: 'You can change your username three times a day', status: 429 }
} as const;

/** Makes the change, and answers the fields of the account it changed, or why it was refused. */
async function applyChange(db: D1Like, user: User, change: AccountChange): Promise<Partial<User> | Response> {
  if ('handle' in change) {
    const refused = await renameAccount(db, user, change.handle);
    if (refused) {
      return jsonError(REFUSED[refused].error, REFUSED[refused].status);
    }
    return { handle: change.handle, name: displayName({ ...user, handle: change.handle }) };
  }
  if ('publicProfile' in change) {
    await db
      .prepare('UPDATE users SET public_profile = ? WHERE id = ?')
      .bind(change.publicProfile ? 1 : 0, user.id)
      .run();
    return change;
  }
  await db.prepare('UPDATE users SET profile_name = ? WHERE id = ?').bind(change.profileName, user.id).run();
  return change;
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
  const changed = await applyChange(db, user, change);
  return changed instanceof Response ? changed : jsonResponse({ user: { ...user, ...changed } }, PRIVATE);
}
