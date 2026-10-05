/**
 * Tournaments in D1: one row per event holding the whole document.
 *
 * Every write names the version it read and bumps it, so a stale write fails
 * instead of undoing someone else's: two staff reporting at once each apply to
 * the latest document, because a failed write is retried from a fresh read by
 * the caller (see `mutate`).
 */

import { ADULT_AGE } from '../../../shared/accounts/age.js';
import { DAY_MS, eventDay } from '../../../shared/tournament/limits.js';
import { POD_CATEGORIES, type Tournament } from '../../../shared/tournament/types.js';
import {
  applyPending,
  assignKeys,
  DEFAULT_SETTINGS,
  type PendingResult,
  type Role,
  type StaffMember,
  storedSettings,
  type TournamentMode,
  type TournamentSettings,
  type TournamentSummary
} from '../../../shared/tournament/view.js';
import { type PlayerReport, pruneReports } from '../../../shared/tournament/reports.js';
import { randomToken, sessionHash, sessionUserQuery, type User, userFromRow, type UserRow } from '../auth/session.js';
import { displayNameSql } from '../accounts/handles.js';
import { firstRow, rowsChanged } from '../d1.js';
import type { D1Like, D1Statement } from '../types.js';
import { deleteWrites, firstIndexWrites, rosterWrites } from './rosterWrites.js';

export interface TournamentRow {
  code: string;
  ownerId: string;
  mode: TournamentMode;
  tournament: Tournament;
  pending: PendingResult[];
  /** Results players reported and staff have not settled (see shared/tournament/reports.ts). */
  reports: PlayerReport[];
  settings: TournamentSettings;
  keys: Record<string, string>;
  /** POP ID to archetype label. */
  decks: Record<string, string>;
  staffToken: string;
  version: number;
  updatedAt: number;
  /** The store that runs the event; null for one run under an account's own name. */
  storeId: string | null;
  /** The day a Community organizer's event holds (see shared/tournament/limits.ts); null otherwise. */
  communityDay: string | null;
}

interface RawRow {
  code: string;
  owner_id: string;
  mode: string;
  state: string;
  pending: string;
  reports: string;
  settings: string;
  player_keys: string;
  decks: string;
  staff_token: string;
  version: number;
  updated_at: number;
  store_id: string | null;
  community_day: string | null;
}

function fromRaw(raw: RawRow): TournamentRow {
  return {
    code: raw.code,
    ownerId: raw.owner_id,
    mode: raw.mode === 'tom' ? 'tom' : 'swiss',
    tournament: JSON.parse(raw.state) as Tournament,
    pending: JSON.parse(raw.pending) as PendingResult[],
    reports: JSON.parse(raw.reports) as PlayerReport[],
    settings: storedSettings(JSON.parse(raw.settings) as Record<string, unknown>),
    keys: JSON.parse(raw.player_keys) as Record<string, string>,
    decks: JSON.parse(raw.decks) as Record<string, string>,
    staffToken: raw.staff_token,
    version: raw.version,
    updatedAt: raw.updated_at,
    storeId: raw.store_id ?? null,
    communityDay: raw.community_day ?? null
  };
}

/** Codes are short enough to read aloud and type from a table sign: no 0/O or 1/I/L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/** A random code in that alphabet; a public profile's address is a longer one (functions/lib/accounts/publicProfile.ts). */
export function newCode(length = CODE_LENGTH, random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Whether `value` could be a code `length` long: an event's, or a public profile's address. */
export function isCode(value: string, length = CODE_LENGTH): boolean {
  return value.length === length && [...value].every(char => CODE_ALPHABET.includes(char));
}

const tournamentQuery = (db: D1Like, code: string) => db.prepare('SELECT * FROM tournaments WHERE code = ?').bind(code);

export async function loadTournament(db: D1Like, code: string): Promise<TournamentRow | null> {
  const raw = await tournamentQuery(db, code).first<RawRow>();
  return raw ? fromRaw(raw) : null;
}

/**
 * Events under way and not ended that nobody has changed since `before`, at
 * most `limit` of them. Under way means round 1 is paired: an event set up
 * ahead of its day may sit untouched for as long as it likes.
 */
export async function loadIdle(db: D1Like, before: number, limit: number, expiredBefore = 0): Promise<TournamentRow[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM tournaments WHERE coalesce(json_extract(settings, '$.finished'), 0) = 0 " +
        "AND (coalesce(json_extract(settings, '$.idle'), 0) = 0 OR updated_at <= ?) " +
        `AND updated_at < ? AND (${pairedRounds('state')}) > 0 ORDER BY updated_at ASC, code ASC LIMIT ?`
    )
    .bind(expiredBefore, before, limit)
    .all<RawRow>();
  return results.map(fromRaw);
}

