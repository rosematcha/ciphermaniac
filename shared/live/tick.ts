/**
 * One polling step for a live event, independent of where it runs.
 *
 * The caller supplies the clock, the RK9 fetch and the store, so the same step
 * drives a Node loop, a Worker cron, and the tests. A step reads the current
 * round only; once that round is finished it watches for the next one, and
 * keeps rereading the finished round for corrections until the next is posted.
 * RK9 numbers rounds straight through day two and the top cut.
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

export interface LiveStore {
  getJson: <T>(key: string) => Promise<T | null>;
  putJson: (key: string, value: unknown, cacheControl: string) => Promise<void>;
}

export interface TickDeps {
  now: Date;
  store: LiveStore;
  /** Body of a round fragment; `''` when RK9 has not posted the round. */
  fetchRound: (event: LiveEvent, round: number) => Promise<string>;
  hash: (text: string) => Promise<string>;
}

export type TickOutcome = 'skipped' | 'not-posted' | 'unchanged' | 'written' | 'broken';

const LIVE_CACHE = 'public, max-age=30';
const STATE_CACHE = 'no-store';

export const liveKeys = {
  state: (event: LiveEvent): string => `live/v1/${event.slug}/state.json`,
  index: (event: LiveEvent): string => `live/v1/${event.slug}/index.json`,
  round: (event: LiveEvent, round: number): string => `live/v1/${event.slug}/r${round}.json`
};

export function isEventLive(event: LiveEvent, now: Date): boolean {
  const day = 24 * 60 * 60 * 1000;
  const from = Date.parse(`${event.firstDay}T00:00:00Z`) - day;
  const to = Date.parse(`${event.lastDay}T00:00:00Z`) + 2 * day;
  return now.getTime() >= from && now.getTime() < to;
}

/** Starts idle: an event with nothing posted is polled at the idle interval, not every call. */
function initialState(): LiveState {
  return {
    round: 1,
    roundComplete: false,
    hash: '',
    matchCount: 0,
    changedAt: new Date(0).toISOString(),
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

function buildIndex(event: LiveEvent, round: LiveRound): LiveIndex {
  return {
    slug: event.slug,
    name: event.name,
    round: round.round,
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

/**
 * A step with nothing new to publish. The state is only rewritten once polling
 * has gone idle, where `checkedAt` paces the next poll; during the active
 * window every call is due anyway, so the write would buy nothing.
 */
async function settleQuietTick(
  event: LiveEvent,
  deps: TickDeps,
  state: LiveState,
  outcome: QuietOutcome
): Promise<QuietOutcome> {
  const idle = deps.now.getTime() - Date.parse(state.changedAt) >= ACTIVE_WINDOW_MS;
  if (idle || !state.checkedAt) {
    await deps.store.putJson(liveKeys.state(event), { ...state, checkedAt: deps.now.toISOString() }, STATE_CACHE);
  }
  return outcome;
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

async function publish(event: LiveEvent, deps: TickDeps, read: RoundRead, digest: string): Promise<void> {
  const { matches, rowsSkipped } = read.parsed;
  const updatedAt = deps.now.toISOString();
  const payload: LiveRound = { round: read.round, updatedAt, unreadable: rowsSkipped, matches };
  const state: LiveState = {
    round: read.round,
    roundComplete: matches.every(match => match.complete),
    hash: digest,
    matchCount: matches.length,
    changedAt: updatedAt,
    checkedAt: updatedAt
  };
  await deps.store.putJson(liveKeys.round(event, read.round), payload, LIVE_CACHE);
  await deps.store.putJson(liveKeys.index(event), buildIndex(event, payload), LIVE_CACHE);
  await deps.store.putJson(liveKeys.state(event), state, STATE_CACHE);
}

export async function tickEvent(event: LiveEvent, deps: TickDeps): Promise<TickOutcome> {
  const state = (await deps.store.getJson<LiveState>(liveKeys.state(event))) ?? initialState();
  if (!isDue(state, deps.now)) {
    return 'skipped';
  }

  const read = await readCurrent(event, deps, state);
  const rejected = rejectRound(read.parsed, state, read.round);
  if (rejected) {
    return settleQuietTick(event, deps, state, rejected);
  }
  const digest = await deps.hash(JSON.stringify(read.parsed.matches));
  if (read.round === state.round && digest === state.hash) {
    return settleQuietTick(event, deps, state, 'unchanged');
  }
  await publish(event, deps, read, digest);
  return 'written';
}
