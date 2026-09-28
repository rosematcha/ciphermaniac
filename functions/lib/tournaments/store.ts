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
  assignKeys,
  DEFAULT_SETTINGS,
  type PendingResult,
  type TournamentMode,
  type TournamentSettings
} from '../../../shared/tournament/view.js';
import { randomToken, type User } from '../auth/session.js';
import type { D1Like } from '../types.js';

export interface TournamentRow {
  code: string;
  ownerId: string;
  mode: TournamentMode;
  tournament: Tournament;
  pending: PendingResult[];
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
        JSON.stringify(DEFAULT_SETTINGS),
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
  settings?: TournamentSettings;
  decks?: Record<string, string>;
  staffToken?: string;
}

/**
 * Writes the changes if the row is still at `row.version`.
 * @returns The new version, or null when someone else wrote first
 */
export async function saveTournament(db: D1Like, row: TournamentRow, changes: Changes): Promise<number | null> {
  const tournament = changes.tournament ?? row.tournament;
  const keys = changes.tournament ? assignKeys(tournament, row.keys) : row.keys;
  const result = (await db
    .prepare(
      'UPDATE tournaments SET state = ?, pending = ?, settings = ?, player_keys = ?, decks = ?, staff_token = ?, ' +
        'version = version + 1, updated_at = ? WHERE code = ? AND version = ?'
    )
    .bind(
      stateJson(tournament),
      JSON.stringify(changes.pending ?? row.pending),
      JSON.stringify(changes.settings ?? row.settings),
      JSON.stringify(keys),
      JSON.stringify(changes.decks ?? row.decks),
      changes.staffToken ?? row.staffToken,
      Date.now(),
      row.code,
      row.version
    )
    .run()) as { meta?: { changes?: number } };
  return (result.meta?.changes ?? 0) === 1 ? row.version + 1 : null;
}

/**
 * Reads, changes and writes, retrying from a fresh read when another write got
 * there first. `change` returns the changes or an error message.
 */
export async function mutate(
  db: D1Like,
  code: string,
  change: (row: TournamentRow) => Changes | string
): Promise<{ row: TournamentRow; version: number } | { error: string; status: number }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await loadTournament(db, code);
    if (!row) {
      return { error: 'No such tournament', status: 404 };
    }
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
    if (version !== null) {
      return { row: { ...row, ...changes, version }, version };
    }
  }
  return { error: 'Busy; try again', status: 409 };
}

export async function roleOf(db: D1Like, row: TournamentRow, user: User | null): Promise<Role | null> {
  if (!user) {
    return null;
  }
  if (user.id === row.ownerId) {
    return 'owner';
  }
  const staff = await db
    .prepare('SELECT 1 AS yes FROM staff WHERE code = ? AND user_id = ?')
    .bind(row.code, user.id)
    .first<{ yes: number }>();
  return staff ? 'staff' : null;
}

export async function addStaff(db: D1Like, code: string, userId: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO staff (code, user_id) VALUES (?, ?)').bind(code, userId).run();
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
  updatedAt: number;
}

interface SummaryRow {
  code: string;
  mode: string;
  name: string | null;
  players: number | null;
  start_date: string | null;
  finished: number | null;
  owner_id: string;
  updated_at: number;
}

/** Every event this user owns or staffs, newest first. */
export async function listTournaments(db: D1Like, userId: string): Promise<TournamentSummary[]> {
  const { results } = await db
    .prepare(
      "SELECT code, mode, json_extract(state, '$.info.name') AS name, " +
        "json_array_length(state, '$.players') AS players, json_extract(state, '$.info.startDate') AS start_date, " +
        "json_extract(settings, '$.finished') AS finished, owner_id, updated_at FROM tournaments " +
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
    updatedAt: row.updated_at
  }));
}

export async function clearStaff(db: D1Like, code: string): Promise<void> {
  await db.prepare('DELETE FROM staff WHERE code = ?').bind(code).run();
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
    db.prepare('DELETE FROM decklists WHERE code = ?').bind(code)
  ]);
}
