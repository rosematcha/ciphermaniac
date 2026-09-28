/**
 * Accounts and sessions in D1.
 *
 * A session is a random 32-byte token in an HttpOnly cookie; the database keeps
 * only its SHA-256, so a leaked table cannot be replayed as a login. Sessions
 * last thirty days from sign-in and are not extended, which keeps every read a
 * single indexed lookup with no write.
 */

import type { D1Like } from '../types.js';
import { readCookie, SESSION_COOKIE } from './cookies.js';
import type { Profile } from './oauth.js';

export const SESSION_DAYS = 30;
export const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

export interface User {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  popId: string | null;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  providers?: string[];
}

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  pop_id: string | null;
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
}

export function userFromRow(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatar: row.avatar,
    popId: row.pop_id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date
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

const USER_COLUMNS = 'users.id, name, email, avatar, pop_id, first_name, last_name, birth_date';

/** The signed-in user for this request, or null. */
export async function currentUser(db: D1Like, request: Request): Promise<User | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) {
    return null;
  }
  const row = await db
    .prepare(
      `SELECT ${USER_COLUMNS} FROM sessions JOIN users ON users.id = sessions.user_id ` +
        'WHERE sessions.token_hash = ? AND sessions.expires_at > ?'
    )
    .bind(await sha256(token), Date.now())
    .first<UserRow>();
  if (!row) {
    return null;
  }
  const identities = await db
    .prepare('SELECT provider FROM identities WHERE user_id = ?')
    .bind(row.id)
    .all<{ provider: string }>();
  return { ...userFromRow(row), providers: identities.results.map(identity => identity.provider) };
}

/** Attach a provider only when its identity is still free or already belongs to this user. */
export async function linkIdentity(db: D1Like, profile: Profile, userId: string): Promise<boolean> {
  const identity = await db
    .prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?')
    .bind(profile.provider, profile.subject)
    .first<{ user_id: string }>();
  if (identity) {
    return identity.user_id === userId;
  }
  await db
    .prepare('INSERT INTO identities (provider, subject, user_id) VALUES (?, ?, ?)')
    .bind(profile.provider, profile.subject, userId)
    .run();
  return true;
}

async function linkedUser(db: D1Like, profile: Profile): Promise<string | null> {
  const identity = await db
    .prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?')
    .bind(profile.provider, profile.subject)
    .first<{ user_id: string }>();
  if (identity) {
    return identity.user_id;
  }
  if (!profile.email || !profile.emailVerified) {
    return null;
  }
  const byEmail = await db.prepare('SELECT id FROM users WHERE email = ?').bind(profile.email).first<{ id: string }>();
  return byEmail?.id ?? null;
}

/**
 * The user this provider account belongs to, creating one on first sign-in.
 * A second provider with the same verified email joins the existing user.
 */
export async function upsertUser(db: D1Like, profile: Profile): Promise<string> {
  const existing = await linkedUser(db, profile);
  const userId = existing ?? randomToken(12);
  const statements = [
    existing
      ? db
          .prepare('UPDATE users SET avatar = COALESCE(avatar, ?), email = COALESCE(email, ?) WHERE id = ?')
          .bind(profile.avatar, profile.emailVerified ? profile.email : null, userId)
      : db
          .prepare('INSERT INTO users (id, name, email, avatar, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(
            userId,
            profile.provider === 'dev' ? profile.name : 'Player',
            profile.emailVerified ? profile.email : null,
            profile.avatar,
            Date.now()
          ),
    db
      .prepare('INSERT OR IGNORE INTO identities (provider, subject, user_id) VALUES (?, ?, ?)')
      .bind(profile.provider, profile.subject, userId)
  ];
  await db.batch(statements);
  return userId;
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
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    await db
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256(token))
      .run();
  }
}
