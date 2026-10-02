/**
 * GET /api/history — the signed-in account's History: { entries }, newest
 * first (see lib/accounts/history.ts). One wait on the database, the account
 * read with its events.
 */

import { historyOf } from '../lib/accounts/history.js';
import { coalescedRead } from '../../shared/coalesce.js';
import { type JsonRepresentation, jsonRepresentation, revalidatedJson } from '../lib/api/revalidation.js';
import { jsonError } from '../lib/api/responses.js';
import type { Context } from '../lib/auth/env.js';
import { sessionHash } from '../lib/auth/session.js';

const readHistory = coalescedRead<JsonRepresentation | null>();

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('History is not available', 503);
  }
  const session = await sessionHash(request);
  if (!session) {
    return jsonError('Sign in first', 401);
  }
  const history = await readHistory(db, session, async () => {
    const found = await historyOf(db, { session, now: Date.now() });
    return found ? jsonRepresentation({ entries: found.entries }) : null;
  });
  return history ? revalidatedJson(request, history) : jsonError('Sign in first', 401);
}
