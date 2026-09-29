/**
 * How the event's public page keeps up. Players read the published file,
 * which costs the functions nothing; staff, who see decks before the public
 * does, ask the API, as does anyone the file cannot reach (not published yet,
 * or a local server).
 *
 * A room of players falling back to the API at once (R2 unreachable) would
 * spend the day's function requests within hours, so a player's fallback asks
 * every half minute, not every poll. One look runs at a time, and failed looks
 * wait longer each time, up to five minutes. A page whose first load failed
 * keeps trying on the same schedule.
 */

import type { PublishedView, TournamentView } from '../../../shared/tournament/view';

export const POLL_MS = 10_000;
/** The big screen's poll: it is what the room reads, and one per venue. */
export const SCREEN_POLL_MS = 5_000;
/** How often a player's page asks the API while the published file cannot be read. */
export const FALLBACK_MS = 30_000;
const MAX_WAIT_MS = 5 * 60_000;

/** The wait before the next look, after `failures` failed looks in a row, for a page that looks every `every` ms. */
export function pollDelay(failures: number, every = POLL_MS): number {
  return Math.min(MAX_WAIT_MS, every * 2 ** failures);
}

export interface ViewSource {
  current: () => TournamentView | undefined;
  /** Loads the page again when its first load failed; whether the page has its event now. */
  reload: () => Promise<boolean>;
  published: () => Promise<PublishedView | null>;
  /** The view if it changed since `since`, or null. */
  api: (since: number) => Promise<TournamentView | null>;
  apply: (view: TournamentView) => void;
  now: () => number;
}

/** One look at the event: true when it went through, false when it failed and the next should wait. */
export function createViewPoll(source: ViewSource): () => Promise<boolean> {
  let askedApiAt = Number.NEGATIVE_INFINITY;

  async function askApi(current: TournamentView): Promise<boolean> {
    if (!current.viewer.role && source.now() - askedApiAt < FALLBACK_MS) {
      return true;
    }
    askedApiAt = source.now();
    try {
      const next = await source.api(current.version);
      if (next) {
        source.apply(next);
      }
      return true;
    } catch {
      return false;
    }
  }

  return async () => {
    const current = source.current();
    if (!current) {
      return source.reload();
    }
    const published = current.viewer.role ? null : await source.published().catch(() => null);
    if (!published) {
      return askApi(current);
    }
    if (published.version > current.version) {
      source.apply({ ...published, viewer: current.viewer });
    }
    return true;
  };
}

export interface Polls {
  /**
   * Looks again now, forgetting past failures. Asked during a look, the next
   * one follows it at once, since the look under way may have read too early.
   */
  soon: () => void;
  stop: () => void;
}

/**
 * Runs `poll` one look at a time, waiting `pollDelay(failures, every)`
 * between looks. A hidden page skips its look but keeps the schedule. Nothing
 * is scheduled once stopped, even by a look that was under way.
 */
export function schedulePolls(poll: () => Promise<boolean>, hidden: () => boolean, every = POLL_MS): Polls {
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  let stopped = false;

  function wait(ms: number) {
    clearTimeout(timer);
    timer = setTimeout(() => void look(), ms);
  }

  async function look() {
    running = true;
    if (!hidden()) {
      failures = (await poll().catch(() => false)) ? 0 : failures + 1;
    }
    running = false;
    if (!stopped) {
      wait(again ? 0 : pollDelay(failures, every));
    }
    again = false;
  }

  wait(pollDelay(0, every));
  return {
    soon: () => {
      failures = 0;
      if (running) {
        again = true;
      } else if (!stopped) {
        wait(0);
      }
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    }
  };
}
