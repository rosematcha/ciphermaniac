/**
 * Reading every round of a live event at once, for one player's run.
 *
 * A finished round file never changes, so it is fetched once per session and
 * held. Only the current round is refetched, and only when the index hash says
 * it moved. Without this the run's resource — keyed on that hash, which moves
 * on nearly every sixty-second poll — re-requested all fifteen round files a
 * minute, on venue wifi, for one player. The data client's own cache is no
 * substitute: it holds a response for twenty seconds, a third of the poll.
 * @module src/lib/liveRounds
 */

import { fetchLiveRound } from './data/live';
import type { LiveRound } from '../../shared/live/types';

/** Reads one round file. A seam: the tests count calls through it. */
export type RoundReader = (slug: string, round: number) => Promise<LiveRound | null>;

const archive = new Map<string, Promise<LiveRound | null>>();

/** A round the event has moved past: fetched once, then served from memory. */
function fetchArchivedRound(slug: string, round: number, read: RoundReader): Promise<LiveRound | null> {
  const key = `${slug}|${round}`;
  const held = archive.get(key);
  if (held) {
    return held;
  }
  // Only a settled round is kept. A miss means the file is a moment behind the
  // index and keeping the null would leave a gap in the run for the session;
  // an unconfirmed table means staff have not signed the round off yet, and
  // that lag runs to half an hour — well past the next round's pairings.
  const pending = read(slug, round)
    .then(loaded => {
      if (!loaded || loaded.matches.some(match => !match.complete)) {
        archive.delete(key);
      }
      return loaded;
    })
    .catch((error: unknown) => {
      archive.delete(key);
      throw error;
    });
  archive.set(key, pending);
  return pending;
}

/**
 * Every round posted so far, oldest first.
 * @param slug - Event slug
 * @param current - The round the index names
 * @param read - Round reader; defaults to the live data client
 * @returns One entry per round; null where the file is not there yet
 */
export function fetchPostedRounds(
  slug: string,
  current: number,
  read: RoundReader = fetchLiveRound
): Promise<(LiveRound | null)[]> {
  return Promise.all(
    Array.from({ length: current }, (_, i) =>
      i + 1 < current ? fetchArchivedRound(slug, i + 1, read) : read(slug, current)
    )
  );
}

/** Test seam: drops what the archive is holding. */
export function clearRoundArchive(): void {
  archive.clear();
}
