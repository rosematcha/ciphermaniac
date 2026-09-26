/**
 * POST /api/live/report: one viewer's word on what deck a player is on.
 *
 * The body is one report, or a batch of them under `reports`, which is how a
 * whole run is filled in at once: a player who posts their matchups names a
 * deck for every round, and sending those one at a time would be a request, a
 * read and a write each. A batch is one device on one event, so it is checked
 * once and published in a single rewrite of `reports.json`.
 *
 * The votes go to D1; each seat's reports are then recounted and the archetype
 * shown for it, if more than half agree, is patched into the event's
 * `reports.json` on R2. Browsers only ever read that file, so reading reports
 * costs this function nothing. Two requests landing together can each patch
 * over the other's seats; the next vote for a seat rewrites it, and a recount
 * is always from D1, so the file heals rather than drifts.
 *
 * The archetype has to be one the site already names, by label: the online
 * index or the archetype icon map.
 *
 * A device has one report per seat: reporting again replaces it, and a null
 * archetype takes it back. Neither takes up a new seat, so the per-device cap
 * never strands a device with reports it cannot fix.
 *
 * A reporter is a random ID from their own device. It stops honest double
 * counting and nothing more, so floods are met by the per-IP limiter and a cap
 * on how many seats one ID can report in an event. An address listed in
 * `TRUSTED_REPORTERS` skips the limiter: the site's own jobs fill in whole runs
 * from one address and are not a flood. Every other rule still applies to them.
 */

import {
  type DeckReport,
  leadingArchetype,
  type LiveReports,
  liveReportsKey,
  MAX_REPORTS_PER_REQUEST,
  parseDeckReports,
  reportableArchetypes
} from '../../../shared/live/reports.js';
import { isEventLive, LIVE_SCHEDULE_KEY } from '../../../shared/live/schedule.js';
import type { LiveSchedule } from '../../../shared/live/types.js';
import { ARCHETYPE_INDEX_KEY } from '../../lib/api/archetypeIndexKey.js';
import { readJsonBody } from '../../lib/api/body.js';
import { createRateLimiter } from '../../lib/api/rateLimiter.js';
import { jsonError, jsonSuccess } from '../../lib/api/responses.js';
import { createVoteStore, type D1Like, type VoteStore } from '../../lib/live/votes.js';

/** Every field of a report is length-bounded; 512 bytes each leaves a full batch room to spare. */
const MAX_BODY_BYTES = 512 * MAX_REPORTS_PER_REQUEST;
/**
 * A whole regional field and then some; past this an ID is not watching, it is
 * writing. Only new seats count against it: a device at the cap can still
 * correct or take back a seat it already reported.
 */
const MAX_SEATS_PER_VOTER = 1500;
const REPORTS_CACHE_CONTROL = 'public, max-age=30';
const ARCHETYPE_ICONS_KEY = 'assets/archetype-icons.json';

// In-memory, so per isolate; acceptable at the edge. 60 reports per IP per ten minutes.
const rateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 60 });

/** @internal exposed for tests */
export function _resetRateLimitStore(): void {
  rateLimiter.reset();
}

function trusted(env: { TRUSTED_REPORTERS?: string }, ip: string): boolean {
  return (env.TRUSTED_REPORTERS ?? '').split(',').some(entry => entry.trim() === ip && ip !== 'unknown');
}

/**
 * Spends `reports` of the address's allowance. A batch is charged per report
 * rather than per request, so filling in a run is not two dozen reports for the
 * price of one. A trusted address spends none of it.
 */
function withinRate(env: { TRUSTED_REPORTERS?: string }, ip: string, reports: number): boolean {
  if (trusted(env, ip)) {
    return true;
  }
  let allowed = true;
  for (let i = 0; i < reports; i += 1) {
    allowed = rateLimiter.check(ip).allowed && allowed;
  }
  return allowed;
}

interface Bucket {
  get: (key: string) => Promise<{ text: () => Promise<string> } | null>;
  put: (key: string, value: string, options: { httpMetadata: Record<string, string> }) => Promise<unknown>;
}

