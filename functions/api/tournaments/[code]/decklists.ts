/**
 * Decklists submitted ahead of the event. Players need no account: they say
 * who they are the way the rest of the player side does (Player ID, name and
 * birth date at a sanctioned event; first and last name at an unsanctioned
 * one), and that identity keys the list. A Player ID or a name is no secret,
 * so the list belongs to the device that sent it: the token it was given is
 * the only way to read, replace or withdraw it. Staff can unlock a list for a
 * player who changed devices, and the next submission under those details
 * takes it over.
 *
 * GET — staff see every list. A player sees their own with the details they
 * submitted under (query popId / firstName / lastName) and their token.
 * PUT — submits or replaces a list while submission is open: { deck,
 * profile, archetype?, token?, localTime? }; replacing takes the token, and
 * the token the device sends stays the list's, so a retry still owns it. A
 * submitter who is not on the event's player list is added to it (a Swiss
 * event still open), marked as added from a list; the answer says whether
 * they were added, matched or not added, and carries the device's new token.
 * The archetype stays on the list until staff apply it. A signed-in
 * submitter's profile is saved to their account unless it already names
 * another Player ID.
 * DELETE — withdraws the list under the details and token in the query,
 * while submission is open.
 * PATCH — staff unlock the list under the details in the query.
 */

import { MAX_DECKLIST_CHARS, parseDecklist } from '../../../../shared/tournament/decklist.js';
import { decklistMatcher, decklistPlayer, fullNameKey } from '../../../../shared/tournament/identify.js';
import { type PlayerProfile, readProfile } from '../../../../shared/tournament/profile.js';
import {
  type Decklist,
  decklistsOpen,
  decksEnabled,
  isSanctioned,
  type Registration,
  type TournamentSettings
} from '../../../../shared/tournament/view.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { createRateLimiter } from '../../../lib/api/rateLimiter.js';
import { jsonError, noContent } from '../../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../../lib/auth/env.js';
import { sha256 } from '../../../lib/auth/session.js';
import { rowsChanged } from '../../../lib/d1.js';
import { type Access, codeOf, open, openForStaff, privateJson } from '../../../lib/tournaments/access.js';
import { archetypeLabel } from '../../../lib/tournaments/decks.js';
import { publishAfter } from '../../../lib/tournaments/publish.js';
import { commandChanges, mutateSettled } from '../../../lib/tournaments/results.js';
import type { TournamentRow } from '../../../lib/tournaments/store.js';

interface DecklistRow {
  /** The submitter's identity key (see identityKey). */
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

/** A list as stored, before it is checked against the roster (see presenter). */
type Stored = Omit<Decklist, 'problems' | 'registered' | 'fromList'>;

function fromRow(row: DecklistRow): Stored {
  return {
    popId: row.pop_id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    deck: row.deck,
    archetype: row.archetype,
    submittedAt: row.submitted_at,
    locked: row.owner_token !== null
  };
}

/**
 * Lists as the pages show them, each with its problems and where its player
 * stands on the event's list. The roster is indexed once for however many
 * lists there are: staff read the whole event's at a time.
 */
function presenter(row: TournamentRow) {
  const match = decklistMatcher(row.tournament, isSanctioned(row));
  const players = new Map(row.tournament.players.map(player => [player.id, player]));
  return (list: Stored): Decklist => {
    const player = players.get(match(list) ?? '');
    return {
      ...list,
      problems: parseDecklist(list.deck).problems,
      registered: player !== undefined,
      fromList: player?.fromList === true
    };
  };
}

/** Who a list belongs to: the Player ID at a sanctioned event, the full name at an unsanctioned one. */
export function identityKey(profile: Pick<PlayerProfile, 'popId' | 'firstName' | 'lastName'>, sanctioned: boolean) {
  return sanctioned ? `pop:${profile.popId.trim()}` : `name:${fullNameKey(profile)}`;
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

/**
 * The asker's own list, by the details and the device token they hold. Only
 * the token reads a list back: a profile anyone can edit to someone else's
 * details must not show that person's list.
 */
async function ownList(access: Access, request: Request): Promise<DecklistRow | null> {
  const claim = claimFrom(request, isSanctioned(access.row));
  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!claim || !token) {
    return null;
  }
  const row = await access.db
    .prepare('SELECT * FROM decklists WHERE code = ? AND user_id = ?')
    .bind(access.row.code, claim)
    .first<DecklistRow>();
  return row?.owner_token && row.owner_token === (await sha256(token)) ? row : null;
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
    const present = presenter(access.row);
    return privateJson({ decklists: results.map(row => present(fromRow(row))), mine: null });
  }
  const mine = await ownList(access, context.request);
  return privateJson({ decklists: [], mine: mine ? presenter(access.row)(fromRow(mine)) : null });
}

