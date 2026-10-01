/**
 * Tournaments in D1: one row per event holding the whole document.
 *
 * Every write names the version it read and bumps it, so a stale write fails
 * instead of undoing someone else's: two staff reporting at once each apply to
 * the latest document, because a failed write is retried from a fresh read by
 * the caller (see `mutate`).
 */

import type { Tournament } from '../../../shared/tournament/types.js';
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
import { firstRow, rowsChanged } from '../d1.js';
import type { D1Like } from '../types.js';

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
    updatedAt: raw.updated_at
  };
}

/** Codes are short enough to read aloud and type from a table sign: no 0/O or 1/I/L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function newCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function isCode(value: string): boolean {
  return value.length === CODE_LENGTH && [...value].every(char => CODE_ALPHABET.includes(char));
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
export async function loadIdle(db: D1Like, before: number, limit: number): Promise<TournamentRow[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM tournaments WHERE coalesce(json_extract(settings, '$.finished'), 0) = 0 " +
        "AND updated_at < ? AND json_array_length(state, '$.pods[0].rounds') > 0 LIMIT ?"
    )
    .bind(before, limit)
    .all<RawRow>();
  return results.map(fromRaw);
}

export interface Opened {
  row: TournamentRow;
  user: User | null;
  role: Role | null;
}

/**
 * The event, the signed-in user and their role in it. Every tournament request
 * starts here, so for a signed-in asker the three reads go as one batch: one
 * wait on the database where there were three in a row.
 */
export async function openTournament(db: D1Like, code: string, request: Request): Promise<Opened | null> {
  const hash = await sessionHash(request);
  if (!hash) {
    const row = await loadTournament(db, code);
    return row && { row, user: null, role: null };
  }
  const now = Date.now();
  const [event, account, staff] = await db.batch([
    tournamentQuery(db, code),
    sessionUserQuery(db, hash, now),
    db
      .prepare(
        'SELECT 1 AS yes FROM staff JOIN sessions ON sessions.user_id = staff.user_id ' +
          'WHERE staff.code = ? AND sessions.token_hash = ? AND sessions.expires_at > ?'
      )
      .bind(code, hash, now)
  ]);
  const raw = firstRow<RawRow>(event);
  if (!raw) {
    return null;
  }
  const row = fromRaw(raw);
  const found = firstRow<UserRow>(account);
  const user = found && userFromRow(found);
  return { row, user, role: roleIn(row, user, firstRow(staff) !== null) };
}

/** The organizer owns the event; anyone else signed in is staff once the invite link let them in. */
function roleIn(row: TournamentRow, user: User | null, joined: boolean): Role | null {
  if (user?.id === row.ownerId) {
    return 'owner';
  }
  return user && joined ? 'staff' : null;
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
}

/**
 * Stores a new event under a code nobody holds, and hands back the row as
 * stored. The insert itself refuses a code already taken, so two events made
 * at once cannot land on one code, and there is no read before or after it.
 */
export async function createTournament(db: D1Like, input: NewTournament): Promise<TournamentRow> {
  const { ownerId, mode, tournament } = input;
  const settings = input.settings ?? DEFAULT_SETTINGS;
  const state = stateJson(tournament);
  const keys = assignKeys(tournament, {});
  const staffToken = randomToken(16);
  const now = Date.now();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    const inserted = await db
      .prepare(
        'INSERT OR IGNORE INTO tournaments ' +
          '(code, owner_id, mode, state, settings, player_keys, staff_token, created_at, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(code, ownerId, mode, state, JSON.stringify(settings), JSON.stringify(keys), staffToken, now, now)
      .run();
    if (rowsChanged(inserted) === 1) {
      const empty = { pending: [], reports: [], decks: {} };
      return { code, ownerId, mode, tournament, settings, keys, staffToken, version: 1, updatedAt: now, ...empty };
    }
  }
  throw new Error('Could not find a free tournament code');
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
  tournament?: Tournament;
  pending?: PendingResult[];
  reports?: PlayerReport[];
  settings?: TournamentSettings;
  decks?: Record<string, string>;
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
  const { tournament, pending, settings, decks } = changes;
  const columns: [string, string | false | undefined][] = [
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
 * send the whole document back.
 * @returns The row as written, or null when someone else wrote first
 */
async function saveTournament(db: D1Like, row: TournamentRow, changes: Changes): Promise<TournamentRow | null> {
  const next = changedRow(row, changes);
  const columns = columnsFor(changes, next);
  const updatedAt = Date.now();
  const result = await db
    .prepare(
      `UPDATE tournaments SET ${columns.map(([name]) => `${name} = ?, `).join('')}` +
        'version = version + 1, updated_at = ? WHERE code = ? AND version = ?'
    )
    .bind(...columns.map(([, value]) => value), updatedAt, row.code, row.version)
    .run();
  return rowsChanged(result) === 1 ? { ...next, version: row.version + 1, updatedAt } : null;
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
    throw error;
  });
  if (saved instanceof TooLarge) {
    return { error: saved.message, status: 413 };
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
        'AND sessions.expires_at > ? AND (sessions.user_id = tournaments.owner_id OR EXISTS ' +
        '(SELECT 1 FROM staff WHERE staff.code = tournaments.code AND staff.user_id = sessions.user_id))) AS staff ' +
        'FROM tournaments WHERE code = ?'
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
      'SELECT staff.user_id AS id, users.name AS name, staff.joined_at AS joined_at FROM staff ' +
        'LEFT JOIN users ON users.id = staff.user_id WHERE staff.code = ? ORDER BY staff.joined_at'
    )
    .bind(code)
    .all<{ id: string; name: string | null; joined_at: number | null }>();
  return results.map(row => ({ id: row.id, name: row.name ?? 'Unknown', joinedAt: row.joined_at }));
}

export async function removeStaff(db: D1Like, code: string, userId: string): Promise<void> {
  await db.prepare('DELETE FROM staff WHERE code = ? AND user_id = ?').bind(code, userId).run();
}

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
}

/** Every event this user owns or staffs, newest first. */
export async function listTournaments(db: D1Like, userId: string): Promise<TournamentSummary[]> {
  const { results } = await db
    .prepare(
      "SELECT code, mode, json_extract(state, '$.info.name') AS name, " +
        "json_array_length(state, '$.players') AS players, json_extract(state, '$.info.startDate') AS start_date, " +
        "json_extract(settings, '$.finished') AS finished, " +
        "json_array_length(state, '$.pods[0].rounds') AS rounds, owner_id, updated_at FROM tournaments " +
        'WHERE owner_id = ? OR code IN (SELECT code FROM staff WHERE user_id = ?) ORDER BY updated_at DESC LIMIT 200'
    )
    .bind(userId, userId)
    .all<SummaryRow>();
  return results.map(row => ({
    code: row.code,
    mode: row.mode === 'tom' ? 'tom' : 'swiss',
    name: row.name ?? '',
    role: row.owner_id === userId ? 'owner' : 'staff',
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

export async function ownedCount(db: D1Like, userId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM tournaments WHERE owner_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function deleteTournament(db: D1Like, code: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM tournaments WHERE code = ?').bind(code),
    db.prepare('DELETE FROM staff WHERE code = ?').bind(code),
    db.prepare('DELETE FROM decklists WHERE code = ?').bind(code),
    db.prepare('DELETE FROM report_devices WHERE code = ?').bind(code)
  ]);
}