interface Env {
  REPORTS?: Bucket;
  LIVE_DB?: D1Like;
  /** Comma-separated addresses the per-IP limit does not apply to; unset trusts nobody. */
  TRUSTED_REPORTERS?: string;
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

/** Same two lists, same union, as the picker on the live page offers; read once per request. */
async function knownArchetypes(bucket: Bucket): Promise<string[]> {
  const [index, icons] = await Promise.all([
    readJson<{ label: string }[]>(bucket, ARCHETYPE_INDEX_KEY),
    readJson<Record<string, unknown>>(bucket, ARCHETYPE_ICONS_KEY)
  ]);
  return reportableArchetypes(Array.isArray(index) ? index.map(entry => entry.label) : [], Object.keys(icons ?? {}));
}

/** The seats whose published archetype the settled counts would change. */
function changedSeats(current: LiveReports | null, settled: ReadonlyMap<string, string | null>): string[] {
  return [...settled.keys()].filter(seat => (current?.decks[seat] ?? null) !== settled.get(seat));
}

async function publishSeats(bucket: Bucket, slug: string, settled: ReadonlyMap<string, string | null>): Promise<void> {
  const key = liveReportsKey(slug);
  const current = await readJson<LiveReports>(bucket, key);
  const changed = changedSeats(current, settled);
  if (changed.length === 0) {
    return;
  }
  const decks = { ...current?.decks };
  for (const seat of changed) {
    const archetype = settled.get(seat);
    if (archetype) {
      decks[seat] = archetype;
    } else {
      delete decks[seat];
    }
  }
  const reports: LiveReports = { updatedAt: new Date().toISOString(), decks };
  await bucket.put(key, JSON.stringify(reports), {
    httpMetadata: { contentType: 'application/json', cacheControl: REPORTS_CACHE_CONTROL }
  });
}

/** Why the batch must be refused, if it must be; the checks a whole batch shares, read side by side. */
async function refuse(bucket: Bucket, slug: string, reports: readonly DeckReport[]): Promise<Response | null> {
  const named = reports.flatMap(report => (report.archetype === null ? [] : [report.archetype]));
  const [live, known] = await Promise.all([
    isLiveEvent(bucket, slug),
    named.length > 0 ? knownArchetypes(bucket) : Promise.resolve([])
  ]);
  if (!live) {
    return jsonError('No such live event', 404);
  }
  if (named.some(archetype => !known.includes(archetype))) {
    return jsonError('Unknown archetype', 400);
  }
  return null;
}

/**
 * Whether the batch would take the device past its seat cap. Only seats it does
 * not already report count: changing a report, or taking one back, adds no row,
 * so a device at the cap is never stranded with reports it cannot fix.
 */
async function overSeatCap(votes: VoteStore, first: DeckReport, reports: readonly DeckReport[]): Promise<boolean> {
  const taking = reports.flatMap(report => (report.archetype === null ? [] : [report.seat]));
  if (taking.length === 0) {
    return false;
  }
  const load = await votes.loadOf(first.slug, first.voter, taking);
  return load.seats + taking.length - load.held > MAX_SEATS_PER_VOTER;
}

/** Records every report, then recounts each seat it touched. */
async function settle(votes: VoteStore, reports: readonly DeckReport[]): Promise<Map<string, string | null>> {
  const tallies = await votes.settle(reports, Date.now());
  return new Map(reports.map((report, i) => [report.seat, leadingArchetype(tallies[i] ?? [])]));
}

/** The batch a request carries, or null when it is oversized or not a deck report. */
async function readReports(request: Request): Promise<DeckReport[] | null> {
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  return body.ok ? parseDeckReports(body.value) : null;
}

export async function onRequestPost({ request, env }: RequestContext): Promise<Response> {
  if (!env.REPORTS || !env.LIVE_DB) {
    return jsonError('Reports are not available', 503);
  }
  // One unit before the body is even read, so a flood of junk is limited too.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!withinRate(env, ip, 1)) {
    return jsonError('Too many reports. Try again later.', 429);
  }
  const reports = await readReports(request);
  const first = reports?.[0];
  if (!reports || !first) {
    return jsonError('Not a deck report', 400);
  }
  if (!withinRate(env, ip, reports.length - 1)) {
    return jsonError('Too many reports. Try again later.', 429);
  }
  const { slug, seat } = first;
  const refused = await refuse(env.REPORTS, slug, reports);
  if (refused) {
    return refused;
  }
  const votes = createVoteStore(env.LIVE_DB);
  if (await overSeatCap(votes, first, reports)) {
    return jsonError('Too many reports. Try again later.', 429);
  }
  const settled = await settle(votes, reports);
  await publishSeats(env.REPORTS, slug, settled);
  // `archetype` is the first seat's, for the single-report callers this grew from.
  return jsonSuccess({ archetype: settled.get(seat) ?? null, archetypes: Object.fromEntries(settled) });
}
