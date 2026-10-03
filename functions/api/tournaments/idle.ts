/**
 * POST /api/tournaments/idle — ends every event under way that has gone two
 * hours without a change, as if its organizer had pressed End event. Nothing
 * runs on a timer on Pages, so a scheduled workflow
 * (.github/workflows/tournament-idle.yml) calls this with the sweep's token.
 * The organizer can reopen an event it ended.
 */

import { jsonError } from '../../lib/api/responses.js';
import type { Context } from '../../lib/auth/env.js';
import { sha256 } from '../../lib/auth/session.js';
import { privateJson } from '../../lib/tournaments/access.js';
import { publishAfter } from '../../lib/tournaments/publish.js';
import { loadIdle, mutate, type TournamentRow } from '../../lib/tournaments/store.js';

const IDLE_END_MS = 2 * 60 * 60 * 1000;

/** Enough for any weekend; the rest wait for the next sweep, which keeps one run's work small. */
const MAX_PER_SWEEP = 10;

async function authorized({ request, env }: Context): Promise<boolean> {
  const token = env.IDLE_SWEEP_TOKEN;
  const sent = request.headers.get('Authorization') ?? '';
  // Hashing both sides keeps the comparison from telling how much of the token matched.
  return Boolean(token) && (await sha256(sent)) === (await sha256(`Bearer ${token}`));
}

/** Still idle as the row stands now: a change since the sweep read it keeps the event going. */
const stillIdle = (row: TournamentRow, before: number): boolean =>
  !row.settings.finished && row.updatedAt < before && row.tournament.pods.some(pod => pod.rounds.length > 0);

export async function onRequestPost(context: Context): Promise<Response> {
  const db = context.env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('Tournaments are not available', 503);
  }
  if (!(await authorized(context))) {
    return jsonError('Forbidden', 403);
  }
  const before = Date.now() - IDLE_END_MS;
  const ended: string[] = [];
  for (const read of await loadIdle(db, before, MAX_PER_SWEEP)) {
    const outcome = await mutate(db, read, row =>
      stillIdle(row, before) ? { settings: { ...row.settings, finished: true } } : 'No longer idle'
    );
    if ('row' in outcome) {
      ended.push(outcome.row.code);
      await publishAfter(context, outcome.row);
    }
  }
  return privateJson({ ended });
}
