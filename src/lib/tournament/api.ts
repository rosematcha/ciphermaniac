/**
 * The tournament and account endpoints, as typed calls. Every call reports
 * failure as a thrown ApiError carrying the server's message, which the pages
 * show as-is: the functions word their errors for people.
 */

import type { Command } from '../../../shared/tournament/commands';
import { tomDateTime } from '../../../shared/tournament/divisions';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import type { Tournament } from '../../../shared/tournament/types';
import type {
  PendingResult,
  TournamentMode,
  TournamentSettings,
  TournamentView
} from '../../../shared/tournament/view';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
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
  updatedAt: number;
}

export interface Manage {
  code: string;
  mode: TournamentMode;
  version: number;
  updatedAt: number;
  tournament: Tournament;
  pending: PendingResult[];
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
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const fetchSession = () => call<Session>('/api/me');

export const saveProfile = (profile: PlayerProfile) => call<{ user: Me }>('/api/me', json('PUT', profile));

export const signOut = () => call<null>('/api/auth/logout', { method: 'POST' });

export function signInUrl(provider: Provider, next: string, name?: string): string {
  const query = new URLSearchParams({ next, ...(name ? { name } : {}) });
  return `/api/auth/login/${provider}?${query}`;
}

export const listTournaments = () => call<{ tournaments: TournamentSummary[] }>('/api/tournaments');

export const createSwiss = (name: string, combined: boolean) =>
  call<{ code: string }>('/api/tournaments', json('POST', { mode: 'swiss', name, combined }));

export const createFromTdf = (tournament: Tournament) =>
  call<{ code: string }>('/api/tournaments', json('POST', { mode: 'tom', tournament }));

const base = (code: string) => `/api/tournaments/${encodeURIComponent(code)}`;

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

export const fetchDecklists = (code: string) =>
  call<{ decklists: Decklist[]; mine: Decklist | null }>(`${base(code)}/decklists`);

export const submitDecklist = (code: string, deck: string, profile: PlayerProfile, archetype: string | null) =>
  call<{ decklist: Decklist }>(`${base(code)}/decklists`, json('PUT', { deck, profile, archetype }));

export const withdrawDecklist = (code: string) => call<null>(`${base(code)}/decklists`, { method: 'DELETE' });
