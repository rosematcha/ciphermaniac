/**
 * GET /api/tournaments — the events the signed-in user owns or staffs.
 * POST /api/tournaments — starts one: a Swiss event from a name, or a TOM-run
 * event from the tournament its .tdf was parsed into in the browser.
 */

import { emptyTournament } from '../../../shared/tournament/create.js';
import { tomDateTime } from '../../../shared/tournament/divisions.js';
import { readTournament } from '../../../shared/tournament/validate.js';
import { readJsonBody } from '../../lib/api/body.js';
import { jsonError } from '../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../lib/auth/env.js';
import { currentUser } from '../../lib/auth/session.js';
import { MAX_TOURNAMENT_BYTES, privateJson } from '../../lib/tournaments/access.js';
import { publishView } from '../../lib/tournaments/publish.js';
import {
  createTournament,
  listTournaments,
  loadTournament,
  ownedCount,
  TooLarge
} from '../../lib/tournaments/store.js';
import type { Tournament } from '../../../shared/tournament/types.js';

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  const user = db ? await currentUser(db, request) : null;
  if (!db || !user) {
    return jsonError('Sign in first', 401);
  }
  return privateJson({ tournaments: await listTournaments(db, user.id) });
}

type Body = Record<string, unknown>;

/** More than any organizer runs in a season; a cap on what one account can store. */
const MAX_EVENTS_PER_ORGANIZER = 200;

function swissFrom(body: Body): Tournament | null {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  // TOM wants a start date in the file; today's stands in until the organizer sets one.
  return name
    ? emptyTournament({ name, startDate: tomDateTime(new Date()).slice(0, 10) }, body.combined !== false)
    : null;
}

/** The event a create request describes, or why it describes none. */
async function readNew(request: Request): Promise<{ mode: 'swiss' | 'tom'; tournament: Tournament } | string> {
  const body = await readJsonBody(request, MAX_TOURNAMENT_BYTES);
  const value = (body.ok && typeof body.value === 'object' && body.value) as Body | false;
  if (!value) {
    return 'Not a tournament';
  }
  const mode = value.mode === 'tom' ? 'tom' : 'swiss';
  const tournament = mode === 'tom' ? readTournament(value.tournament) : swissFrom(value);
  if (!tournament) {
    return mode === 'tom' ? 'That file did not read as a tournament' : 'The event needs a name';
  }
  return { mode, tournament };
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!db || !sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  const user = await currentUser(db, request);
  if (!user) {
    return jsonError('Sign in first', 401);
  }
  const read = await readNew(request);
  if (typeof read === 'string') {
    return jsonError(read, 400);
  }
  const { mode, tournament } = read;
  if ((await ownedCount(db, user.id)) >= MAX_EVENTS_PER_ORGANIZER) {
    return jsonError('You have too many events; delete an old one first', 429);
  }
  try {
    const code = await createTournament(db, { ownerId: user.id, mode, tournament });
    const row = await loadTournament(db, code);
    if (row) {
      await publishView(env.REPORTS, row);
    }
    return privateJson({ code }, 201);
  } catch (error) {
    if (error instanceof TooLarge) {
      return jsonError(error.message, 413);
    }
    throw error;
  }
}
