/**
 * GET /api/tournaments — the events the signed-in user owns or staffs.
 * POST /api/tournaments — starts one: a Swiss event from the setup's answers,
 * or a TOM-run event from the tournament its .tdf was parsed into in the
 * browser. Either may carry the settings it starts with.
 */

import { emptyTournament } from '../../../shared/tournament/create.js';
import { tomDateTime } from '../../../shared/tournament/divisions.js';
import { readTournament } from '../../../shared/tournament/validate.js';
import { DEFAULT_SETTINGS, readSettings, type TournamentSettings } from '../../../shared/tournament/view.js';
import { readJsonObject } from '../../lib/api/body.js';
import { jsonError } from '../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../lib/auth/env.js';
import { currentUser } from '../../lib/auth/session.js';
import { MAX_TOURNAMENT_BYTES, privateJson } from '../../lib/tournaments/access.js';
import { publishAfter } from '../../lib/tournaments/publish.js';
import { createTournament, listTournaments, ownedCount, TooLarge } from '../../lib/tournaments/store.js';
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

interface NewEvent {
  mode: 'swiss' | 'tom';
  tournament: Tournament;
  settings: TournamentSettings;
}

const isMinutes = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 180;

/**
 * A Swiss event from the setup's answers: a name, and optionally the round
 * length and the settings to start with. Without birth years there are no
 * divisions to split, so an unsanctioned event always pairs everyone together.
 */
function swissFrom(body: Body, settings: TournamentSettings): Tournament | null {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  // TOM wants a start date in the file; today's stands in until the organizer sets one.
  const info = {
    name,
    startDate: tomDateTime(new Date()).slice(0, 10),
    ...(isMinutes(body.roundTime) ? { roundTime: body.roundTime } : {})
  };
  return name ? emptyTournament(info, body.combined !== false || !settings.sanctioned) : null;
}

/** The settings a new event starts with; closing it is not something it starts as. */
function initialSettings(body: Body): TournamentSettings | null {
  const settings = readSettings(body.settings ?? {}, DEFAULT_SETTINGS);
  return settings && { ...settings, finished: false };
}

/** The event a create request describes, or why it describes none. */
async function readNew(request: Request): Promise<NewEvent | string> {
  const value = await readJsonObject(request, MAX_TOURNAMENT_BYTES);
  const settings = value && initialSettings(value);
  if (!value || !settings) {
    return 'Not a tournament';
  }
  const mode = value.mode === 'tom' ? 'tom' : 'swiss';
  const tournament = mode === 'tom' ? readTournament(value.tournament) : swissFrom(value, settings);
  if (!tournament) {
    return mode === 'tom' ? 'That file did not read as a tournament' : 'The event needs a name';
  }
  return { mode, tournament, settings };
}

export async function onRequestPost(context: Context): Promise<Response> {
  const { request, env } = context;
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
  const { mode, tournament, settings } = read;
  if ((await ownedCount(db, user.id)) >= MAX_EVENTS_PER_ORGANIZER) {
    return jsonError('You have too many events; delete an old one first', 429);
  }
  try {
    const row = await createTournament(db, { ownerId: user.id, mode, tournament, settings });
    await publishAfter(context, row);
    return privateJson({ code: row.code }, 201);
  } catch (error) {
    if (error instanceof TooLarge) {
      return jsonError(error.message, 413);
    }
    throw error;
  }
}
