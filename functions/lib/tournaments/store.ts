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
  type TournamentMode,
  type TournamentSettings
} from '../../../shared/tournament/view.js';
import { type PlayerReport, pruneReports } from '../../../shared/tournament/reports.js';
import { randomToken, type User } from '../auth/session.js';
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

export type Role = 'owner' | 'staff';

function fromRaw(raw: RawRow): TournamentRow {
  return {
    code: raw.code,
    ownerId: raw.owner_id,
    mode: raw.mode === 'tom' ? 'tom' : 'swiss',
    tournament: JSON.parse(raw.state) as Tournament,
    pending: JSON.parse(raw.pending) as PendingResult[],
    reports: JSON.parse(raw.reports) as PlayerReport[],
    settings: { ...DEFAULT_SETTINGS, ...(JSON.parse(raw.settings) as Partial<TournamentSettings>) },
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

export async function loadTournament(db: D1Like, code: string): Promise<TournamentRow | null> {
  const raw = await db.prepare('SELECT * FROM tournaments WHERE code = ?').bind(code).first<RawRow>();
  return raw ? fromRaw(raw) : null;
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

export async function createTournament(db: D1Like, input: NewTournament): Promise<string> {
  const now = Date.now();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    const taken = await loadVersion(db, code);
    if (taken !== null) {
      continue;
    }
    await db
      .prepare(
        'INSERT INTO tournaments (code, owner_id, mode, state, settings, player_keys, staff_token, created_at, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        code,
        input.ownerId,
        input.mode,
        stateJson(input.tournament),
        JSON.stringify(input.settings ?? DEFAULT_SETTINGS),
        JSON.stringify(assignKeys(input.tournament, {})),
        randomToken(16),
        now,
        now
      )
      .run();
    return code;
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

/** The columns a change writes, and their values: only what it changed. */
function columnsFor(row: TournamentRow, changes: Changes): [string, string][] {
  const { tournament, pending, settings, decks } = changes;
  const columns: [string, string | false | undefined][] = [
    ['state', tournament && stateJson(tournament)],
    ['player_keys', tournament && JSON.stringify(assignKeys(tournament, row.keys))],
    ['pending', pending && JSON.stringify(pending)],
    ['settings', settings && JSON.stringify(settings)],
    ['decks', decks && JSON.stringify(decks)],
    // Reports follow the results and the reporting setting, so any of those rewrites them.
    ['reports', (changes.reports ?? tournament ?? pending ?? settings) && JSON.stringify(reportsAfter(row, changes))]
  ];
  return columns.filter((column): column is [string, string] => typeof column[1] === 'string');
}

/**
 * Writes the changes if the row is still at `row.version`. Only the columns
 * the change touches are written, so a result reported mid-event does not
 * send the whole document back.
 * @returns The new version, or null when someone else wrote first
 */
export async function saveTournament(db: D1Like, row: TournamentRow, changes: Changes): Promise<number | null> {
  const columns = columnsFor(row, changes);
  const result = (await db
    .prepare(
      `UPDATE tournaments SET ${columns.map(([name]) => `${name} = ?, `).join('')}` +
        'version = version + 1, updated_at = ? WHERE code = ? AND version = ?'
    )
    .bind(...columns.map(([, value]) => value), Date.now(), row.code, row.version)
    .run()) as { meta?: { changes?: number } };
  return (result.meta?.changes ?? 0) === 1 ? row.version + 1 : null;
}

/**
 * Reads, changes and writes, retrying from a fresh read when another write got
 * there first. Given the row a request already read, the first try uses it
 * rather than reading it again. `change` returns the changes or an error message.
 */
export async function mutate(
  db: D1Like,
  from: string | TournamentRow,
  change: (row: TournamentRow) => Changes | string
): Promise<{ row: TournamentRow; version: number } | { error: string; status: number }> {
  const code = typeof from === 'string' ? from : from.code;
  let known = typeof from === 'string' ? null : from;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = known ?? (await loadTournament(db, code));
    known = null;
    if (!row) {
      return { error: 'No such tournament', status: 404 };
    }
    const outcome = await tryChange(db, row, change);
    if (outcome) {
      return outcome;
    }
  }
  return { error: 'Busy; try again', status: 409 };
}

/** One read-change-write; null when another write got there first. */
async function tryChange(
  db: D1Like,
  row: TournamentRow,
  change: (row: TournamentRow) => Changes | string
): Promise<{ row: TournamentRow; version: number } | { error: string; status: number } | null> {
  const changes = change(row);
  if (typeof changes === 'string') {
    return { error: changes, status: 400 };
  }
  const version = await saveTournament(db, row, changes).catch((error: unknown) => {
    if (error instanceof TooLarge) {
      return error;
    }
    throw error;
  });
  if (version instanceof TooLarge) {
    return { error: version.message, status: 413 };
  }
  if (version === null) {
    return null;
  }
  // The keys as saved, so a player added by this change is already under a public key.
  const keys = changes.tournament ? assignKeys(changes.tournament, row.keys) : row.keys;
  const reports = reportsAfter(row, changes);
  return { row: { ...row, ...changes, keys, reports, version, updatedAt: Date.now() }, version };
}

/** What the console's polls check before anything else: whether the copy they hold still stands. */
export interface TournamentHead {
  ownerId: string;
  version: number;
  reports: PlayerReport[];
}

export async function loadHead(db: D1Like, code: string): Promise<TournamentHead | null> {
  const raw = await db
    .prepare('SELECT owner_id, version, reports FROM tournaments WHERE code = ?')
    .bind(code)
    .first<{ owner_id: string; version: number; reports: string }>();
  return raw && { ownerId: raw.owner_id, version: raw.version, reports: JSON.parse(raw.reports) as PlayerReport[] };
}

export async function isStaffMember(db: D1Like, code: string, userId: string): Promise<boolean> {
  const staff = await db
    .prepare('SELECT 1 AS yes FROM staff WHERE code = ? AND user_id = ?')
    .bind(code, userId)
    .first<{ yes: number }>();
  return staff !== null;
}

export async function roleOf(db: D1Like, row: TournamentRow, user: User | null): Promise<Role | null> {
  if (!user) {
    return null;
  }
  if (user.id === row.ownerId) {
    return 'owner';
  }
  return (await isStaffMember(db, row.code, user.id)) ? 'staff' : null;
}

/**
 * Joins the user to the event's staff if `token` is its invite token at the
 * moment of writing: checked in the insert itself, so a join that read the
 * old token cannot land after the organizer replaced it.
 * @returns Whether the user joined
 */
export async function joinStaff(db: D1Like, code: string, userId: string, token: string): Promise<boolean> {
  const result = (await db
    .prepare(
      'INSERT OR IGNORE INTO staff (code, user_id, joined_at) ' +
        'SELECT code, ?, ? FROM tournaments WHERE code = ? AND staff_token = ?'
    )
    .bind(userId, Date.now(), code, token)
    .run()) as { meta?: { changes?: number } };
  return (result.meta?.changes ?? 0) === 1;
}

export interface StaffMember {
  id: string;
  name: string;
  /** When they joined through the invite link; null for anyone who joined before that was kept. */
  joinedAt: number | null;
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

export interface TournamentSummary {
  code: string;
  mode: TournamentMode;
  name: string;
  role: Role;
  players: number;
  /** MM/DD/YYYY, as TOM writes it; '' when unset. */
  startDate: string;
  finished: boolean;
  /** Rounds the event's first pod has paired: 0 before round 1. */
  rounds: number;
  updatedAt: number;
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
