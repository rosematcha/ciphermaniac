/**
 * Accounts and sessions in D1.
 *
 * A session is a random 32-byte token in an HttpOnly cookie; the database keeps
 * only its SHA-256, so a leaked table cannot be replayed as a login. Sessions
 * last thirty days from sign-in and are not extended, which keeps every read a
 * single indexed lookup with no write.
 */

import { displayName, isHandle, randomHandle } from '../../../shared/accounts/handle.js';
import { type AccountRole, readAccountRole } from '../../../shared/accounts/roles.js';
import { storeRoleOf } from '../../../shared/accounts/stores.js';
import type { MyStore } from '../../../shared/accounts/types.js';
import type { D1Like, D1Statement } from '../types.js';
import { readCookie, SESSION_COOKIE } from './cookies.js';
import type { Profile } from './oauth.js';

export const SESSION_DAYS = 30;
export const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

/** Which name a public profile shows: the real one from the player profile, or the username. */
export type ProfileName = 'real' | 'handle';

export interface User {
  id: string;
  /** What the site calls the account: its real name, or its username without one (`displayName`). */
  name: string;
  handle: string;
  email: string | null;
  avatar: string | null;
  popId: string | null;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  /** What the account may do beyond playing (shared/accounts/roles.ts). */
  role: AccountRole | null;
  /** Whether the account's history is public at /u/<handle>. */
  publicProfile: boolean;
  profileName: ProfileName;
  providers?: string[];
  /** The stores the account belongs to, which only the account's own page reads. */
  stores?: MyStore[];
}

export interface UserRow {
  id: string;
  handle: string;
  email: string | null;
  avatar: string | null;
  pop_id: string | null;
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
  role: string | null;
  public_profile: number;
  profile_name: string;
}

export function userFromRow(row: UserRow): User {
  return {
    id: row.id,
    name: displayName({ firstName: row.first_name, lastName: row.last_name, handle: row.handle }),
    handle: row.handle,
    email: row.email,
    avatar: row.avatar,
    popId: row.pop_id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    role: readAccountRole(row.role),
    publicProfile: row.public_profile === 1,
    profileName: row.profile_name === 'handle' ? 'handle' : 'real'
  };
}

/** A URL-safe random token of `bytes` bytes. */
export function randomToken(bytes = 32): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/[=]+$/, '');
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const USER_COLUMNS =
  'users.id, handle, email, avatar, pop_id, first_name, last_name, birth_date, role, public_profile, profile_name';

/** The SHA-256 of the request's session token, as the sessions table keys it; null without the cookie. */
export async function sessionHash(request: Request): Promise<string | null> {
  const token = readCookie(request, SESSION_COOKIE);
  return token ? sha256(token) : null;
}

/**
 * The read of the user a session belongs to; `userFromRow` reads its row. An
 * account that has not passed the age check (lib/auth/signup.ts) reads as no
 * one, whatever session it holds.
 */
export function sessionUserQuery(db: D1Like, tokenHash: string, now: number): D1Statement {
  return db
    .prepare(
      `SELECT ${USER_COLUMNS} FROM sessions JOIN users ON users.id = sessions.user_id ` +
        'WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.age_checked_at IS NOT NULL'
    )
    .bind(tokenHash, now);
}

/** The signed-in user for this request, or null. */
export async function currentUser(db: D1Like, request: Request): Promise<User | null> {
  const hash = await sessionHash(request);
  const row = hash ? await sessionUserQuery(db, hash, Date.now()).first<UserRow>() : null;
  return row ? userFromRow(row) : null;
}

interface MyStoreRow {
  id: string;
  name: string;
  league_id: string;
  status: string;
  time_zone: string;
  role: string;
}

const myStore = (row: MyStoreRow): MyStore => ({
  id: row.id,
  name: row.name,
  leagueId: row.league_id,
  status: row.status === 'revoked' ? 'revoked' : 'active',
  timeZone: row.time_zone,
  role: storeRoleOf(row.role)
});

/**
 * As `currentUser`, with the providers the account signs in with and the
 * stores it belongs to, which only the account's own page shows. The three
 * reads go in one round trip.
 */
export async function currentAccount(db: D1Like, request: Request): Promise<User | null> {
  const hash = await sessionHash(request);
  if (!hash) {
    return null;
  }
  const now = Date.now();
  const [user, identities, stores] = await db.batch([
    sessionUserQuery(db, hash, now),
    db
      .prepare(
        'SELECT provider FROM identities JOIN sessions ON sessions.user_id = identities.user_id ' +
          'WHERE sessions.token_hash = ? AND sessions.expires_at > ?'
      )
      .bind(hash, now),
    db
      .prepare(
        'SELECT s.id, s.name, s.league_id, s.status, s.time_zone, m.role FROM sessions ' +
          'JOIN store_members m ON m.user_id = sessions.user_id JOIN stores s ON s.id = m.store_id ' +
          'WHERE sessions.token_hash = ? AND sessions.expires_at > ? ORDER BY s.name'
      )
      .bind(hash, now)
  ]);
  const row = (user?.results as UserRow[] | undefined)?.[0];
  const providers = (identities?.results ?? []) as { provider: string }[];
  const memberships = (stores?.results ?? []) as MyStoreRow[];
  return row
    ? {
        ...userFromRow(row),
        providers: providers.map(identity => identity.provider),
        stores: memberships.map(myStore)
      }
    : null;
}

