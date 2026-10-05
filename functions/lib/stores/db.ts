/**
 * Stores in D1 (shared/accounts/stores.ts): the store, who belongs to it and
 * as what, and the links that let someone in. A store never loses its last
 * Manager: each write that removes or demotes one holds only while another
 * stays, inside the statement itself, so two Managers leaving at once cannot
 * both go.
 */

import type {
  LeagueNight,
  NightException,
  StoreDetails,
  StorePlace,
  StoreRole
} from '../../../shared/accounts/stores.js';
import type { PublicStore, Store, StoreEvent, StoreInvite, StoreMember } from '../../../shared/accounts/types.js';
import { randomToken, sha256 } from '../auth/session.js';
import { displayNameSql } from '../accounts/handles.js';
import { rowsChanged } from '../d1.js';
import type { D1Like, D1Statement } from '../types.js';

/** How long a store's invite link lets someone in. */
export const INVITE_DAYS = 7;
const INVITE_MS = INVITE_DAYS * 24 * 60 * 60 * 1000;

interface StoreRow {
  id: string;
  league_id: string;
  status: string;
  name: string;
  address: string;
  city: string;
  region: string;
  postal: string;
  country: string;
  lat: number | null;
  lon: number | null;
  time_zone: string;
  website: string;
  discord: string;
  phone: string;
  email: string;
  details: string;
  nights: string;
  exceptions: string;
}

function storeFromRow(row: StoreRow): Store {
  return {
    id: row.id,
    leagueId: row.league_id,
    status: row.status === 'revoked' ? 'revoked' : 'active',
    name: row.name,
    address: row.address,
    city: row.city,
    region: row.region,
    postal: row.postal,
    country: row.country,
    lat: row.lat,
    lon: row.lon,
    timeZone: row.time_zone,
    website: row.website,
    discord: row.discord,
    phone: row.phone,
    email: row.email,
    details: row.details,
    nights: JSON.parse(row.nights) as LeagueNight[],
    exceptions: JSON.parse(row.exceptions) as NightException[]
  };
}

export async function loadStore(db: D1Like, id: string): Promise<Store | null> {
  const row = await db.prepare('SELECT * FROM stores WHERE id = ?').bind(id).first<StoreRow>();
  return row && storeFromRow(row);
}

export async function storeOfLeague(db: D1Like, leagueId: string): Promise<Store | null> {
  const row = await db.prepare('SELECT * FROM stores WHERE league_id = ?').bind(leagueId).first<StoreRow>();
  return row && storeFromRow(row);
}

export interface NewStore {
  leagueId: string;
  details: StoreDetails;
  lat: number | null;
  lon: number | null;
  timeZone: string;
  nights: LeagueNight[];
}

/** A condition every write of a batch holds to, with its bound values. */
export interface Guard {
  sql: string;
  values: unknown[];
}

const ALWAYS: Guard = { sql: '1 = 1', values: [] };

/** A store to make: under `id`, with `managerId` its Manager, at `now`, each write only while `guard` holds. */
export interface StoreMaking {
  id: string;
  store: NewStore;
  managerId: string;
  now: number;
  guard?: Guard;
}

/**
 * The writes that make a store and its first Manager. The unique league
 * index refuses a second store for a league, failing the batch.
 */
export function storeInserts(db: D1Like, making: StoreMaking): D1Statement[] {
  const { id, store, managerId, now, guard = ALWAYS } = making;
  const { details } = store;
  return [
    db
      .prepare(
        'INSERT INTO stores (id, league_id, status, name, address, city, region, postal, country, lat, lon, ' +
          'time_zone, website, discord, phone, email, details, nights, created_at, updated_at) ' +
          `SELECT ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`
      )
      .bind(
        id,
        store.leagueId,
        details.name,
        details.address,
        details.city,
        details.region,
        details.postal,
        details.country,
        store.lat,
        store.lon,
        store.timeZone,
        details.website,
        details.discord,
        details.phone,
        details.email,
        details.details,
        JSON.stringify(store.nights),
        now,
        now,
        ...guard.values
      ),
    db
      .prepare(
        `INSERT INTO store_members (store_id, user_id, role, added_at) SELECT ?, ?, 'manager', ? WHERE ${guard.sql}`
      )
      .bind(id, managerId, now, ...guard.values)
  ];
}

/** Whether a failed write broke the one-store-per-league index. */
export const breaksLeague = (error: unknown) =>
  error instanceof Error && /stores\.league_id|stores_by_league/.test(error.message);

