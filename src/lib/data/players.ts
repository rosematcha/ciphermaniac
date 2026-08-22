/**
 * Cross-tournament player profiles.
 *
 * These bodies are the last scope still served from legacy paths rather than
 * the immutable release (DB-MASTER-PLAN Phase 4 follow-up: ~89k objects), so a
 * 404 here is a normal miss, not release-body corruption.
 * @module src/lib/data/players
 */

import { dataClient } from './client';
import { decodeSlimIndex } from '../../../shared/playerTypes.js';
import type { PlayerDecks, PlayerIndexEntry, PlayerIndexSlimEntry, PlayerProfile } from '../../types';

const { fetchJsonOptional } = dataClient;

// In dev, serve from the local public/ tree (populated by
// `npx tsx scripts/build-players-local.ts`) so we don't need a deploy.
async function fetchPlayerJson<T>(path: string): Promise<T | null> {
  if (import.meta.env.DEV) {
    const res = await fetch(path);
    // Vite's SPA fallback answers missing files with index.html and a 200, so
    // a genuinely absent player file never 404s in dev. A local miss doesn't
    // mean the player is absent upstream, though — build-players-local seeds
    // are usually partial — so fall through to public R2 before giving up.
    if (res.status === 404 || (res.headers.get('content-type') ?? '').includes('text/html')) {
      return fetchJsonOptional<T>(path);
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch ${path}: ${res.status}`);
    }
    return (await res.json()) as T;
  }
  return fetchJsonOptional<T>(path);
}

/**
 * Slim index (players table + compare autocomplete). `decodeSlimIndex` accepts
 * both wire shapes — the columnar payload the aggregator writes now and the
 * legacy row array — so the frontend keeps working on either side of the
 * aggregator deploy. Falls back to the full index when `index-slim.json` is
 * missing or unrecognizable (full entries are a superset of the slim shape).
 */
export async function fetchPlayerIndexSlim(): Promise<PlayerIndexSlimEntry[] | null> {
  const slim = decodeSlimIndex(await fetchPlayerJson<unknown>('/players/index-slim.json'));
  if (slim) {
    return slim;
  }
  return fetchPlayerJson<PlayerIndexEntry[]>('/players/index.json');
}

export function fetchPlayerProfile(playerId: string): Promise<PlayerProfile | null> {
  return fetchPlayerJson<PlayerProfile>(`/players/${encodeURIComponent(playerId)}/profile.json`);
}

/**
 * Lazy-fetch decklists for a player. The profile page only requests this when
 * a tournament row is expanded, so most profile views never download it.
 */
export function fetchPlayerDecks(playerId: string): Promise<PlayerDecks | null> {
  return fetchPlayerJson<PlayerDecks>(`/players/${encodeURIComponent(playerId)}/decks.json`);
}
