/**
 * The history index (the `pop_history` table in config/d1/tournaments.sql):
 * which events each POP ID plays in. A sanctioned event knows its players by
 * POP ID, so every player there is indexed under their ID; an unsanctioned
 * one knows them only by name, and its players reach an account's History
 * through a Claim instead. A change to an event writes only what it changed
 * in the index, so a result or a clock tick writes nothing extra.
 */

import type { Tournament } from './types.js';
import { isSanctioned, type TournamentMode, type TournamentSettings } from './view.js';

/** The parts of a stored event the index follows: its players, and whether they are known by POP ID. */
export interface IndexedEvent {
  mode: TournamentMode;
  settings: TournamentSettings;
  tournament: Pick<Tournament, 'players'>;
}

/** The player IDs an event indexes under POP IDs: all of them at a sanctioned event, none at another. */
export function indexedIds(event: IndexedEvent): Set<string> {
  return new Set(isSanctioned(event) ? event.tournament.players.map(player => player.id) : []);
}

export interface RosterDiff {
  /** IDs to index under this event. */
  add: string[];
  /** IDs no longer indexed under it. */
  remove: string[];
  /** IDs off the player list altogether, sanctioned or not: whoever was that player here is no one now. */
  gone: string[];
}

const without = (ids: Iterable<string>, kept: ReadonlySet<string>) => [...ids].filter(id => !kept.has(id));

/**
 * What a change from `before` to `after` adds to and removes from the index,
 * and which players it took off the list. A player whose ID changed, as TOM
 * may do, is one removal and one addition.
 */
export function rosterDiff(before: IndexedEvent, after: IndexedEvent): RosterDiff {
  const was = indexedIds(before);
  const now = indexedIds(after);
  const listed = new Set(after.tournament.players.map(player => player.id));
  return {
    add: without(now, was),
    remove: without(was, now),
    gone: without(
      before.tournament.players.map(player => player.id),
      listed
    )
  };
}

/**
 * D1 binds at most 100 values to a statement, and an index write binds the
 * event's code and a guard besides its IDs: 98 IDs a statement, so a
 * 700-player file is eight.
 */
export const IDS_PER_STATEMENT = 98;

/** `ids` in runs of at most `size`, in order; none for none. */
export function chunks(ids: readonly string[], size = IDS_PER_STATEMENT): string[][] {
  const runs: string[][] = [];
  for (let start = 0; start < ids.length; start += size) {
    runs.push(ids.slice(start, start + size));
  }
  return runs;
}
