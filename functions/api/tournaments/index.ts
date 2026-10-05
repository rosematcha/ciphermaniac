/**
 * GET /api/tournaments — the events the signed-in user owns or staffs, their
 * stores' among them.
 * POST /api/tournaments — starts one: a Swiss event from the setup's answers,
 * or a TOM-run event from the tournament its .tdf was parsed into in the
 * browser. Either may carry the settings it starts with. With { store } the
 * store runs it: any of its Managers or Staff may start one, sanctioned or
 * not, from TOM or not, twenty in a day. Without, it is the account's own,
 * which only a Community organizer or an Admin starts: never sanctioned,
 * never from TOM, and for a Community organizer one per date and three in a
 * day, deleted ones counting (shared/tournament/limits.ts). The date is the
 * start time's, or { today } (the browser's date) without one.
 */

import { canRunCommunityEvents } from '../../../shared/accounts/roles.js';
import { dateIn } from '../../../shared/accounts/stores.js';
import { CREATIONS_PER_DAY, eventDay, organizerToday } from '../../../shared/tournament/limits.js';
import { sanctionedMinutesError } from '../../../shared/tournament/structure.js';
import { emptyTournament } from '../../../shared/tournament/create.js';
import { tomDateTime } from '../../../shared/tournament/divisions.js';
import { withSiteClocks } from '../../../shared/tournament/tomClock.js';
import { readTournament } from '../../../shared/tournament/validate.js';
import { DEFAULT_SETTINGS, readSettings, type TournamentSettings } from '../../../shared/tournament/view.js';
import { readJsonObject } from '../../lib/api/body.js';
import { jsonError } from '../../lib/api/responses.js';
import { type Context, sameOrigin } from '../../lib/auth/env.js';
import { currentUser, sessionHash, type User } from '../../lib/auth/session.js';
import { MAX_TOURNAMENT_BYTES, privateJson } from '../../lib/tournaments/access.js';
import { publishAfter } from '../../lib/tournaments/publish.js';
import {
  createTournament,
  CreationRefused,
  DayTaken,
  LimitReached,
  listTournaments,
  type NewTournament,
  TooLarge
} from '../../lib/tournaments/store.js';
import type { D1Like, PublishBucket } from '../../lib/types.js';
import { leagueListings } from '../../lib/stores/leagues.js';

/** The database and the data bucket a creation reads. */
interface Where {
  db: D1Like;
  bucket: PublishBucket | undefined;
}
import { EVENT_TYPES, type EventType, type Tournament } from '../../../shared/tournament/types.js';

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  const user = db ? await currentUser(db, request) : null;
  if (!db || !user) {
    return jsonError('Sign in first', 401);
  }
  return privateJson({ tournaments: await listTournaments(db, user.id) });
}

type Body = Record<string, unknown>;

/** More than any organizer runs in a season; a cap on what one account can store. */
const MAX_EVENTS_PER_ORGANIZER = 200;

interface NewEvent {
  mode: 'swiss' | 'tom';
  tournament: Tournament;
  settings: TournamentSettings;
  /** The store asked to run it, when one was. */
  storeId: string | null;
  /** The browser's own date, for an event with no start time. */
  today: unknown;
  /** Whether the request itself asked for a sanctioned event, rather than the default saying so. */
  askedSanctioned: boolean;
  /** The Play! Pokémon sanction ID of the listing a store started it from, when it did. */
  sanctionId: string;
}

const SANCTION_ID_RE = /^\d{2}-\d{2}-\d{6}$/;

const isMinutes = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 180;

/**
 * A Swiss event from the setup's answers: a name, and optionally the round
 * length, the kind of event and the settings to start with. Its pods follow
 * the players' age divisions (see shared/tournament/podding.ts); without
 * birth years everyone reads as Masters, so an unsanctioned event pairs
 * everyone together.
 */
function swissFrom(body: Body): Tournament | null {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  // TOM wants a start date in the file; today's stands in until the organizer sets one.
  const info = {
    name,
    startDate: tomDateTime(new Date()).slice(0, 10),
    ...(isMinutes(body.roundTime) ? { roundTime: body.roundTime } : {}),
    ...(EVENT_TYPES.includes(body.eventType as EventType) ? { eventType: body.eventType as EventType } : {})
  };
  return name ? emptyTournament(info) : null;
}

