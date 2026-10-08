/**
 * Username and password sign-in through Clerk (functions/lib/auth/clerk.ts,
 * functions/api/auth/clerk.ts): only a token Clerk signed, still current, from
 * this instance and made for this site stands for anyone; it ends as a
 * provider's callback does.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, mock, test } from 'node:test';

import * as ageCheck from '../../functions/api/auth/age.ts';
import * as clerkSignIn from '../../functions/api/auth/clerk.ts';
import * as callback from '../../functions/api/auth/callback/[provider].ts';
import * as login from '../../functions/api/auth/login/[provider].ts';
import * as me from '../../functions/api/me.ts';
import { frontendApi, primaryEmail, verifiedSubject } from '../../functions/lib/auth/clerk.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { apiCalls, type Handler, ORIGIN, request } from '../__utils__/apiCalls.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

const ISSUER = 'https://clerk.cm.test';
const PUBLISHABLE = `pk_test_${btoa('clerk.cm.test$')}`;
const NOW = Math.floor(Date.now() / 1000);
const ADULT = new Date().getUTCFullYear() - 30;

const base64Url = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');
const part = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

const pair = (await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify']
)) as CryptoKeyPair;
const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
const PEM = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(spki).toString('base64')}\n-----END PUBLIC KEY-----\n`;

const claimsFor = (sub: string) => ({ sub, iss: ISSUER, azp: ORIGIN, exp: NOW + 60, nbf: NOW - 5, iat: NOW });

async function sign(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT' }) {
  const signed = `${part(header)}.${part(claims)}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signed));
  return `${signed}.${base64Url(signature)}`;
}

const check = { publicKeyPem: PEM, issuer: ISSUER, origin: ORIGIN, now: NOW };

let env: TournamentEnv;
const { hit, signIn } = apiCalls(() => env);

beforeEach(() => {
  env = {
    TOURNAMENT_DB: sqliteD1('tournaments.sql'),
    DEV_LOGIN: 'true',
    CLERK_PUBLISHABLE_KEY: PUBLISHABLE,
    CLERK_SECRET_KEY: 'sk_test_secret',
    CLERK_JWT_KEY: PEM
  };
});

const raw = () => (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw as DatabaseSync;
const count = (table: string) => (raw().prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const cookieOf = (response: Response, name: string) =>
  (response.headers.getSetCookie().find(value => value.startsWith(`${name}=`)) ?? '').split(';')[0] ?? '';

interface ClerkUser {
  email?: string;
  verified?: boolean;
  status?: number;
  banned?: boolean;
  locked?: boolean;
}

/** Clerk's Backend API answering for every user as `user` says, while `body` runs; the URLs it was asked. */
async function asClerk<T>(user: ClerkUser, body: () => Promise<T>): Promise<{ result: T; asked: string[] }> {
  const asked: string[] = [];
  const fetch = mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    asked.push(String(url));
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer sk_test_secret');
    /* eslint-disable camelcase -- Clerk's field names */
    const addresses = user.email
      ? [
          {
            id: 'idn_1',
            email_address: user.email,
            verification: { status: user.verified ? 'verified' : 'unverified', strategy: 'email_code' }
          }
        ]
      : [];
    return Response.json(
      {
        id: 'user_x',
        email_addresses: addresses,
        primary_email_address_id: user.email ? 'idn_1' : null,
        banned: user.banned ?? false,
        locked: user.locked ?? false
      },
      { status: user.status ?? 200 }
    );
    /* eslint-enable camelcase */
  });
  try {
    return { result: await body(), asked };
  } finally {
    fetch.mock.restore();
  }
}

interface Post {
  token: string;
  next?: string;
  link?: boolean;
  cookie?: string;
  origin?: string | null;
}

function post({ token, next = '/host', link = false, cookie, origin = ORIGIN }: Post): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  if (origin !== null) {
    headers.set('origin', origin);
  }
  if (cookie) {
    headers.set('cookie', cookie);
  }
  const body = new URLSearchParams({ token, next, ...(link ? { link: '1' } : {}) });
  return clerkSignIn.onRequestPost({
    request: new Request(`${ORIGIN}/api/auth/clerk`, { method: 'POST', headers, body }),
    env,
    params: {}
  } as never);
}

