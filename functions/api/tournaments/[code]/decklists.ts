/**
 * Decklists submitted ahead of the event. Players need no account: they say
 * who they are the way the rest of the player side does (Player ID, name and
 * birth date at a sanctioned event; first and last name at an unsanctioned
 * one), and that identity keys the list, so submitting again replaces it.
 * This runs on good faith, as the organizer chose: anyone who enters the same
 * details can replace or withdraw the list.
 *
 * GET — staff see every list. A player sees their own with the details they
 * submitted under (query popId / firstName / lastName) and the token the
 * submitting device was given, so a list is not readable by anyone who knows
 * a Player ID; a signed-in player's saved profile works in place of both.
 * PUT — submits or replaces a list while submission is open: { deck,
 * profile, archetype?, localTime? }. A submitter who is not on the event's
 * player list is added to it (a Swiss event still open), marked as added from
 * a list; the answer says whether they were added, matched or not added. The
 * archetype stays on the list until staff apply it. A signed-in submitter's
 * profile is saved to their account, as before.
 * DELETE — withdraws the list under the details in the query.
 */

import { MAX_DECKLIST_CHARS, parseDecklist } from '../../../../shared/tournament/decklist.js';
import { decklistPlayer, nameKey } from '../../../../shared/tournament/identify.js';
import { type PlayerProfile, readProfile } from '../../../../shared/tournament/profile.js';
import { decksEnabled, isSanctioned } from '../../../../shared/tournament/view.js';
import { readJsonBody } from '../../../lib/api/body.js';
import { createRateLimiter } from '../../../lib/api/rateLimiter.js';
import { jsonError } from '../../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../../lib/auth/env.js';
import { type Access, open, privateJson } from '../../../lib/tournaments/access.js';
import { archetypeLabel } from '../../../lib/tournaments/decks.js';
import { publishView } from '../../../lib/tournaments/publish.js';
import { commandChanges, mutateSettled } from '../../../lib/tournaments/results.js';
import type { TournamentRow } from '../../../lib/tournaments/store.js';

interface DecklistRow {
  /** The submitter's identity key (see identityKey); an account ID on lists from before accounts were dropped. */
  user_id: string;
  pop_id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  deck: string;
  archetype: string | null;
  submitted_at: number;
  owner_token: string | null;
}

interface Stored extends PlayerProfile {
  deck: string;
  archetype: string | null;
  submittedAt: number;
}

/** Whether the submitter is on the player list, and whether their list is what put them there. */
export type Registration = 'added' | 'matched' | 'not-added';

function fromRow(row: DecklistRow): Stored {
  return {
    popId: row.pop_id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    deck: row.deck,
    archetype: row.archetype,
    submittedAt: row.submitted_at
  };
}

function present(list: Stored, row: TournamentRow) {
  const id = decklistPlayer(row.tournament, list, isSanctioned(row));
  const player = id === undefined ? undefined : row.tournament.players.find(p => p.id === id);
  return {
    ...list,
    problems: parseDecklist(list.deck).problems,
    /** Whether the player is on the event's player list yet. */
    registered: player !== undefined,
    /** Whether submitting this list is what added them. */
    fromList: player?.fromList === true
  };
}

/** Who a list belongs to: the Player ID at a sanctioned event, the full name at an unsanctioned one. */
export function identityKey(profile: Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>, sanctioned: boolean) {
  return sanctioned ? `pop:${profile.popId.trim()}` : `name:${nameKey(profile.firstName)} ${nameKey(profile.lastName)}`;
}

