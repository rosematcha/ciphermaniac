/**
 * What a spectator narrows the public page's pairings to: the tables still
 * playing, the players they follow, or one archetype; and the one table a
 * stream overlay shows. Pure, apart from the followed players kept on the
 * device, so the page and its tests read the same rules.
 */

import { latestRound, livePods } from '../../../shared/tournament/rounds';
import type { Match, Pod, PodCategory, Round, Tournament } from '../../../shared/tournament/types';
import { decksVisible, type PendingResult, type TournamentView } from '../../../shared/tournament/view';
import { shownOutcome } from './present';

export type Showing = 'all' | 'playing' | 'following';

export interface SpectateFilter {
  showing: Showing;
  /** One archetype's tables only; null for every deck. */
  deck: string | null;
}

export const NO_FILTER: SpectateFilter = { showing: 'all', deck: null };

interface RoundContext {
  pod: Pod;
  round: Round;
  pending: readonly PendingResult[];
  decks: Readonly<Record<string, string>>;
  following: ReadonlySet<string>;
}

const seats = (match: Match) => (match.p2 === null ? [match.p1] : [match.p1, match.p2]);

/** A table with two players and no result yet, a result entered on the site counting as one. */
export function stillPlaying(match: Match, context: Pick<RoundContext, 'pod' | 'round' | 'pending'>): boolean {
  return match.p2 !== null && shownOutcome(match, context.pod, context.round, context.pending).outcome === 'pending';
}

const SHOWING: Record<Showing, (match: Match, context: RoundContext) => boolean> = {
  all: () => true,
  playing: stillPlaying,
  following: (match, context) => seats(match).some(id => context.following.has(id))
};

/** The round's matches the filter leaves. */
export function spectatorMatches(matches: readonly Match[], filter: SpectateFilter, context: RoundContext): Match[] {
  const { deck } = filter;
  return matches.filter(
    match =>
      SHOWING[filter.showing](match, context) && (deck === null || seats(match).some(id => context.decks[id] === deck))
  );
}

/** The archetypes played in a round, most played first, for the deck filter. */
export function roundDecks(matches: readonly Match[], decks: Readonly<Record<string, string>>): string[] {
  const counts = new Map<string, number>();
  for (const id of matches.flatMap(seats)) {
    const deck = decks[id];
    if (deck) {
      counts.set(deck, (counts.get(deck) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([deck]) => deck);
}

const followKey = (code: string) => `cm-tournament-follow:${code}`;

/** The players this device follows at the event, by their public keys. */
export function readFollowing(code: string): Set<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(followKey(code)) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Follows the player, or stops following them; the set the device now keeps. */
export function toggleFollowing(code: string, id: string): Set<string> {
  const next = readFollowing(code);
  if (!next.delete(id)) {
    next.add(id);
  }
  localStorage.setItem(followKey(code), JSON.stringify([...next]));
  return next;
}

export interface StreamTable {
  pod: Pod;
  round: Round;
  match: Match;
}

/**
 * The match a stream overlay shows: the one at `table` in the current round
 * of the first pod still playing at that table, `category`'s when it names
 * one. Only pods still playing count: once a combined pod's divisions cut,
 * its Swiss rounds are over, and asking for it finds the cuts it went on to.
 */
export function streamTable(tournament: Tournament, table: number, category?: PodCategory): StreamTable | null {
  const named = (pod: Pod) => category === undefined || pod.category === category || pod.cutOf === category;
  const pods = livePods(tournament).filter(named);
  for (const pod of pods) {
    const round = latestRound(pod);
    const match = round?.matches.find(m => m.table === table);
    if (round && match) {
      return { pod, round, match };
    }
  }
  return null;
}

/**
 * The decks a stream may show: the public's, only once the event shows them.
 * A staff browser's copy of the event carries decks before then, and a
 * stream is broadcast to everyone.
 */
export const streamDecks = (view: Pick<TournamentView, 'decks' | 'settings'>): Readonly<Record<string, string>> =>
  decksVisible(view.settings) ? view.decks : {};
