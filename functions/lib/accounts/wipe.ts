/**
 * Wiping what the site keeps on an account (shared/accounts/myData.ts), and
 * deleting the account outright. Each part is a few writes, and a wipe runs
 * every part it asks for in one batch, so it lands whole or not at all.
 *
 * An event is the organizer's record as much as the player's, so nothing
 * here edits a player's place in one. Wiping event history hides the ended
 * events the account played from its History and unlinks it from the
 * players and decklists it held there; a running event is left alone, since
 * the account still reports in it. Wiping organizer history takes the
 * organizer's name and POP ID off the events the account owns or is named
 * on, hands their ownership to no one, and drops its staff places; players
 * keep those events in their histories. It waits while one of those events
 * runs, since a running event still needs its organizer.
 *
 * Deleting wipes organizer history the same way, unlinks the account from
 * every event, and removes the account and everything else kept under it:
 * sign-ins, sessions, Applications and their proof files, store places. An
 * account that owns a store hands it over first.
 *
 * The checks that make a wipe or deletion wait run twice: once to say why,
 * and again as the batch's first statement, which fails the batch (and so
 * rolls it back) when an event started or a store was handed over between.
 */

import { randomHandle } from '../../../shared/accounts/handle.js';
import type { DataRefusal, RunningEvent, WipePart } from '../../../shared/accounts/myData.js';
import type { User } from '../auth/session.js';
import type { D1Like, D1Statement } from '../types.js';

/** The events an organizer wipe changes: owned, or naming the account's POP ID as their organizer. */
const ORGANIZED = "(owner_id = ?1 OR (?2 IS NOT NULL AND json_extract(state, '$.info.organizerPopId') = ?2))";

const FINISHED = "coalesce(json_extract(settings, '$.finished'), 0) = 1";

/** The running events an organizer wipe would change, or whose staff the account is on; binds the id and POP ID. */
const RUNNING =
  `SELECT code, coalesce(json_extract(state, '$.info.name'), '') AS name FROM tournaments WHERE NOT ${FINISHED} ` +
  `AND (${ORGANIZED} OR code IN (SELECT code FROM staff WHERE user_id = ?1))`;

/** The stores the account owns; binds the id. */
const OWNED_STORES =
  "SELECT s.name FROM store_members m JOIN stores s ON s.id = m.store_id WHERE m.user_id = ?1 AND m.role = 'owner'";

const ENDED = `SELECT code FROM tournaments WHERE ${FINISHED}`;

async function runningEvents(db: D1Like, user: User): Promise<RunningEvent[]> {
  const { results } = await db
    .prepare(`${RUNNING} ORDER BY created_at LIMIT 50`)
    .bind(user.id, user.popId)
    .all<RunningEvent>();
  return results;
}

async function ownedStores(db: D1Like, userId: string): Promise<string[]> {
  const { results } = await db.prepare(`${OWNED_STORES} ORDER BY s.name`).bind(userId).all<{ name: string }>();
  return results.map(row => row.name);
}

const RUNNING_ERROR = 'End your running events first';
const STORE_ERROR = 'Hand over the stores you own first';

/** Why the asked change must wait, or null when it may go ahead. */
async function refusalOf(db: D1Like, user: User, deleting: boolean): Promise<DataRefusal | null> {
  const running = await runningEvents(db, user);
  const stores = deleting ? await ownedStores(db, user.id) : [];
  if (running.length === 0 && stores.length === 0) {
    return null;
  }
  return { error: running.length > 0 ? RUNNING_ERROR : STORE_ERROR, running, ownedStores: stores };
}

/**
 * Fails its batch while the account runs an event or (deleting) owns a store:
 * `json('wait')` is malformed JSON, which SQLite refuses with an error.
 */
function stillClear(db: D1Like, user: User, deleting: boolean): D1Statement {
  const stores = deleting ? ` OR EXISTS (${OWNED_STORES})` : '';
  return db.prepare(`SELECT CASE WHEN EXISTS (${RUNNING})${stores} THEN json('wait') END`).bind(user.id, user.popId);
}

/** The player profile goes, and with its POP ID the players the account was at events as it, as a new POP ID would. */
function profileWrites(db: D1Like, user: User): D1Statement[] {
  return [
    db
      .prepare('DELETE FROM report_devices WHERE user_id = ?1 AND player_id = (SELECT pop_id FROM users WHERE id = ?1)')
      .bind(user.id),
    db
      .prepare('UPDATE users SET pop_id = NULL, first_name = NULL, last_name = NULL, birth_date = NULL WHERE id = ?')
      .bind(user.id)
  ];
}

/**
 * A random username in place of the account's, and the usernames it let go
 * today freed at once. The day's changes still count against its renames.
 */
function usernameWrites(db: D1Like, user: User): D1Statement[] {
  return [
    db.prepare("UPDATE handle_changes SET old_key = '', handle = '' WHERE user_id = ?").bind(user.id),
    db.prepare('UPDATE users SET handle = ? WHERE id = ?').bind(randomHandle(), user.id)
  ];
}