export interface Opened {
  row: TournamentRow;
  user: User | null;
  role: Role | null;
  /**
   * The player the signed-in account is at this event through a reporter row
   * it holds (its Claim, see reporters.ts), when the route asked; null when it
   * holds none, or the route did not ask.
   */
  claimed: string | null;
}

/** What a route asks of `openTournament` beyond the event and who is asking. */
export interface OpenOptions {
  /** Read the asking account's Claim too, in the same batch. */
  claim?: boolean;
}

/**
 * The event, the signed-in user and their role in it. Every tournament request
 * starts here, so for a signed-in asker the three reads go as one batch: one
 * wait on the database where there were three in a row. A route that shows
 * the asker who they are in the event asks for their Claim as a fourth.
 */
export async function openTournament(
  db: D1Like,
  code: string,
  request: Request,
  options: OpenOptions = {}
): Promise<Opened | null> {
  const hash = await sessionHash(request);
  if (!hash) {
    const row = await loadTournament(db, code);
    return row && { row, user: null, role: null, claimed: null };
  }
  const now = Date.now();
  const [event, account, staff, claim] = await db.batch([
    tournamentQuery(db, code),
    sessionUserQuery(db, hash, now),
    staffQuery(db, code, hash, now),
    ...(options.claim ? [claimQuery(db, code, hash, now)] : [])
  ]);
  const raw = firstRow<RawRow>(event);
  if (!raw) {
    return null;
  }
  const row = fromRaw(raw);
  const found = firstRow<UserRow>(account);
  const user = found && userFromRow(found);
  const claimed = firstRow<{ player_id: string }>(claim)?.player_id ?? null;
  return { row, user, role: roleIn(row, user, firstRow<StaffRow>(staff)), claimed };
}

/** How the session's account is on the event's staff: through its invite link, or as one of its store's. */
interface StaffRow {
  joined: number;
  store_role: string | null;
}

const staffQuery = (db: D1Like, code: string, hash: string, now: number) =>
  db
    .prepare(
      'SELECT EXISTS (SELECT 1 FROM staff WHERE staff.code = ?1 AND staff.user_id = sessions.user_id) AS joined, ' +
        '(SELECT m.role FROM tournaments t JOIN store_members m ON m.store_id = t.store_id ' +
        'WHERE t.code = ?1 AND m.user_id = sessions.user_id) AS store_role ' +
        'FROM sessions WHERE sessions.token_hash = ?2 AND sessions.expires_at > ?3'
    )
    .bind(code, hash, now);

/** The player the session's account holds a reporter row for at the event. */
const claimQuery = (db: D1Like, code: string, hash: string, now: number) =>
  db
    .prepare(
      'SELECT player_id FROM report_devices JOIN sessions ON sessions.user_id = report_devices.user_id ' +
        'WHERE report_devices.code = ? AND sessions.token_hash = ? AND sessions.expires_at > ?'
    )
    .bind(code, hash, now);

/**
 * A store's event is the store's: its Managers are as its organizer and its
 * Staff as its staff, whoever started it, and anyone who leaves the store
 * leaves its events. Any other event is owned by the account that started
 * it. Either way, anyone the invite link let in is staff.
 */
function roleIn(row: TournamentRow, user: User | null, staff: StaffRow | null): Role | null {
  if (!user) {
    return null;
  }
  const owner = row.storeId === null ? user.id === row.ownerId : staff?.store_role === 'manager';
  if (owner) {
    return 'owner';
  }
  return staff?.joined === 1 || staff?.store_role === 'staff' ? 'staff' : null;
}

