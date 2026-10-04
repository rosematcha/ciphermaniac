/**
 * POST /api/tournaments/idle — marks events idle after two hours without a
 * write. Completed events end then; abandoned events end after seven days.
 * A scheduled workflow calls this with the sweep token because Pages Functions
 * have no timer.
 */

import { divisionLookup } from '../../../shared/tournament/divisions.js';
import { attendees, cutPodsOf, roundComplete, swissAttendance } from '../../../shared/tournament/rounds.js';
import { bracketMatches, eliminationResult } from '../../../shared/tournament/standings.js';
import { eventTypeOf, recommendedStructure } from '../../../shared/tournament/structure.js';
import { DIVISIONS, isDivision, type Pod, type Round } from '../../../shared/tournament/types.js';
import { jsonError } from '../../lib/api/responses.js';
import type { Context } from '../../lib/auth/env.js';
import { sha256 } from '../../lib/auth/session.js';
import { privateJson } from '../../lib/tournaments/access.js';
import { publishAfter } from '../../lib/tournaments/publish.js';
import { loadIdle, mutate, type TournamentRow } from '../../lib/tournaments/store.js';

const IDLE_END_MS = 2 * 60 * 60 * 1000;
const MAX_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

/** Enough for any weekend; the rest wait for the next sweep, which keeps one run's work small. */
const MAX_PER_SWEEP = 10;

async function authorized({ request, env }: Context): Promise<boolean> {
  const token = env.IDLE_SWEEP_TOKEN;
  const sent = request.headers.get('Authorization') ?? '';
  // Hashing both sides keeps the comparison from telling how much of the token matched.
  return Boolean(token) && (await sha256(sent)) === (await sha256(`Bearer ${token}`));
}

/** Still idle as the row stands now: a change since the sweep read it keeps the event going. */
const stillIdle = (row: TournamentRow, before: number, expiredBefore: number): boolean =>
  !row.settings.finished &&
  (!row.settings.idle || row.updatedAt <= expiredBefore) &&
  row.updatedAt < before &&
  row.tournament.pods.some(pod => pod.rounds.length > 0);

/** A resolved round must have results, including a winner for each cut match. */
function resolvedRound(round: Round): boolean {
  return (
    round.status === 'finished' &&
    round.matches.length > 0 &&
    roundComplete(round) &&
    (round.kind !== 'elimination' || round.matches.every(match => eliminationResult(match) !== null))
  );
}

function cutComplete(pod: Pod): boolean {
  const final = pod.rounds.at(-1);
  return final?.kind === 'elimination' && bracketMatches(pod, final).length === 1;
}

/** Combined Swiss pods must not finish while another division's cut is unpaired. */
function divisionCutsPaired(row: TournamentRow, pod: Pod): boolean {
  const divisionOf = divisionLookup(row.tournament);
  const entrants = attendees(pod);
  const cuts = cutPodsOf(row.tournament, pod);
  return DIVISIONS.every(division => {
    const count = entrants.filter(id => divisionOf(id) === division).length;
    const planned = recommendedStructure(count, eventTypeOf(row.tournament));
    return planned.cut === 0 || cuts.some(cut => cut.category === division);
  });
}

function stagesComplete(row: TournamentRow, pod: Pod): boolean {
  if (pod.cutOf) {
    return cutComplete(pod);
  }
  const planned = recommendedStructure(swissAttendance(pod), eventTypeOf(row.tournament));
  const swiss = pod.rounds.filter(round => round.kind === 'swiss');
  if (swiss.length < (row.settings.roundCap || planned.rounds)) {
    return false;
  }
  if (pod.cut > 0) {
    return cutComplete(pod);
  }
  return isDivision(pod.category)
    ? planned.cut === 0
    : divisionCutsPaired(row, pod) && cutPodsOf(row.tournament, pod).every(cutComplete);
}

function podComplete(row: TournamentRow, pod: Pod): boolean {
  if (pod.playerIds.length === 0 && pod.rounds.length === 0) {
    return true;
  }
  return pod.rounds.length > 0 && pod.rounds.every(resolvedRound) && stagesComplete(row, pod);
}

const completed = (row: TournamentRow): boolean =>
  row.pending.length === 0 && row.reports.length === 0 && row.tournament.pods.every(pod => podComplete(row, pod));

export async function onRequestPost(context: Context): Promise<Response> {
  const db = context.env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('Tournaments are not available', 503);
  }
  if (!(await authorized(context))) {
    return jsonError('Forbidden', 403);
  }
  const now = Date.now();
  const before = now - IDLE_END_MS;
  const expiredBefore = now - MAX_IDLE_MS;
  const ended: string[] = [];
  const idle: string[] = [];
  for (const read of await loadIdle(db, before, MAX_PER_SWEEP, expiredBefore)) {
    const outcome = await mutate(db, read, row =>
      stillIdle(row, before, expiredBefore)
        ? {
            settings: { ...row.settings, idle: true, finished: row.updatedAt <= expiredBefore || completed(row) },
            updatedAt: row.updatedAt
          }
        : 'No longer idle'
    );
    if ('row' in outcome) {
      (outcome.row.settings.finished ? ended : idle).push(outcome.row.code);
      await publishAfter(context, outcome.row);
    }
  }
  return privateJson({ ended, idle });
}
