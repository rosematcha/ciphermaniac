/**
 * The tournament and account endpoints, as typed calls. Every call reports
 * failure as a thrown ApiError carrying the server's message, which the pages
 * show as-is: the functions word their errors for people.
 */

import type { ExportPart, WipePart } from '../../../shared/accounts/myData';
import type { AccountRole } from '../../../shared/accounts/roles';
import type { HistoryEntry, MyStore, PublicProfile } from '../../../shared/accounts/types';
import type { Command } from '../../../shared/tournament/commands';
import { tomDateTime } from '../../../shared/tournament/divisions';
import type { PlayerClaim } from '../../../shared/tournament/identify';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import type { PlayerResult, ShownMatch } from '../../../shared/tournament/reports';
import type { EventType, PodCategory, Tournament } from '../../../shared/tournament/types';
import {
  type Decklist,
  type Manage,
  type PublishedView,
  publishedViewKey,
  type Registration,
  type StaffMember,
  type TournamentSettings,
  type TournamentSummary,
  type TournamentView
} from '../../../shared/tournament/view';
import { R2_ORIGIN } from '../constants';

export type { Decklist, HistoryEntry, Manage, PublicProfile, Registration, StaffMember, TournamentSummary };

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
  /** What the site calls the account: its real name, or its username without one. */
  name: string;
  handle: string;
  avatar: string | null;
  popId: string | null;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  role: AccountRole | null;
  /** Whether the account's history is public at /u/<handle>. */
  publicProfile: boolean;
  /** Which name the public profile shows. */
  profileName: 'real' | 'handle';
  providers: Provider[];
  /** The stores the account belongs to, and as what. */
  stores: MyStore[];
}

export type Provider = 'google' | 'discord' | 'dev' | 'clerk';
export type OAuthProvider = 'google' | 'discord';

export interface Session {
  user: Me | null;
  providers: Provider[];
  /** Clerk's publishable key, when username and password sign-in is offered. */
  clerkKey?: string | null;
}

/** What the sign-in box needs of the session: the ways in, and Clerk's key when username sign-in is one. */
export type SignInOffer = Pick<Session, 'providers' | 'clerkKey'>;

/** Who a list belongs to, as a query string: the Player ID, or the name at an unsanctioned event. */
function listOwner(profile: Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>, token?: string): string {
  // All three go: the server reads the Player ID at a sanctioned event and the name at any other.
  const query = new URLSearchParams({ popId: profile.popId, firstName: profile.firstName, lastName: profile.lastName });
  if (token) {
    query.set('token', token);
  }
  return query.toString();
}

/** A call that answered ok, or the ApiError it failed with. */
async function answer(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(15_000),
    credentials: 'same-origin',
    headers: typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : undefined
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null;
    throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status, body);
  }
  return response;
}

/** One call to the functions: a JSON body (see `json`) is sent as JSON; a file goes as it is. */
export async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await answer(path, init);
  return (response.status === 204 ? null : await response.json()) as T;
}

export const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const fetchSession = () => call<Session>('/api/me');

export const saveProfile = (profile: PlayerProfile) => call<{ user: Me }>('/api/me', json('PUT', profile));
export const saveHandle = (handle: string) => call<{ user: Me }>('/api/me', json('PATCH', { handle }));

/** The parts asked for of what the site keeps on the account, as a Markdown file and the name it saves under. */
export async function exportData(parts: readonly ExportPart[]): Promise<{ file: Blob; name: string }> {
  const response = await answer(`/api/me/data?parts=${parts.join(',')}`, {});
  const name = /filename="([^"]+)"/u.exec(response.headers.get('Content-Disposition') ?? '')?.[1];
  return { file: await response.blob(), name: name ?? 'ciphermaniac.md' };
}

/** Wipes the parts asked for; a 409 carries a DataRefusal (shared/accounts/myData.ts) in its body. */
export const wipeData = (parts: readonly WipePart[]) => call<{ user: Me }>('/api/me/data', json('POST', { parts }));

/** Deletes the account, confirmed by its username typed out; a 409 carries a DataRefusal. */
export const deleteAccount = (confirm: string) => call<null>('/api/me', json('DELETE', { confirm }));

export const signOut = () => call<null>('/api/auth/logout', { method: 'POST' });

