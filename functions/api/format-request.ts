/**
 * POST /api/format-request: a format someone typed into the tier list's
 * Formats tab because the list lacked it.
 *
 * Counted, not logged: one row per name, folded case-insensitively, with how
 * often and when it was asked for. Nothing about who asked is kept, so the
 * table answers "which formats are missing" and nothing else. The page fires
 * and forgets, so every answer is an empty 204: a failure here must never
 * reach the person ranking.
 */

import { isRecord } from '../../shared/data/validate.js';
import { readJsonBody } from '../lib/api/body.js';
import { createRateLimiter } from '../lib/api/rateLimiter.js';
import type { D1Like } from '../lib/types.js';

/** Matches the name field's own limit in the tier list editor. */
const MAX_NAME_LENGTH = 24;
const MAX_BODY_BYTES = 512;

// In-memory, so per isolate; acceptable at the edge. 20 names per IP per hour.
const rateLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, maxRequests: 20 });

/** @internal exposed for tests */
export function _resetRateLimitStore(): void {
  rateLimiter.reset();
}

interface RequestContext {
  request: Request;
  env: { LIVE_DB?: D1Like };
}

const COUNT_REQUEST = `INSERT INTO format_requests (name_key, name, count, first_seen, last_seen)
VALUES (?1, ?2, 1, ?3, ?3)
ON CONFLICT (name_key) DO UPDATE SET count = count + 1, last_seen = excluded.last_seen`;

/** The name as it will be stored, or null for anything that is not one. */
export function formatRequestName(body: unknown): string | null {
  const raw = isRecord(body) && typeof body.name === 'string' ? body.name : '';
  const name = raw.replace(/\s+/g, ' ').trim();
  return name && name.length <= MAX_NAME_LENGTH && !/\p{Cc}/u.test(name) ? name : null;
}

const noContent = (): Response => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

async function readName(request: Request): Promise<string | null> {
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  return body.ok ? formatRequestName(body.value) : null;
}

export async function onRequestPost({ request, env }: RequestContext): Promise<Response> {
  const db = env.LIVE_DB;
  if (!db || !rateLimiter.check(request.headers.get('CF-Connecting-IP') ?? 'unknown').allowed) {
    return noContent();
  }
  const name = await readName(request);
  if (name) {
    await db
      .prepare(COUNT_REQUEST)
      .bind(name.toLowerCase(), name, Date.now())
      .run()
      .catch((error: unknown) => console.error('format-request write failed', error));
  }
  return noContent();
}