function checkAge(cookie: string) {
  return hit(
    ageCheck.onRequestPost as Handler,
    '/api/auth/age',
    {},
    {
      method: 'POST',
      cookie,
      body: { birthDate: `${ADULT}-03-01` }
    }
  );
}

/** A new Clerk account through its age check: the session cookie it ends with. */
async function signUp(sub: string, user: ClerkUser = {}): Promise<string> {
  const { result: waiting } = await asClerk(user, async () => post({ token: await sign(claimsFor(sub)) }));
  assert.equal(waiting.headers.get('location'), '/welcome');
  const passed = await checkAge(cookieOf(waiting, 'cm_signup'));
  assert.equal(passed.status, 200);
  return (passed.headers.getSetCookie().find(value => value.startsWith('cm_session=')) ?? '').split(';')[0] ?? '';
}

test('a publishable key names its Frontend API; anything else names none', () => {
  assert.equal(frontendApi(PUBLISHABLE), ISSUER);
  assert.equal(frontendApi(`pk_live_${btoa('clerk.ciphermaniac.com$')}`), 'https://clerk.ciphermaniac.com');
  assert.equal(frontendApi(`pk_test_${btoa('clerk.cm.test')}`), null, 'no closing $');
  assert.equal(frontendApi(`pk_test_${btoa('evil.test/path$')}`), null, 'not a host');
  assert.equal(frontendApi('pk_test_!!!'), null);
  assert.equal(frontendApi(`sk_test_${btoa('clerk.cm.test$')}`), null);
  assert.equal(frontendApi(''), null);
});

test('a token Clerk signed, current, from this instance and made for this site stands for its user', async () => {
  assert.equal(await verifiedSubject(await sign(claimsFor('user_abc')), check), 'user_abc');
  const literalNewlines = PEM.replace(/\n/gu, '\\n');
  assert.equal(
    await verifiedSubject(await sign(claimsFor('user_abc')), { ...check, publicKeyPem: literalNewlines }),
    'user_abc',
    'a key pasted with literal \\n still reads'
  );
  assert.equal(
    await verifiedSubject(await sign({ ...claimsFor('user_abc'), exp: NOW - 2 }), check),
    'user_abc',
    'a few seconds of clock difference are allowed'
  );
});

test('a token out of its window, from elsewhere, or for another site stands for no one', async () => {
  const refused = {
    expired: { ...claimsFor('user_abc'), exp: NOW - 30 },
    'not yet valid': { ...claimsFor('user_abc'), nbf: NOW + 30 },
    'no expiry': { ...claimsFor('user_abc'), exp: undefined },
    'no not-before': { ...claimsFor('user_abc'), nbf: undefined },
    'another instance': { ...claimsFor('user_abc'), iss: 'https://clerk.other.test' },
    'another site': { ...claimsFor('user_abc'), azp: 'https://evil.test' },
    'no site': { ...claimsFor('user_abc'), azp: undefined },
    'a session not yet complete': { ...claimsFor('user_abc'), sts: 'pending' },
    'not a user': claimsFor('org_abc'),
    'a user ID with more in it': claimsFor('user_abc/../x')
  };
  for (const [why, claims] of Object.entries(refused)) {
    assert.equal(await verifiedSubject(await sign(claims), check), null, why);
  }
});

test('a token not signed by the instance’s key stands for no one', async () => {
  const good = await sign(claimsFor('user_abc'));
  const [header, , signature] = good.split('.');
  const forged = `${header}.${part(claimsFor('user_other'))}.${signature}`;
  const unsigned = `${part({ alg: 'none', typ: 'JWT' })}.${part(claimsFor('user_abc'))}.`;
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(PEM),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const hmacSigned = `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claimsFor('user_abc'))}`;
  const hmac = `${hmacSigned}.${base64Url(await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(hmacSigned)))}`;
  const relabelled = `${part({ alg: 'RS512', typ: 'JWT' })}.${good.split('.').slice(1).join('.')}`;
  for (const [why, token] of Object.entries({
    forged,
    unsigned,
    hmac,
    relabelled,
    'two parts': good.split('.').slice(0, 2).join('.'),
    'four parts': `${good}.x`,
    garbage: 'not a token',
    empty: ''
  })) {
    assert.equal(await verifiedSubject(token, check), null, why);
  }
  assert.equal(await verifiedSubject(good, { ...check, publicKeyPem: 'not a key' }), null, 'a bad key fails closed');
});

