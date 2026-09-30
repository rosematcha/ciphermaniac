/**
 * The tournament and account endpoints, as typed calls. Every call reports
 * failure as a thrown ApiError carrying the server's message, which the pages
 * show as-is: the functions word their errors for people.
 */

import type { Command } from '../../../shared/tournament/commands';
import { tomDateTime } from '../../../shared/tournament/divisions';
import type { PlayerClaim } from '../../../shared/tournament/identify';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import type { PlayerResult, ShownMatch } from '../../../shared/tournament/reports';
import type { Tournament } from '../../../shared/tournament/types';
import {
  type Decklist,
  type Manage,
  type PendingResult,
  type PublishedView,
  publishedViewKey,
  type Registration,
  type StaffMember,
  type TournamentSettings,
  type TournamentSummary,
  type TournamentView
} from '../../../shared/tournament/view';
import { R2_ORIGIN } from '../constants';

export type { Decklist, Manage, Registration, StaffMember, TournamentSummary };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The server's whole answer, for the few errors that say more than a message. */
    readonly body: Record<string, unknown> | null = null
  ) {
    super(message);
  }
}

/** What a failed call says, for the pages to show as-is. */
export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export interface Me {
  id: string;
  name: string;
  avatar: string | null;
  popId: string | null;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  providers: Provider[];
}

export type Provider = 'google' | 'discord' | 'dev';

export interface Session {
  user: Me | null;
  providers: Provider[];
}

/** Who a list belongs to, as a query string: the Player ID, or the name at an unsanctioned event. */
function listOwner(profile: Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>, token?: string): string {
  // All three go: the server reads the Player ID at a sanctioned event and the name at any other.
  const query = new URLSearchParams({ popId: profile.popId, firstName: profile.firstName, lastName: profile.lastName });
  if (token) {
    query.set('token', token);
  }
  return query.toString();
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null;
    throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status, body);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const fetchSession = () => call<Session>('/api/me');

export const saveProfile = (profile: PlayerProfile) => call<{ user: Me }>('/api/me', json('PUT', profile));
export const saveAccountName = (name: string) => call<{ user: Me }>('/api/me', json('PATCH', { name }));

export const signOut = () => call<null>('/api/auth/logout', { method: 'POST' });

export function signInUrl(provider: Provider, next: string, name?: string): string {
  const query = new URLSearchParams({ next, ...(name ? { name } : {}) });
  return `/api/auth/login/${provider}?${query}`;
}

export function linkUrl(provider: Exclude<Provider, 'dev'>): string {
  return `/api/auth/login/${provider}?${new URLSearchParams({ next: '/settings', link: '1' })}`;
}

export const listTournaments = () => call<{ tournaments: TournamentSummary[] }>('/api/tournaments');

/** What the setup asks before a Swiss event starts; the settings left out keep their defaults. */
export interface SwissSetup {
  name: string;
  combined: boolean;
  roundTime?: number;
  settings?: Partial<TournamentSettings>;
}

export const createSwiss = (setup: SwissSetup) =>
  call<{ code: string }>('/api/tournaments', json('POST', { mode: 'swiss', ...setup }));

export const createFromTdf = (tournament: Tournament, settings?: Partial<TournamentSettings>) =>
  call<{ code: string }>('/api/tournaments', json('POST', { mode: 'tom', tournament, settings }));

const base = (code: string) => `/api/tournaments/${encodeURIComponent(code)}`;

/**
 * The view published to R2 (see PublishedView), or null when it cannot be
 * read: not published yet, or a data origin that does not carry it. Revalidated
 * rather than cached, so a poll sees the edge's copy, which is seconds old.
 */
export function fetchPublished(code: string): Promise<PublishedView | null> {
  const started = early?.code === code ? early.read : null;
  early = null;
  return started ?? readPublished(code);
}

async function readPublished(code: string): Promise<PublishedView | null> {
  const response = await fetch(`${R2_ORIGIN}/${publishedViewKey(code)}`, { cache: 'no-cache' });
  return response.ok ? ((await response.json()) as PublishedView) : null;
}

let early: { code: string; read: Promise<PublishedView | null> } | null = null;

/**
 * Starts reading an event's published view while the code of the page that
 * shows it is still loading, so the two arrive side by side; the page's first
 * `fetchPublished` takes this read.
 */
export function preloadPublished(code: string): void {
  early = { code, read: readPublished(code).catch(() => null) };
}

/** The public view, or null when it has not changed since `since`. */
export const fetchView = (code: string, since?: number) =>
  call<TournamentView | null>(since ? `${base(code)}?since=${since}` : base(code));

/**
 * The console's copy, or null when it has not changed since `since`. The poll
 * can settle players' reports, so it carries the venue's clock as a command
 * does.
 */
export function fetchManage(code: string, since?: number) {
  const query = new URLSearchParams({ localTime: tomDateTime(new Date()) });
  if (since) {
    query.set('since', String(since));
  }
  return call<Manage | null>(`${base(code)}/manage?${query}`);
}

