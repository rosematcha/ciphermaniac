/**
 * One polling step for a live event.
 *
 * The caller supplies the clock, the RK9 fetch and the publisher, and carries
 * the returned state into the next step, so the same step drives the Node
 * runner and the tests. A step is one of two looks. A read fetches the current
 * round; once that round is finished, or has gone quiet, it looks for the next
 * one first, and keeps rereading the current round for corrections until the
 * next is posted. A probe fetches only the next round, which RK9 answers with
 * an empty body until it is posted, so it can run every few seconds while a
 * round is expected. RK9 numbers rounds straight through day two and the top
 * cut.
 *
 * Pacing is `shared/live/pace.ts`: reads every minute while results are
 * changing, spaced out once they stop, asleep overnight, and never again once
 * the final has a result; probes in the minutes a new round is expected. Day
 * one's first round has no anchor to expect it by, so it is probed every half
 * minute through any hour the first day's morning could fall on.
 * @module shared/live/tick
 */

import { ACTIVE_WINDOW_MS, awaitsNextRound, type LivePace, nextCheck, PROBE_INTERVAL_MS } from './pace';
import { detectRoundBreakage, parseRk9Round } from './rk9Pairings';
import { isDecided } from './view';
import { sameMatches } from './sameMatches';
import type { LiveCut, LiveEvent, LiveIndex, LiveRound, LiveRoundParse, LiveState } from './types';

export interface TickDeps {
  now: Date;
  publish: (key: string, value: unknown) => Promise<void>;
  /** Body of a round fragment; `''` when RK9 has not posted the round. */
  fetchRound: (event: LiveEvent, round: number) => Promise<string>;
  hash: (text: string) => Promise<string>;
}

/** `probed`: a probe found no new round. */
export type TickOutcome = 'skipped' | 'probed' | 'not-posted' | 'unchanged' | 'written' | 'broken';

export interface TickResult {
  outcome: TickOutcome;
  state: LiveState;
}

/** Browsers poll the index; a minute-old round is as fresh as the source allows. */
export const LIVE_CACHE_CONTROL = 'public, max-age=30';

export const liveKeys = {
  index: (event: LiveEvent): string => `live/v1/${event.slug}/index.json`,
  round: (event: LiveEvent, round: number): string => `live/v1/${event.slug}/r${round}.json`
};

const IDLE_SINCE = new Date(0).toISOString();
const HOUR = 60 * 60 * 1000;
/** Gap between probes for day one's first round. */
export const FIRST_ROUND_PROBE_MS = 30 * 1000;
/**
 * The first day's mornings, relative to its UTC midnight: from the first
 * morning at UTC+14 to the last at UTC-10, the widest offsets RK9 events run in.
 */
const FIRST_MORNING_FROM = -14 * HOUR;
const FIRST_MORNING_UNTIL = 24 * HOUR;

/** Starts idle, so an event with nothing posted is polled at the idle interval. */
export function initialState(): LiveState {
  return { round: 1, roundComplete: false, hash: '', matchCount: 0, changedAt: IDLE_SINCE, checkedAt: '' };
}

/**
 * State for a runner taking over mid-event, from the index the last one
 * published. Carrying the hash and match count over keeps the shrink guard armed
 * and spares a rewrite of a round that has not changed.
 */
export function resumeState(index: LiveIndex): LiveState {
  return {
    round: index.round,
    roundComplete: index.playing === 0,
    hash: index.hash,
    matchCount: index.matches,
    playing: index.playing,
    changedAt: index.updatedAt,
    checkedAt: '',
    ...(index.cut ? { cut: index.cut } : {}),
    ...(index.round2At ? { round2At: index.round2At } : {}),
    ...(index.finished ? { finished: true } : {})
  };
}

function paceOf(state: LiveState): LivePace {
  return { ...state, topCut: state.cut !== undefined && state.round >= state.cut.from };
}

/** Whether any round has been published; until one is, the current round is round one, unposted. */
function isPosted(state: LiveState): boolean {
  return state.round > 1 || state.hash !== '';
}

function isDue(state: LiveState, now: Date): boolean {
  if (!state.checkedAt) {
    return !state.finished;
  }
  const next = nextCheck(paceOf(state), Date.parse(state.checkedAt));
  return next !== null && now.getTime() >= next;
}

function isFirstMorning(event: LiveEvent, now: number): boolean {
  const since = now - Date.parse(`${event.firstDay}T00:00:00Z`);
  return since >= FIRST_MORNING_FROM && since < FIRST_MORNING_UNTIL;
}

/** How often to probe for the next round now, or null while none is expected. */
function probeInterval(event: LiveEvent, state: LiveState, now: number): number | null {
  if (!isPosted(state)) {
    return isFirstMorning(event, now) ? FIRST_ROUND_PROBE_MS : null;
  }
  return awaitsNextRound(paceOf(state), now) ? PROBE_INTERVAL_MS : null;
}

type Look = 'read' | 'probe';

/** The look due now, if any. A read also looks for the next round, so it counts as a probe. */
function dueLook(event: LiveEvent, state: LiveState, now: Date): Look | null {
  if (isDue(state, now)) {
    return 'read';
  }
  const interval = state.finished ? null : probeInterval(event, state, now.getTime());
  const last = Math.max(Date.parse(state.checkedAt), Date.parse(state.probedAt ?? IDLE_SINCE));
  return interval !== null && now.getTime() - last >= interval ? 'probe' : null;
}

