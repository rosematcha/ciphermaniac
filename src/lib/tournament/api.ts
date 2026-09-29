/**
 * The tournament and account endpoints, as typed calls. Every call reports
 * failure as a thrown ApiError carrying the server's message, which the pages
 * show as-is: the functions word their errors for people.
 */

import type { Command } from '../../../shared/tournament/commands';
import { tomDateTime } from '../../../shared/tournament/divisions';
import type { PlayerClaim } from '../../../shared/tournament/identify';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import type { PlayerReport, PlayerResult } from '../../../shared/tournament/reports';
import type { Tournament } from '../../../shared/tournament/types';
import {
  type PendingResult,
  type PublishedView,
  publishedViewKey,
  type TournamentMode,
  type TournamentSettings,
  type TournamentView
} from '../../../shared/tournament/view';
import { R2_ORIGIN } from '../constants';

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

export interface TournamentSummary {
  code: string;
  mode: TournamentMode;
  name: string;
  role: 'owner' | 'staff';
  players: number;
  startDate: string;
  finished: boolean;
  updatedAt: number;
}

export interface Manage {
  code: string;
  mode: TournamentMode;
  version: number;
  updatedAt: number;
  tournament: Tournament;
  pending: PendingResult[];
  reports: PlayerReport[];
  settings: TournamentSettings;
  decks: Record<string, string>;
  role: 'owner' | 'staff';
  staffToken: string | null;
}

export interface Decklist extends PlayerProfile {
  deck: string;
  /** The player's own word for their deck, until staff apply it. */
  archetype: string | null;
  submittedAt: number;
  problems: string[];
  registered: boolean;
  /** Submitting this list is what added the player to the event. */
  fromList: boolean;
}

/** Whether submitting put the player on the event's list, found them on it, or could not add them. */
export type Registration = 'added' | 'matched' | 'not-added';

/** Who a list belongs to, as a query string: the Player ID, or the name at an unsanctioned event. */
function listOwner(profile: Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>, token?: string): string {
  const query = new URLSearchParams(
    profile.popId ? { popId: profile.popId } : { firstName: profile.firstName, lastName: profile.lastName }
  );
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
export async function fetchPublished(code: string): Promise<PublishedView | null> {
  const response = await fetch(`${R2_ORIGIN}/${publishedViewKey(code)}`, { cache: 'no-cache' });
  return response.ok ? ((await response.json()) as PublishedView) : null;
}

/** The public view, or null when it has not changed since `since`. */
export const fetchView = (code: string, since?: number) =>
  call<TournamentView | null>(since ? `${base(code)}?since=${since}` : base(code));

export const fetchManage = (code: string) => call<Manage>(`${base(code)}/manage`);

/** Sends one command, stamped with the venue's clock (see functions/lib/tournaments/commandContext.ts). */
export const sendCommand = (code: string, command: Command) =>
  call<Manage>(`${base(code)}/commands`, json('POST', { command, localTime: tomDateTime(new Date()) }));

export const syncTournament = (code: string, tournament: Tournament) =>
  call<{ version: number; pending: PendingResult[] }>(`${base(code)}/sync`, json('PUT', tournament));

export const setDeck = (code: string, playerId: string, archetype: string | null) =>
  call<Manage>(`${base(code)}/decks`, json('PUT', { playerId, archetype }));

export const saveSettings = (code: string, settings: Partial<TournamentSettings>) =>
  call<Manage>(`${base(code)}/settings`, json('PUT', settings));

export const joinStaff = (code: string, token: string) =>
  call<{ role: string }>(`${base(code)}/staff`, json('POST', { token }));

export const rotateStaffToken = (code: string) => call<Manage>(`${base(code)}/staff`, json('POST', { rotate: true }));

export const deleteTournament = (code: string) => call<null>(base(code), { method: 'DELETE' });

/** A player says who they are; their public key, to follow their pairings with, and the event as it stands. */
export const identifyPlayer = (code: string, claim: PlayerClaim) =>
  call<{ key: string | null; view: PublishedView }>(
    `${base(code)}/report`,
    json('POST', { ...claim, localTime: tomDateTime(new Date()) })
  );

/** A player reports their current match; the answer carries the event as it now stands. */
export const reportAsPlayer = (code: string, claim: PlayerClaim, result: PlayerResult) =>
  call<{ key: string | null; view: PublishedView }>(
    `${base(code)}/report`,
    json('POST', { ...claim, result, localTime: tomDateTime(new Date()) })
  );

/** Every list, for staff. */
export const fetchDecklists = (code: string) =>
  call<{ decklists: Decklist[]; mine: Decklist | null }>(`${base(code)}/decklists`);

/** A player's own list, by the details it was sent under and the token the sending device kept. */
export const fetchMyDecklist = (
  code: string,
  owner: Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>,
  token: string
) => call<{ mine: Decklist | null }>(`${base(code)}/decklists?${listOwner(owner, token)}`);

export const submitDecklist = (code: string, deck: string, profile: PlayerProfile, archetype: string | null) =>
  call<{ decklist: Decklist; registration: Registration; token: string }>(
    `${base(code)}/decklists`,
    json('PUT', { deck, profile, archetype, localTime: tomDateTime(new Date()) })
  );

export const withdrawDecklist = (code: string, owner: Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>) =>
  call<null>(`${base(code)}/decklists?${listOwner(owner)}`, { method: 'DELETE' });
