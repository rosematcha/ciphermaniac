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
  /** No row printed points, which only a top cut round leaves off. */
  topCut: boolean;
}

export type LiveEventKind = 'regional' | 'international' | 'worlds';

/** An event the poller should watch. Days are the dates RK9 lists, `YYYY-MM-DD`. */
export interface LiveEvent {
  /**
   * RK9's event slug without its `pokemon-` prefix, e.g. `brisbane-2027`. Known
   * weeks ahead, unlike a Limitless Labs code, which only exists once the event
   * is under way; `rk9Id` is what joins a live event to its Labs import later.
   */
  slug: string;
  name: string;
  kind: LiveEventKind;
  rk9Id: string;
  /** RK9's pod number for the division; Masters has been pod 2. */
  pod: number;
  firstDay: string;
  lastDay: string;
}

/** Where the top cut starts: its first round, and how many players it holds. */
export interface LiveCut {
  from: number;
  size: number;
}

/** Poller bookkeeping for one event, held by the runner between steps. */
export interface LiveState {
  round: number;
  roundComplete: boolean;
  cut?: LiveCut;
  /** When round two was first published; see `shared/live/pace.ts`. */
  round2At?: string;
  finished?: boolean;
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
  /** A top cut round; its seats carry their frozen Swiss records. */
  topCut?: true;
  /** Rows RK9 listed that could not be read, so a gap is visible rather than silent. */
  unreadable: number;
  matches: LiveMatch[];
}

export interface LiveIndex {
  slug: string;
  rk9Id: string;
  name: string;
  round: number;
  matches: number;
  /** Hash of the round's matches; changes whenever `r{round}.json` does. */
  hash: string;
  /** Matches in the current round with no result, confirmed or submitted. */
  playing: number;
  updatedAt: string;
  /** Present once the top cut has started. */
  cut?: LiveCut;
  /** When round two was first published, which pins the venue's day for pacing. */
  round2At?: string;
  /** The final has a result: the event is over and nothing more will be published. */
  finished?: true;
}

/** `live/v1/schedule.json`: the events worth following, soonest first. */
export interface LiveSchedule {
  generatedAt: string;
  events: LiveEvent[];
}
