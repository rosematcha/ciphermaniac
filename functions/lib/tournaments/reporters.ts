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
import { loadTournament, type TournamentRow } from './store.js';

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

/** Who asks to be a player: the token their device holds, the device, and who is signed in. */
export interface Asker {
  held: unknown;
  device: unknown;
  user: User | null;
}

/** Why the asker's standing could not be had: the player left the event, or the event kept changing. */
interface Refusal {
  error: string;
  status: number;
}

interface ClaimRow {
  token_hash: string;
  device: string;
  user_id: string | null;
}

/**
 * One player's seat at one event as a request read the event: its version,
 * and the account the asker would be the player as, which must still hold
 * `popId` (the player's, at a sanctioned event; null at an unsanctioned one)
 * when a write lands.
 */
interface Seat {
  db: D1Like;
  code: string;
  playerId: string;
  version: number;
  account: string | null;
  popId: string | null;
}

/** The answer when the event changed between the read and the write: worked out again from a fresh read. */
const STALE = Symbol('stale');

type Standing = Claim | Elsewhere | typeof STALE;

const readSeat = ({ db, code, playerId }: Seat) =>
  db
    .prepare('SELECT token_hash, device, user_id FROM report_devices WHERE code = ? AND player_id = ?')
    .bind(code, playerId);

/** The player the seat's account holds here, read in a batch with a write so a race lost to it shows. */
const readHeld = ({ db, code, account }: Seat) =>
  account
    ? [db.prepare('SELECT player_id FROM report_devices WHERE user_id = ? AND code = ?').bind(account, code)]
    : [];

/**
 * The account a write makes the row's, checked as the write lands: the seat's
 * account while it still holds the player's POP ID, NULL otherwise. Its
 * values are ?1 and ?2.
 */
const ACCOUNT_SQL = '(SELECT id FROM users WHERE id = ?1 AND (?2 IS NULL OR pop_id = ?2))';

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
function accountFor(asking: { row: TournamentRow; user: User | null }, playerId: string): string | null {
  const { row, user } = asking;
  if (!user || row.settings.finished) {
    return null;
  }
  return !isSanctioned(row) || user.popId === playerId ? user.id : null;
}

/** The seat as `row` has it, for `asker`. */
const seatIn = (db: D1Like, row: TournamentRow, playerId: string, asker: Asker): Seat => ({
  db,
  code: row.code,
  playerId,
  version: row.version,
  account: accountFor({ row, user: asker.user }, playerId),
  popId: isSanctioned(row) ? playerId : null
});

/**
 * A round's end is many writes to the event at once; this many tries lets a
 * claim through them, as `mutate` does a report.
 */
const MAX_TRIES = 5;

/**
 * The asker's standing for `playerId`: checking the token they hold, or the
 * account they ask as, against whoever claimed the player, or claiming them
 * if no one has. Elsewhere when the asking account is another player here.
 * A claim lands only on the event as `row` read it, so none outlives the
 * event's end, its player's leaving or its sanctioning: when the event moved
 * on first, the standing is worked out again from a fresh read.
 */
export async function claimReporter(
  db: D1Like,
  row: TournamentRow,
  playerId: string,
  asker: Asker
): Promise<Claim | Elsewhere | Refusal> {
  let current = row;
  for (let tries = 1; ; tries += 1) {
    const standing = await standingAt(seatIn(db, current, playerId, asker), asker);
    if (standing !== STALE) {
      return standing;
    }
    if (tries === MAX_TRIES) {
      return { error: 'Busy; try again', status: 409 };
    }
    const fresh = await loadTournament(db, row.code);
    if (!fresh?.tournament.players.some(player => player.id === playerId)) {
      return { error: 'No such player', status: 404 };
    }
    current = fresh;
  }
}

