/**
 * Which device reports for each player at an event where players report
 * their own results (the `report_devices` table in config/d1/tournaments.sql).
 *
 * Saying who you are is knowing a Player ID, or a last name, and a player
 * knows their opponent's: that alone would let one player report for both
 * seats and settle a match on their own. So the first device to say who a
 * player is claims them and keeps a token, and only that token reports as
 * them. Another device can still follow the player's table. Staff release a
 * claim when a player changes phones.
 */

import { randomToken, sha256 } from '../auth/session.js';
import type { D1Like } from '../types.js';

export interface Claim {
  /** The token to keep, when this request made the claim; the device that has it already holds it otherwise. */
  token: string | null;
  /** Whether the asker is the device that reports for this player. */
  reporter: boolean;
}

interface ClaimRow {
  token_hash: string;
  device: string;
}

const read = (db: D1Like, code: string, playerId: string) =>
  db
    .prepare('SELECT token_hash, device FROM report_devices WHERE code = ? AND player_id = ?')
    .bind(code, playerId)
    .first<ClaimRow>();

/** A browser's own ID, hashed; one that sent none counts as its own device. */
export const deviceOf = async (device: unknown) =>
  sha256(typeof device === 'string' && device ? device.slice(0, 80) : randomToken(16));

/** The asker's standing for `playerId`: claiming them if no device has, or checking the token they hold. */
export async function claimReporter(
  db: D1Like,
  code: string,
  playerId: string,
  asker: { held: unknown; device: unknown }
): Promise<Claim> {
  const { held, device } = asker;
  const token = randomToken(24);
  const hash = await sha256(token);
  await db
    .prepare(
      'INSERT OR IGNORE INTO report_devices (code, player_id, token_hash, device, claimed_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(code, playerId, hash, await deviceOf(device), Date.now())
    .run();
  // Whoever's hash is stored claimed them: this request, or a device that got there first.
  const row = await read(db, code, playerId);
  if (row?.token_hash === hash) {
    return { token, reporter: true };
  }
  return { token: null, reporter: row ? await matches(row, held) : false };
}

const matches = async (row: ClaimRow, held: unknown) =>
  typeof held === 'string' && held !== '' && row.token_hash === (await sha256(held));

/** Whether `held` is the token of the device that reports for `playerId`. */
export async function holds(db: D1Like, code: string, playerId: string, held: unknown): Promise<boolean> {
  const row = await read(db, code, playerId);
  return row ? matches(row, held) : false;
}

/** The hashed device that reports for `playerId`, if one has claimed them. */
export async function reporterDevice(db: D1Like, code: string, playerId: string): Promise<string | null> {
  return (await read(db, code, playerId))?.device ?? null;
}

/** Lets another device claim `playerId`, as staff do when a player changes phones. */
export async function releaseReporter(db: D1Like, code: string, playerId: string): Promise<void> {
  await db.prepare('DELETE FROM report_devices WHERE code = ? AND player_id = ?').bind(code, playerId).run();
}
