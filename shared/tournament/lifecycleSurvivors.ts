/**
 * PAIRING V18-8: the surviving players TOM keeps for a pod in elimination play. A top cut after Swiss and an
 * elimination-only pod each keep one list; it changes only in the ways named here, and reopening the file
 * rebuilds it from the saved rounds.
 */

import { divisionLookup } from './divisions.js';
import { countsComplete, latestRound } from './rounds.js';
import { thirdPlaceMatch } from './standings.js';
import type { Division, Match, Pod, Tournament } from './types.js';

export const departed = (t: Tournament, id: string | null | undefined): boolean =>
  Boolean(id && t.players.find(p => p.id === id)?.droppedAfter !== null);

/** Whether the pod keeps a list: a started top cut, or any elimination-only pod. */
export function keepsSurvivors(t: Tournament, pod: Pod): boolean {
  return t.settings?.type === 1 ? pod.rounds.length > 0 : pod.stage === 1;
}

/** Every player who lost an elimination match: a two-seat loss, a forced loss or a double loss. */
export function eliminationLosers(pod: Pod): Set<string> {
  return new Set(pod.rounds.filter(r => r.kind === 'elimination').flatMap(r => r.matches.flatMap(matchLosers)));
}

/** The losers of decided two-seat elimination matches only. */
export function twoSeatLosers(pod: Pod): Set<string> {
  return new Set(
    pod.rounds
      .filter(r => r.kind === 'elimination')
      .flatMap(r => r.matches.filter(m => m.p2 !== null).flatMap(matchLosers))
  );
}

function matchLosers(match: Match): string[] {
  if (match.p2 === null) {
    return match.outcome === 'loss' ? [match.p1] : [];
  }
  const losers: Record<string, string[]> = { p1: [match.p2], p2: [match.p1], 'double-loss': [match.p1, match.p2] };
  return losers[match.outcome] ?? [];
}

/** The list a reopened file holds, also used for documents saved without one. */
export function rebuiltSurvivors(t: Tournament, pod: Pod): string[] {
  if (t.settings?.type === 1) {
    const lost = twoSeatLosers(pod);
    return pod.playerIds.filter(id => !departed(t, id) && !lost.has(id));
  }
  return (latestRound(pod)?.matches ?? []).flatMap(m => {
    const first = ['p1', 'pending', 'bye'].includes(m.outcome) ? [m.p1] : [];
    const second = m.p2 !== null && ['p2', 'pending'].includes(m.outcome) ? [m.p2] : [];
    return [...first, ...second];
  });
}

export function survivorList(t: Tournament, pod: Pod): string[] {
  return pod.survivors ?? rebuiltSurvivors(t, pod);
}

function withSurvivors(t: Tournament, pod: Pod, change: (ids: string[]) => string[]): Pod {
  return keepsSurvivors(t, pod) ? { ...pod, survivors: change(survivorList(t, pod)) } : pod;
}

const added = (ids: string[], id: string) => (ids.includes(id) ? ids : [...ids, id]);

/** A removal takes one entry of a list that can repeat a player (V24-2). */
function removedOnce(ids: readonly string[], id: string): string[] {
  const index = ids.indexOf(id);
  return index < 0 ? [...ids] : [...ids.slice(0, index), ...ids.slice(index + 1)];
}

/** V24-2: a top cut adds the winner only to a list still holding someone, then removes the loser once more. */
function storedWin(t: Tournament, list: string[], winner: string, loser: string): string[] {
  if (t.settings?.type === 1) {
    return added(list, winner);
  }
  return list.length && !list.includes(winner) ? removedOnce([...list, winner], loser) : list;
}

/**
 * Every attempted result in an elimination round removes the loser it names; a stored win also restores the
 * winner. TOM refuses to store a win for a departed player.
 */