/** The ended events in History hidden from it, then the account off the players and decklists it held at them. */
function eventWrites(db: D1Like, user: User): D1Statement[] {
  const hide = db
    .prepare(
      'INSERT OR IGNORE INTO history_hidden (user_id, code) ' +
        `SELECT ?1, code FROM pop_history WHERE pop_id = (SELECT pop_id FROM users WHERE id = ?1) AND code IN (${ENDED}) ` +
        `UNION SELECT ?1, code FROM report_devices WHERE user_id = ?1 AND code IN (${ENDED})`
    )
    .bind(user.id);
  return [
    hide,
    db.prepare(`UPDATE report_devices SET user_id = NULL WHERE user_id = ? AND code IN (${ENDED})`).bind(user.id),
    db.prepare(`UPDATE decklists SET account = NULL WHERE account = ? AND code IN (${ENDED})`).bind(user.id)
  ];
}

/**
 * The organizer's name and POP ID off the ended events the account owns or is
 * named on, each owned one given an owner no account is, and its staff
 * places gone. Each event's version moves, as any write to it does.
 */
function organizerWrites(db: D1Like, user: User, now: number): D1Statement[] {
  return [
    db
      .prepare(
        "UPDATE tournaments SET state = json_set(state, '$.info.organizerName', '', '$.info.organizerPopId', ''), " +
          "owner_id = CASE WHEN owner_id = ?1 THEN 'wiped:' || code ELSE owner_id END, " +
          `version = version + 1, updated_at = ?3 WHERE ${ORGANIZED} AND ${FINISHED}`
      )
      .bind(user.id, user.popId, now),
    db.prepare(`DELETE FROM staff WHERE user_id = ? AND code IN (${ENDED})`).bind(user.id)
  ];
}

const PART_WRITES: Record<WipePart, (db: D1Like, user: User, now: number) => D1Statement[]> = {
  profile: profileWrites,
  username: usernameWrites,
  events: eventWrites,
  organizer: organizerWrites
};

/**
 * Runs the batch led by its check; null when it landed, or why it must wait
 * when the check failed it. Any other failure is thrown.
 */
async function guarded(db: D1Like, user: User, deleting: boolean, writes: D1Statement[]): Promise<DataRefusal | null> {
  try {
    await db.batch([stillClear(db, user, deleting), ...writes]);
    return null;
  } catch (err) {
    const refusal = await refusalOf(db, user, deleting);
    if (refusal) {
      return refusal;
    }
    throw err;
  }
}

/** The order parts run in: the events before the profile, since they find sanctioned events by its POP ID. */
const PART_ORDER: readonly WipePart[] = ['events', 'organizer', 'username', 'profile'];

/** Wipes the parts asked for, or answers why the organizer part must wait. */
export async function wipeParts(
  db: D1Like,
  user: User,
  parts: readonly WipePart[],
  now = Date.now()
): Promise<DataRefusal | null> {
  const writes = PART_ORDER.filter(part => parts.includes(part)).flatMap(part => PART_WRITES[part](db, user, now));
  if (!parts.includes('organizer')) {
    await db.batch(writes);
    return null;
  }
  return (await refusalOf(db, user, false)) ?? guarded(db, user, false, writes);
}

/** Tables whose rows under the account go with it. */
const ACCOUNT_TABLES = [
  'applications',
  'proof_uploads',
  'store_members',
  'staff',
  'sessions',
  'identities',
  'handle_changes',
  'duplicate_emails_backup',
  'history_hidden'
];

/** Where an admin's id stays on what it decided; with the account gone it names no one, so it goes too. */
const DECIDED_BY = [
  ['applications', 'decided_by'],
  ['users', 'role_by'],
  ['stores', 'status_by']
] as const;

function accountWrites(db: D1Like, user: User): D1Statement[] {
  const proofs = db
    .prepare(
      'INSERT OR IGNORE INTO proof_deletions (key) SELECT proof_key FROM applications WHERE user_id = ?1 ' +
        'AND proof_key IS NOT NULL UNION SELECT key FROM proof_uploads WHERE user_id = ?1'
    )
    .bind(user.id);
  return [
    proofs,
    db.prepare('UPDATE report_devices SET user_id = NULL WHERE user_id = ?').bind(user.id),
    db.prepare('UPDATE decklists SET account = NULL WHERE account = ?').bind(user.id),
    ...DECIDED_BY.map(([table, column]) =>
      db.prepare(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = ?`).bind(user.id)
    ),
    ...ACCOUNT_TABLES.map(table => db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(user.id)),
    db.prepare('DELETE FROM event_creations WHERE owner = ?').bind(`user:${user.id}`),
    db.prepare('DELETE FROM users WHERE id = ?').bind(user.id)
  ];
}

/**
 * Deletes the account, or answers why it must wait. Answers the Clerk user
 * the account signed in with, if any, for the caller to delete there too.
 */
export async function deleteAccount(
  db: D1Like,
  user: User,
  now = Date.now()
): Promise<{ refusal: DataRefusal } | { clerkSubject: string | null }> {
  const early = await refusalOf(db, user, true);
  if (early) {
    return { refusal: early };
  }
  const clerk = await db
    .prepare("SELECT subject FROM identities WHERE user_id = ? AND provider = 'clerk'")
    .bind(user.id)
    .first<{ subject: string }>();
  const refusal = await guarded(db, user, true, [...organizerWrites(db, user, now), ...accountWrites(db, user)]);
  return refusal ? { refusal } : { clerkSubject: clerk?.subject ?? null };
}