/** Saves what a store says about itself; its place on the map changes only when one is given. */
export async function saveDetails(
  db: D1Like,
  id: string,
  saved: { details: StoreDetails; timeZone: string; place: StorePlace | null },
  guard: Guard = ALWAYS
): Promise<boolean> {
  const { details, timeZone, place } = saved;
  const done = await db
    .prepare(
      'UPDATE stores SET name = ?, address = ?, city = ?, region = ?, postal = ?, country = ?, website = ?, ' +
        'discord = ?, phone = ?, email = ?, details = ?, time_zone = ?, updated_at = ?, ' +
        `lat = COALESCE(?, lat), lon = COALESCE(?, lon) WHERE id = ? AND ${guard.sql}`
    )
    .bind(
      details.name,
      details.address,
      details.city,
      details.region,
      details.postal,
      details.country,
      details.website,
      details.discord,
      details.phone,
      details.email,
      details.details,
      timeZone,
      Date.now(),
      place?.lat ?? null,
      place?.lon ?? null,
      id,
      ...guard.values
    )
    .run();
  return rowsChanged(done) === 1;
}

export async function saveNights(
  db: D1Like,
  id: string,
  saved: { nights: LeagueNight[]; exceptions: NightException[] },
  guard: Guard = ALWAYS
): Promise<boolean> {
  const { nights, exceptions } = saved;
  const done = await db
    .prepare(`UPDATE stores SET nights = ?, exceptions = ?, updated_at = ? WHERE id = ? AND ${guard.sql}`)
    .bind(JSON.stringify(nights), JSON.stringify(exceptions), Date.now(), id, ...guard.values)
    .run();
  return rowsChanged(done) === 1;
}

export async function setStatus(
  db: D1Like,
  id: string,
  status: 'active' | 'revoked',
  adminId: string
): Promise<boolean> {
  const done = await db
    .prepare('UPDATE stores SET status = ?, status_at = ?, status_by = ? WHERE id = ?')
    .bind(status, Date.now(), adminId, id)
    .run();
  return rowsChanged(done) === 1;
}

export async function listMembers(db: D1Like, storeId: string): Promise<StoreMember[]> {
  const { results } = await db
    .prepare(
      `SELECT m.user_id AS id, ${displayNameSql('u')} AS name, u.pop_id, m.role, m.added_at FROM store_members m ` +
        'JOIN users u ON u.id = m.user_id WHERE m.store_id = ? ORDER BY m.role, name'
    )
    .bind(storeId)
    .all<{ id: string; name: string; pop_id: string | null; role: string; added_at: number }>();
  return results.map(row => ({
    id: row.id,
    name: row.name,
    hasPopId: Boolean(row.pop_id),
    role: row.role === 'manager' ? 'manager' : 'staff',
    addedAt: row.added_at
  }));
}

/** Whether `userId` is a Manager the store can lose: not one, or one of several. */
const ANOTHER_MANAGER =
  "(role <> 'manager' OR (SELECT COUNT(*) FROM store_members AS others " +
  "WHERE others.store_id = store_members.store_id AND others.role = 'manager') > 1)";

/** Takes someone out of the store; false when they are its last Manager (or not in it). */
export async function removeMember(
  db: D1Like,
  storeId: string,
  userId: string,
  guard: Guard = ALWAYS
): Promise<boolean> {
  const done = await db
    .prepare(`DELETE FROM store_members WHERE store_id = ? AND user_id = ? AND ${ANOTHER_MANAGER} AND ${guard.sql}`)
    .bind(storeId, userId, ...guard.values)
    .run();
  return rowsChanged(done) === 1;
}

/** Makes someone a Manager or Staff; false when that would leave the store without a Manager. */
export async function setMemberRole(
  db: D1Like,
  storeId: string,
  member: { userId: string; role: StoreRole },
  guard: Guard = ALWAYS
): Promise<boolean> {
  const { userId, role } = member;
  const keepsManager = role === 'manager' ? '1 = 1' : ANOTHER_MANAGER;
  const done = await db
    .prepare(
      `UPDATE store_members SET role = ? WHERE store_id = ? AND user_id = ? AND ${keepsManager} AND ${guard.sql}`
    )
    .bind(role, storeId, userId, ...guard.values)
    .run();
  return rowsChanged(done) === 1;
}

