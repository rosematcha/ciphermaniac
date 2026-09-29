/**
 * POST /api/tournaments/:code/report — a player at an event with player
 * reporting on says who they are: { popId } at a sanctioned event, or
 * { lastName, firstName? } at an unsanctioned one. Alone, that answers with
 * their public key, so the page can follow their pairings. With { result }
 * ('win', 'loss' or 'tie') it also reports their current match (see
 * shared/tournament/reports.ts), and a result both players agree on stands.
 *
 * Nobody signs in for this, as a player at the table has no time to: knowing
 * a player's Player ID or name is enough, the same trust a paper slip carries,
 * and staff can override any result.
 */

import { findPlayer, type PlayerClaim } from '../../../../shared/tournament/identify.js';
import {
  fileReport,
  PLAYER_RESULTS,
  playerReport,
  type PlayerResult,
  reportableMatch,
  resultFor
} from '../../../../shared/tournament/reports.js';
import { applyPending, isSanctioned } from '../../../../shared/tournament/view.js';
import { readJsonBody } from '../../../lib/api/body.js';
import { createRateLimiter } from '../../../lib/api/rateLimiter.js';
import { jsonError } from '../../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../../lib/auth/env.js';
import { type Access, open, privateJson, publicViewOf } from '../../../lib/tournaments/access.js';
import { publishView } from '../../../lib/tournaments/publish.js';
import { commandChanges } from '../../../lib/tournaments/results.js';
import { type Changes, mutate, type TournamentRow } from '../../../lib/tournaments/store.js';

type Body = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 60) : undefined);

function claimOf(body: Body): PlayerClaim {
  return { popId: text(body.popId), lastName: text(body.lastName), firstName: text(body.firstName) };
}

/** The player's report of their open match, or why they cannot report. */
function readReport(row: TournamentRow, claim: PlayerClaim, result: PlayerResult) {
  const found = findPlayer(row.tournament, isSanctioned(row), claim);
  if (!found.ok) {
    return found.error;
  }
  const open = reportableMatch(applyPending(row.tournament, row.pending), found.id);
  if (typeof open === 'string') {
    return open;
  }
  const report = playerReport(open, found.id, result, Date.now());
  return typeof report === 'string' ? report : { open, report };
}

/** The report laid over the event, with the result it settles when the opponent agrees. */
function reportChanges(row: TournamentRow, claim: PlayerClaim, result: PlayerResult, localTime: unknown) {
  const read = readReport(row, claim, result);
  if (typeof read === 'string') {
    return read;
  }
  const filed = fileReport(row.reports, read.report);
  if (!filed.agreed) {
    return { reports: filed.reports };
  }
  const settled = commandChanges(row, { type: 'reportResult', ...resultFor(read.open, filed.agreed) }, localTime);
  return typeof settled === 'string' ? settled : ({ ...settled, reports: filed.reports } satisfies Changes);
}

/**
 * A room of players shares the venue's address, and each reports a few times
 * a round; this stops a script, not a busy event.
 */
const rateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 300 });

/** @internal exposed for tests */
export function _resetRateLimitStore(): void {
  rateLimiter.reset();
}

/** The event, when this request may report to it; the refusal when it may not. */
async function reportable(context: Context<'code'>): Promise<Access | Response> {
  if (!sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  if (!rateLimiter.check(context.request.headers.get('CF-Connecting-IP') ?? 'unknown').allowed) {
    return jsonError('Too many reports from here. Try again shortly.', 429);
  }
  const access = await open(context);
  if (access instanceof Response || access.row.settings.playerReporting) {
    return access;
  }
  return jsonError('Results at this event are reported to staff', 403);
}

/** Files the report and publishes what it changed. */
async function report(context: Context<'code'>, access: Access, body: Body, who: { claim: PlayerClaim; id: string }) {
  const result = body.result as PlayerResult;
  if (!PLAYER_RESULTS.includes(result)) {
    return jsonError('Not a result', 400);
  }
  const outcome = await mutate(access.db, access.row.code, row =>
    reportChanges(row, who.claim, result, body.localTime)
  );
  if ('error' in outcome) {
    return jsonError(outcome.error, outcome.status);
  }
  await publishView(context.env.REPORTS, outcome.row);
  return privateJson({ key: outcome.row.keys[who.id] ?? null, view: publicViewOf(outcome.row) });
}

export async function onRequestPost(context: Context<'code'>): Promise<Response> {
  const access = await reportable(context);
  if (access instanceof Response) {
    return access;
  }
  const read = await readJsonBody(context.request, 1024);
  const body: Body = read.ok && typeof read.value === 'object' && read.value ? (read.value as Body) : {};
  const claim = claimOf(body);
  const found = findPlayer(access.row.tournament, isSanctioned(access.row), claim);
  if (!found.ok) {
    return privateJson({ error: found.error, ambiguous: found.ambiguous === true }, 404);
  }
  return body.result === undefined
    ? privateJson({ key: access.row.keys[found.id] ?? null })
    : report(context, access, body, { claim, id: found.id });
}
