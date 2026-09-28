/**
 * Decklists submitted ahead of the event.
 *
 * GET — staff see every list; everyone signed in gets their own as `mine`.
 * PUT — a signed-in player submits or replaces theirs while submission is
 * open: { deck, profile, archetype? }. The profile (POP ID, name, birth date)
 * is what matches the list to the organizer's player list, and is saved to
 * the account so the next event needs only the deck. The archetype stays on
 * the list until staff apply it; anyone can type any Player ID.
 * DELETE — a player withdraws theirs.
 */

import { MAX_DECKLIST_CHARS, parseDecklist } from '../../../../shared/tournament/decklist.js';
import { type PlayerProfile, readProfile } from '../../../../shared/tournament/profile.js';
import { readJsonBody } from '../../../lib/api/body.js';
import { createRateLimiter } from '../../../lib/api/rateLimiter.js';
import { jsonError } from '../../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../../lib/auth/env.js';
import { type Access, open, privateJson } from '../../../lib/tournaments/access.js';
import { archetypeLabel } from '../../../lib/tournaments/decks.js';

interface DecklistRow {
  user_id: string;
  pop_id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  deck: string;
  archetype: string | null;
  submitted_at: number;
}

interface Stored extends PlayerProfile {
  deck: string;
  archetype: string | null;
  submittedAt: number;
}

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

function present(list: Stored, keys: Record<string, string>) {
  return {
    ...list,
    problems: parseDecklist(list.deck).problems,
    /** Whether the Player ID is on the event's player list yet. */
    registered: Object.hasOwn(keys, list.popId)
  };
}

async function signedIn(context: Context<'code'>, write: boolean): Promise<(Access & { userId: string }) | Response> {
  if (write && !sameOrigin(context.request)) {
    return jsonError('Forbidden', 403);
  }
  const access = await open(context);
  if (access instanceof Response) {
    return access;
  }
  return access.user ? { ...access, userId: access.user.id } : jsonError('Sign in first', 401);
}

export async function onRequestGet(context: Context<'code'>): Promise<Response> {
  const access = await signedIn(context, false);
  if (access instanceof Response) {
    return access;
  }
  const { results } = await (
    access.role
      ? access.db.prepare('SELECT * FROM decklists WHERE code = ? ORDER BY last_name, first_name').bind(access.row.code)
      : access.db.prepare('SELECT * FROM decklists WHERE code = ? AND user_id = ?').bind(access.row.code, access.userId)
  ).all<DecklistRow>();
  const mine = results.find(row => row.user_id === access.userId);
  return privateJson({
    decklists: access.role ? results.map(row => present(fromRow(row), access.row.keys)) : [],
    mine: mine ? present(fromRow(mine), access.row.keys) : null
  });
}

interface Submission {
  profile: PlayerProfile;
  deck: string;
  archetype: string | null;
}

/** The submission in a request body, or why it is not one. */
async function readSubmission(request: Request): Promise<Submission | string> {
  const body = await readJsonBody(request, MAX_DECKLIST_CHARS * 4 + 1024);
  const value = body.ok && typeof body.value === 'object' && body.value ? (body.value as Record<string, unknown>) : {};
  const profile = readProfile(value.profile);
  const deck = typeof value.deck === 'string' ? value.deck.trim() : '';
  const archetype = archetypeLabel(value.archetype ?? null);
  if (!profile) {
    return 'Fill in your Player ID, name and birth year';
  }
  if (!deck || deck.length > MAX_DECKLIST_CHARS) {
    return 'Paste a decklist';
  }
  return archetype === undefined ? 'Not an archetype' : { profile, deck, archetype };
}

/** Stores the list, and saves the profile to the account so the next event needs only the deck. */
async function store(access: Access & { userId: string }, submission: Submission, now: number): Promise<void> {
  const { profile, deck } = submission;
  await access.db.batch([
    access.db
      .prepare(
        'INSERT INTO decklists (code, user_id, pop_id, first_name, last_name, birth_date, deck, archetype, submitted_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (code, user_id) DO UPDATE SET pop_id = excluded.pop_id, ' +
          'first_name = excluded.first_name, last_name = excluded.last_name, birth_date = excluded.birth_date, ' +
          'deck = excluded.deck, archetype = excluded.archetype, submitted_at = excluded.submitted_at'
      )
      .bind(
        access.row.code,
        access.userId,
        profile.popId,
        profile.firstName,
        profile.lastName,
        profile.birthDate,
        deck,
        submission.archetype,
        now
      ),
    access.db
      .prepare('UPDATE users SET pop_id = ?, first_name = ?, last_name = ?, birth_date = ? WHERE id = ?')
      .bind(profile.popId, profile.firstName, profile.lastName, profile.birthDate, access.userId)
  ]);
}

/** A player resubmits a handful of times at most; 20 per address per ten minutes leaves room. */
const rateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxRequests: 20 });

/** @internal exposed for tests */
export function _resetRateLimitStore(): void {
  rateLimiter.reset();
}

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  if (!rateLimiter.check(context.request.headers.get('CF-Connecting-IP') ?? 'unknown').allowed) {
    return jsonError('Too many submissions. Try again later.', 429);
  }
  const access = await signedIn(context, true);
  if (access instanceof Response) {
    return access;
  }
  if (!access.row.settings.decklistsOpen) {
    return jsonError('Decklist submission is closed', 403);
  }
  const submission = await readSubmission(context.request);
  if (typeof submission === 'string') {
    return jsonError(submission, 400);
  }
  const now = Date.now();
  await store(access, submission, now);
  const { profile, deck, archetype } = submission;
  return privateJson({ decklist: present({ ...profile, deck, archetype, submittedAt: now }, access.row.keys) });
}

export async function onRequestDelete(context: Context<'code'>): Promise<Response> {
  const access = await signedIn(context, true);
  if (access instanceof Response) {
    return access;
  }
  await access.db
    .prepare('DELETE FROM decklists WHERE code = ? AND user_id = ?')
    .bind(access.row.code, access.userId)
    .run();
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
