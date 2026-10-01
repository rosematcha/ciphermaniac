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
 *
 * A signed-in account can hold the row too, on the same first-come terms:
 * as the player whose POP ID it holds at a sanctioned event, or as the one it
 * says it is at an unsanctioned one, which is its Claim (see accountFor).
 * The account then reports from any of its devices, token or not, and the
 * row puts the event in its History. An account is one player per event.
 */

import { isSanctioned } from '../../../shared/tournament/view.js';
import { randomToken, sha256, type User } from '../auth/session.js';
import { firstRow, rowsChanged } from '../d1.js';
import type { D1Like } from '../types.js';
import type { TournamentRow } from './store.js';

export interface Claim {
  /** The token to keep, when this request made the claim; the device that has it already holds it otherwise. */
  token: string | null;
  /** Whether the asker is the device that reports for this player. */
  reporter: boolean;
  /** The hashed device that reports for this player, when one has claimed them. */
  device: string | null;
  /** Whether the player is the asking account's at this event. */
  linked: boolean;
}

/** The answer when the asking account is already another player at this event: that player's ID. */
export interface Elsewhere {
  elsewhere: string;
}

/** Who asks to be a player: the token their device holds, the device, and the account they would be the player as. */
export interface Asker {
  held: unknown;
  device: unknown;
  account: string | null;
}

interface ClaimRow {
  token_hash: string;
  device: string;
  user_id: string | null;
}

/** One player's seat at one event, and the database it is kept in. */
interface Seat {
  db: D1Like;
  code: string;
  playerId: string;
}

const readSeat = ({ db, code, playerId }: Seat) =>
  db
    .prepare('SELECT token_hash, device, user_id FROM report_devices WHERE code = ? AND player_id = ?')
    .bind(code, playerId);

/** A browser's own ID, hashed; one that sent none counts as its own device. */
export const deviceOf = async (device: unknown) =>
  sha256(typeof device === 'string' && device ? device.slice(0, 80) : randomToken(16));

/**
 * The account the signed-in asker would be `playerId` as. At a sanctioned
 * event that is only the player whose POP ID the account holds: typing
 * someone else's links nothing. At an unsanctioned one, saying who you are
 * while signed in is the Claim, with no one to approve it. A finished event
 * takes no new Claims, so there it is none.
 */
export function accountFor(asking: { row: TournamentRow; user: User | null }, playerId: string): string | null {
  const { row, user } = asking;
  if (!user || row.settings.finished) {
    return null;
  }
  return !isSanctioned(row) || user.popId === playerId ? user.id : null;
}

/**
 * The asker's standing for `playerId`: checking the token they hold, or the
 * account they ask as, against whoever claimed the player, or claiming them
 * if no one has. Elsewhere when the asking account is another player here.
 */
export async function claimReporter(
  db: D1Like,
  code: string,
  playerId: string,
  asker: Asker
): Promise<Claim | Elsewhere> {
  const seat = { db, code, playerId };
  const held = asker.account
    ? [db.prepare('SELECT player_id FROM report_devices WHERE user_id = ? AND code = ?').bind(asker.account, code)]
    : [];
  const [claimed, account] = await db.batch([readSeat(seat), ...held]);
  const other = firstRow<{ player_id: string }>(account)?.player_id;
  if (other !== undefined && other !== playerId) {
    return { elsewhere: other };
  }
  const row = firstRow<ClaimRow>(claimed);
  return row ? standingFor(seat, row, asker) : claim(seat, asker);
}

const matches = async (row: ClaimRow, held: unknown) =>
  typeof held === 'string' && held !== '' && row.token_hash === (await sha256(held));

async function standingFor(seat: Seat, row: ClaimRow, asker: Asker): Promise<Claim> {
  const holder = await matches(row, asker.held);
  const linked = await linkedAs(seat, row, { ...asker, holder });
  return { token: null, reporter: holder || linked, device: row.device, linked };
}

/**
 * Whether the row is the asking account's: already, or now, when the device
 * that claimed the player before signing in asks again signed in. That
 * device's claim becomes the account's, unless the account took another
 * player here meanwhile.
 */
async function linkedAs(seat: Seat, row: ClaimRow, asker: Asker & { holder: boolean }): Promise<boolean> {
  if (asker.account === null || row.user_id !== null) {
    return asker.account !== null && row.user_id === asker.account;
  }
  if (!asker.holder) {
    return false;
  }
  const taken = await seat.db
    .prepare('UPDATE OR IGNORE report_devices SET user_id = ? WHERE code = ? AND player_id = ? AND user_id IS NULL')
    .bind(asker.account, seat.code, seat.playerId)
    .run();
  return rowsChanged(taken) === 1;
}

/** Claims the player for the asker, unless another device or account got there between the read and this write. */
async function claim(seat: Seat, asker: Asker): Promise<Claim> {
  const token = randomToken(24);
  const hash = await sha256(token);
  const [, stored] = await seat.db.batch([
    seat.db
      .prepare(
        'INSERT OR IGNORE INTO report_devices (code, player_id, token_hash, device, claimed_at, user_id) ' +
          'VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(seat.code, seat.playerId, hash, await deviceOf(asker.device), Date.now(), asker.account),
    readSeat(seat)
  ]);
  // Whoever's hash is stored claimed them: this request, or a device that got there first.
  const row = firstRow<ClaimRow>(stored);
  if (row?.token_hash === hash) {
    return { token, reporter: true, device: row.device, linked: asker.account !== null };
  }
  return row ? standingFor(seat, row, asker) : { token: null, reporter: false, device: null, linked: false };
}

/** Lets another device or account claim `playerId`, as staff do when a player changes phones. */
export async function releaseReporter(db: D1Like, code: string, playerId: string): Promise<void> {
  await db.prepare('DELETE FROM report_devices WHERE code = ? AND player_id = ?').bind(code, playerId).run();
}
