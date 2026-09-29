/**
 * POST /api/tournaments/:code/report — a player says who they are: { popId }
 * at a sanctioned event, or { lastName, firstName? } at an unsanctioned one.
 * Alone, that answers with their public key and the event, so the page can
 * follow their pairings; any event takes it, as it is how a player marks
 * themselves. With { result } ('win', 'loss' or 'tie') it also reports their
 * current match (see shared/tournament/reports.ts), where player reporting
 * is on. Either way, results whose reports
 * have agreed and locked are written in first, so a player asking again once
 * their window closes sees the result stand.
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
  reportableMatch
} from '../../../../shared/tournament/reports.js';
import { applyPending, isSanctioned } from '../../../../shared/tournament/view.js';
import { readJsonBody } from '../../../lib/api/body.js';
import { createRateLimiter } from '../../../lib/api/rateLimiter.js';
import { jsonError } from '../../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../../lib/auth/env.js';
import { type Access, open, privateJson, publicViewOf } from '../../../lib/tournaments/access.js';
import { publishView } from '../../../lib/tournaments/publish.js';
import { mutateSettled, settleIfDue } from '../../../lib/tournaments/results.js';
import type { Changes, TournamentRow } from '../../../lib/tournaments/store.js';

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
  return typeof open === 'string' ? open : playerReport(open, found.id, result, Date.now());
}

/** The report laid over the event's others; the result stands once both players' reports agree and lock. */
function reportChanges(row: TournamentRow, claim: PlayerClaim, result: PlayerResult): Changes | string {
  const report = readReport(row, claim, result);
  const reports = typeof report === 'string' ? report : fileReport(row.reports, report);
  return typeof reports === 'string' ? reports : { reports };
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

/** The event, when this request may ask of it; the refusal when it may not. */
async function reachable(context: Context<'code'>): Promise<Access | Response> {
  if (!sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  if (!rateLimiter.check(context.request.headers.get('CF-Connecting-IP') ?? 'unknown').allowed) {
    return jsonError('Too many reports from here. Try again shortly.', 429);
  }
  return open(context);
}

/** Files the report and publishes what it changed. */
async function report(context: Context<'code'>, access: Access, body: Body, who: { claim: PlayerClaim; id: string }) {
  const result = body.result as PlayerResult;
  if (!PLAYER_RESULTS.includes(result)) {
    return jsonError('Not a result', 400);
  }
  const outcome = await mutateSettled(
    access.db,
    access.row.code,
    row => reportChanges(row, who.claim, result),
    body.localTime
  );
  if ('error' in outcome) {
    return jsonError(outcome.error, outcome.status);
  }
  await publishView(context.env.REPORTS, outcome.row);
  return privateJson({ key: outcome.row.keys[who.id] ?? null, view: publicViewOf(outcome.row) });
}

/** Who the player is, and the event with any due results settled. */
async function identify(context: Context<'code'>, access: Access, body: Body, id: string) {
  const row = await settleIfDue(access.db, access.row, body.localTime);
  if (row !== access.row) {
    await publishView(context.env.REPORTS, row);
  }
  return privateJson({ key: row.keys[id] ?? null, view: publicViewOf(row) });
}

export async function onRequestPost(context: Context<'code'>): Promise<Response> {
  const access = await reachable(context);
  if (access instanceof Response) {
    return access;
  }
  const read = await readJsonBody(context.request, 1024);
  const body: Body = read.ok && typeof read.value === 'object' && read.value ? (read.value as Body) : {};
  if (body.result !== undefined && !access.row.settings.playerReporting) {
    return jsonError('Results at this event are reported to staff', 403);
  }
  const claim = claimOf(body);
  const found = findPlayer(access.row.tournament, isSanctioned(access.row), claim);
  if (!found.ok) {
    return privateJson({ error: found.error, ambiguous: found.ambiguous === true }, 404);
  }
  return body.result === undefined
    ? identify(context, access, body, found.id)
    : report(context, access, body, { claim, id: found.id });
}