async function standingAt(seat: Seat, asker: Asker): Promise<Standing> {
  const [claimed, held] = await seat.db.batch([readSeat(seat), ...readHeld(seat)]);
  const other = elsewhere(seat, held);
  if (other) {
    return other;
  }
  const row = firstRow<ClaimRow>(claimed);
  return row ? standingFor(seat, row, asker) : claim(seat, asker);
}

/** Elsewhere, when the seat's account holds another player here. */
function elsewhere(seat: Seat, held: { results?: unknown[] } | undefined): Elsewhere | null {
  const other = firstRow<{ player_id: string }>(held)?.player_id;
  return other !== undefined && other !== seat.playerId ? { elsewhere: other } : null;
}

const matches = async (row: ClaimRow, held: unknown) =>
  typeof held === 'string' && held !== '' && row.token_hash === (await sha256(held));

async function standingFor(seat: Seat, row: ClaimRow, asker: Asker): Promise<Standing> {
  const holder = await matches(row, asker.held);
  const linked = await linkedAs(seat, row, holder);
  return typeof linked === 'boolean' ? { token: null, reporter: holder || linked, device: row.device, linked } : linked;
}

/**
 * Whether the row is the asking account's: already, or now, when the device
 * that claimed the player before signing in asks again signed in. That
 * device's claim becomes the account's, unless the account took another
 * player here meanwhile (Elsewhere), or the event or the row changed since
 * the read (stale).
 */
async function linkedAs(seat: Seat, row: ClaimRow, holder: boolean): Promise<boolean | Elsewhere | typeof STALE> {
  if (seat.account === null || row.user_id !== null) {
    return seat.account !== null && row.user_id === seat.account;
  }
  if (!holder) {
    return false;
  }
  // Only the row whose token was checked: staff may have let another device claim the player since.
  const [taken, stored, held] = await seat.db.batch([
    seat.db
      .prepare(
        `UPDATE OR IGNORE report_devices SET user_id = ${ACCOUNT_SQL} WHERE code = ?3 AND player_id = ?4 ` +
          'AND token_hash = ?5 AND user_id IS NULL AND EXISTS (SELECT 1 FROM tournaments WHERE code = ?3 AND version = ?6)'
      )
      .bind(seat.account, seat.popId, seat.code, seat.playerId, row.token_hash, seat.version),
    readSeat(seat),
    ...readHeld(seat)
  ]);
  if (rowsChanged(taken) === 1) {
    return firstRow<ClaimRow>(stored)?.user_id === seat.account;
  }
  return elsewhere(seat, held) ?? STALE;
}

/** Claims the player for the asker, unless another device or account got there between the read and this write. */
async function claim(seat: Seat, asker: Asker): Promise<Standing> {
  const token = randomToken(24);
  const hash = await sha256(token);
  const [, stored, held] = await seat.db.batch([
    seat.db
      .prepare(
        'INSERT OR IGNORE INTO report_devices (code, player_id, token_hash, device, claimed_at, user_id) ' +
          `SELECT ?3, ?4, ?5, ?6, ?7, ${ACCOUNT_SQL} FROM tournaments WHERE code = ?3 AND version = ?8`
      )
      .bind(
        seat.account,
        seat.popId,
        seat.code,
        seat.playerId,
        hash,
        await deviceOf(asker.device),
        Date.now(),
        seat.version
      ),
    readSeat(seat),
    ...readHeld(seat)
  ]);
  // Whoever's hash is stored claimed them: this request, or a device that got there first.
  const row = firstRow<ClaimRow>(stored);
  if (row?.token_hash === hash) {
    return { token, reporter: true, device: row.device, linked: row.user_id !== null };
  }
  // Nothing stored and the account free: the event changed since the read.
  return elsewhere(seat, held) ?? (row ? standingFor(seat, row, asker) : STALE);
}

/** Lets another device or account claim `playerId`, as staff do when a player changes phones. */
export async function releaseReporter(db: D1Like, code: string, playerId: string): Promise<void> {
  await db.prepare('DELETE FROM report_devices WHERE code = ? AND player_id = ?').bind(code, playerId).run();
}