/** The details a player gave in a query string, as the identity their list is kept under. */
function claimFrom(request: Request, sanctioned: boolean): string | null {
  const query = new URL(request.url).searchParams;
  const profile = {
    popId: query.get('popId') ?? '',
    firstName: query.get('firstName') ?? '',
    lastName: query.get('lastName') ?? ''
  };
  const complete = sanctioned ? /^\d{1,10}$/.test(profile.popId) : Boolean(profile.firstName && profile.lastName);
  return complete ? identityKey(profile, sanctioned) : null;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The identity a signed-in player's saved profile gives, for reading their own list without a token. */
async function accountKey(access: Access): Promise<string | null> {
  if (!access.user) {
    return null;
  }
  const saved = await access.db
    .prepare('SELECT pop_id, first_name, last_name FROM users WHERE id = ?')
    .bind(access.user.id)
    .first<{ pop_id: string | null; first_name: string | null; last_name: string | null }>();
  const profile = { popId: saved?.pop_id ?? '', firstName: saved?.first_name ?? '', lastName: saved?.last_name ?? '' };
  const sanctioned = isSanctioned(access.row);
  const complete = sanctioned ? Boolean(profile.popId) : Boolean(profile.firstName && profile.lastName);
  return complete ? identityKey(profile, sanctioned) : null;
}

/** The asker's own list: by the details and device token they hold, or a signed-in player's profile. */
async function ownList(access: Access, request: Request): Promise<DecklistRow | null> {
  const claim = claimFrom(request, isSanctioned(access.row));
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const select = (key: string) =>
    access.db
      .prepare('SELECT * FROM decklists WHERE code = ? AND user_id = ?')
      .bind(access.row.code, key)
      .first<DecklistRow>();
  if (claim && token) {
    const row = await select(claim);
    if (row?.owner_token && row.owner_token === (await sha256(token))) {
      return row;
    }
  }
  const account = await accountKey(access);
  return account ? select(account) : null;
}

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  if (access.role) {
    const { results } = await access.db
      .prepare('SELECT * FROM decklists WHERE code = ? ORDER BY last_name, first_name')
      .bind(access.row.code)
      .all<DecklistRow>();
    return privateJson({ decklists: results.map(row => present(fromRow(row), access.row)), mine: null });
  }
  const mine = await ownList(access, context.request);
  return privateJson({ decklists: [], mine: mine ? present(fromRow(mine), access.row) : null });
}

interface Submission {
  profile: PlayerProfile;
  deck: string;
  archetype: string | null;
  localTime: unknown;
}

/** The submission in a request body, or why it is not one. */
async function readSubmission(request: Request, sanctioned: boolean): Promise<Submission | string> {
  const body = await readJsonBody(request, MAX_DECKLIST_CHARS * 4 + 1024);
  const value = body.ok && typeof body.value === 'object' && body.value ? (body.value as Record<string, unknown>) : {};
  const profile = readProfile(value.profile, sanctioned);
  const deck = typeof value.deck === 'string' ? value.deck.trim() : '';
  const archetype = archetypeLabel(value.archetype ?? null);
  if (!profile) {
    return sanctioned ? 'Fill in your Player ID, name and birth year' : 'Fill in your name';
  }
  if (!deck || deck.length > MAX_DECKLIST_CHARS) {
    return 'Paste a decklist';
  }
  return archetype === undefined ? 'Not an archetype' : { profile, deck, archetype, localTime: value.localTime };
}

/**
 * Saves a signed-in submitter's details to their account, so pages that know
 * them can find them. An unsanctioned event asked only for the name, so the
 * Player ID and birth year already there stay.
 */
function saveToAccount(access: Access, userId: string, profile: PlayerProfile) {
  const { db } = access;
  return isSanctioned(access.row)
    ? db
        .prepare('UPDATE users SET pop_id = ?, first_name = ?, last_name = ?, birth_date = ? WHERE id = ?')
        .bind(profile.popId, profile.firstName, profile.lastName, profile.birthDate, userId)
    : db
        .prepare('UPDATE users SET first_name = ?, last_name = ? WHERE id = ?')
        .bind(profile.firstName, profile.lastName, userId);
}

