/**
 * What the public sees of a tournament, and the results the site holds for a
 * TOM-run event until TOM takes them in.
 *
 * The public copy is the same document with the private parts gone: POP IDs
 * become per-event keys, and birth dates, the organizer's ID and TOM's
 * leftovers are dropped. Because it keeps the shape, the page ranks and pairs
 * it with the same shared code the organizer's copy uses.
 */

import { divisionFor, parseTomDate, seasonOf } from './divisions.js';
import type { Division, Outcome, Pod, PodCategory, Tournament } from './types.js';

export type TournamentMode = 'swiss' | 'tom';

/** A result entered on the site for a TOM-run event, shown until the .tdf has one. */
export interface PendingResult {
  pod: PodCategory;
  round: number;
  table: number;
  p1: string;
  p2: string | null;
  outcome: Outcome;
  at: number;
}

/**
 * When the public can see what each player is on. 'off' turns archetypes
 * off for the event altogether: nobody picks one, and no page shows one.
 */
export type DeckVisibility = 'always' | 'after' | 'off';

export interface TournamentSettings {
  decklistsOpen: boolean;
  deckVisibility: DeckVisibility;
  /** The organizer's own notes for players: venue, prizes, schedule. */
  details: string;
  /** Standard, Expanded, or whatever the organizer calls it. */
  format: string;
  /** Local date and time, YYYY-MM-DDTHH:mm as a datetime-local input gives it; '' until set. */
  startsAt: string;
  /** Set when the organizer closes the event; 'after' decks show from then. */
  finished: boolean;
}

export const DEFAULT_SETTINGS: TournamentSettings = {
  decklistsOpen: false,
  deckVisibility: 'after',
  details: '',
  format: 'Standard',
  startsAt: '',
  finished: false
};

export const SETTINGS_LIMITS = { details: 1000, format: 40, archetype: 60 } as const;

const VISIBILITIES: readonly DeckVisibility[] = ['always', 'after', 'off'];
const STARTS_AT_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})?$/;

type SettingCheck = (value: unknown) => boolean;

const SETTING_CHECKS: { [K in keyof TournamentSettings]: SettingCheck } = {
  decklistsOpen: value => typeof value === 'boolean',
  finished: value => typeof value === 'boolean',
  deckVisibility: value => VISIBILITIES.includes(value as DeckVisibility),
  details: value => typeof value === 'string' && value.length <= SETTINGS_LIMITS.details,
  format: value => typeof value === 'string' && value.length <= SETTINGS_LIMITS.format,
  startsAt: value => typeof value === 'string' && STARTS_AT_RE.test(value)
};

/** A settings change out of a request body, laid over `current`; null when any field is malformed. */
export function readSettings(body: unknown, current: TournamentSettings): TournamentSettings | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(body)) {
    const check = Object.hasOwn(SETTING_CHECKS, key) ? SETTING_CHECKS[key as keyof TournamentSettings] : undefined;
    if (!check?.(value)) {
      return null;
    }
    next[key] = value;
  }
  return next as unknown as TournamentSettings;
}

/** Whether the event tracks archetypes at all. */
export function decksEnabled(settings: TournamentSettings): boolean {
  return settings.deckVisibility !== 'off';
}

/** Whether the public may see players' archetypes now. */
export function decksVisible(settings: TournamentSettings): boolean {
  return settings.deckVisibility === 'always' || (settings.deckVisibility === 'after' && settings.finished);
}

export interface TournamentView {
  code: string;
  mode: TournamentMode;
  version: number;
  updatedAt: number;
  tournament: Tournament;
  pending: PendingResult[];
  /** Each public key's age division, since the birth dates it comes from stay private. */
  divisions: Record<string, Division>;
  /** Each public key's archetype label, when the organizer's deck visibility allows. */
  decks: Record<string, string>;
  settings: TournamentSettings;
  viewer: Viewer;
}

export interface Viewer {
  role: 'owner' | 'staff' | null;
  me: string | null;
  signedIn: boolean;
}

/**
 * The public view as it is published to R2 on every change, for anyone to
 * read: the same as the API's answer without the part about who is asking.
 * The page reads who it is once from the API and polls this file after, so a
 * room full of players refreshing costs the functions nothing.
 */
export type PublishedView = Omit<TournamentView, 'viewer'>;

