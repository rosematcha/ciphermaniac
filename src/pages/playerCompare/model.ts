/**
 * Head-to-head model for the player compare page. Lives outside the component
 * so the counting rules — which events pair up, who finished higher, what
 * counts as a draw — stay unit-testable.
 */
import type { PlayerProfile, PlayerTournamentEntry } from '../../types';

/** Only the history is needed to pair events up. */
type PlayerTournaments = Pick<PlayerProfile, 'tournaments'>;

export interface SharedEvent {
  tournamentId: string;
  date: string;
  a: PlayerTournamentEntry;
  b: PlayerTournamentEntry;
}

export interface HeadToHead {
  aWins: number;
  bWins: number;
  ties: number;
  /** Shared events left uncounted because a finish is unpublished. */
  unscored: number;
}

/**
 * Events both players attended, newest first. This is the honest head-to-head
 * surface the data supports: Limitless publishes final standings, not round
 * pairings, so we compare where each player finished at the same event — not
 * direct matches.
 */
export function sharedEvents(a: PlayerTournaments, b: PlayerTournaments): SharedEvent[] {
  const byId = new Map(b.tournaments.map(t => [t.tournamentId, t]));
  const out: SharedEvent[] = [];
  for (const ta of a.tournaments) {
    const tb = byId.get(ta.tournamentId);
    if (tb) {
      out.push({ tournamentId: ta.tournamentId, date: ta.tournamentDate, a: ta, b: tb });
    }
  }
  out.sort((x, y) => y.date.localeCompare(x.date));
  return out;
}

/**
 * −1 when `a` finished higher (lower placement), 1 when `b` did, 0 when they
 * tied, null when either finish is unpublished — which is not a draw, and so
 * is left out of the count rather than scored as one.
 */
export function finishCmp(a: PlayerTournamentEntry, b: PlayerTournamentEntry): number | null {
  if (a.placement == null || b.placement == null) {
    return null;
  }
  if (a.placement === b.placement) {
    return 0;
  }
  return a.placement < b.placement ? -1 : 1;
}

export function headToHead(events: readonly SharedEvent[]): HeadToHead {
  const tally: HeadToHead = { aWins: 0, bWins: 0, ties: 0, unscored: 0 };
  for (const ev of events) {
    const cmp = finishCmp(ev.a, ev.b);
    if (cmp == null) {
      tally.unscored += 1;
    } else if (cmp < 0) {
      tally.aWins += 1;
    } else if (cmp > 0) {
      tally.bWins += 1;
    } else {
      tally.ties += 1;
    }
  }
  return tally;
}