/** The signed-in account's History, newest first. */
export const fetchHistory = () => call<{ entries: HistoryEntry[] }>('/api/history');

/** A public profile by its username; not found while its account keeps it off. */
export const fetchProfile = (handle: string) => call<PublicProfile>(`/api/profiles/${encodeURIComponent(handle)}`);

/** Turns the account's public profile on or off; its address stays its username either way. */
export const setPublicProfile = (on: boolean) => call<{ user: Me }>('/api/me', json('PATCH', { publicProfile: on }));

/** Which name the public profile shows. */
export const setProfileName = (profileName: Me['profileName']) =>
  call<{ user: Me }>('/api/me', json('PATCH', { profileName }));

export function signInUrl(provider: Provider, next: string, name?: string): string {
  const query = new URLSearchParams({ next, ...(name ? { name } : {}) });
  return `/api/auth/login/${provider}?${query}`;
}

export function linkUrl(provider: OAuthProvider): string {
  return `/api/auth/login/${provider}?${new URLSearchParams({ next: '/settings', link: '1' })}`;
}

export const listTournaments = () => call<{ tournaments: TournamentSummary[] }>('/api/tournaments');

/** What the setup asks before a Swiss event starts; the settings left out keep their defaults. */
export interface SwissSetup {
  name: string;
  roundTime?: number;
  eventType?: EventType;
  settings?: Partial<TournamentSettings>;
  /** The store that runs it; null for the account's own. */
  store?: string | null;
  /** The organizer's own date, for an event set to no start time. */
  today?: string;
  /** The store's pokemon.com listing it starts from, by sanction ID. */
  sanctionId?: string;
}

export const createSwiss = (setup: SwissSetup) =>
  call<{ code: string }>('/api/tournaments', json('POST', { mode: 'swiss', ...setup }));

/** A TOM event, which only a store runs. */
export const createFromTdf = (tournament: Tournament, store: string | null, settings?: Partial<TournamentSettings>) =>
  call<{ code: string }>('/api/tournaments', json('POST', { mode: 'tom', tournament, settings, store }));

const base = (code: string) => `/api/tournaments/${encodeURIComponent(code)}`;

/**
 * The view published to R2 (see PublishedView), or null when it cannot be
 * read: not published yet, or a data origin that does not carry it. Revalidated
 * rather than cached, so a poll sees the edge's copy, which is seconds old; a
 * page reading an event that no longer changes may let the browser's cache
 * answer (`cache: 'default'`).
 */
export function fetchPublished(code: string, cache: RequestCache = 'no-cache'): Promise<PublishedView | null> {
  const started = early?.code === code ? early.read : null;
  early = null;
  return started ?? readPublished(code, cache);
}

async function readPublished(code: string, cache: RequestCache = 'no-cache'): Promise<PublishedView | null> {
  const response = await fetch(`${R2_ORIGIN}/${publishedViewKey(code)}`, {
    cache,
    signal: AbortSignal.timeout(15_000)
  });
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

/** A TOM event's next round, paired over the copy `revision` names, for the console to write into TOM's file. */
export const pairNextRound = (code: string, pod: PodCategory, revision: string) =>
  call<{ tournament: Tournament }>(
    `${base(code)}/pairing`,
    json('POST', { pod, base: revision, localTime: tomDateTime(new Date()) })
  );

/** How long a sync may take before the link gives up on it and tries again. */
export const SYNC_TIMEOUT_MS = 30_000;

/**
 * Sends the parsed .tdf, taken only if the site still holds the copy `revision` names (see shared/tournament/revision.ts).
 * A sync that hangs is abandoned, so the link following TOM's file is not stuck waiting on it; one that landed
 * anyway is the copy the site holds when the link sends again, which the server takes as a match.
 */
export async function syncTournament(code: string, tournament: Tournament, revision: string) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new ApiError('The site took too long to answer', 0)),
    SYNC_TIMEOUT_MS
  );
  try {
    return await call<Manage & { revision: string }>(`${base(code)}/sync`, {
      ...json('PUT', { tournament, base: revision }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

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
  /** Whether the player is the signed-in account's at this event. */
  linked?: boolean;
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

/** The signed-in account stops being its player at the event: its Claim, or the row its POP ID made. */
export const leaveEvent = (code: string) => call<null>(`${base(code)}/claim`, { method: 'DELETE' });

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