/** Just the version, for a cheap "has anything changed" check. */
export async function loadVersion(db: D1Like, code: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT version FROM tournaments WHERE code = ?')
    .bind(code)
    .first<{ version: number }>();
  return row?.version ?? null;
}

export interface NewTournament {
  ownerId: string;
  mode: TournamentMode;
  tournament: Tournament;
  settings?: TournamentSettings;
  /** The store that runs it, when one does. */
  storeId?: string | null;
  /** The day a Community organizer's event holds, one per owner (see shared/tournament/limits.ts). */
  communityDay?: string | null;
  /** Who the day's creations count against, and how many they may make; none for an Admin's own. */
  admission?: { owner: string; limit: number } | null;
  /** Authorization and retained-event quota, evaluated inside the creation transaction. */
  guard?: { sql: string; values: unknown[] };
}

/** The day's creations are used up (shared/tournament/limits.ts). */
export class LimitReached extends Error {}

/** The owner already holds an event on that day (shared/tournament/limits.ts). */
export class DayTaken extends Error {}

/** The creation no longer meets its authorization or retained-event quota. */
export class CreationRefused extends Error {}

/** Whether a failed write broke the one-event-per-day index. */
const breaksDay = (error: unknown) => error instanceof Error && error.message.includes('community_day');

/**
 * The writes that count a creation against `owner`, kept a day: the ones
 * older go first, then this one goes in only while the day's count is under
 * the limit. `id` names it, so a retry with the same id counts nothing more.
 */
function admissionWrites(
  db: D1Like,
  admission: { owner: string; limit: number },
  creation: { id: string; now: number; guard: { sql: string; values: unknown[] } }
) {
  const { id, now, guard } = creation;
  return [
    db.prepare('DELETE FROM event_creations WHERE owner = ? AND at <= ?').bind(admission.owner, now - DAY_MS),
    db
      .prepare(
        'INSERT OR IGNORE INTO event_creations (owner, at, id) SELECT ?1, ?2, ?3 ' +
          `WHERE (SELECT COUNT(*) FROM event_creations WHERE owner = ?1 AND at > ?4) < ?5 AND (${guard.sql})`
      )
      .bind(admission.owner, now, id, now - DAY_MS, admission.limit, ...guard.values)
  ];
}

/**
 * Stores a new event under a code nobody holds, and hands back the row as
 * stored. The insert itself refuses a code already taken, so two events made
 * at once cannot land on one code, and there is no read before or after it.
 * A file's players go into the history index in the same batch, only where
 * the row this insert made stands (see rosterWrites.ts).
 */
export async function createTournament(db: D1Like, input: NewTournament): Promise<TournamentRow> {
  const { ownerId, mode, tournament } = input;
  const settings = input.settings ?? DEFAULT_SETTINGS;
  const storeId = input.storeId ?? null;
  const communityDay = input.communityDay ?? null;
  const state = stateJson(tournament);
  const keys = assignKeys(tournament, {});
  const staffToken = randomToken(16);
  const now = Date.now();
  const admissionId = randomToken(8);
  // With a limit, the event goes in only where its creation was counted in.
  const admitted = input.admission
    ? {
        sql: ' AND EXISTS (SELECT 1 FROM event_creations WHERE owner = ? AND at = ? AND id = ?)',
        values: [input.admission.owner, now, admissionId]
      }
    : { sql: '', values: [] };
  const guard = input.guard ?? { sql: '1 = 1', values: [] };
  const allowed = db.prepare(`SELECT (${guard.sql}) AS allowed`).bind(...guard.values);
  const admission = input.admission ? admissionWrites(db, input.admission, { id: admissionId, now, guard }) : [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    const insert = db
      .prepare(
        'INSERT INTO tournaments (code, owner_id, mode, state, settings, player_keys, staff_token, created_at, ' +
          'updated_at, store_id, community_day) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ' +
          `WHERE NOT EXISTS (SELECT 1 FROM tournaments WHERE code = ?)${admitted.sql} AND (${guard.sql})`
      )
      .bind(
        code,
        ownerId,
        mode,
        state,
        JSON.stringify(settings),
        JSON.stringify(keys),
        staffToken,
        now,
        now,
        storeId,
        communityDay,
        code,
        ...admitted.values,
        ...guard.values
      );
    const results = await db
      .batch([allowed, ...admission, insert, ...firstIndexWrites(db, { code, staffToken, mode, settings, tournament })])
      .catch((error: unknown) => {
        throw breaksDay(error) ? new DayTaken('You already have an event that day') : error;
      });
    checkCreationAdmission(results, input, attempt);
    if (rowsChanged(results[admission.length + 1]) === 1) {
      const empty = { pending: [], reports: [], decks: {} };
      const made = { code, ownerId, mode, tournament, settings, keys, staffToken, version: 1, updatedAt: now };
      return { ...made, ...empty, storeId, communityDay };
    }
  }
  throw new Error('Could not find a free tournament code');
}

