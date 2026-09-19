/**
 * Shared shapes for live round data scraped from RK9 pairings.
 *
 * Produced by the pairings parser and the live Worker, consumed by the
 * frontend. RK9 publishes no player ID on a pairing, so a seat is identified by
 * name and country alone.
 * @module shared/live/types
 */

export type LiveResult = 'win' | 'loss' | 'tie';

/** Which side a not-yet-confirmed result was reported for. */
export type LiveSubmitted = 'p1' | 'p2' | 'tie';

export interface LiveSeat {
  name: string;
  /** ISO-ish country tag as RK9 prints it, `''` when the name carries none. */
  country: string;
  wins: number;
  losses: number;
  ties: number;
  points: number;
  /** Present once the match is confirmed. */
  result?: LiveResult;
  dropped?: true;
}

export interface LiveMatch {
  /** Table number; `0` for a bye or an unpaired loss. */
  table: number;
  /** One seat for a bye or an unpaired loss, otherwise two. */
  seats: LiveSeat[];
  complete: boolean;
  /** A result a player has reported that staff have not confirmed yet. */
  submitted?: LiveSubmitted;
}

export interface LiveRoundParse {
  matches: LiveMatch[];
  /** Match rows present in the markup, whether or not they parsed. */
  rowsSeen: number;
  rowsSkipped: number;
  /** Rows were present but the body does not end where a whole fragment does. */
  truncated: boolean;
}

/** An event the poller should watch. Days are the dates RK9 lists, `YYYY-MM-DD`. */
export interface LiveEvent {
  slug: string;
  name: string;
  rk9Id: string;
  /** RK9's pod number for the division; Masters has been pod 2. */
  pod: number;
  firstDay: string;
  lastDay: string;
}

/** Poller bookkeeping for one event; not read by the frontend. */
export interface LiveState {
  round: number;
  roundComplete: boolean;
  /** Hash of the last published matches. */
  hash: string;
  /** Matches in the last published round; a round never loses tables. */
  matchCount: number;
  changedAt: string;
  /** `''` until the first poll. */
  checkedAt: string;
}

export interface LiveRound {
  round: number;
  updatedAt: string;
  /** Rows RK9 listed that could not be read, so a gap is visible rather than silent. */
  unreadable: number;
  matches: LiveMatch[];
}

export interface LiveIndex {
  slug: string;
  name: string;
  round: number;
  /** Matches in the current round without a confirmed result. */
  playing: number;
  updatedAt: string;
}