test('only the primary email, and only proven by an emailed code, is the account’s', () => {
  /* eslint-disable camelcase -- Clerk's field names */
  const address = (id: string, email: string, status: string, strategy = 'email_code') => ({
    id,
    email_address: email,
    verification: { status, strategy }
  });
  assert.deepEqual(
    primaryEmail({
      primary_email_address_id: 'b',
      email_addresses: [address('a', 'a@example.com', 'verified'), address('b', 'b@example.com', 'verified')]
    }),
    { email: 'b@example.com', verified: true }
  );
  assert.deepEqual(
    primaryEmail({ primary_email_address_id: 'a', email_addresses: [address('a', 'a@example.com', 'unverified')] }),
    { email: 'a@example.com', verified: false }
  );
  for (const strategy of ['admin', 'from_oauth_google', 'email_link']) {
    assert.deepEqual(
      primaryEmail({
        primary_email_address_id: 'a',
        email_addresses: [address('a', 'a@example.com', 'verified', strategy)]
      }),
      { email: 'a@example.com', verified: false },
      strategy
    );
  }
  assert.deepEqual(primaryEmail({ primary_email_address_id: null, email_addresses: [] }), {
    email: null,
    verified: false
  });
  assert.deepEqual(primaryEmail({}), { email: null, verified: false });
  /* eslint-enable camelcase */
});

test('a sign-in from another site, or with no Origin, fails before anything is read', async () => {
  const token = await sign(claimsFor('user_abc'));
  const { result, asked } = await asClerk({}, async () => [
    await post({ token, origin: 'https://evil.test' }),
    await post({ token, origin: null })
  ]);
  assert.deepEqual(
    result.map(response => response.headers.get('location')),
    ['/settings?signin=failed', '/settings?signin=failed']
  );
  assert.deepEqual(asked, [], 'Clerk was never asked');
  assert.equal(count('pending_signups'), 0);
});

test('without all three Clerk keys, or with a key that names no instance, there is no username sign-in', async () => {
  const session = await hit(me.onRequestGet as Handler, '/api/me', {});
  assert.ok(session.json.providers.includes('clerk'));
  assert.equal(session.json.clerkKey, PUBLISHABLE);
  for (const broken of [{ CLERK_JWT_KEY: undefined }, { CLERK_PUBLISHABLE_KEY: 'pk_test_typo' }]) {
    env = { ...env, ...broken };
    assert.equal((await post({ token: await sign(claimsFor('user_abc')) })).status, 503);
    const without = await hit(me.onRequestGet as Handler, '/api/me', {});
    assert.ok(!without.json.providers.includes('clerk'));
    assert.equal(without.json.clerkKey, null);
  }
});

test('Clerk has no redirect sign-in: its login and callback routes answer for nothing', async () => {
  const started = await login.onRequestGet({
    request: request('/api/auth/login/clerk'),
    env,
    params: { provider: 'clerk' }
  } as never);
  assert.equal(started.status, 404);
  const returned = await callback.onRequestGet({
    request: request('/api/auth/callback/clerk?code=c&state=s', { cookie: 'cm_oauth=s%20%2Fhost' }),
    env,
    params: { provider: 'clerk' }
  } as never);
  assert.equal(returned.headers.get('location'), '/settings?signin=failed');
});

test('a token that does not hold up, or Clerk failing to answer, signs no one in', async () => {
  const { result: bad, asked } = await asClerk({}, () => post({ token: 'nope' }));
  assert.equal(bad.headers.get('location'), '/settings?signin=failed');
  assert.deepEqual(asked, [], 'a bad token never reaches Clerk');
  const { result: down } = await asClerk({ status: 500 }, async () =>
    post({ token: await sign(claimsFor('user_abc')) })
  );
  assert.equal(down.headers.get('location'), '/settings?signin=failed');
  assert.equal(cookieOf(down, 'cm_session'), '');
  assert.deepEqual([count('users'), count('pending_signups')], [0, 0]);
});

