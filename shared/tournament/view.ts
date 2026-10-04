/**
 * What the public sees of a tournament, and the results the site holds for a
 * TOM-run event until TOM takes them in.
 *
 * The public copy is the same document with the private parts gone: POP IDs
 * become per-event keys, and birth dates, the organizer's ID and TOM's
 * leftovers are dropped. Because it keeps the shape, the page ranks and pairs
 * it with the same shared code the organizer's copy uses.
 */

import { divisionFor, eventSeason } from './divisions.js';
import { SANCTIONED, sanctionedMinutesError } from './structure.js';
import { type PlayerClaim, shortLastNames } from './identify.js';
import type { PlayerProfile } from './profile.js';
import type { PlayerReport } from './reports.js';
import { isOpenMatch, type MatchKey, sameMatch } from './rounds.js';
import type { Division, Outcome, Pod, Tournament, TournamentInfo } from './types.js';

export type TournamentMode = 'swiss' | 'tom';

/** A result entered on the site for a TOM-run event, shown until the .tdf has one. */
export interface PendingResult extends MatchKey {
  outcome: Outcome;
  at: number;
}

/**
 * When the public can see what each player is on. 'off' turns archetypes
 * off for the event altogether: nobody picks one, and no page shows one.
 */
export type DeckVisibility = 'always' | 'after' | 'off';

/**
 * Whether the event takes decklists: 'off' leaves them out altogether (no
 * form for players, no tab for staff); 'open' and 'closed' say whether
 * players can send one now.
 */
export type DecklistMode = 'off' | 'open' | 'closed';

export interface TournamentSettings {
  decklists: DecklistMode;
  deckVisibility: DeckVisibility;
  /** The organizer's own notes for players: venue, prizes, schedule. */
  details: string;
  /** Standard, Expanded, or whatever the organizer calls it. */
  format: string;
  /** Local date and time, YYYY-MM-DDTHH:mm as a datetime-local input gives it; '' until set. */
  startsAt: string;
  /** Set when the organizer closes the event; 'after' decks show from then. */
  finished: boolean;
  /** Write inactivity; does not close reporting or reveal post-event decks. */
  idle: boolean;
  /**
   * A Play! Pokémon event: players are known by Player ID and birth year, and
   * the event exports a .tdf. An unsanctioned one asks for names only.
   */
  sanctioned: boolean;
  /** Players report their own results from the event's page (see shared/tournament/reports.ts). */
  playerReporting: boolean;
  /**
   * The most Swiss rounds the event plans to play; 0 plays the number Play!
   * Pokémon recommends for the attendance. Past it the console offers the top
   * cut and ending the event ahead of another round.
   */
  roundCap: number;
}

export const DEFAULT_SETTINGS: TournamentSettings = {
  decklists: 'off',
  deckVisibility: 'off',
  details: '',
  format: 'Standard',
  startsAt: '',
  finished: false,
  idle: false,
  // Events made before the choice existed asked for Player IDs, so they stay sanctioned.
  sanctioned: true,
  playerReporting: false,
  roundCap: 0
};

export const SETTINGS_LIMITS = { details: 1000, format: 40, archetype: 60, roundCap: 15 } as const;

const VISIBILITIES: readonly DeckVisibility[] = ['always', 'after', 'off'];
const DECKLIST_MODES: readonly DecklistMode[] = ['off', 'open', 'closed'];
const STARTS_AT_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})?$/;

type SettingCheck = (value: unknown) => boolean;

const SETTING_CHECKS: { [K in keyof TournamentSettings]: SettingCheck } = {
  decklists: value => DECKLIST_MODES.includes(value as DecklistMode),
  roundCap: value =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= SETTINGS_LIMITS.roundCap,
  finished: value => typeof value === 'boolean',
  idle: value => typeof value === 'boolean',
  sanctioned: value => typeof value === 'boolean',
  playerReporting: value => typeof value === 'boolean',
  deckVisibility: value => VISIBILITIES.includes(value as DeckVisibility),
  details: value => typeof value === 'string' && value.length <= SETTINGS_LIMITS.details,
  format: value => typeof value === 'string' && value.length <= SETTINGS_LIMITS.format,
  startsAt: value => typeof value === 'string' && STARTS_AT_RE.test(value)
};

/**
 * A change or stored copy in today's words: the open or closed switch
 * decklists had before they could be turned off, as a console loaded before
 * then still sends it, reads as the decklists choice.
 */
function withoutLegacy(body: object): Record<string, unknown> {
  const { decklistsOpen, ...rest } = body as Record<string, unknown>;
  return typeof decklistsOpen === 'boolean' && rest.decklists === undefined
    ? { ...rest, decklists: decklistsOpen ? 'open' : 'closed' }
    : { ...rest, ...(decklistsOpen === undefined ? {} : { decklistsOpen }) };
}

/** A settings change out of a request body, laid over `current`; null when any field is malformed. */
export function readSettings(body: unknown, current: TournamentSettings): TournamentSettings | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(withoutLegacy(body))) {
    const check = Object.hasOwn(SETTING_CHECKS, key) ? SETTING_CHECKS[key as keyof TournamentSettings] : undefined;
    if (!check?.(value)) {
      return null;
    }
    next[key] = value;
  }
  return next as unknown as TournamentSettings;
}

/**
 * Why a settings change would leave a sanctioned event invalid (see
 * SANCTIONED), or null: a cap under three Swiss rounds, or turning a Swiss
 * event with short rounds sanctioned. Only what the change itself sets is
 * judged, so an event stored before these checks can still be changed and
 * ended.
 */