/** Interpret the admission snapshot from the same transaction as the event insert. */
function checkCreationAdmission(
  results: Awaited<ReturnType<D1Like['batch']>>,
  input: NewTournament,
  attempt: number
): void {
  const permission = (results[0]?.results as { allowed: number }[] | undefined)?.[0]?.allowed;
  if (!permission) {
    throw new CreationRefused('You can no longer start this event, or have too many events');
  }
  // A retry can reuse its admission; the first try must have recorded one.
  if (attempt === 0 && input.admission && rowsChanged(results[2]) === 0) {
    throw new LimitReached('You’ve started as many events as you can today; try again tomorrow');
  }
}

/**
 * D1 refuses a row over 2,000,000 bytes, so the stored document stops short of
 * it. A League Cup is a few kilobytes; this is room for a large Regional's
 * day one, and a larger event fails here with a message rather than in D1.
 */
export const MAX_STATE_BYTES = 1_800_000;

export class TooLarge extends Error {}

function stateJson(tournament: Tournament): string {
  const json = JSON.stringify(tournament);
  if (new TextEncoder().encode(json).length > MAX_STATE_BYTES) {
    throw new TooLarge('This event is too large to store');
  }
  return json;
}

export interface Changes {
  /** Preserve the last activity time when the idle sweep only changes bookkeeping. */
  updatedAt?: number;
  tournament?: Tournament;
  pending?: PendingResult[];
  reports?: PlayerReport[];
  settings?: TournamentSettings;
  decks?: Record<string, string>;
  /** A Community organizer's event moving to another day (see dayChange). */
  communityDay?: string;
}

/**
 * The day a settings change moves a Community organizer's event to, when it
 * moves it: its start time names another date. Clearing the start time keeps
 * the day it holds.
 */
export function dayChange(row: TournamentRow, settings: TournamentSettings): Pick<Changes, 'communityDay'> {
  if (row.communityDay === null) {
    return {};
  }
  const day = eventDay(settings.startsAt, row.communityDay);
  return day === row.communityDay ? {} : { communityDay: day };
}

/**
 * The reports a change leaves: its own, or the row's less any whose match it
 * settled or took away, since a result from staff settles a disputed match.
 * Turning player reporting off drops them all.
 */
function reportsAfter(row: TournamentRow, changes: Changes): PlayerReport[] {
  if (!(changes.settings ?? row.settings).playerReporting) {
    return [];
  }
  const reports = changes.reports ?? row.reports;
  return changes.tournament || changes.pending
    ? pruneReports(applyPending(changes.tournament ?? row.tournament, changes.pending ?? row.pending), reports)
    : reports;
}

/**
 * The row as a change leaves it, short of its new version: the public keys
 * and the reports follow from the change, and are worked out here once for
 * both the write and the row handed back.
 */
function changedRow(row: TournamentRow, changes: Changes): TournamentRow {
  // The keys as saved, so a player added by this change is already under a public key.
  const keys = changes.tournament ? assignKeys(changes.tournament, row.keys) : row.keys;
  return { ...row, ...changes, keys, reports: reportsAfter(row, changes) };
}

