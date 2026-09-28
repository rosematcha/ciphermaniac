/**
 * GET /api/tournaments/:code — the event's public page data: pairings,
 * standings and who the viewer is in it. `?since=<version>` answers 204 when
 * nothing has changed, which is what the page polls with.
 * DELETE /api/tournaments/:code — the owner removes the event.
 */

import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { open, openForStaff, privateJson, viewOf } from '../../../lib/tournaments/access.js';
import { deleteTournament, isCode, loadVersion } from '../../../lib/tournaments/store.js';

async function unchanged(context: Context<'code'>): Promise<boolean> {
  const since = Number(new URL(context.request.url).searchParams.get('since'));
  const code = String(context.params.code).toUpperCase();
  if (!since || !context.env.TOURNAMENT_DB || !isCode(code)) {
    return false;
  }
  return (await loadVersion(context.env.TOURNAMENT_DB, code)) === since;
}

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
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
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