interface Submission {
  profile: PlayerProfile;
  deck: string;
  archetype: string | null;
  /** The token the device holds for an earlier list under these details, if any. */
  held: unknown;
  localTime: unknown;
}

const LOCKED = 'This list was sent from another device. Send it from that device, or ask staff to reset it.';

/** The submission in a request body, or why it is not one. */
async function readSubmission(request: Request, sanctioned: boolean): Promise<Submission | string> {
  const value = (await readJsonObject(request, MAX_DECKLIST_CHARS * 4 + 1024)) ?? {};
  const profile = readProfile(value.profile, sanctioned);
  const deck = typeof value.deck === 'string' ? value.deck.trim() : '';
  const archetype = archetypeLabel(value.archetype ?? null);
  if (!profile) {
    return sanctioned ? 'Fill in your Player ID, name and birth year' : 'Fill in your name';
  }
  if (!deck || deck.length > MAX_DECKLIST_CHARS) {
    return 'Paste a decklist';
  }
  return archetype === undefined
    ? 'Not an archetype'
    : { profile, deck, archetype, held: value.token, localTime: value.localTime };
}

/**
 * Saves a signed-in submitter's details to their account, so pages that know
 * them can find them. An account that already names a different Player ID
 * keeps its own details: a list sent under someone else's does not rewrite
 * who the account says it is. An unsanctioned event asked only for the name,
 * so the Player ID and birth year already there stay.
 */
function saveToAccount(access: Access, userId: string, profile: PlayerProfile) {
  const { db } = access;
  return isSanctioned(access.row)
    ? db
        .prepare(
          'UPDATE users SET pop_id = ?, first_name = ?, last_name = ?, birth_date = ? ' +
            "WHERE id = ? AND (pop_id IS NULL OR pop_id = '' OR pop_id = ?)"
        )
        .bind(profile.popId, profile.firstName, profile.lastName, profile.birthDate, userId, profile.popId)
    : db
        .prepare(
          'UPDATE users SET first_name = ?, last_name = ? ' +
            "WHERE id = ? AND (pop_id IS NULL OR pop_id = '' OR (first_name = ? AND last_name = ?))"
        )
        .bind(profile.firstName, profile.lastName, userId, profile.firstName, profile.lastName);
}

/**
 * Stores the list under its identity with the new token's hash: a first list,
 * one staff unlocked, or a replacement from the device that holds the token.
 * False when another device's list is there, which stays as it was.
 */
async function store(access: Access, submission: Submission, tokenHash: string, now: number): Promise<boolean> {
  const { profile, deck } = submission;
  const key = identityKey(profile, isSanctioned(access.row));
  const held = typeof submission.held === 'string' && submission.held ? await sha256(submission.held) : '';
  const insert = access.db
    .prepare(
      'INSERT INTO decklists (code, user_id, pop_id, first_name, last_name, birth_date, deck, archetype, submitted_at, owner_token) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (code, user_id) DO UPDATE SET pop_id = excluded.pop_id, ' +
        'first_name = excluded.first_name, last_name = excluded.last_name, birth_date = excluded.birth_date, ' +
        'deck = excluded.deck, archetype = excluded.archetype, submitted_at = excluded.submitted_at, ' +
        'owner_token = excluded.owner_token WHERE decklists.owner_token IS NULL OR decklists.owner_token = ?'
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
      tokenHash,
      held
    );
  // The upsert changes no row when another device's list is there, so its count is the answer.
  if (rowsChanged(await insert.run()) === 0) {
    return false;
  }
  if (access.user) {
    await saveToAccount(access, access.user.id, profile).run();
  }
  return true;
}