function buildIndex(event: LiveEvent, round: LiveRound, hash: string, state: LiveState): LiveIndex {
  return {
    slug: event.slug,
    rk9Id: event.rk9Id,
    name: event.name,
    round: round.round,
    matches: round.matches.length,
    hash,
    playing: state.playing ?? 0,
    updatedAt: round.updatedAt,
    ...(state.cut ? { cut: state.cut } : {}),
    ...(state.round2At ? { round2At: state.round2At } : {}),
    ...(state.finished ? { finished: true } : {})
  };
}

/** The cut, from the first top cut round seen; two seats a match. */
function cutFor(state: LiveState, read: RoundRead): LiveCut | undefined {
  if (state.cut || !read.parsed.topCut) {
    return state.cut;
  }
  return { from: read.round, size: read.parsed.matches.length * 2 };
}

type QuietOutcome = Exclude<TickOutcome, 'skipped' | 'written'>;

/**
 * Why a parsed round must not be published, if it must not. A round never loses
 * tables, so fewer matches than were last published is a bad read rather than
 * news, whatever the markup looks like.
 */
function rejectRound(parsed: LiveRoundParse, state: LiveState, round: number): QuietOutcome | null {
  const shrunk = round === state.round && parsed.matches.length < state.matchCount;
  const breakage =
    detectRoundBreakage(parsed) ??
    (shrunk ? `round shrank from ${state.matchCount} to ${parsed.matches.length} matches` : undefined);
  if (breakage) {
    console.warn(`live r${round}: ${breakage}`);
    return 'broken';
  }
  return parsed.matches.length === 0 ? 'not-posted' : null;
}

interface RoundRead {
  round: number;
  parsed: LiveRoundParse;
}

async function readRound(event: LiveEvent, deps: TickDeps, round: number): Promise<RoundRead> {
  return { round, parsed: parseRk9Round(await deps.fetchRound(event, round)) };
}

/**
 * Whether RK9 may have moved past the current round: it is finished, or has
 * been quiet so long that its last results may never be filled in.
 */
function mayHaveMovedOn(state: LiveState, now: Date): boolean {
  return isPosted(state) && (state.roundComplete || now.getTime() - Date.parse(state.changedAt) >= ACTIVE_WINDOW_MS);
}

/**
 * The round a read is about. After a round RK9 may have moved past, that is the
 * next one as soon as RK9 shows any sign of it; until then the current round is
 * reread, because staff correct results after a round closes.
 */
async function readCurrent(event: LiveEvent, deps: TickDeps, state: LiveState): Promise<RoundRead> {
  if (mayHaveMovedOn(state, deps.now)) {
    const next = await readRound(event, deps, state.round + 1);
    if (next.parsed.rowsSeen > 0) {
      return next;
    }
  }
  return readRound(event, deps, state.round);
}

async function publish(
  event: LiveEvent,
  deps: TickDeps,
  state: LiveState,
  read: RoundRead & { digest: string }
): Promise<LiveState> {
  const { digest } = read;
  const { matches, rowsSkipped, topCut } = read.parsed;
  const updatedAt = deps.now.toISOString();
  const roundComplete = matches.every(match => match.complete);
  const next: LiveState = {
    round: read.round,
    roundComplete,
    hash: digest,
    matchCount: matches.length,
    matches,
    playing: matches.filter(match => !isDecided(match)).length,
    changedAt: updatedAt,
    checkedAt: updatedAt,
    cut: cutFor(state, read),
    round2At: state.round2At ?? (read.round === 2 ? updatedAt : undefined),
    // The final is the one top cut match; once it has a result there is no next round.
    finished: topCut && matches.length === 1 && roundComplete
  };
  const payload: LiveRound = {
    round: read.round,
    updatedAt,
    ...(topCut ? { topCut: true as const } : {}),
    unreadable: rowsSkipped,
    matches
  };
  await deps.publish(liveKeys.round(event, read.round), payload);
  await deps.publish(liveKeys.index(event), buildIndex(event, payload, digest, next));
  return next;
}

/** What a look's round means: nothing new, a bad read, or a round to publish. `state` has the look recorded. */
async function settle(event: LiveEvent, deps: TickDeps, state: LiveState, read: RoundRead): Promise<TickResult> {
  const rejected = rejectRound(read.parsed, state, read.round);
  if (rejected) {
    return { outcome: rejected, state };
  }
  if (read.round === state.round && state.matches && sameMatches(state.matches, read.parsed.matches)) {
    return { outcome: 'unchanged', state };
  }
  const digest = await deps.hash(JSON.stringify(read.parsed.matches));
  if (read.round === state.round && digest === state.hash) {
    return { outcome: 'unchanged', state: { ...state, matches: read.parsed.matches } };
  }
  return { outcome: 'written', state: await publish(event, deps, state, { ...read, digest }) };
}

async function probe(event: LiveEvent, deps: TickDeps, state: LiveState): Promise<TickResult> {
  const probed = { ...state, probedAt: deps.now.toISOString() };
  const read = await readRound(event, deps, isPosted(state) ? state.round + 1 : state.round);
  if (read.parsed.rowsSeen === 0) {
    return { outcome: 'probed', state: probed };
  }
  return settle(event, deps, probed, read);
}

export async function tickEvent(event: LiveEvent, state: LiveState, deps: TickDeps): Promise<TickResult> {
  const look = dueLook(event, state, deps.now);
  if (look === 'probe') {
    return probe(event, deps, state);
  }
  if (look === null) {
    return { outcome: 'skipped', state };
  }
  const checked = { ...state, checkedAt: deps.now.toISOString() };
  return settle(event, deps, checked, await readCurrent(event, deps, state));
}
