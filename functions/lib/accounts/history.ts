/**
 * An account's History: the events run on the site it appears in, through
 * its POP ID at sanctioned events (the `pop_history` index) and its Claims
 * at unsanctioned ones (the reporter rows it holds). Both are read in one
 * batch with the account itself, so a page waits on the database once.
 *
 * Nothing about an event is copied into the index: its name, date, format
 * and state come from the event's row at read time, and a deleted event
 * drops out of the join. Every step is an index lookup, and the JSON is
 * read in D1, not in the function.
 */

import type { HistoryEntry, PublicProfile } from '../../../shared/accounts/types.js';
import { parseTomDate } from '../../../shared/tournament/divisions.js';
import { DEFAULT_SETTINGS } from '../../../shared/tournament/view.js';
import { firstRow } from '../d1.js';
import type { D1Like, D1Statement } from '../types.js';

/** Whose History: the account a session belongs to, or the one whose public profile is at a slug. */
export type Whose = { session: string; now: number } | { slug: string };

/** How each statement finds the account: `u` is its users row. */
function accountSql(whose: Whose): { from: string; where: string; values: unknown[] } {
  return 'slug' in whose
    ? { from: 'users u', where: 'u.public_slug = ?', values: [whose.slug] }
    : {
        from: 'sessions s JOIN users u ON u.id = s.user_id',
        where: 's.token_hash = ? AND s.expires_at > ?',
        values: [whose.session, whose.now]
      };
}

/** An account appears in a few hundred events at most; this bounds a read that goes wrong. */
const MAX_ENTRIES = 500;

/** The event's columns an entry needs, `player` being the player's ID there. */
const entryColumns = (player: string) =>
  `t.code, t.mode, t.updated_at, json_extract(t.player_keys, '$."' || ${player} || '"') AS key, ` +
  "json_extract(t.state, '$.info.name') AS name, json_extract(t.state, '$.info.startDate') AS start_date, " +
  "json_extract(t.settings, '$.startsAt') AS starts_at, json_extract(t.settings, '$.format') AS format, " +
  "json_extract(t.settings, '$.finished') AS finished, json_array_length(t.state, '$.pods[0].rounds') AS rounds";

interface EntryRow {
  code: string;
  mode: string;
  updated_at: number;
  key: string | null;
  name: string | null;
  start_date: string | null;
  starts_at: string | null;
  format: string | null;
  finished: number | null;
  rounds: number | null;
}

function statements(db: D1Like, whose: Whose): D1Statement[] {
  const { from, where, values } = accountSql(whose);
  return [
    db.prepare(`SELECT u.name AS name, u.avatar AS avatar FROM ${from} WHERE ${where}`).bind(...values),
    // By POP ID: the index holds sanctioned events only.
    db
      .prepare(
        `SELECT ${entryColumns('h.pop_id')} FROM ${from} JOIN pop_history h ON h.pop_id = u.pop_id ` +
          `JOIN tournaments t ON t.code = h.code WHERE ${where} LIMIT ${MAX_ENTRIES}`
      )
      .bind(...values),
    // By Claim: at a sanctioned event the account's row is its POP ID's, already listed above.
    db
      .prepare(
        `SELECT ${entryColumns('d.player_id')} FROM ${from} JOIN report_devices d ON d.user_id = u.id ` +
          `JOIN tournaments t ON t.code = d.code WHERE ${where} ` +
          `AND t.mode = 'swiss' AND json_extract(t.settings, '$.sanctioned') IS 0 LIMIT ${MAX_ENTRIES}`
      )
      .bind(...values)
  ];
}

function statusOf(row: EntryRow): HistoryEntry['status'] {
  if (row.finished === 1) {
    return 'finished';
  }
  return (row.rounds ?? 0) > 0 ? 'live' : 'upcoming';
}

const entryOf = (row: EntryRow & { key: string }): HistoryEntry => ({
  code: row.code,
  key: row.key,
  name: row.name ?? '',
  startDate: row.start_date ?? '',
  startsAt: row.starts_at ?? DEFAULT_SETTINGS.startsAt,
  format: row.format ?? DEFAULT_SETTINGS.format,
  mode: row.mode === 'tom' ? 'tom' : 'swiss',
  status: statusOf(row)
});

/** When the event is, to sort by: its start time, or else its date, as text that sorts. */
const whenOf = (row: EntryRow) => row.starts_at || (parseTomDate(row.start_date ?? '')?.toISOString() ?? '');

/**
 * The entries, one per event, newest first: by start, then by last change.
 * An event in both lists (only while its sanctioned setting changes) shows
 * once. A row whose player has no public key is left out.
 */
function merged(rows: EntryRow[]): HistoryEntry[] {
  const byCode = new Map<string, EntryRow & { key: string }>();
  for (const row of rows) {
    if (row.key !== null && !byCode.has(row.code)) {
      byCode.set(row.code, { ...row, key: row.key });
    }
  }
  return [...byCode.values()]
    .sort((a, b) => whenOf(b).localeCompare(whenOf(a)) || b.updated_at - a.updated_at)
    .map(entryOf);
}

/** The account's name, picture and History; null when no account is there (signed out, or no such profile). */
export async function historyOf(db: D1Like, whose: Whose): Promise<PublicProfile | null> {
  const [account, byPopId, byClaim] = await db.batch(statements(db, whose));
  const found = firstRow<{ name: string; avatar: string | null }>(account);
  if (!found) {
    return null;
  }
  const rows = [...((byPopId?.results ?? []) as EntryRow[]), ...((byClaim?.results ?? []) as EntryRow[])];
  return { name: found.name, avatar: found.avatar, entries: merged(rows) };
}
