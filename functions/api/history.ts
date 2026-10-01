/**
 * GET /api/history — the signed-in account's History: { entries }, newest
 * first (see lib/accounts/history.ts). One wait on the database, the account
 * read with its events.
 */

import { historyOf } from '../lib/accounts/history.js';
import { jsonError } from '../lib/api/responses.js';
import type { Context } from '../lib/auth/env.js';
import { sessionHash } from '../lib/auth/session.js';
import { privateJson } from '../lib/tournaments/access.js';

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('History is not available', 503);
  }
  const session = await sessionHash(request);
  const history = session ? await historyOf(db, { session, now: Date.now() }) : null;
  return history ? privateJson({ entries: history.entries }) : jsonError('Sign in first', 401);
}
