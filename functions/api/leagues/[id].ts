/**
 * GET /api/leagues/:id — what the event locator knows of a Play! Pokémon
 * league, for a store application to start from: the store's name, address,
 * place and time zone as pokemon.com lists them ({ league }, null when it
 * lists nothing for the ID), and whether a store on the site already holds
 * the league ({ taken }). The ID may be the number or its pokemon.com league
 * page. Signed in only; it is a convenience for applying, not a directory.
 */

import { readLeagueId } from '../../../shared/accounts/stores.js';
import { jsonError } from '../../lib/api/responses.js';
import { type Context, param } from '../../lib/auth/env.js';
import { currentUser } from '../../lib/auth/session.js';
import { storeOfLeague } from '../../lib/stores/db.js';
import { findLeague } from '../../lib/stores/leagues.js';
import { privateJson } from '../../lib/tournaments/access.js';

export async function onRequestGet({ request, env, params }: Context<'id'>): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('Stores are not available', 503);
  }
  if (!(await currentUser(db, request))) {
    return jsonError('Sign in first', 401);
  }
  const leagueId = readLeagueId(decodeURIComponent(param(params.id)));
  if (!leagueId) {
    return jsonError('Not a league ID', 400);
  }
  const [league, store] = await Promise.all([findLeague(env.REPORTS, leagueId), storeOfLeague(db, leagueId)]);
  return privateJson({ leagueId, league, taken: store !== null });
}
