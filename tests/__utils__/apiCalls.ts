/**
 * Calling the functions as Pages would, for the API suites: a request from
 * this site's origin, the handler's answer read back as JSON, and a dev
 * sign-in that hands back the session cookie.
 */

import assert from 'node:assert/strict';

import * as login from '../../functions/api/auth/login/[provider].ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';

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

  async function signIn(name: string): Promise<string> {
    const response = await login.onRequestGet({
      request: request(`/api/auth/login/dev?name=${encodeURIComponent(name)}&next=/host`),
      env: envOf(),
      params: { provider: 'dev' }
    } as never);
    assert.equal(response.status, 302);
    return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  }

  return { hit, signIn };
}
