/**
 * Calling the functions as Pages would, for the API suites: a request from
 * this site's origin, the handler's answer read back as JSON, and a dev
 * sign-in that hands back the session cookie, as an organizer, a Community
 * organizer or an Admin when the test needs one. An organizer here is what
 * runs sanctioned events: the Manager of a store of its own.
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

  /**
   * The session cookie of the account named `name`. With an account role it
   * holds that role; as 'organizer' it is the Manager of a store of its own
   * (league 9 followed by its row number), as an approved application leaves it.
   */
  async function signIn(name: string, role: AccountRole | 'organizer' | null = null): Promise<string> {
    const response = await login.onRequestGet({
      request: request(`/api/auth/login/dev?name=${encodeURIComponent(name)}&next=/host`),
      env: envOf(),
      params: { provider: 'dev' }
    } as never);
    assert.equal(response.status, 302);
    const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    // Straight to SQLite: the setup is not something the functions asked of the database.
    const { raw } = envOf().TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
    const hash = await sha256(cookie.slice(cookie.indexOf('=') + 1));
    if (role === 'organizer') {
      const { id } = raw.prepare('SELECT user_id AS id FROM sessions WHERE token_hash = ?').get(hash) as { id: string };
      raw
        .prepare(
          'INSERT OR IGNORE INTO stores (id, league_id, status, name, address, country, time_zone, created_at, updated_at) ' +
            "SELECT ?1, '9' || (SELECT COUNT(*) + 1 FROM stores), 'active', ?2, '1 Main St', 'US', 'America/Chicago', 1, 1"
        )
        .run(`store-${id}`, `${name} Games`);
      raw
        .prepare("INSERT OR IGNORE INTO store_members (store_id, user_id, role, added_at) VALUES (?, ?, 'owner', 1)")
        .run(`store-${id}`, id);
    } else if (role) {
      raw
        .prepare('UPDATE users SET role = ? WHERE id = (SELECT user_id FROM sessions WHERE token_hash = ?)')
        .run(role, hash);
    }
    return cookie;
  }

  return { hit, signIn };
}