const ALREADY_IN = 'Already on the player list';

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
  // Checked again against the event as it is when written: a second submission
  // may have added them meanwhile, or the organizer closed the event.
  const outcome = await mutateSettled(
    access.db,
    row,
    current => {
      if (decklistPlayer(current.tournament, profile, isSanctioned(current)) !== undefined) {
        return ALREADY_IN;
      }
      return current.settings.finished
        ? 'The event is closed'
        : commandChanges(current, { type: 'addPlayer', player }, submission.localTime);
    },
    submission.localTime
  );
  if ('error' in outcome) {
    return { registration: outcome.error === ALREADY_IN ? 'matched' : 'not-added', row };
  }
  await publishAfter(context, outcome.row);
  return { registration: 'added', row: outcome.row };
}

/**
 * A whole field can send its lists from one venue's Wi-Fi, so the limit is
 * counted per event and sized for a room: 150 submissions per address per
 * event per ten minutes, with a looser cap across every event so one address
 * cannot flood many.
 */
const eventLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 150 });
const addressLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 400 });

/** Why a list cannot be sent or withdrawn now: the event takes none, or not any more. */
function notTaking(settings: TournamentSettings): Response {
  return jsonError(
    settings.decklists === 'off' ? 'This event does not take decklists' : 'Decklist submission is closed',
    403
  );
}

/** @internal exposed for tests */
export function _resetRateLimitStore(): void {
  eventLimiter.reset();
  addressLimiter.reset();
}

function limited(context: Context<'code'>): boolean {
  const address = context.request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const code = codeOf(context);
  const forEvent = eventLimiter.check(`${code}:${address}`).allowed;
  return !(addressLimiter.check(address).allowed && forEvent);
}

/** A token the device made for itself, when it sent one that looks like one. */
const deviceToken = (held: unknown) => (typeof held === 'string' && /^[\w-]{16,100}$/.test(held) ? held : null);

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  if (limited(context)) {
    return jsonError('Too many submissions. Try again later.', 429);
  }
  if (!sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  if (!decklistsOpen(access.row.settings)) {
    return notTaking(access.row.settings);
  }
  const read = await readSubmission(context.request, isSanctioned(access.row));
  if (typeof read === 'string') {
    return jsonError(read, 400);
  }
  // With archetypes off for the event, the player's pick is not kept.
  const submission = decksEnabled(access.row.settings) ? read : { ...read, archetype: null };
  const now = Date.now();
  // The device's own token stays its token, so a retry after a lost answer still owns the list.
  const token = deviceToken(submission.held) ?? crypto.randomUUID();
  if (!(await store(access, submission, await sha256(token), now))) {
    return jsonError(LOCKED, 409);
  }
  const { registration, row } = await register(context, access, submission);
  const { profile, deck, archetype } = submission;
  return privateJson({
    decklist: presenter(row)({ ...profile, deck, archetype, submittedAt: now, locked: true }),
    registration,
    token
  });
}

export async function onRequestDelete(context: Context<'code'>): Promise<Response> {
  if (limited(context)) {
    return jsonError('Too many requests. Try again later.', 429);
  }
  if (!sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  if (!decklistsOpen(access.row.settings)) {
    return notTaking(access.row.settings);
  }
  const key = claimFrom(context.request, isSanctioned(access.row));
  if (!key) {
    return jsonError('Say whose list to withdraw', 400);
  }
  const held = new URL(context.request.url).searchParams.get('token') ?? '';
  const { db, row } = access;
  // The token is checked in the delete itself, so a list replaced meanwhile is not the one withdrawn.
  const deleted = await db
    .prepare('DELETE FROM decklists WHERE code = ? AND user_id = ? AND (owner_token IS NULL OR owner_token = ?)')
    .bind(row.code, key, held ? await sha256(held) : '')
    .run();
  if (rowsChanged(deleted) === 0 && (await listExists(db, row.code, key))) {
    return jsonError(LOCKED, 409);
  }
  return noContent();
}

async function listExists(db: Access['db'], code: string, key: string): Promise<boolean> {
  const found = await db
    .prepare('SELECT 1 AS yes FROM decklists WHERE code = ? AND user_id = ?')
    .bind(code, key)
    .first<{ yes: number }>();
  return found !== null;
}

/** Staff unlock a list, so the next submission under its details takes it over from whichever device sent it. */
export async function onRequestPatch(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const key = claimFrom(context.request, isSanctioned(access.row));
  if (!key) {
    return jsonError('Say whose list to unlock', 400);
  }
  await access.db
    .prepare('UPDATE decklists SET owner_token = NULL WHERE code = ? AND user_id = ?')
    .bind(access.row.code, key)
    .run();
  return noContent();
}