export function sanctionedSettingsError(
  change: object,
  current: TournamentSettings,
  next: TournamentSettings,
  info: Pick<TournamentInfo, 'roundTime' | 'finalsRoundTime'>
): string | null {
  const touches = (key: keyof TournamentSettings) => Object.hasOwn(change, key);
  const capped = next.roundCap > 0 && next.roundCap < SANCTIONED.swissRounds;
  if (next.sanctioned && capped && (touches('roundCap') || touches('sanctioned'))) {
    return `A sanctioned event plays at least ${SANCTIONED.swissRounds} Swiss rounds`;
  }
  return next.sanctioned && !current.sanctioned ? sanctionedMinutesError(info) : null;
}

/**
 * Settings as stored, laid over the defaults. Events stored before decklists
 * could be turned off kept an open or closed switch; they keep the tab.
 */
export function storedSettings(stored: Record<string, unknown>): TournamentSettings {
  const { decklistsOpen: _old, ...current } = withoutLegacy(stored);
  return { ...DEFAULT_SETTINGS, ...(current as Partial<TournamentSettings>) };
}

/** Whether players can send a decklist now. */
export function decklistsOpen(settings: Pick<TournamentSettings, 'decklists'>): boolean {
  return settings.decklists === 'open';
}

/** Whether players are known by Player ID and birth year: a TOM event always is. */
export function isSanctioned(event: { mode: TournamentMode; settings: TournamentSettings }): boolean {
  return event.mode === 'tom' || event.settings.sanctioned;
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
  /** Results players reported that are not settled yet, so a player sees where theirs stands. */
  reports: PlayerReport[];
  /** Each public key's age division, since the birth dates it comes from stay private. */
  divisions: Record<string, Division>;
  /** Each public key's archetype label, when the organizer's deck visibility allows. */
  decks: Record<string, string>;
  settings: TournamentSettings;
  viewer: Viewer;
}

export interface Viewer {
  role: 'owner' | 'staff' | null;
  /** The viewer's public key in the event, when their account is one of its players. */
  me: string | null;
  /** How the account is that player: its POP ID at a sanctioned event, or its Claim at an unsanctioned one. */
  via: 'pop' | 'claim' | null;
  /**
   * What that player answers "Which player are you?" with: the POP ID, or at
   * an unsanctioned event the full name the public copy shortens. A device
   * that never asked reports as the player with it.
   */
  claim?: PlayerClaim;
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

/**
 * The public copy of the tournament, its players under `keys` (see
 * assignKeys). With `shortNames`, as for an unsanctioned event, last names go
 * out shortened (see shortLastNames).
 */
export function publicTournament(tournament: Tournament, keys: Record<string, string>, shortNames = false): Tournament {
  const key = (id: string) => keys[id] ?? id;
  const short = shortNames ? shortLastNames(tournament.players) : null;
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
    // Field by field, so a field added to Player stays private until it is named here:
    // a fixed table, for one, is an accommodation, not the room's business.
    players: tournament.players.map(player => ({
      id: key(player.id),
      firstName: player.firstName,
      lastName: short?.get(player.id) ?? player.lastName,
      birthDate: '',
      droppedAfter: player.droppedAfter,
      ...(player.disqualified ? { disqualified: true as const } : {}),
      ...(player.late ? { late: true } : {}),
      created: '',
      modified: ''
    })),
    pods
  };
}

export function publicDivisions(
  tournament: Tournament,
  keys: Record<string, string>,
  now: number
): Record<string, Division> {
  const season = eventSeason(tournament, new Date(now));
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

/**
 * The pending results still waiting on TOM: a result is dropped once the
 * .tdf has its own for that match, or once the match is gone (re-paired).
 */
export function prunePending(tournament: Tournament, pending: readonly PendingResult[]): PendingResult[] {
  return pending.filter(result => isOpenMatch(tournament, result));
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

// What the staff endpoints answer with, beyond the public view: declared once, so the
// functions that send these and the pages that read them cannot drift apart.

/** The organizer owns the event; staff joined through its invite link. */
export type Role = 'owner' | 'staff';

/** One of a user's events, as their list shows it. */
export interface TournamentSummary {
  code: string;
  mode: TournamentMode;
  name: string;
  role: Role;
  players: number;
  /** MM/DD/YYYY, as TOM writes it; '' when unset. */
  startDate: string;
  finished: boolean;
  /** Rounds the event has paired across its pods: 0 before round 1. */
  rounds: number;
  updatedAt: number;
}

/** The whole event, as its staff's console holds it. */
export interface Manage {
  code: string;
  mode: TournamentMode;
  version: number;
  updatedAt: number;
  tournament: Tournament;
  pending: PendingResult[];
  reports: PlayerReport[];
  settings: TournamentSettings;
  /** POP ID to archetype label. */
  decks: Record<string, string>;
  role: Role;
  /** The invite link's token, for the organizer alone. */
  staffToken: string | null;
}

export interface StaffMember {
  id: string;
  name: string;
  /** When they joined through the invite link; null for anyone who joined before that was kept. */
  joinedAt: number | null;
}

/** A submitted decklist, as staff and its own submitter read it. */
export interface Decklist extends PlayerProfile {
  deck: string;
  /** The player's own word for their deck, until staff apply it. */
  archetype: string | null;
  submittedAt: number;
  /** What the parser found wrong with the list. */
  problems: string[];
  /** Whether the player is on the event's player list yet. */
  registered: boolean;
  /** Submitting this list is what added the player to the event. */
  fromList: boolean;
  /** Only the device that sent it can replace it, until staff unlock it. */
  locked: boolean;
}

/** Whether submitting put the player on the event's list, found them on it, or could not add them. */
export type Registration = 'added' | 'matched' | 'not-added';