/** The settings a new event starts with; closing it is not something it starts as. */
function initialSettings(body: Body): TournamentSettings | null {
  const settings = readSettings(body.settings ?? {}, DEFAULT_SETTINGS);
  return settings && { ...settings, finished: false, idle: false };
}

/** A TOM event's parsed file, its round clocks left for the site to run. */
function tomEvent(value: unknown): Tournament | null {
  const file = readTournament(value);
  return file && withSiteClocks(file, null);
}

/** The event a create request describes, or why it describes none. */
async function readNew(request: Request): Promise<NewEvent | string> {
  const value = await readJsonObject(request, MAX_TOURNAMENT_BYTES);
  const settings = value && initialSettings(value);
  if (!value || !settings) {
    return 'Not a tournament';
  }
  const mode = value.mode === 'tom' ? 'tom' : 'swiss';
  const tournament = mode === 'tom' ? tomEvent(value.tournament) : swissFrom(value);
  if (!tournament) {
    return mode === 'tom' ? 'That file did not read as a tournament' : 'The event needs a name';
  }
  const short = mode === 'swiss' && settings.sanctioned ? sanctionedMinutesError(tournament.info) : null;
  return short ?? { mode, tournament, settings, ...whoAndWhen(value) };
}

/** What a create request says about who runs the event and the listing it comes from. */
function whoAndWhen(value: Body): Pick<NewEvent, 'storeId' | 'today' | 'askedSanctioned' | 'sanctionId'> {
  const { store, sanctionId } = value;
  return {
    storeId: typeof store === 'string' && store ? store : null,
    today: value.today,
    askedSanctioned: (value.settings as { sanctioned?: unknown } | undefined)?.sanctioned === true,
    sanctionId: typeof sanctionId === 'string' && SANCTION_ID_RE.test(sanctionId) ? sanctionId : ''
  };
}

/** Who runs a new event and on what terms, with what it starts as; or the refusal. */
type Running =
  | (Pick<NewTournament, 'storeId' | 'communityDay' | 'admission'> &
      Partial<Pick<NewTournament, 'tournament' | 'settings'>>)
  | Response;

/**
 * The account's own event: a Swiss event, never sanctioned and of no Play!
 * Pokémon kind, and for a Community organizer within its limits.
 */
function ownEvent(user: User, read: NewEvent): Running {
  if (!canRunCommunityEvents(user.role)) {
    // `apply` tells the page to offer a way in rather than the message alone.
    return privateJson({ error: 'Only organizers can start events', apply: true }, 403);
  }
  if (read.mode === 'tom' || read.askedSanctioned) {
    return jsonError('Only a store runs sanctioned events', 403);
  }
  const { eventType: _kind, ...info } = read.tournament.info;
  const unsanctioned = { tournament: { ...read.tournament, info }, settings: { ...read.settings, sanctioned: false } };
  if (user.role === 'admin') {
    return { ...unsanctioned, storeId: null, communityDay: null, admission: null };
  }
  const today = organizerToday(read.today, Date.now());
  return {
    ...unsanctioned,
    storeId: null,
    communityDay: eventDay(read.settings.startsAt, today),
    admission: { owner: `user:${user.id}`, limit: CREATIONS_PER_DAY.community }
  };
}

interface StorePlace {
  status: string;
  league_id: string;
  city: string;
  region: string;
  country: string;
  time_zone: string;
}

/** YYYY-MM-DD as TOM writes a date, MM/DD/YYYY. */
const tomDate = (day: string) => `${day.slice(5, 7)}/${day.slice(8, 10)}/${day.slice(0, 4)}`;

/**
 * What a store's Swiss event starts with that the setup does not say: the
 * store's place, its day in the store's own time zone, the listing it was
 * started from, and the account starting it as its organizer of record
 * (TOM's <organizer>; the store's staff can name another).
 */
function storeInfo(user: User, read: NewEvent, place: StorePlace): Tournament {
  const day = eventDay(read.settings.startsAt, dateIn(place.time_zone, Date.now()));
  const realName = [user.firstName, user.lastName].filter(Boolean).join(' ');
  const info = {
    ...read.tournament.info,
    city: place.city,
    state: place.region,
    country: place.country,
    startDate: tomDate(day),
    organizerPopId: user.popId ?? '',
    organizerName: realName,
    ...(read.sanctionId ? { sanctionId: read.sanctionId } : {})
  };
  return { ...read.tournament, info };
}

