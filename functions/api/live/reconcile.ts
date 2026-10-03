import { jsonError, jsonSuccess } from '../../lib/api/responses.js';
import { sha256 } from '../../lib/auth/session.js';
import { type LiveBucket, publishSeats } from '../../lib/live/publish.js';
import { createVoteStore } from '../../lib/live/votes.js';
import type { D1Like } from '../../lib/types.js';

interface Context {
  request: Request;
  env: { REPORTS?: LiveBucket; LIVE_DB?: D1Like; LIVE_RECONCILE_TOKEN?: string };
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const token = env.LIVE_RECONCILE_TOKEN;
  const sent = request.headers.get('Authorization') ?? '';
  if (!token || (await sha256(sent)) !== (await sha256(`Bearer ${token}`))) {
    return jsonError('Forbidden', 403);
  }
  if (!env.REPORTS || !env.LIVE_DB) {
    return jsonError('Reports are not available', 503);
  }
  const votes = createVoteStore(env.LIVE_DB);
  const failed: string[] = [];
  for (const slug of await votes.pending()) {
    await votes.markAttempted(slug, Date.now());
    try {
      await publishSeats(env.REPORTS, votes, slug);
    } catch {
      failed.push(slug);
    }
  }
  return failed.length > 0 ? jsonError('Publication pending', 503) : jsonSuccess({ reconciled: true });
}
