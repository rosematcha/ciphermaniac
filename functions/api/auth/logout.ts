/** POST /api/auth/logout — ends this browser's session. */

import { clearCookie, SESSION_COOKIE } from '../../lib/auth/cookies.js';
import { type Context, sameOrigin } from '../../lib/auth/env.js';
import { endSession } from '../../lib/auth/session.js';
import { jsonError } from '../../lib/api/responses.js';

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  if (!sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  if (env.TOURNAMENT_DB) {
    await endSession(env.TOURNAMENT_DB, request);
  }
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clearCookie(request, SESSION_COOKIE), 'Cache-Control': 'no-store' }
  });
}
