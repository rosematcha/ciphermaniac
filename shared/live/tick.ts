/**
 * One polling step for a live event.
 *
 * The caller supplies the clock, the RK9 fetch and the publisher, and carries
 * the returned state into the next step, so the same step drives the Node
 * runner and the tests. A step reads the current round only; once that round is
 * finished it watches for the next one, and keeps rereading the finished round
 * for corrections until the next is posted. RK9 numbers rounds straight through
 * day two and the top cut.
 *
 * Pacing comes from what the step observes rather than from venue time zones:
 * while results are changing it runs on every call, and once nothing has
 * changed for a while it skips calls until the idle interval has passed.
 * @module shared/live/tick
 */

import { detectRoundBreakage, parseRk9Round } from './rk9Pairings';
import type { LiveEvent, LiveIndex, LiveRound, LiveRoundParse, LiveState } from './types';

/** Still polling every call this long after the last observed change. */
export const ACTIVE_WINDOW_MS = 90 * 60 * 1000;
/** Gap between polls once the active window has lapsed. */
export const IDLE_INTERVAL_MS = 10 * 60 * 1000;

export interface TickDeps {
  now: Date;
  publish: (key: string, value: unknown) => Promise<void>;
  /** Body of a round fragment; `''` when RK9 has not posted the round. */
  fetchRound: (event: LiveEvent, round: number) => Promise<string>;
  hash: (text: string) => Promise<string>;
}

export type TickOutcome = 'skipped' | 'not-posted' | 'unchanged' | 'written' | 'broken';

export interface TickResult {
  outcome: TickOutcome;
  state: LiveState;
}

/** Browsers poll the index; a minute-old round is as fresh as the source allows. */
export const LIVE_CACHE_CONTROL = 'public, max-age=30';

export const liveKeys = {
  index: (event: LiveEvent): string => `live/v1/${event.labsCode}/index.json`,
  round: (event: LiveEvent, round: number): string => `live/v1/${event.labsCode}/r${round}.json`
};

const IDLE_SINCE = new Date(0).toISOString();

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
    changedAt: index.updatedAt,
    checkedAt: ''
  };
}

function isDue(state: LiveState, now: Date): boolean {
  if (!state.checkedAt) {
    return true;
  }
  const active = now.getTime() - Date.parse(state.changedAt) < ACTIVE_WINDOW_MS;
  return active || now.getTime() - Date.parse(state.checkedAt) >= IDLE_INTERVAL_MS;
}

function buildIndex(event: LiveEvent, round: LiveRound, hash: string): LiveIndex {
  return {
    labsCode: event.labsCode,
    name: event.name,
    round: round.round,
    matches: round.matches.length,
    hash,
    playing: round.matches.filter(match => !match.complete).length,
    updatedAt: round.updatedAt
  };
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
 * The round this step is about. After a finished round that is the next one as
 * soon as RK9 shows any sign of it; until then the finished round is reread,
 * because staff correct results after a round closes.
 */
async function readCurrent(event: LiveEvent, deps: TickDeps, state: LiveState): Promise<RoundRead> {
  if (state.roundComplete) {
    const next = await readRound(event, deps, state.round + 1);
    if (next.parsed.rowsSeen > 0) {
      return next;
    }
  }
  return readRound(event, deps, state.round);
}

async function publish(event: LiveEvent, deps: TickDeps, read: RoundRead, digest: string): Promise<LiveState> {
  const { matches, rowsSkipped } = read.parsed;
  const updatedAt = deps.now.toISOString();
  const payload: LiveRound = { round: read.round, updatedAt, unreadable: rowsSkipped, matches };
  await deps.publish(liveKeys.round(event, read.round), payload);
  await deps.publish(liveKeys.index(event), buildIndex(event, payload, digest));
  return {
    round: read.round,
    roundComplete: matches.every(match => match.complete),
    hash: digest,
    matchCount: matches.length,
    changedAt: updatedAt,
    checkedAt: updatedAt
  };
}

export async function tickEvent(event: LiveEvent, state: LiveState, deps: TickDeps): Promise<TickResult> {
  if (!isDue(state, deps.now)) {
    return { outcome: 'skipped', state };
  }
  const checked = { ...state, checkedAt: deps.now.toISOString() };
  const read = await readCurrent(event, deps, state);
  const rejected = rejectRound(read.parsed, state, read.round);
  if (rejected) {
    return { outcome: rejected, state: checked };
  }
  const digest = await deps.hash(JSON.stringify(read.parsed.matches));
  if (read.round === state.round && digest === state.hash) {
    return { outcome: 'unchanged', state: checked };
  }
  return { outcome: 'written', state: await publish(event, deps, read, digest) };
}