/** Makes a link that lets one person into the store as `role`, for a week; returns its token. */
export async function createInvite(
  db: D1Like,
  storeId: string,
  role: StoreRole,
  options: { now?: number; guard?: Guard } = {}
): Promise<string | null> {
  const { now = Date.now(), guard = ALWAYS } = options;
  const token = randomToken(18);
  const results = await db.batch([
    db.prepare('DELETE FROM store_invites WHERE store_id = ? AND expires_at <= ?').bind(storeId, now),
    db
      .prepare(
        `INSERT INTO store_invites (token_hash, store_id, role, created_at, expires_at) SELECT ?, ?, ?, ?, ? WHERE ${guard.sql}`
      )
      .bind(await sha256(token), storeId, role, now, now + INVITE_MS, ...guard.values)
  ]);
  return rowsChanged(results[1]) === 1 ? token : null;
}

/** The links still open, newest first: when each was made and as what it lets someone in. */
export async function listInvites(db: D1Like, storeId: string, now = Date.now()): Promise<StoreInvite[]> {
  const { results } = await db
    .prepare(
      'SELECT token_hash, role, created_at, expires_at FROM store_invites WHERE store_id = ? AND expires_at > ? ' +
        'ORDER BY created_at DESC'
    )
    .bind(storeId, now)
    .all<{ token_hash: string; role: string; created_at: number; expires_at: number }>();
  // A link is named by the start of its hash: enough to withdraw it, and nothing to let anyone in with.
  return results.map(row => ({
    id: row.token_hash.slice(0, 16),
    role: row.role === 'manager' ? 'manager' : 'staff',
    createdAt: row.created_at,
    expiresAt: row.expires_at
  }));
}

export async function withdrawInvite(db: D1Like, storeId: string, id: string, guard: Guard = ALWAYS): Promise<boolean> {
  const done = await db
    .prepare(`DELETE FROM store_invites WHERE store_id = ? AND substr(token_hash, 1, 16) = ? AND ${guard.sql}`)
    .bind(storeId, id, ...guard.values)
    .run();
  return rowsChanged(done) === 1;
}

/**
 * Lets the account in through a link, once: joining and using the link up are
 * one transaction, so two people cannot both come in on it. Someone already
 * in keeps the higher of the two roles. The store's id, or null when the link
 * is gone or ran out.
 */
export async function acceptInvite(
  db: D1Like,
  token: string,
  userId: string,
  now = Date.now()
): Promise<string | null> {
  const hash = await sha256(token);
  const [, used] = await db.batch([
    db
      .prepare(
        'INSERT INTO store_members (store_id, user_id, role, added_at) ' +
          'SELECT store_id, ?, role, ? FROM store_invites WHERE token_hash = ? AND expires_at > ? ' +
          "ON CONFLICT (store_id, user_id) DO UPDATE SET role = 'manager' WHERE excluded.role = 'manager'"
      )
      .bind(userId, now, hash, now),
    db.prepare('DELETE FROM store_invites WHERE token_hash = ? AND expires_at > ? RETURNING store_id').bind(hash, now)
  ]);
  return (used?.results as { store_id: string }[] | undefined)?.[0]?.store_id ?? null;
}

interface StoreEventRow {
  code: string;
  name: string | null;
  start_date: string | null;
  starts_at: string | null;
  sanctioned: number | null;
  rounds: number;
  mode: string;
}

/** A store's events on the site that have not ended, as its page lists them. */
export async function storeEvents(db: D1Like, storeId: string, pairedRounds: string): Promise<StoreEvent[]> {
  const { results } = await db
    .prepare(
      "SELECT code, mode, json_extract(state, '$.info.name') AS name, json_extract(state, '$.info.startDate') AS start_date, " +
        "json_extract(settings, '$.startsAt') AS starts_at, json_extract(settings, '$.sanctioned') AS sanctioned, " +
        `${pairedRounds} AS rounds FROM tournaments INDEXED BY tournaments_of_store ` +
        "WHERE store_id = ? AND coalesce(json_extract(settings, '$.finished'), 0) = 0 ORDER BY created_at DESC LIMIT 50"
    )
    .bind(storeId)
    .all<StoreEventRow>();
  return results.map(row => ({
    code: row.code,
    name: row.name ?? row.code,
    startDate: row.start_date ?? '',
    startsAt: row.starts_at ?? '',
    sanctioned: row.mode === 'tom' || row.sanctioned !== 0,
    status: row.rounds > 0 ? 'live' : 'upcoming'
  }));
}

/** What anyone may read about a store. */
export function publicStore(store: Store, events: StoreEvent[]): PublicStore {
  const { id, leagueId, name, address, city, region, postal, country, lat, lon, timeZone } = store;
  const { website, discord, details, nights, exceptions } = store;
  return {
    id,
    leagueId,
    name,
    address,
    city,
    region,
    postal,
    country,
    lat,
    lon,
    timeZone,
    website,
    discord,
    details,
    nights,
    exceptions,
    events
  };
}