/** Sends one command, stamped with the venue's clock (see functions/lib/tournaments/commandContext.ts). */
export const sendCommand = (code: string, command: Command) =>
  call<Manage>(`${base(code)}/commands`, json('POST', { command, localTime: tomDateTime(new Date()) }));

/** Sends the parsed .tdf, taken only if the site still holds the copy `revision` names (see shared/tournament/revision.ts). */
export const syncTournament = (code: string, tournament: Tournament, revision: string) =>
  call<{ version: number; pending: PendingResult[]; revision: string }>(
    `${base(code)}/sync`,
    json('PUT', { tournament, base: revision })
  );

export const setDeck = (code: string, playerId: string, archetype: string | null) =>
  call<Manage>(`${base(code)}/decks`, json('PUT', { playerId, archetype }));

export const saveSettings = (code: string, settings: Partial<TournamentSettings>) =>
  call<Manage>(`${base(code)}/settings`, json('PUT', settings));

export const joinStaff = (code: string, token: string) =>
  call<{ role: string }>(`${base(code)}/staff`, json('POST', { token }));

export const rotateStaffToken = (code: string) => call<Manage>(`${base(code)}/staff`, json('POST', { rotate: true }));

export const deleteTournament = (code: string) => call<null>(base(code), { method: 'DELETE' });

const DEVICE_KEY = 'cm-device';

/**
 * This browser's own ID, made once and kept: the server tells two reports
 * from one device apart from reports from two, and records which device
 * reports for a player. Without storage (a test, a locked-down browser) each
 * call counts as its own device.
 */
function deviceId(): string {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(DEVICE_KEY);
  if (stored) {
    return stored;
  }
  const made = crypto.randomUUID();
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DEVICE_KEY, made);
  }
  return made;
}

/** What the report endpoint says of the asker: the player's public key, the event, and whether this device reports for them. */
export interface PlayerAnswer {
  key: string | null;
  view: PublishedView;
  /** The token to keep, when this device just became the one that reports for the player. */
  reportToken?: string;
  reporter?: boolean;
}

/** A player says who they are; their public key, to follow their pairings with, and the event as it stands. */
export const identifyPlayer = (code: string, claim: PlayerClaim, reportToken?: string | null) =>
  call<PlayerAnswer>(
    `${base(code)}/report`,
    json('POST', { ...claim, reportToken, device: deviceId(), localTime: tomDateTime(new Date()) })
  );

/** A player reports the match their page shows, with the token of the device that reports for them. */
export const reportAsPlayer = (
  code: string,
  claim: PlayerClaim,
  report: { result: PlayerResult; match: ShownMatch },
  reportToken: string | null
) =>
  call<PlayerAnswer>(
    `${base(code)}/report`,
    json('POST', { ...claim, ...report, reportToken, device: deviceId(), localTime: tomDateTime(new Date()) })
  );

/** Staff let another device report for a player, as when they change phones. */
export const releaseReporter = (code: string, playerId: string) =>
  call<null>(`${base(code)}/report?${new URLSearchParams({ player: playerId }).toString()}`, { method: 'DELETE' });

/** Everyone the invite link let onto the staff; the organizer's to see. */
export const fetchStaff = (code: string) => call<{ staff: StaffMember[] }>(`${base(code)}/staff`);

export const removeStaff = (code: string, userId: string) =>
  call<{ staff: StaffMember[] }>(`${base(code)}/staff?${new URLSearchParams({ user: userId }).toString()}`, {
    method: 'DELETE'
  });

/** Every list, for staff. */
export const fetchDecklists = (code: string) =>
  call<{ decklists: Decklist[]; mine: Decklist | null }>(`${base(code)}/decklists`);

/** A player's own list, by the details it was sent under and the token the sending device kept. */
export const fetchMyDecklist = (
  code: string,
  owner: Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>,
  token: string
) => call<{ mine: Decklist | null }>(`${base(code)}/decklists?${listOwner(owner, token)}`);

/** Sends a list; replacing one takes the token of the device that sent it. */
export const submitDecklist = (
  code: string,
  list: { deck: string; profile: PlayerProfile; archetype: string | null; token: string | null }
) =>
  call<{ decklist: Decklist; registration: Registration; token: string }>(
    `${base(code)}/decklists`,
    json('PUT', { ...list, localTime: tomDateTime(new Date()) })
  );

export const withdrawDecklist = (
  code: string,
  owner: Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>,
  token: string | null
) => call<null>(`${base(code)}/decklists?${listOwner(owner, token ?? undefined)}`, { method: 'DELETE' });

/** Staff unlock a list, so the player can send it again from another device. */
export const unlockDecklist = (code: string, owner: Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>) =>
  call<null>(`${base(code)}/decklists?${listOwner(owner)}`, { method: 'PATCH' });