/** Where an event's published view lives, in the bucket and under the data origin. */
export const publishedViewKey = (code: string): string => `tournaments/v1/${code}.json`;

/** POP ID to public key, adding keys for players seen for the first time. Keys never change once given. */
export function assignKeys(tournament: Tournament, keys: Record<string, string>): Record<string, string> {
  const next = { ...keys };
  let counter = Object.keys(next).length;
  for (const player of tournament.players) {
    if (!next[player.id]) {
      counter += 1;
      next[player.id] = String(counter);
    }
  }
  return next;
}

function eventSeason(tournament: Tournament, now: number): number {
  return seasonOf(parseTomDate(tournament.info.startDate) ?? new Date(now));
}

/** The public copy of the tournament, its players under `keys` (see assignKeys). */
export function publicTournament(tournament: Tournament, keys: Record<string, string>): Tournament {
  const key = (id: string) => keys[id] ?? id;
  const pods: Pod[] = tournament.pods.map(pod => ({
    ...pod,
    playerIds: pod.playerIds.map(key),
    rounds: pod.rounds.map(round => ({
      ...round,
      matches: round.matches.map(match => ({
        ...match,
        p1: key(match.p1),
        p2: match.p2 === null ? null : key(match.p2)
      }))
    }))
  }));
  return {
    info: { ...tournament.info, organizerPopId: '' },
    players: tournament.players.map(player => ({
      ...player,
      id: key(player.id),
      birthDate: '',
      created: '',
      modified: ''
    })),
    pods,
    ...(tournament.combined ? { combined: true } : {})
  };
}

export function publicDivisions(
  tournament: Tournament,
  keys: Record<string, string>,
  now: number
): Record<string, Division> {
  const season = eventSeason(tournament, now);
  return Object.fromEntries(
    tournament.players.map(player => [keys[player.id] ?? player.id, divisionFor(player.birthDate, season)])
  );
}

/** The archetype map under public keys. */
export function publicDecks(decks: Record<string, string>, keys: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(decks).flatMap(([id, label]) => (keys[id] ? [[keys[id], label]] : [])));
}

export function publicPending(pending: readonly PendingResult[], keys: Record<string, string>): PendingResult[] {
  const key = (id: string) => keys[id] ?? id;
  return pending.map(result => ({ ...result, p1: key(result.p1), p2: result.p2 === null ? null : key(result.p2) }));
}

type MatchKey = Pick<PendingResult, 'pod' | 'round' | 'table' | 'p1' | 'p2'>;

function sameMatch(result: PendingResult, key: MatchKey): boolean {
  return (
    result.pod === key.pod &&
    result.round === key.round &&
    result.table === key.table &&
    result.p1 === key.p1 &&
    result.p2 === key.p2
  );
}

/**
 * The pending results still waiting on TOM: a result is dropped once the
 * .tdf has its own for that match, or once the match is gone (re-paired).
 */
export function prunePending(tournament: Tournament, pending: readonly PendingResult[]): PendingResult[] {
  return pending.filter(result => {
    const pod = tournament.pods.find(p => p.category === result.pod);
    const round = pod?.rounds.find(r => r.number === result.round);
    const match = round?.matches.find(m => m.table === result.table && m.p1 === result.p1 && m.p2 === result.p2);
    return match !== undefined && match.outcome === 'pending';
  });
}

/** Records a pending result, replacing any earlier one for the same match; `pending` outcome clears it. */
export function withPending(pending: readonly PendingResult[], result: PendingResult): PendingResult[] {
  const rest = pending.filter(p => !sameMatch(p, result));
  return result.outcome === 'pending' ? rest : [...rest, result];
}

/** The tournament with pending results laid over its open matches, for display and for writing the .tdf. */
export function applyPending(tournament: Tournament, pending: readonly PendingResult[]): Tournament {
  if (pending.length === 0) {
    return tournament;
  }
  return {
    ...tournament,
    pods: tournament.pods.map(pod => ({
      ...pod,
      rounds: pod.rounds.map(round => ({
        ...round,
        matches: round.matches.map(match => {
          const result = pending.find(p =>
            sameMatch(p, { pod: pod.category, round: round.number, table: match.table, p1: match.p1, p2: match.p2 })
          );
          return result && match.outcome === 'pending' ? { ...match, outcome: result.outcome } : match;
        })
      }))
    }))
  };
}
