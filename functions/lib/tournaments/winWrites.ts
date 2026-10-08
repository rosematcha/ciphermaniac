/**
 * The winners index (`event_wins`): who placed first in each division of a
 * finished event, by player ID, for the Won badge (shared/accounts/achievements.ts).
 * Reading an event's standings takes its whole document, too much to do for
 * every event on a profile, so they are read once here, as the event ends,
 * and again as a finished event changes. Reopening it takes them away.
 */

import { firstPlaces } from '../../../shared/tournament/tdf.js';
import type { Tournament } from '../../../shared/tournament/types.js';
import type { D1Like, D1Statement } from '../types.js';

/** What this reads of an event's row (store.ts's TournamentRow), before and after a write. */
interface EventRow {
  code: string;
  version: number;
  tournament: Tournament;
  settings: { finished: boolean };
}

/** The event's row stands at the version this write made, finished or not as `finished` says. */
const LANDED =
  'EXISTS (SELECT 1 FROM tournaments WHERE code = ?1 AND version = ?2 ' +
  "AND coalesce(json_extract(settings, '$.finished'), 0) = ?3)";

/**
 * What a write from `row` to `next` does to the index, landing only where the
 * write itself did. Nothing while the event is unfinished and stays so, or
 * when a finished event's change leaves its results alone.
 */
export function winWrites(db: D1Like, row: EventRow, next: EventRow): D1Statement[] {
  const { finished } = next.settings;
  const results = next.tournament !== row.tournament;
  if (finished === row.settings.finished && !(finished && results)) {
    return [];
  }
  const version = row.version + 1;
  const clear = db
    .prepare(`DELETE FROM event_wins WHERE code = ?1 AND ${LANDED}`)
    .bind(row.code, version, Number(finished));
  if (!finished) {
    return [clear];
  }
  const add = db
    .prepare(
      `INSERT OR IGNORE INTO event_wins (code, player_id) SELECT ?1, ids.value FROM json_each(?4) AS ids WHERE ${LANDED}`
    )
    .bind(row.code, version, 1, JSON.stringify(firstPlaces(next.tournament)));
  return [clear, add];
}
