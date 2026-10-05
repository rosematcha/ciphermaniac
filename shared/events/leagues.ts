/**
 * Leagues, one entry per Play! Pokémon league ID: where the store is and the
 * events pokemon.com lists for it with a sanction ID. A store applying is
 * found by its league ID here, and a store starting a sanctioned event picks
 * it from its listings. Sharded by the league ID's last two digits, so a
 * lookup reads one small file; the sanctioned listing and the locals each
 * write their own shards, so an outage in one never blocks the other.
 *
 * Pure, like ./build: the producer fetches and writes.
 * @module shared/events/leagues
 */

import { pastCutoff } from './build';
import { normalizeEvent, type ZoneLookup } from './normalize';
import type { EventKind, LocatorEvent } from './types';

export const LEAGUES_ROOT = 'events/leagues/v1';

/** Which listing a shard comes from. */
export type LeagueSource = 'sanctioned' | 'locals';
export const LEAGUE_SOURCES: readonly LeagueSource[] = ['sanctioned', 'locals'];

/** One event pokemon.com lists for a league, as a store would run it. */
export interface LeagueListing {
  sanctionId: string;
  kind: EventKind;
  name: string;
  /** Venue-local YYYY-MM-DD. */
  date: string;
  /** Venue-local HH:MM, or '' when unlisted. */
  time: string;
}

export interface LeagueEntry {
  shop: string;
  address: string;
  city: string;
  region: string;
  cc: string;
  lat: number;
  lon: number;
  timeZone: string;
  /** Soonest first. */
  listings: LeagueListing[];
}

export interface LeagueShard {
  version: 1;
  leagues: Record<string, LeagueEntry>;
}

/** Each shard's content hash, so a run rewrites only the shards whose leagues changed. */
export interface LeaguesIndex {
  version: 1;
  updatedAt: string;
  shards: Record<string, string>;
}

const LEAGUE_RE = /^\d+$/;
const SANCTION_RE = /^\d{2}-\d{2}-\d{6}$/;
const SANCTION_IN_URL_RE = /\/(\d{2}-\d{2}-\d{6})\/?(?:[?#]|$)/;

/** The shard a league's entry lives in: the last two digits of its ID. */
export const leagueShardOf = (leagueId: string): string => leagueId.slice(-2).padStart(2, '0');

export const leagueShardPath = (source: LeagueSource, shard: string): string =>
  `${LEAGUES_ROOT}/${source}/${shard}.json`;

export const leaguesIndexPath = (source: LeagueSource): string => `${LEAGUES_ROOT}/${source}/index.json`;

/** Every shard name, 00 to 99, so a run writes each one and none is left stale. */
export const LEAGUE_SHARDS: readonly string[] = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'));

/** The sanction ID of a listing: its own ID, or the one in its pokemon.com address. */
function sanctionIdOf(event: LocatorEvent, raw: Record<string, unknown>): string {
  if (SANCTION_RE.test(event.id)) {
    return event.id;
  }
  const url = typeof raw.pokemon_url === 'string' ? raw.pokemon_url : '';
  return SANCTION_IN_URL_RE.exec(url)?.[1] ?? '';
}

function entryOf(event: LocatorEvent, zoneAt: ZoneLookup): LeagueEntry {
  return {
    shop: event.shop,
    address: event.address,
    city: event.city,
    region: event.region,
    cc: event.cc,
    lat: event.lat,
    lon: event.lon,
    timeZone: zoneAt(event.lat, event.lon),
    listings: []
  };
}

interface Found {
  leagueId: string;
  event: LocatorEvent;
  raw: Record<string, unknown>;
}

/** Each record that names a league and is not yet past, normalized. */
function leagueEvents(raw: readonly unknown[], zoneAt: ZoneLookup, cutoff: string): Found[] {
  return raw.flatMap(record => {
    const fields = (record && typeof record === 'object' ? record : {}) as Record<string, unknown>;
    const league = typeof fields.league === 'number' ? String(fields.league) : String(fields.league ?? '').trim();
    const result = normalizeEvent(fields, zoneAt);
    return LEAGUE_RE.test(league) && result.ok && result.event.date >= cutoff
      ? [{ leagueId: league, event: result.event, raw: fields }]
      : [];
  });
}

/**
 * The shards for one listing's records. Every shard comes back, empty ones
 * too, so a league that stops listing is gone from its shard the next run.
 */
export function buildLeagueShards(
  raw: readonly unknown[],
  options: { now: Date; zoneAt: ZoneLookup }
): Map<string, LeagueShard> {
  const leagues = new Map<string, LeagueEntry>();
  const seen = new Set<string>();
  for (const { leagueId, event, raw: fields } of leagueEvents(raw, options.zoneAt, pastCutoff(options.now))) {
    const entry = leagues.get(leagueId) ?? entryOf(event, options.zoneAt);
    leagues.set(leagueId, entry);
    const sanctionId = sanctionIdOf(event, fields);
    if (sanctionId && !seen.has(sanctionId)) {
      seen.add(sanctionId);
      entry.listings.push({ sanctionId, kind: event.kind, name: event.name, date: event.date, time: event.time });
    }
  }
  const shards = new Map<string, LeagueShard>(LEAGUE_SHARDS.map(shard => [shard, { version: 1, leagues: {} }]));
  for (const [leagueId, entry] of leagues) {
    entry.listings.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    const shard = shards.get(leagueShardOf(leagueId));
    if (shard) {
      shard.leagues[leagueId] = entry;
    }
  }
  return shards;
}