test('a user Clerk has banned or locked since the token was made signs no one in', async () => {
  for (const shut of [{ banned: true }, { locked: true }]) {
    const { result } = await asClerk(shut, async () => post({ token: await sign(claimsFor('user_shut')) }));
    assert.equal(result.headers.get('location'), '/settings?signin=failed');
  }
  assert.deepEqual([count('users'), count('pending_signups')], [0, 0]);
});

test('a new username sign-up waits for the age check, then is an account with a random username', async () => {
  const { result: waiting, asked } = await asClerk({}, async () => post({ token: await sign(claimsFor('user_new')) }));
  assert.deepEqual(asked, ['https://api.clerk.com/v1/users/user_new']);
  assert.equal(waiting.headers.get('location'), '/welcome');
  assert.equal(cookieOf(waiting, 'cm_session'), '');
  const passed = await checkAge(cookieOf(waiting, 'cm_signup'));
  assert.deepEqual(passed.json, { next: '/host' });
  const account = raw()
    .prepare(
      "SELECT u.handle, u.email FROM users u JOIN identities i ON i.user_id = u.id WHERE i.provider = 'clerk' AND i.subject = 'user_new'"
    )
    .get() as { handle: string; email: string | null };
  assert.equal(account.email, null);
  assert.ok(account.handle, 'a username of its own, not the one it signs in with');
});

test('a known username account signs straight in, and an email it verified since is kept', async () => {
  await signUp('user_back');
  const { result } = await asClerk({ email: 'back@example.com', verified: true }, async () =>
    post({ token: await sign(claimsFor('user_back')), next: '/history' })
  );
  assert.equal(result.headers.get('location'), '/history');
  assert.ok(cookieOf(result, 'cm_session'));
  assert.equal(count('users'), 1);
  const { email } = raw().prepare('SELECT email FROM users').get() as { email: string | null };
  assert.equal(email, 'back@example.com');
});

test('an email Clerk has not verified is never kept, nor links to the account that holds it', async () => {
  raw().exec(
    'INSERT INTO users (id, handle, email, birth_date, age_checked_at, created_at) ' +
      "VALUES ('held', 'held', 'pat@example.com', '02/27/1980', 1, 1)"
  );
  const cookie = await signUp('user_claim', { email: 'pat@example.com', verified: false });
  assert.ok(cookie);
  assert.equal(count('users'), 2, 'an account of its own');
  const emails = raw().prepare('SELECT email FROM users ORDER BY email').all() as { email: string | null }[];
  assert.deepEqual(
    emails.map(row => row.email),
    [null, 'pat@example.com']
  );
});

test('an email Clerk verified joins the account that already has it, as Google’s would', async () => {
  raw().exec(
    'INSERT INTO users (id, handle, email, birth_date, age_checked_at, created_at) ' +
      "VALUES ('held', 'held', 'pat@example.com', '02/27/1980', 1, 1)"
  );
  const { result } = await asClerk({ email: 'pat@example.com', verified: true }, async () =>
    post({ token: await sign(claimsFor('user_pat')) })
  );
  assert.ok(cookieOf(result, 'cm_session'));
  const owner = raw().prepare("SELECT user_id FROM identities WHERE provider = 'clerk'").get() as { user_id: string };
  assert.equal(owner.user_id, 'held');
});

test('linking adds the username sign-in to the signed-in account, once', async () => {
  const cookie = await signIn('Pat');
  const { result } = await asClerk({}, async () =>
    post({ token: await sign(claimsFor('user_link')), link: true, cookie })
  );
  assert.ok(cookieOf(result, 'cm_session'));
  const session = await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie });
  assert.deepEqual(session.json.user.providers.sort(), ['clerk', 'dev']);
  const other = await signIn('Sam');
  const { result: taken } = await asClerk({}, async () =>
    post({ token: await sign(claimsFor('user_link')), link: true, cookie: other })
  );
  assert.equal(taken.headers.get('location'), '/settings?link=used');
});