/** The columns a change writes, and their values: only what it changed. */
function columnsFor(changes: Changes, next: TournamentRow): [string, string][] {
  const { tournament, pending, settings, decks, communityDay } = changes;
  const columns: [string, string | false | undefined][] = [
    ['community_day', communityDay],
    ['state', tournament && stateJson(tournament)],
    ['player_keys', tournament && JSON.stringify(next.keys)],
    ['pending', pending && JSON.stringify(pending)],
    ['settings', settings && JSON.stringify(settings)],
    ['decks', decks && JSON.stringify(decks)],
    // Reports follow the results and the reporting setting, so any of those rewrites them.
    ['reports', (changes.reports ?? tournament ?? pending ?? settings) && JSON.stringify(next.reports)]
  ];
  return columns.filter((column): column is [string, string] => typeof column[1] === 'string');
}

/**
 * Writes the changes if the row is still at `row.version`. Only the columns
 * the change touches are written, so a result reported mid-event does not
 * send the whole document back. A change to the player list or to whether
 * the event is sanctioned also keeps the history index, in the same batch and
 * on the same version (see rosterWrites.ts); any other change is the one
 * update alone.
 * @returns The row as written, or null when someone else wrote first
 */
async function saveTournament(db: D1Like, row: TournamentRow, input: Changes): Promise<TournamentRow | null> {
  const changes =
    row.settings.idle && !input.settings ? { ...input, settings: { ...row.settings, idle: false } } : input;
  const next = changedRow(row, changes);
  const columns = columnsFor(changes, next);
  const updatedAt = changes.updatedAt ?? Date.now();
  const roster = changes.tournament || changes.settings ? rosterWrites(db, row, next) : [];
  const update = db
    .prepare(
      `UPDATE tournaments SET ${columns.map(([name]) => `${name} = ?, `).join('')}` +
        'version = version + 1, updated_at = ? WHERE code = ? AND version = ?'
    )
    .bind(...columns.map(([, value]) => value), updatedAt, row.code, row.version);
  const ending = next.settings.finished && !row.settings.finished ? [minorCardsCut(db, row, updatedAt)] : [];
  const results = await db.batch([...roster, update, ...ending]);
  const saved = results.at(-1 - ending.length);
  return rowsChanged(saved) === 1 ? { ...next, version: row.version + 1, updatedAt } : null;
}

/**
 * Deletes the cards of every list whose player may be under 18, as the event
 * ends: deck checks needed them while it ran, and nothing needs them after
 * (Play! Pokémon sets no time to keep them). The archetype stays. Runs after
 * the event's own write in the same batch, and only where that write landed:
 * the row must stand at the version it wrote and be finished, so an end that
 * lost a race to another write deletes nothing. An unsanctioned event's lists
 * carry no birth year, so its lists are kept.
 */
function minorCardsCut(db: D1Like, row: TournamentRow, now: number): D1Statement {
  // Born in this year or later, someone may still be 17 (shared/accounts/age.ts).
  const youngest = new Date(now).getUTCFullYear() - ADULT_AGE;
  return db
    .prepare(
      "UPDATE decklists SET deck = '' WHERE code = ?1 AND deck <> '' " +
        'AND CAST(substr(birth_date, -4) AS INTEGER) >= ?2 ' +
        'AND EXISTS (SELECT 1 FROM tournaments WHERE code = ?1 AND version = ?3 ' +
        "AND coalesce(json_extract(settings, '$.finished'), 0) = 1)"
    )
    .bind(row.code, youngest, row.version + 1);
}

/** What a change comes to: the row as written, or why it was refused. */
export type Mutation = { row: TournamentRow } | { error: string; status: number };

/**
 * A round's end is many writes to one row at once, each player's report among
 * them; this many tries lets them all through in turn.
 */
const MAX_TRIES = 5;

/**
 * Changes the row a request read and writes it, trying again from a fresh
 * read each time another write got there first. `change` returns the changes
 * or an error message.
 */
