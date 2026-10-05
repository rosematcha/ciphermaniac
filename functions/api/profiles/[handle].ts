/**
 * GET /api/profiles/:handle — an account's public profile: { name, handle,
 * avatar, entries }, its History as /u/:handle shows it to anyone with the
 * link. Never the account's POP ID or email, nor how it is each player. An
 * unknown username and a profile turned off answer alike (404). Profiles are shared by
 * link, not listed for search engines, and limited per address as the
 * event page is.
 */

import { isHandle, normalizeHandle } from '../../../shared/accounts/handle.js';
import { historyOf } from '../../lib/accounts/history.js';
import { createRateLimiter } from '../../lib/api/rateLimiter.js';
import { jsonError, jsonResponse } from '../../lib/api/responses.js';
import { type Context, param } from '../../lib/auth/env.js';

const rateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 1200 });

/** @internal exposed for tests */
export function _resetRateLimitStore(): void {
  rateLimiter.reset();
}

/** A minute at the edge: a profile turned off is gone from shared links within it. */
const answer = (body: unknown, status = 200) =>
  jsonResponse(body, {
    status,
    cacheControl: 'public, max-age=60',
    cors: false,
    headers: { 'X-Robots-Tag': 'noindex' }
  });

export async function onRequestGet(context: Context<'handle'>): Promise<Response> {
  if (!rateLimiter.check(context.request.headers.get('CF-Connecting-IP') ?? 'unknown').allowed) {
    return jsonError('Too many requests from here. Try again shortly.', 429);
  }
  const db = context.env.TOURNAMENT_DB;
  const handle = normalizeHandle(param(context.params.handle));
  const profile = db && isHandle(handle) ? await historyOf(db, { handle }) : null;
  return profile ? answer(profile) : answer({ error: 'No such profile' }, 404);
}
