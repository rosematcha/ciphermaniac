/**
 * The writes a change to an event's player list makes beside the event's own
 * row: the history index (`pop_history`, see shared/tournament/history.ts),
 * and the reporter rows of players taken off the list, so a Claim never
 * outlives its player, nor an unsanctioned event's Claims its sanctioning.
 *
 * They go in the same batch as the event's write, and each checks first that
 * the event's row is still the one this write read. A D1 batch is one
 * transaction and D1 runs one writer at a time, so a guard that holds when
 * the batch starts holds through the event's write at its end: the index
 * changes exactly when the event does, and a write that lost a race to the
 * row changes nothing, to be worked out again from a fresh read.
 */

import { chunks, type IndexedEvent, indexedIds, rosterDiff } from '../../../shared/tournament/history.js';
import { isSanctioned } from '../../../shared/tournament/view.js';
import type { D1Like, D1Statement } from '../types.js';

/**
 * What the event's row must hold for the writes to land: the version a save
 * read, or the staff token a new event was made with, which tells it apart
 * from an event that already held the code drawn for it.
 */
export type Guard = { column: 'version'; value: number } | { column: 'staff_token'; value: string };

/** The guard's check, with the code as ?1 and its value as ?2; the IDs follow from ?3. */
const guardSql = (guard: Guard) => `SELECT 1 FROM tournaments WHERE code = ?1 AND ${guard.column} = ?2`;

const numbered = (ids: readonly string[]) => ids.map((_, i) => `?${i + 3}`);

/**
 * Indexes `ids` under the event. One row per ID from a `UNION ALL` of
 * selects: a multi-row VALUES list plans as a scan.
 */
function addIndexed(db: D1Like, code: string, guard: Guard, ids: string[]): D1Statement[] {
  return chunks(ids).map(run => {
    const rows = numbered(run).map(id => `SELECT ${id}, ?1 FROM ok`);
    return db
      .prepare(
        `WITH ok AS (${guardSql(guard)}) INSERT OR IGNORE INTO pop_history (pop_id, code) ${rows.join(' UNION ALL ')}`
      )
      .bind(code, guard.value, ...run);
  });
}

/** Deletes the event's rows of `table` whose `column` is one of `ids`. */
function deleteGuarded(
  db: D1Like,
  where: { table: 'pop_history' | 'report_devices'; column: 'pop_id' | 'player_id' },
  at: { code: string; guard: Guard },
  ids: string[]
): D1Statement[] {
  return chunks(ids).map(run =>
    db
      .prepare(
        `DELETE FROM ${where.table} WHERE code = ?1 AND ${where.column} IN (${numbered(run).join(', ')}) ` +
          `AND EXISTS (${guardSql(at.guard)})`
      )
      .bind(at.code, at.guard.value, ...run)
  );
}

/**
 * Ends the event's Claims, when it becomes sanctioned: there an account is
 * the player whose POP ID it holds, and a Claim made by name links no one.
 * The devices that hold the rows keep reporting.
 */
function endClaims(db: D1Like, at: { code: string; guard: Guard }): D1Statement {
  return db
    .prepare(
      `UPDATE report_devices SET user_id = NULL WHERE code = ?1 AND user_id IS NOT NULL AND EXISTS (${guardSql(at.guard)})`
    )
    .bind(at.code, at.guard.value);
}

/** What saving `after` over `before` writes beside the event's row; none when its players and sanction stand. */
export function rosterWrites(
  db: D1Like,
  before: IndexedEvent & { code: string; version: number },
  after: IndexedEvent
): D1Statement[] {
  const { add, remove, gone } = rosterDiff(before, after);
  const guard: Guard = { column: 'version', value: before.version };
  const at = { code: before.code, guard };
  return [
    ...addIndexed(db, at.code, at.guard, add),
    ...deleteGuarded(db, { table: 'pop_history', column: 'pop_id' }, at, remove),
    ...deleteGuarded(db, { table: 'report_devices', column: 'player_id' }, at, gone),
    ...(isSanctioned(after) && !isSanctioned(before) ? [endClaims(db, at)] : [])
  ];
}

/** What making a new event writes beside its row: its players in the index, when they are known by POP ID. */
export function firstIndexWrites(db: D1Like, event: IndexedEvent & { code: string; staffToken: string }) {
  return addIndexed(db, event.code, { column: 'staff_token', value: event.staffToken }, [...indexedIds(event)]);
}

/**
 * What deleting an event writes ahead of its row, landing only while the row
 * is still at the version read: its players out of the index (which has no
 * lookup by code alone, so they go by the list read), and everything else
 * kept under its code.
 */
export function deleteWrites(db: D1Like, event: IndexedEvent & { code: string; version: number }): D1Statement[] {
  const at = { code: event.code, guard: { column: 'version', value: event.version } as const };
  return [
    ...deleteGuarded(db, { table: 'pop_history', column: 'pop_id' }, at, [...indexedIds(event)]),
    ...(['staff', 'decklists', 'report_devices'] as const).map(table =>
      db
        .prepare(`DELETE FROM ${table} WHERE code = ?1 AND EXISTS (${guardSql(at.guard)})`)
        .bind(at.code, at.guard.value)
    )
  ];
}