/** Whether `sanctionId` is one pokemon.com lists for the league: a store starts only its own league's events from a listing. */
async function listedFor(bucket: PublishBucket | undefined, leagueId: string, sanctionId: string): Promise<boolean> {
  const listings = await leagueListings(bucket, leagueId, '');
  return listings.some(listing => listing.sanctionId === sanctionId);
}

/**
 * A store's event: the asker must belong to the store, the store must be
 * active, and a sanction ID it names must be one its league lists.
 */
async function storeEvent(where: Where, user: User, read: NewEvent, storeId: string): Promise<Running> {
  const { db, bucket } = where;
  const place = await db
    .prepare(
      'SELECT s.status, s.league_id, s.city, s.region, s.country, s.time_zone FROM store_members m ' +
        'JOIN stores s ON s.id = m.store_id WHERE m.store_id = ? AND m.user_id = ?'
    )
    .bind(storeId, user.id)
    .first<StorePlace>();
  if (!place) {
    return jsonError('You are not part of that store', 403);
  }
  if (place.status !== 'active') {
    return jsonError('That store can no longer start events', 403);
  }
  if (read.sanctionId && !(await listedFor(bucket, place.league_id, read.sanctionId))) {
    return jsonError('That sanction ID is not one pokemon.com lists for your league', 400);
  }
  return {
    ...(read.mode === 'swiss' ? { tournament: storeInfo(user, read, place) } : {}),
    storeId,
    communityDay: null,
    admission: { owner: `store:${storeId}`, limit: CREATIONS_PER_DAY.store }
  };
}

/** The answer to a creation that failed for one of the reasons a creation can. */
function refusal(error: unknown): Response {
  if (error instanceof CreationRefused) {
    return jsonError(error.message, 403);
  }
  if (error instanceof TooLarge) {
    return jsonError(error.message, 413);
  }
  if (error instanceof LimitReached) {
    return jsonError(error.message, 429);
  }
  if (error instanceof DayTaken) {
    return jsonError(error.message, 409);
  }
  throw error;
}

/** Keep the session, organizer role, store access and retained-event quota valid at admission. */
async function creationGuard(request: Request, userId: string, storeId: string | null) {
  const standing = storeId
    ? 'EXISTS (SELECT 1 FROM store_members m JOIN stores s ON s.id = m.store_id ' +
      "WHERE m.user_id = u.id AND m.store_id = ? AND s.status = 'active')"
    : "u.role IN ('community', 'admin') AND " +
      `(SELECT COUNT(*) FROM tournaments WHERE owner_id = u.id AND store_id IS NULL) < ${MAX_EVENTS_PER_ORGANIZER}`;
  return {
    sql:
      'EXISTS (SELECT 1 FROM sessions JOIN users u ON u.id = sessions.user_id ' +
      'WHERE sessions.token_hash = ? AND u.id = ? AND sessions.expires_at > ? ' +
      `AND u.age_checked_at IS NOT NULL AND ${standing})`,
    values: [await sessionHash(request), userId, Date.now(), ...(storeId ? [storeId] : [])]
  };
}

export async function onRequestPost(context: Context): Promise<Response> {
  const { request, env } = context;
  const db = env.TOURNAMENT_DB;
  if (!db || !sameOrigin(request)) {
    return jsonError('Forbidden', 403);
  }
  const user = await currentUser(db, request);
  if (!user) {
    return jsonError('Sign in first', 401);
  }
  const read = await readNew(request);
  if (typeof read === 'string') {
    return jsonError(read, 400);
  }
  const where = { db, bucket: env.REPORTS };
  const running = read.storeId ? await storeEvent(where, user, read, read.storeId) : ownEvent(user, read);
  if (running instanceof Response) {
    return running;
  }
  try {
    const { mode, tournament, settings } = read;
    const guard = await creationGuard(request, user.id, read.storeId);
    const row = await createTournament(db, { ownerId: user.id, mode, tournament, settings, ...running, guard });
    await publishAfter(context, row);
    return privateJson({ code: row.code }, 201);
  } catch (error) {
    return refusal(error);
  }
}
