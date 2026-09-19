/**
 * POST /api/live/report: one viewer's word on what deck a player is on.
 *
 * The vote goes to D1; the seat's reports are then recounted and the archetype
 * shown for it, if more than half agree, is patched into the event's
 * `reports.json` on R2. Browsers only ever read that file, so reading reports
 * costs this function nothing. Two votes landing together can each patch over
 * the other's seat; the next vote for a seat rewrites it, and a recount is
 * always from D1, so the file heals rather than drifts.
 *
 * The archetype has to be one the site already names, by label: the online
 * index or the archetype icon map.
 *
 * A reporter is a random ID from their own device. It stops honest double
 * counting and nothing more, so floods are met by the per-IP limiter and a cap
 * on how many seats one ID can report in an event.
 */

import {
  leadingArchetype,
  type LiveReports,
  liveReportsKey,
  parseDeckReport,
  reportableArchetypes
} from '../../../shared/live/reports.js';
import { isEventLive, LIVE_SCHEDULE_KEY } from '../../../shared/live/schedule.js';
import type { LiveSchedule } from '../../../shared/live/types.js';
import { ARCHETYPE_INDEX_KEY } from '../../lib/api/archetypeIndexKey.js';
import { createRateLimiter } from '../../lib/api/rateLimiter.js';
import { jsonError, jsonSuccess } from '../../lib/api/responses.js';
import { createVoteStore, type D1Like } from '../../lib/live/votes.js';

const MAX_BODY_BYTES = 1024;
/** A whole top cut and then some; past this an ID is not watching, it is writing. */
const MAX_SEATS_PER_VOTER = 150;
const REPORTS_CACHE_CONTROL = 'public, max-age=30';
const ARCHETYPE_ICONS_KEY = 'assets/archetype-icons.json';

// In-memory, so per isolate; acceptable at the edge. 60 reports per IP per ten minutes.
const rateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 60 });

/** @internal exposed for tests */
export function _resetRateLimitStore(): void {
  rateLimiter.reset();
}

interface Bucket {
  get: (key: string) => Promise<{ text: () => Promise<string> } | null>;
  put: (key: string, value: string, options: { httpMetadata: Record<string, string> }) => Promise<unknown>;
}

interface Env {
  REPORTS?: Bucket;
  LIVE_DB?: D1Like;
}

interface RequestContext {
  request: Request;
  env: Env;
}

async function readJson<T>(bucket: Bucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);
  return object ? (JSON.parse(await object.text()) as T) : null;
}

async function isLiveEvent(bucket: Bucket, slug: string): Promise<boolean> {
  const schedule = await readJson<LiveSchedule>(bucket, LIVE_SCHEDULE_KEY);
  const event = schedule?.events.find(candidate => candidate.slug === slug);
  return event !== undefined && isEventLive(event, new Date());
}

/** Same two lists, same union, as the picker on the live page offers. */
async function isKnownArchetype(bucket: Bucket, archetype: string): Promise<boolean> {
  const [index, icons] = await Promise.all([
    readJson<{ label: string }[]>(bucket, ARCHETYPE_INDEX_KEY),
    readJson<Record<string, unknown>>(bucket, ARCHETYPE_ICONS_KEY)
  ]);
  const labels = reportableArchetypes(
    Array.isArray(index) ? index.map(entry => entry.label) : [],
    Object.keys(icons ?? {})
  );
  return labels.includes(archetype);
}

async function publishSeat(bucket: Bucket, slug: string, seat: string, archetype: string | null): Promise<void> {
  const key = liveReportsKey(slug);
  const decks = { ...(await readJson<LiveReports>(bucket, key))?.decks };
  if (archetype) {
    decks[seat] = archetype;
  } else {
    delete decks[seat];
  }
  const reports: LiveReports = { updatedAt: new Date().toISOString(), decks };
  await bucket.put(key, JSON.stringify(reports), {
    httpMetadata: { contentType: 'application/json', cacheControl: REPORTS_CACHE_CONTROL }
  });
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function onRequestPost({ request, env }: RequestContext): Promise<Response> {
  if (!env.REPORTS || !env.LIVE_DB) {
    return jsonError('Reports are not available', 503);
  }
  if (!rateLimiter.check(request.headers.get('CF-Connecting-IP') ?? 'unknown').allowed) {
    return jsonError('Too many reports. Try again later.', 429);
  }
  const report = parseDeckReport(await readBody(request));
  if (!report) {
    return jsonError('Not a deck report', 400);
  }
  if (!(await isLiveEvent(env.REPORTS, report.slug))) {
    return jsonError('No such live event', 404);
  }
  if (!(await isKnownArchetype(env.REPORTS, report.archetype))) {
    return jsonError('Unknown archetype', 400);
  }

  const votes = createVoteStore(env.LIVE_DB);
  if ((await votes.votesBy(report.slug, report.voter)) >= MAX_SEATS_PER_VOTER) {
    return jsonError('Too many reports. Try again later.', 429);
  }
  await votes.record(report, Date.now());
  const archetype = leadingArchetype(await votes.tally(report.slug, report.seat));
  await publishSeat(env.REPORTS, report.slug, report.seat, archetype);
  return jsonSuccess({ archetype });
}