export async function mutate(
  db: D1Like,
  read: TournamentRow,
  change: (row: TournamentRow) => Changes | string
): Promise<Mutation> {
  let row = read;
  for (let tries = 1; ; tries += 1) {
    const outcome = await tryChange(db, row, change);
    if (outcome) {
      return outcome;
    }
    if (tries === MAX_TRIES) {
      return { error: 'Busy; try again', status: 409 };
    }
    const fresh = await loadTournament(db, row.code);
    if (!fresh) {
      return { error: 'No such tournament', status: 404 };
    }
    row = fresh;
  }
}

/** One read-change-write; null when another write got there first. */
async function tryChange(
  db: D1Like,
  row: TournamentRow,
  change: (row: TournamentRow) => Changes | string
): Promise<Mutation | null> {
  const changes = change(row);
  if (typeof changes === 'string') {
    return { error: changes, status: 400 };
  }
  const saved = await saveTournament(db, row, changes).catch((error: unknown) => {
    if (error instanceof TooLarge) {
      return error;
    }
    if (breaksDay(error)) {
      return new DayTaken('You already have an event that day');
    }
    throw error;
  });
  if (saved instanceof TooLarge) {
    return { error: saved.message, status: 413 };
  }
  if (saved instanceof DayTaken) {
    return { error: saved.message, status: 409 };
  }
  return saved && { row: saved };
}

/** What the console's polls check before anything else: whether the copy they hold still stands. */
export interface TournamentHead {
  version: number;
  reports: PlayerReport[];
  /** Whether the request's session belongs to the event's organizer or one of its staff. */
  staff: boolean;
}

/** The head as the request's session sees it, in one read: a console polls this every few seconds. */
export async function loadHead(db: D1Like, code: string, request: Request): Promise<TournamentHead | null> {
  const raw = await db
    .prepare(
      'SELECT version, reports, EXISTS (SELECT 1 FROM sessions WHERE sessions.token_hash = ? ' +
        'AND sessions.expires_at > ? AND ((tournaments.store_id IS NULL AND sessions.user_id = tournaments.owner_id) OR EXISTS ' +
        '(SELECT 1 FROM staff WHERE staff.code = tournaments.code AND staff.user_id = sessions.user_id) OR EXISTS ' +
        '(SELECT 1 FROM store_members m WHERE m.store_id = tournaments.store_id AND m.user_id = sessions.user_id))) ' +
        'AS staff FROM tournaments WHERE code = ?'
    )
    .bind((await sessionHash(request)) ?? '', Date.now(), code)
    .first<{ version: number; reports: string; staff: number }>();
  return raw && { version: raw.version, reports: JSON.parse(raw.reports) as PlayerReport[], staff: raw.staff === 1 };
}

export async function isStaffMember(db: D1Like, code: string, userId: string): Promise<boolean> {
  const staff = await db
    .prepare('SELECT 1 AS yes FROM staff WHERE code = ? AND user_id = ?')
    .bind(code, userId)
    .first<{ yes: number }>();
  return staff !== null;
}

/**
 * Joins the user to the event's staff if `token` is its invite token at the
 * moment of writing: checked in the insert itself, so a join that read the
 * old token cannot land after the organizer replaced it.
 * @returns Whether the user joined
 */
export async function joinStaff(db: D1Like, code: string, userId: string, token: string): Promise<boolean> {
  const result = await db
    .prepare(
      'INSERT OR IGNORE INTO staff (code, user_id, joined_at) ' +
        'SELECT code, ?, ? FROM tournaments WHERE code = ? AND staff_token = ?'
    )
    .bind(userId, Date.now(), code, token)
    .run();
  return rowsChanged(result) === 1;
}

/** Everyone the invite link has let onto the event's staff, earliest first. */
export async function listStaff(db: D1Like, code: string): Promise<StaffMember[]> {
  const { results } = await db
    .prepare(
      `SELECT staff.user_id AS id, ${displayNameSql('users')} AS name, staff.joined_at AS joined_at FROM staff ` +
        'LEFT JOIN users ON users.id = staff.user_id WHERE staff.code = ? ORDER BY staff.joined_at'
    )
    .bind(code)
    .all<{ id: string; name: string | null; joined_at: number | null }>();
  return results.map(row => ({ id: row.id, name: row.name ?? 'Unknown', joinedAt: row.joined_at }));
}