async function identityOwner(db: D1Like, profile: Profile): Promise<string | null> {
  const identity = await db
    .prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?')
    .bind(profile.provider, profile.subject)
    .first<{ user_id: string }>();
  return identity?.user_id ?? null;
}

function verifiedEmail(profile: Profile): string | null {
  return profile.emailVerified ? profile.email?.trim().toLowerCase() || null : null;
}

async function emailOwner(db: D1Like, profile: Profile): Promise<string | null> {
  const email = verifiedEmail(profile);
  if (!email) {
    return null;
  }
  const user = await db
    .prepare('SELECT id FROM users WHERE email IS NOT NULL AND email = ?')
    .bind(email)
    .first<{ id: string }>();
  return user?.id ?? null;
}

function identityInsert(db: D1Like, profile: Profile, userId: string): D1Statement {
  return db
    .prepare('INSERT INTO identities (provider, subject, user_id) VALUES (?, ?, ?)')
    .bind(profile.provider, profile.subject, userId);
}

/** Attach a provider only when its identity is still free or already belongs to this user. */
export async function linkIdentity(db: D1Like, profile: Profile, userId: string): Promise<boolean> {
  try {
    await db.batch([identityInsert(db, profile, userId)]);
    return true;
  } catch (error) {
    const owner = await identityOwner(db, profile);
    if (!owner) {
      throw error;
    }
    return owner === userId;
  }
}

/**
 * Refreshes an account from its provider. With `birthDate` (year only, see
 * shared/accounts/age.ts) the account has just passed the age check, which
 * stands over any year it held before.
 */
function refreshUser(db: D1Like, profile: Profile, userId: string, birthDate: string | null = null): D1Statement {
  const email = verifiedEmail(profile);
  return db
    .prepare(
      'UPDATE users SET avatar = COALESCE(avatar, ?1), birth_date = COALESCE(?2, birth_date), ' +
        'age_checked_at = CASE WHEN ?2 IS NULL THEN age_checked_at ELSE ?3 END, ' +
        'email = COALESCE(email, (SELECT ?4 WHERE NOT EXISTS ' +
        '(SELECT 1 FROM users WHERE email IS NOT NULL AND email = ?4))) WHERE id = ?5'
    )
    .bind(profile.avatar, birthDate, Date.now(), email, userId);
}

/**
 * A new account's username. A provider's account names are not kept, so a
 * new account has a random one until it picks its own. A dev sign-in takes
 * the name typed, when that makes a username, so local test accounts read
 * as who they are.
 */
function firstHandle(profile: Profile): string {
  const typed = profile.name.trim().toLowerCase().replace(/\s+/g, '-');
  return profile.provider === 'dev' && isHandle(typed, { reserved: false }) ? typed : randomHandle();
}

async function insertAccount(
  db: D1Like,
  profile: Profile,
  existing: string | null,
  birthDate: string | null
): Promise<string> {
  const userId = existing ?? randomToken(12);
  await db.batch([
    existing
      ? refreshUser(db, profile, userId, birthDate)
      : db
          .prepare(
            'INSERT INTO users (id, handle, email, avatar, birth_date, age_checked_at, created_at) ' +
              'VALUES (?1, ?2, ?3, ?4, ?5, CASE WHEN ?5 IS NULL THEN NULL ELSE ?6 END, ?6)'
          )
          .bind(userId, firstHandle(profile), verifiedEmail(profile), profile.avatar, birthDate, Date.now()),
    identityInsert(db, profile, userId)
  ]);
  return userId;
}

/** Resolve a strict insert's winner; unrelated database failures still fail sign-in. */
async function resolveAccount(db: D1Like, profile: Profile, error: unknown): Promise<string> {
  const owner = await identityOwner(db, profile);
  if (owner) {
    return owner;
  }
  const existing = await emailOwner(db, profile);
  if (!existing) {
    throw error;
  }
  // The email winner committed first. Link in a fresh transaction, resolving
  // another identity winner if one lands before this insert.
  if (await linkIdentity(db, profile, existing)) {
    return existing;
  }
  const winner = await identityOwner(db, profile);
  if (!winner) {
    throw error;
  }
  return winner;
}

/**
 * Identity ownership always takes precedence over email. Only verified emails
 * are stored and matched, trimmed and case-insensitive, with database uniqueness.
 * A failed strict identity insert rolls back the entire account batch. A new
 * account is made only with the birth date (year only) its age check gave;
 * the callback holds back anyone who has not passed one (see signup.ts).
 */
export async function upsertUser(db: D1Like, profile: Profile, birthDate: string | null = null): Promise<string> {
  const owner = await identityOwner(db, profile);
  if (owner) {
    await refreshUser(db, profile, owner, birthDate).run();
    return owner;
  }
  const existing = await emailOwner(db, profile);
  try {
    return await insertAccount(db, profile, existing, birthDate);
  } catch (error) {
    const winner = await resolveAccount(db, profile, error);
    await refreshUser(db, profile, winner, birthDate).run();
    return winner;
  }
}

/** Starts a session and returns the token for the cookie. */
export async function createSession(db: D1Like, userId: string): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await db.batch([
    db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256(token), userId, now + SESSION_SECONDS * 1000),
    // Sign-in is the one write a session costs, so it also sweeps this user's expired ones.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?').bind(userId, now)
  ]);
  return token;
}

export async function endSession(db: D1Like, request: Request): Promise<void> {
  const hash = await sessionHash(request);
  if (hash) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
  }
}
