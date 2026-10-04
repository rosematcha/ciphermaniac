/**
 * Wrong birth years given with a Player ID at a sanctioned event (the
 * `identify_failures` table in config/d1/tournaments.sql). A Player ID is no
 * secret and a birth year is one of some seventy, so wrong tries are counted
 * per event and Player ID, wherever they come from: from the FREE_TRIES-th
 * the Player ID is refused for a minute, doubling with each wrong try after,
 * up to an hour. The count is in D1 rather than in an isolate's memory, which
 * a guesser spreading requests would never fill.
 *
 * Every try is let in or refused by one statement, so D1 takes tries landing
 * at once one at a time: a burst gets FREE_TRIES answers, not one per request
 * read before any was counted. A wrong year is counted in the statement that
 * lets it in; a right year is let in by a read, which counts nothing; a try
 * whose year only a later write can judge is counted before that write, and
 * forgiven once it lands.
 */

import type { D1Like } from '../types.js';

export const FREE_TRIES = 5;
const FIRST_LOCK_MS = 60_000;
const MAX_LOCK_MS = 60 * 60_000;

export const LOCKED_OUT = 'Too many wrong birth years for this Player ID. Try again later, or ask staff.';

/**
 * Counts a try against the Player ID unless it is refused now; whether it was
 * let in. From the FREE_TRIES-th the Player ID is refused for a minute,
 * doubling with each (2^0 .. 2^6 minutes, capped at an hour). A refused try
 * changes nothing, so it neither counts nor lengthens the wait.
 */
async function countTry(db: D1Like, code: string, popId: string, now: number): Promise<boolean> {
  const counted = await db
    .prepare(
      'INSERT INTO identify_failures (code, pop_id, failures, locked_until) VALUES (?1, ?2, 1, 0) ' +
        'ON CONFLICT (code, pop_id) DO UPDATE SET failures = failures + 1, locked_until = CASE ' +
        'WHEN failures + 1 >= ?3 THEN ?4 + min(?5, ?6 * (1 << min(failures + 1 - ?3, 6))) ' +
        'ELSE locked_until END ' +
        'WHERE identify_failures.locked_until <= ?4 RETURNING failures'
    )
    .bind(code, popId, FREE_TRIES, now, MAX_LOCK_MS, FIRST_LOCK_MS)
    .first<{ failures: number }>();
  return counted !== null;
}

/**
 * Forgives the Player ID's wrong tries, unless it is refused now: a lock that
 * tries landing alongside earned stays theirs.
 */
export function forgive(db: D1Like, code: string, popId: string, now: number) {
  return db
    .prepare('DELETE FROM identify_failures WHERE code = ? AND pop_id = ? AND locked_until <= ?')
    .bind(code, popId, now)
    .run();
}

/** Lets in a try with the right year unless the Player ID is refused now, forgiving the wrong ones before it. */
async function admitRight(db: D1Like, code: string, popId: string, now: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT failures, locked_until FROM identify_failures WHERE code = ? AND pop_id = ?')
    .bind(code, popId)
    .first<{ failures: number; locked_until: number }>();
  if (row && row.locked_until > now) {
    return false;
  }
  if (row) {
    await forgive(db, code, popId, now);
  }
  return true;
}

/** One try: the event, the Player ID it names, whether its year is right, and when it lands. */
interface Try {
  db: D1Like;
  code: string;
  popId: string;
  right: boolean;
  now: number;
}

/** Lets in a try: a right year by `admitRight`, a wrong one by counting it. Whether it was let in. */
export const admitTry = ({ db, code, popId, right, now }: Try) =>
  right ? admitRight(db, code, popId, now) : countTry(db, code, popId, now);

/** Forgets a Player ID's wrong tries outright: staff vouch for the player. */
export function clearFailures(db: D1Like, code: string, popId: string) {
  return db.prepare('DELETE FROM identify_failures WHERE code = ? AND pop_id = ?').bind(code, popId).run();
}
