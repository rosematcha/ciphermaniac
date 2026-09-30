/**
 * POST /api/tournaments/:code/report — a player says who they are: { popId }
 * at a sanctioned event, or { lastName, firstName? } at an unsanctioned one.
 * Alone, that answers with their public key and the event, so the page can
 * follow their pairings; any event takes it, as it is how a player marks
 * themselves. With { result } ('win', 'loss' or 'tie') it also reports their
 * current match (see shared/tournament/reports.ts), where player reporting
 * is on; { match: { pod, round, table } } names the match the page showed,
 * and a report for one that is no longer current is refused. Either way,
 * results whose reports have agreed and locked are written in first, so a
 * player asking again once their window closes sees the result stand.
 *
 * Nobody signs in for this, as a player at the table has no time to. Knowing
 * a player's Player ID or name finds their table, but a player knows their
 * opponent's too, so reporting also takes the token the first device to say
 * who the player is was given (see lib/tournaments/reporters.ts): nobody can
 * report for both seats of a match. Staff can override any result, and
 * release a player's device (DELETE, { player }) when they change phones.
 */

import { findPlayer, type PlayerClaim } from '../../../../shared/tournament/identify.js';
import {
  fileReport,
  PLAYER_RESULTS,
  playerReport,
  type PlayerResult,
  reportableMatch,
  type ShownMatch,
  stillShown
} from '../../../../shared/tournament/reports.js';
import type { PodCategory } from '../../../../shared/tournament/types.js';
import { applyPending, isSanctioned } from '../../../../shared/tournament/view.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { createRateLimiter } from '../../../lib/api/rateLimiter.js';
import { jsonError, noContent } from '../../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../../lib/auth/env.js';
import { type Access, open, openForStaff, privateJson, publicViewOf } from '../../../lib/tournaments/access.js';
import { settled } from '../../../lib/tournaments/answers.js';
import { publishAfter } from '../../../lib/tournaments/publish.js';
import { type Claim, claimReporter, releaseReporter } from '../../../lib/tournaments/reporters.js';
import { mutateSettled } from '../../../lib/tournaments/results.js';
import type { Changes, TournamentRow } from '../../../lib/tournaments/store.js';

type Body = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 60) : undefined);

function claimOf(body: Body): PlayerClaim {
  return { popId: text(body.popId), lastName: text(body.lastName), firstName: text(body.firstName) };
}

const NOT_REPORTER = 'Someone else is already reporting for this player. Ask staff if that’s wrong.';

/** The match the player's page showed them, when it said: pod, round and table. */
function shownOf(value: unknown): ShownMatch | undefined {
  const shown = typeof value === 'object' && value ? (value as Record<string, unknown>) : {};
  const { pod, round, table } = shown;
  return typeof pod === 'string' && typeof round === 'number' && typeof table === 'number'
    ? { pod: pod as PodCategory, round, table }
    : undefined;
}

interface Filing {
  claim: PlayerClaim;
  result: PlayerResult;
  shown: ShownMatch | undefined;
  device: string;
}

/** The player's report of their open match, or why they cannot report. */
function readReport(row: TournamentRow, filing: Filing) {
  const found = findPlayer(row.tournament, isSanctioned(row), filing.claim);
  if (!found.ok) {
    return found.error;
  }
  const open = reportableMatch(applyPending(row.tournament, row.pending), found.id);
  if (typeof open === 'string') {
    return open;
  }
  return stillShown(open, filing.shown)
    ? playerReport(open, found.id, filing.result, { at: Date.now(), device: filing.device })
    : 'Your pairing has changed; check your table';
}

/** The report laid over the event's others; the result stands once both players' reports agree and lock. */
function reportChanges(row: TournamentRow, filing: Filing): Changes | string {
  const report = readReport(row, filing);
  const reports = typeof report === 'string' ? report : fileReport(row.reports, report);
  return typeof reports === 'string' ? reports : { reports };
}

/**
 * A room of players shares the venue's address, and each says who they are,
 * reports and asks again a few times a round, most of it in the minutes a
 * round ends; this stops a script, not a busy event. It matches the event
 * page's own limit.
 */
const rateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 1200 });

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

/** What the answer says of the asker's device: the token when it just claimed the player, and whether it reports. */
const standingOf = (claim: Claim) => ({
  reporter: claim.reporter,
  ...(claim.token ? { reportToken: claim.token } : {})
});

/** Files the report, from the device that reports for the player, and publishes what it changed. */
async function report(context: Context<'code'>, access: Access, body: Body, who: { claim: PlayerClaim; id: string }) {
  const result = body.result as PlayerResult;
  if (!PLAYER_RESULTS.includes(result)) {
    return jsonError('Not a result', 400);
  }
  const { db, row } = access;
  const standing = await claimReporter(db, row.code, who.id, { held: body.reportToken, device: body.device });
  if (!standing.reporter) {
    return jsonError(NOT_REPORTER, 403);
  }
  const filing = { claim: who.claim, result, shown: shownOf(body.match), device: standing.device ?? '' };
  const outcome = await mutateSettled(db, row, r => reportChanges(r, filing), body.localTime);
  if ('error' in outcome) {
    return jsonError(outcome.error, outcome.status);
  }
  await publishAfter(context, outcome.row);
  return privateJson({
    key: outcome.row.keys[who.id] ?? null,
    view: publicViewOf(outcome.row),
    ...standingOf(standing)
  });
}

/** Who the player is, whether this device reports for them, and the event with any due results settled. */
async function identify(context: Context<'code'>, access: Access, body: Body, id: string) {
  const standing = await claimReporter(access.db, access.row.code, id, { held: body.reportToken, device: body.device });
  const row = await settled(context, access, body.localTime);
  return privateJson({ key: row.keys[id] ?? null, view: publicViewOf(row), ...standingOf(standing) });
}

/** Staff let another device claim a player ({ player }, their Player ID or the event's own ID for them). */
export async function onRequestDelete(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const player = new URL(context.request.url).searchParams.get('player') ?? '';
  if (!access.row.tournament.players.some(p => p.id === player)) {
    return jsonError('No such player', 404);
  }
  await releaseReporter(access.db, access.row.code, player);
  return noContent();
}

export async function onRequestPost(context: Context<'code'>): Promise<Response> {
  const access = await reachable(context);
  if (access instanceof Response) {
    return access;
  }
  const body: Body = (await readJsonObject(context.request, 1024)) ?? {};
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
