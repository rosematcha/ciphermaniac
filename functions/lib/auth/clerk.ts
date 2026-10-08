/**
 * Username and password sign-in through Clerk. Clerk checks the password; the
 * sign-in page hands over Clerk's short-lived session token, which is checked
 * here against the instance's public key, with no call to Clerk. Then Clerk's
 * Backend API says which email the account has verified, if any. Nothing of
 * Clerk's session is kept: the account and its session are ours, as with
 * Google or Discord.
 */

import { frontendApi } from '../../../shared/accounts/clerk.js';
import type { AuthEnv, Profile } from './oauth.js';

/** Seconds of clock difference allowed either side of a token's window. */
const SKEW_SECONDS = 5;

type Json = Record<string, unknown>;

/** Bytes of base64 or base64url text; throws when it is neither. */
function base64Bytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function decodeJson(part: string): Json | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(base64Bytes(part)));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
  } catch {
    return null;
  }
}

const keys = new Map<string, CryptoKey>();

/** The PEM public key as a verifying key, imported once per isolate. Literal `\n`s from a pasted secret are dropped. */
async function publicKey(pem: string): Promise<CryptoKey> {
  const cached = keys.get(pem);
  if (cached) {
    return cached;
  }
  const body = pem.replace(/-----[^-]+-----|\\n|\s/gu, '');
  const key = await crypto.subtle.importKey(
    'spki',
    base64Bytes(body),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  keys.set(pem, key);
  return key;
}

async function signatureHolds(pem: string, signed: string, signature: string): Promise<boolean> {
  try {
    const key = await publicKey(pem);
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64Bytes(signature),
      new TextEncoder().encode(signed)
    );
  } catch {
    return false;
  }
}

export interface TokenCheck {
  publicKeyPem: string;
  /** The Frontend API origin (shared/accounts/clerk.ts). */
  issuer: string;
  /** This site's origin, which the token must have been made for. */
  origin: string;
  /** Seconds since the epoch. */
  now: number;
}

function current(claims: Json, now: number): boolean {
  const { exp, nbf } = claims;
  return typeof exp === 'number' && typeof nbf === 'number' && exp + SKEW_SECONDS > now && nbf - SKEW_SECONDS <= now;
}

function madeForUs(claims: Json, check: TokenCheck): boolean {
  return claims.iss === check.issuer && claims.azp === check.origin;
}

/** A session with tasks left to do (`sts: 'pending'`) is not signed in yet. */
function settled(claims: Json): boolean {
  return claims.sts === undefined || claims.sts === 'active';
}

function claimsHold(claims: Json, check: TokenCheck): boolean {
  return current(claims, check.now) && madeForUs(claims, check) && settled(claims);
}

function userId(claims: Json): string | null {
  return typeof claims.sub === 'string' && /^user_[A-Za-z0-9]+$/u.test(claims.sub) ? claims.sub : null;
}

/**
 * The Clerk user a session token stands for, or null when anything about it is
 * off: not RS256 (so `none` and an HMAC keyed with the public key both fail),
 * a bad signature, outside its window, from another instance, made for
 * another site, or a session not yet complete.
 */
export async function verifiedSubject(token: string, check: TokenCheck): Promise<string | null> {
  const [header = '', payload = '', signature = '', ...rest] = token.split('.');
  if (rest.length > 0 || decodeJson(header)?.alg !== 'RS256') {
    return null;
  }
  if (!(await signatureHolds(check.publicKeyPem, `${header}.${payload}`, signature))) {
    return null;
  }
  const claims = decodeJson(payload);
  return claims && claimsHold(claims, check) ? userId(claims) : null;
}

/**
 * The account's primary email as Clerk holds it, and whether its owner proved
 * it by the code Clerk emailed. An address an admin set, or one carried over
 * from a social sign-in, does not count: a verified email joins the account
 * that already holds it.
 */
export function primaryEmail(user: Json): { email: string | null; verified: boolean } {
  const addresses = Array.isArray(user.email_addresses) ? (user.email_addresses as Json[]) : [];
  const primary = addresses.find(address => address.id === user.primary_email_address_id);
  const email = typeof primary?.email_address === 'string' ? primary.email_address : null;
  const verification = primary?.verification as Json | null | undefined;
  const proven = verification?.status === 'verified' && verification.strategy === 'email_code';
  return { email, verified: email !== null && proven };
}

export interface ClerkKeys {
  publishableKey: string;
  issuer: string;
  publicKeyPem: string;
  secretKey: string;
}

/** The instance's keys, or null unless all three are set and the publishable key names a Frontend API. */
export function clerkKeys(env: AuthEnv): ClerkKeys | null {
  const { CLERK_PUBLISHABLE_KEY: publishableKey, CLERK_JWT_KEY: publicKeyPem, CLERK_SECRET_KEY: secretKey } = env;
  const issuer = frontendApi(publishableKey ?? '');
  return publishableKey && issuer && publicKeyPem && secretKey
    ? { publishableKey, issuer, publicKeyPem, secretKey }
    : null;
}

/** Whether Clerk will no longer sign this user in. */
const shutOut = (user: Json) => user.banned === true || user.locked === true;

/**
 * The profile a Clerk session token stands for, or null when the token does
 * not hold up or the user has been banned or locked since it was made. Only a
 * verified email is kept. Throws when Clerk can't be read.
 */
export async function clerkProfile(env: AuthEnv, origin: string, token: string): Promise<Profile | null> {
  const clerk = clerkKeys(env);
  const subject = clerk && (await verifiedSubject(token, { ...clerk, origin, now: Math.floor(Date.now() / 1000) }));
  if (!clerk || !subject) {
    return null;
  }
  const response = await fetch(`https://api.clerk.com/v1/users/${subject}`, {
    headers: { Authorization: `Bearer ${clerk.secretKey}` }
  });
  if (!response.ok) {
    throw new Error(`Clerk user read failed: ${response.status}`);
  }
  const user = (await response.json()) as Json;
  if (shutOut(user)) {
    return null;
  }
  const { email, verified } = primaryEmail(user);
  return {
    provider: 'clerk',
    subject,
    name: '',
    email: verified ? email : null,
    emailVerified: verified,
    avatar: null
  };
}

/**
 * Deletes the Clerk user an account signed in with, so its username and
 * password are gone with the account. A user Clerk no longer has counts as
 * deleted. Throws when Clerk can't be reached or refuses.
 */
export async function deleteClerkUser(env: AuthEnv, subject: string): Promise<void> {
  const clerk = clerkKeys(env);
  if (!clerk) {
    throw new Error('Clerk is not configured');
  }
  const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(subject)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${clerk.secretKey}` }
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Clerk user delete failed: ${response.status}`);
  }
}
