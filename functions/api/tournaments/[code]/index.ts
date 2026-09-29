/**
 * GET /api/tournaments/:code — the event's public page data: pairings,
 * standings and who the viewer is in it. `?since=<version>` answers 204 when
 * nothing has changed, which is what the page polls with. A room of players
 * shares one address, so the limit is generous: it is there to make walking
 * the code space for events slow, not to slow a venue.
 * DELETE /api/tournaments/:code — the owner removes the event.
 */

import { createRateLimiter } from '../../../lib/api/rateLimiter.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { open, openForStaff, privateJson, viewOf } from '../../../lib/tournaments/access.js';
import { unpublishView } from '../../../lib/tournaments/publish.js';
import { deleteTournament, isCode, loadVersion } from '../../../lib/tournaments/store.js';

async function unchanged(context: Context<'code'>): Promise<boolean> {
  const since = Number(new URL(context.request.url).searchParams.get('since'));
  const code = String(context.params.code).toUpperCase();
  if (!since || !context.env.TOURNAMENT_DB || !isCode(code)) {
    return false;
  }
  return (await loadVersion(context.env.TOURNAMENT_DB, code)) === since;
}

const rateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 1200 });

/** @internal exposed for tests */
export function _resetRateLimitStore(): void {
  rateLimiter.reset();
}

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  if (!rateLimiter.check(context.request.headers.get('CF-Connecting-IP') ?? 'unknown').allowed) {
    return jsonError('Too many requests from here. Try again shortly.', 429);
  }
  if (await unchanged(context)) {
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }
  const access = await open(context);
  return access instanceof Response ? access : privateJson(viewOf(access));
}

export async function onRequestDelete(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  if (access.role !== 'owner') {
    return jsonError('Only the organizer can delete the event', 403);
  }
  await deleteTournament(access.db, access.row.code);
  await unpublishView(context.env.REPORTS, access.row.code);
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