export async function removeStaff(db: D1Like, code: string, userId: string): Promise<void> {
  await db.prepare('DELETE FROM staff WHERE code = ? AND user_id = ?').bind(code, userId).run();
}

/**
 * How many rounds the event in the `state` column has paired across its
 * pods: any pod may pair first, as each division plays on its own. A stored
 * event has no more pods than there are pod categories
 * (shared/tournament/validate.ts), so these slots are all of them.
 */
export const pairedRounds = (state: string) =>
  POD_CATEGORIES.map((_, i) => `ifnull(json_array_length(${state}, '$.pods[${i}].rounds'), 0)`).join(' + ');

interface SummaryRow {
  code: string;
  mode: string;
  name: string | null;
  players: number | null;
  start_date: string | null;
  finished: number | null;
  rounds: number | null;
  owner_id: string;
  updated_at: number;
  store_id: string | null;
  store_role: string | null;
}

/** Every event this user owns or staffs, their stores' among them, newest first. */
export async function listTournaments(db: D1Like, userId: string): Promise<TournamentSummary[]> {
  const { results } = await db
    .prepare(
      "SELECT code, mode, json_extract(state, '$.info.name') AS name, " +
        "json_array_length(state, '$.players') AS players, json_extract(state, '$.info.startDate') AS start_date, " +
        "json_extract(settings, '$.finished') AS finished, " +
        `${pairedRounds('state')} AS rounds, owner_id, updated_at, store_id, ` +
        '(SELECT m.role FROM store_members m WHERE m.store_id = tournaments.store_id AND m.user_id = ?1) AS store_role ' +
        'FROM tournaments WHERE (owner_id = ?1 AND store_id IS NULL) OR code IN (SELECT code FROM staff WHERE user_id = ?1) ' +
        'OR store_id IN (SELECT store_id FROM store_members WHERE user_id = ?1) ORDER BY updated_at DESC LIMIT 200'
    )
    .bind(userId)
    .all<SummaryRow>();
  return results.map(row => ({
    code: row.code,
    mode: row.mode === 'tom' ? 'tom' : 'swiss',
    name: row.name ?? '',
    role: (row.store_id === null ? row.owner_id === userId : row.store_role === 'manager') ? 'owner' : 'staff',
    players: row.players ?? 0,
    startDate: row.start_date ?? '',
    finished: row.finished === 1,
    rounds: row.rounds ?? 0,
    updatedAt: row.updated_at
  }));
}

/**
 * A new invite token and nobody on staff, in one transaction: no join can
 * fall between the two and keep a place the old link gave.
 */
export async function rotateStaff(db: D1Like, code: string): Promise<void> {
  await db.batch([
    db
      .prepare('UPDATE tournaments SET staff_token = ?, version = version + 1, updated_at = ? WHERE code = ?')
      .bind(randomToken(16), Date.now(), code),
    db.prepare('DELETE FROM staff WHERE code = ?').bind(code)
  ]);
}

/**
 * Deletes the event and everything kept under its code, its players' places
 * in the history index included, all on the version `row` read (see
 * deleteWrites): a change between means a fresh read and another try, so no
 * player it gained meanwhile stays in the index.
 * @returns Whether the event is gone; false when other writes kept getting there first
 */
export async function deleteTournament(db: D1Like, row: TournamentRow): Promise<boolean> {
  let current: TournamentRow | null = row;
  for (let tries = 1; current; tries += 1) {
    const results = await db.batch([
      ...deleteWrites(db, current),
      db.prepare('DELETE FROM tournaments WHERE code = ? AND version = ?').bind(current.code, current.version)
    ]);
    if (rowsChanged(results.at(-1)) === 1) {
      return true;
    }
    if (tries === MAX_TRIES) {
      return false;
    }
    current = await loadTournament(db, row.code);
  }
  // Deleted by another request meanwhile, which took its rows with it.
  return true;
}
