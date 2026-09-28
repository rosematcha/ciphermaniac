/**
 * The checks every tournament route starts with: is the database bound, is
 * the code real, who is asking, and may they do this.
 */

import {
  decksEnabled,
  decksVisible,
  isSanctioned,
  publicDecks,
  publicDivisions,
  publicPending,
  publicTournament,
  type PublishedView,
  type TournamentView
} from '../../../shared/tournament/view.js';
import { publicReports } from '../../../shared/tournament/reports.js';
import { jsonError, jsonResponse } from '../api/responses.js';
import { type Context, param, sameOrigin } from '../auth/env.js';
import { currentUser, type User } from '../auth/session.js';
import type { D1Like } from '../types.js';
import { isCode, loadTournament, type Role, roleOf, type TournamentRow } from './store.js';

export const PRIVATE = { cacheControl: 'no-store', cors: false } as const;

/** A .tdf's worth of JSON with room to spare; a regional is well under a megabyte. */
export const MAX_TOURNAMENT_BYTES = 3 * 1024 * 1024;

export interface Access {
  db: D1Like;
  user: User | null;
  row: TournamentRow;
  role: Role | null;
}

/** The tournament and who is asking; a Response when either cannot be had. */
export async function open(context: Context<'code'>): Promise<Access | Response> {
  const db = context.env.TOURNAMENT_DB;
  if (!db) {
    return jsonError('Tournaments are not available', 503);
  }
  const code = param(context.params.code).toUpperCase();
  const row = isCode(code) ? await loadTournament(db, code) : null;
  if (!row) {
    return jsonError('No such tournament', 404);
  }
  const user = await currentUser(db, context.request);
  return { db, user, row, role: await roleOf(db, row, user) };
}

/** As `open`, for a change only staff may make. */
export async function openForStaff(context: Context<'code'>): Promise<Access | Response> {
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
  return access.role ? access : jsonError('Only this event’s staff can do that', 403);
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

/** What the event's public page reads from the API, shaped for the viewer: staff see decks before the public does. */
export function viewOf(access: Access): TournamentView {
  const { row, user, role } = access;
  const me = user?.popId ? (row.keys[user.popId] ?? null) : null;
  const decks = role && decksEnabled(row.settings) ? publicDecks(row.decks, row.keys) : undefined;
  return {
    ...publicViewOf(row),
    ...(decks ? { decks } : {}),
    viewer: { role, me, signedIn: user !== null }
  };
}

/** Staff get the whole document, pending results and invite token included. */
export function manageView(access: Access): Record<string, unknown> {
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
    staffToken: role === 'owner' ? row.staffToken : null
  };
}

export function privateJson(body: unknown, status = 200): Response {
  return jsonResponse(body, { ...PRIVATE, status });
}
