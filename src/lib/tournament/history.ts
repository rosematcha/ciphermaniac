/**
 * What History shows of each event an account played, read out of the
 * event's public copy by the player's key: their division, place, record,
 * deck and every round. Built from the same standings and match history the
 * event page draws (see present.ts), so the two always agree; the event
 * page's player sheet takes its place from here too.
 */

import { playerPod } from '../../../shared/tournament/rounds';
import type { MatchRecord, Standing } from '../../../shared/tournament/standings';
import type { Division, Pod } from '../../../shared/tournament/types';
import { decksVisible, isSanctioned, type PublishedView } from '../../../shared/tournament/view';
import { type HistoryRow, matchHistory, podStandings, roundLabel } from './present';

/** How one player's event went, as the public copy of it says. */
export interface PlayerFinish {
  /** Their division at a sanctioned event; null at an unsanctioned one, which plays as one. */
  division: Division | null;
  /** Where they stand in their division, its top cut counted; null until their pod has played a round. */
  place: number | null;
  /** Their Swiss record, as the standings show it; null with their place. */
  record: MatchRecord | null;
  /** Their archetype, while the public may see it. */
  deck: string | null;
  dropped: boolean;
  /** Every round they played, the top cut's included, each with its name ("Round 2", "Semifinals"). */
  rounds: (HistoryRow & { label: string })[];
}

/** A player's row in the standings of the pod they played in, top cut included (see playerPod). */
function finishOf(view: PublishedView, pod: Pod, key: string): Standing | undefined {
  const divisionOf = (id: string) => view.divisions[id] ?? 'masters';
  return podStandings(view.tournament, pod, divisionOf)
    .flatMap(group => group.rows)
    .find(row => row.playerId === key);
}

/** What the copy says of a player beside their results: their division where it names one, and a deck the public may see. */
function shownOf(view: PublishedView, key: string): Pick<PlayerFinish, 'division' | 'deck'> {
  return {
    division: isSanctioned(view) ? (view.divisions[key] ?? null) : null,
    deck: decksVisible(view.settings) ? (view.decks[key] ?? null) : null
  };
}

/** A player's rounds, each named as the event page names it. */
function namedRounds(pod: Pod, key: string): PlayerFinish['rounds'] {
  const labels = new Map(pod.rounds.map(round => [round.number, roundLabel(round)]));
  return matchHistory(pod, key).map(row => ({ ...row, label: labels.get(row.round) ?? `Round ${row.round}` }));
}

/**
 * One player's event, by their public key: their place, record, deck and
 * every round, from the same standings the event page draws, so a History
 * entry and the page it links to always agree. Results entered on the site
 * and not yet in TOM's file count here as they do in the page's standings:
 * not until TOM has them. Null when the copy has no player by that key.
 */
export function playerResult(view: PublishedView, key: string): PlayerFinish | null {
  const player = view.tournament.players.find(p => p.id === key);
  if (!player) {
    return null;
  }
  const pod = playerPod(view.tournament, key);
  const row = pod?.rounds.length ? finishOf(view, pod, key) : undefined;
  return {
    ...shownOf(view, key),
    place: row?.place ?? null,
    record: row?.record ?? null,
    dropped: player.droppedAfter !== null,
    rounds: pod ? namedRounds(pod, key) : []
  };
}