export function enteredResults(t: Tournament, pod: Pod, attempts: readonly Match[]): Pod {
  if (latestRound(pod)?.kind !== 'elimination') {
    return pod;
  }
  return withSurvivors(t, pod, ids =>
    attempts.reduce((list, match) => {
      if (match.p2 === null || !['p1', 'p2'].includes(match.outcome)) {
        return list;
      }
      const [winner, loser] = match.outcome === 'p1' ? [match.p1, match.p2] : [match.p2, match.p1];
      const without = removedOnce(list, loser);
      return departed(t, winner) ? without : storedWin(t, without, winner, loser);
    }, ids)
  );
}

/** A departure that awards a cut match to a missing opponent restores the opponent and removes the departed. */
export function awardedDeparture(t: Tournament, pod: Pod, id: string, opponent: string | null): Pod {
  if (t.settings?.type === 1 || !opponent || departed(t, opponent)) {
    return pod;
  }
  return withSurvivors(t, pod, ids =>
    ids.includes(opponent) || !ids.length ? ids : [...removedOnce(ids, id), opponent]
  );
}

/**
 * V24-2: the first check after a reading confirms the rebuilt list; an empty one is refilled with every seat of
 * the pod's latest round, departed players and losers included.
 */
export function confirmedSurvivors(t: Tournament, pod: Pod): Pod {
  if (!pod.survivorsUnconfirmed) {
    return pod;
  }
  const { survivorsUnconfirmed: _held, ...rest } = pod;
  const seats = (latestRound(pod)?.matches ?? []).flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2]));
  return survivorList(t, rest).length ? rest : { ...rest, survivors: seats };
}

/** V24-2: saves, repairs and numberings check every pod at its scheduled round count whose latest round is complete. */
export function checkedSurvivors(t: Tournament): Tournament {
  const pods = t.pods.map(pod => {
    const last = latestRound(pod);
    const swiss = pod.rounds.filter(r => r.kind === 'swiss').length;
    const scheduled = swiss + Math.ceil(Math.log2(Math.max(pod.cut, 1)));
    return last && last.number >= scheduled && countsComplete(last) ? confirmedSurvivors(t, pod) : pod;
  });
  return pods.some((pod, i) => pod !== t.pods[i]) ? { ...t, pods } : t;
}

/**
 * V21-1: an elimination-only pairing adds every player it seated who is missing from the list and has not
 * departed, after numbering its tables and before the renumbering.
 */
export function seatedPlayers(t: Tournament, pod: Pod, matches: readonly Match[]): Pod {
  const seated = matches.flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2])).filter(id => !departed(t, id));
  return t.settings?.type === 1 ? withSurvivors(t, pod, ids => seated.reduce(added, ids)) : pod;
}

/** Entrants and returning players rejoin an elimination-only pod's list. */
export function rejoined(t: Tournament, pod: Pod, id: string): Pod {
  return t.settings?.type === 1 ? withSurvivors(t, pod, ids => added(ids, id)) : pod;
}

/** A paired third-place playoff adds its two players (V16-11); a top cut records the playoff as paired. */
export function playoffPlayers(
  t: Tournament,
  pod: Pod,
  playoff: Pick<Match, 'p1' | 'p2'> | undefined,
  finalistsDivision?: Division
): Pod {
  if (!playoff || playoff.p2 === null) {
    return pod;
  }
  const division = finalistsDivision ?? divisionLookup(t)(playoff.p1);
  const recorded =
    t.settings?.type === 1 ? pod : { ...pod, playoffsPaired: [...new Set([...(pod.playoffsPaired ?? []), division])] };
  return withSurvivors(t, recorded, ids => [...ids, playoff.p1, playoff.p2!]);
}

/** Whether TOM records the division's playoff as paired; a document saved without the flag reads its rounds. */
export function playoffPaired(pod: Pod, division: Division): boolean {
  return pod.playoffsPaired ? pod.playoffsPaired.includes(division) : pod.rounds.some(r => thirdPlaceMatch(pod, r));
}