/** Stores the list under its identity with the device token's hash, replacing any earlier one. */
async function store(access: Access, submission: Submission, tokenHash: string, now: number): Promise<void> {
  const { profile, deck } = submission;
  const key = identityKey(profile, isSanctioned(access.row));
  const insert = access.db
    .prepare(
      'INSERT INTO decklists (code, user_id, pop_id, first_name, last_name, birth_date, deck, archetype, submitted_at, owner_token) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (code, user_id) DO UPDATE SET pop_id = excluded.pop_id, ' +
        'first_name = excluded.first_name, last_name = excluded.last_name, birth_date = excluded.birth_date, ' +
        'deck = excluded.deck, archetype = excluded.archetype, submitted_at = excluded.submitted_at, ' +
        'owner_token = excluded.owner_token'
    )
    .bind(
      access.row.code,
      key,
      profile.popId,
      profile.firstName,
      profile.lastName,
      profile.birthDate,
      deck,
      submission.archetype,
      now,
      tokenHash
    );
  await access.db.batch(access.user ? [insert, saveToAccount(access, access.user.id, profile)] : [insert]);
}

/**
 * Puts a submitter who is not on the player list onto it: a Swiss event the
 * organizer has not closed takes them as staff would add them, marked as
 * added from their list. A TOM event's roster is TOM's, and a closed event
 * takes nobody new.
 */
async function register(
  context: Context<'code'>,
  access: Access,
  submission: Submission
): Promise<{ registration: Registration; row: TournamentRow }> {
  const { row } = access;
  if (decklistPlayer(row.tournament, submission.profile, isSanctioned(row)) !== undefined) {
    return { registration: 'matched', row };
  }
  if (row.mode !== 'swiss' || row.settings.finished) {
    return { registration: 'not-added', row };
  }
  const { profile } = submission;
  const player = {
    firstName: profile.firstName,
    lastName: profile.lastName,
    ...(isSanctioned(row) ? { id: profile.popId, birthDate: profile.birthDate } : {}),
    fromList: true
  };
  const outcome = await mutateSettled(
    access.db,
    row.code,
    current => commandChanges(current, { type: 'addPlayer', player }, submission.localTime),
    submission.localTime
  );
  if ('error' in outcome) {
    return { registration: 'not-added', row };
  }
  await publishView(context.env.REPORTS, outcome.row);
  return { registration: 'added', row: outcome.row };
}

/** A player resubmits a handful of times at most; 20 per address per ten minutes leaves room. */
const rateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 20 });

/** @internal exposed for tests */
export function _resetRateLimitStore(): void {
  rateLimiter.reset();
}

const limited = (request: Request) => !rateLimiter.check(request.headers.get('CF-Connecting-IP') ?? 'unknown').allowed;

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  if (limited(context.request)) {
    return jsonError('Too many submissions. Try again later.', 429);
  }
  if (!sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  if (!access.row.settings.decklistsOpen) {
    return jsonError('Decklist submission is closed', 403);
  }
  const read = await readSubmission(context.request, isSanctioned(access.row));
  if (typeof read === 'string') {
    return jsonError(read, 400);
  }
  // With archetypes off for the event, the player's pick is not kept.
  const submission = decksEnabled(access.row.settings) ? read : { ...read, archetype: null };
  const now = Date.now();
  const token = crypto.randomUUID();
  await store(access, submission, await sha256(token), now);
  const { registration, row } = await register(context, access, submission);
  const { profile, deck, archetype } = submission;
  return privateJson({
    decklist: present({ ...profile, deck, archetype, submittedAt: now }, row),
    registration,
    token
  });
}

export async function onRequestDelete(context: Context<'code'>): Promise<Response> {
  if (limited(context.request)) {
    return jsonError('Too many requests. Try again later.', 429);
  }
  if (!sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  const key = claimFrom(context.request, isSanctioned(access.row)) ?? (await accountKey(access));
  if (!key) {
    return jsonError('Say whose list to withdraw', 400);
  }
  await access.db.prepare('DELETE FROM decklists WHERE code = ? AND user_id = ?').bind(access.row.code, key).run();
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
