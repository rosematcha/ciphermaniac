/**
 * The checks every tournament route starts with: is the database bound, is
 * the code real, who is asking, and may they do this.
 */

import {
  decksEnabled,
  decksVisible,
  isSanctioned,
  type Manage,
  publicDecks,
  publicDivisions,
  publicPending,
  publicTournament,
  type PublishedView,
  type Role,
  type TournamentView,
  type Viewer
} from '../../../shared/tournament/view.js';
import { birthYear } from '../../../shared/tournament/divisions.js';
import { publicReports } from '../../../shared/tournament/reports.js';
import { jsonError, jsonResponse } from '../api/responses.js';
import { type Context, param, sameOrigin } from '../auth/env.js';
import type { User } from '../auth/session.js';
import type { D1Like } from '../types.js';
import { isCode, type OpenOptions, openTournament, type TournamentRow } from './store.js';

export const PRIVATE = { cacheControl: 'no-store', cors: false } as const;

/** A .tdf's worth of JSON with room to spare; a regional is well under a megabyte. */
export const MAX_TOURNAMENT_BYTES = 3 * 1024 * 1024;

export interface Access {
  db: D1Like;
  user: User | null;
  row: TournamentRow;
  role: Role | null;
  /** The player the account's Claim makes it here, when the route asked for it (see openTournament). */
  claimed: string | null;
}

/** The tournament and who is asking; a Response when either cannot be had. */
export async function open(context: Context<'code'>, options: OpenOptions = {}): Promise<Access | Response> {
  const db = context.env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('Tournaments are not available', 503);
  }
  const code = codeOf(context);
  const opened = isCode(code) ? await openTournament(db, code, context.request, options) : null;
  return opened ? { db, ...opened } : jsonError('No such tournament', 404);
}

/** The event code a route names, as codes are stored. */
export const codeOf = (context: Context<'code'>): string => param(context.params.code).toUpperCase();

/**
 * What a poll names: the event, and the version the asker already holds
 * (`?since=`). Null when it names no version or no event, and the whole
 * answer is due.
 */
export function pollOf(context: Context<'code'>): { db: D1Like; code: string; since: number } | null {
  const since = Number(new URL(context.request.url).searchParams.get('since'));
  const db = context.env.TOURNAMENT_DB;
  const code = codeOf(context);
  return since && db && isCode(code) ? { db, code, since } : null;
}

/** An event opened by one of its staff. */
export type StaffAccess = Access & { role: Role };

/** As `open`, for a change only staff may make. */
export async function openForStaff(context: Context<'code'>): Promise<StaffAccess | Response> {
  if (!sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  if (!access.user) {
    return jsonError('Sign in first', 401);
  }
  const { role } = access;
  return role ? { ...access, role } : jsonError('Only this event’s staff can do that', 403);
}

/** As `openForStaff`, for what only the organizer may do; `refusal` tells anyone else so. */
export async function openForOwner(
  context: Context<'code'>,
  refusal = 'Only the organizer can do that'
): Promise<StaffAccess | Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  return access.role === 'owner' ? access : jsonError(refusal, 403);
}

/** What anyone may read about the event: what is published to R2, and the base of every API view. */
export function publicViewOf(row: TournamentRow): PublishedView {
  return {
    code: row.code,
    mode: row.mode,
    version: row.version,
    updatedAt: row.updatedAt,
    tournament: publicTournament(row.tournament, row.keys, !isSanctioned(row)),
    pending: publicPending(row.pending, row.keys),
    reports: publicReports(row.reports, row.keys),
    divisions: publicDivisions(row.tournament, row.keys, Date.now()),
    decks: decksVisible(row.settings) ? publicDecks(row.decks, row.keys) : {},
    settings: row.settings
  };
}

const NOT_PLAYING = { me: null, via: null } as const;

/**
 * Which player the viewer is, how the page knows, and what the player says
 * to report: at a sanctioned event the one whose POP ID the account holds,
 * at an unsanctioned one the one its Claim names, by their full name.
 */
function identityOf(access: Access): Pick<Viewer, 'me' | 'via' | 'claim'> {
  const { row, user, claimed } = access;
  if (isSanctioned(row)) {
    const popId = user?.popId ?? '';
    const listed = row.tournament.players.some(player => player.id === popId);
    const year = birthYear(user?.birthDate ?? '');
    const claim = { popId, ...(year === null ? {} : { birthYear: String(year) }) };
    return listed ? { me: row.keys[popId] ?? null, via: 'pop', claim } : NOT_PLAYING;
  }
  const player = row.tournament.players.find(candidate => candidate.id === claimed);
  const key = player && row.keys[player.id];
  return key
    ? { me: key, via: 'claim', claim: { lastName: player.lastName, firstName: player.firstName } }
    : NOT_PLAYING;
}

/** What the event's public page reads from the API, shaped for the viewer: staff see decks before the public does. */
export function viewOf(access: Access): TournamentView {
  const { row, user, role } = access;
  const decks = role && decksEnabled(row.settings) ? publicDecks(row.decks, row.keys) : undefined;
  return {
    ...publicViewOf(row),
    ...(decks ? { decks } : {}),
    viewer: { role, ...identityOf(access), signedIn: user !== null }
  };
}

/** Staff get the whole document, pending results and invite token included. */
export function manageView(access: StaffAccess): Manage {
  const { row, role } = access;
  return {
    code: row.code,
    mode: row.mode,
    version: row.version,
    updatedAt: row.updatedAt,
    tournament: row.tournament,
    pending: row.pending,
    reports: row.reports,
    settings: row.settings,
    decks: row.decks,
    role,
    staffToken: role === 'owner' ? row.staffToken : null,
    store: row.storeId
  };
}

/** Event data is shared by link, not for search engines to list. */
export function privateJson(body: unknown, status = 200): Response {
  return jsonResponse(body, { ...PRIVATE, status, headers: { 'X-Robots-Tag': 'noindex' } });
}
