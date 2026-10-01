/**
 * Calling the functions as Pages would, for the API suites: a request from
 * this site's origin, the handler's answer read back as JSON, and a dev
 * sign-in that hands back the session cookie, as an Organizer or an Admin
 * when the test needs one.
 */

import assert from 'node:assert/strict';

import * as login from '../../functions/api/auth/login/[provider].ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { sha256 } from '../../functions/lib/auth/session.ts';
import type { AccountRole } from '../../shared/accounts/roles.ts';
import type { sqliteD1 } from './sqliteD1.ts';

export const ORIGIN = 'https://cm.test';

export interface Call {
  method?: string;
  body?: unknown;
  cookie?: string;
  origin?: string | null;
}

export function request(path: string, call: Call = {}): Request {
  const method = call.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (call.cookie) {
    headers.cookie = call.cookie;
  }
  if (method !== 'GET' && call.origin !== null) {
    headers.origin = call.origin ?? ORIGIN;
  }
  if (call.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  return new Request(ORIGIN + path, {
    method,
    headers,
    body: call.body === undefined ? undefined : JSON.stringify(call.body)
  });
}

export type Handler = (context: never) => Promise<Response>;

/** `hit` and `signIn` against the environment `envOf` returns at the time of each call. */
export function apiCalls(envOf: () => TournamentEnv) {
  async function hit(handler: Handler, path: string, params: Record<string, string>, call: Call = {}) {
    const response = await handler({ request: request(path, call), env: envOf(), params } as never);
    const text = await response.text();
    return { status: response.status, headers: response.headers, json: text ? (JSON.parse(text) as any) : null };
  }

  /** The session cookie of the account named `name`, with `role` set on it when given (no request sets one yet). */
  async function signIn(name: string, role: AccountRole | null = null): Promise<string> {
    const response = await login.onRequestGet({
      request: request(`/api/auth/login/dev?name=${encodeURIComponent(name)}&next=/host`),
      env: envOf(),
      params: { provider: 'dev' }
    } as never);
    assert.equal(response.status, 302);
    const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    if (role) {
      // Straight to SQLite: the setup is not something the functions asked of the database.
      const { raw } = envOf().TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
      raw
        .prepare('UPDATE users SET role = ? WHERE id = (SELECT user_id FROM sessions WHERE token_hash = ?)')
        .run(role, await sha256(cookie.slice(cookie.indexOf('=') + 1)));
    }
    return cookie;
  }

  return { hit, signIn };
}
