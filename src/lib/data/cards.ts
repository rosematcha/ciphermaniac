/**
 * Per-card usage across archetypes, and cluster-aware lookup.
 *
 * Every join here resolves through the synonym map to the GLOBAL cluster
 * identity before comparing. A rebaked historical event keys its rows by that
 * event's rolling canonical print (D17), which is a different UID from today's
 * global canonical for the same card — so a direct UID match would silently
 * find nothing on exactly the events that have been reprocessed.
 * @module src/lib/data/cards
 */

import { dataClient } from './client';
import { tournamentPath } from './paths';
import { getCanonicalCardFromData, type SynonymDatabase } from '../../../shared/synonyms.js';
import { itemUid } from './compat';
import { normalizeCardNumberKey } from './routes';
import type { CardDistributionEntry, CardItem } from '../../types';

const { fetchJsonOptional } = dataClient;

export interface CardUsageEntry {
  /** Archetype slug — joins to archetypes/index.json `name` for label/icons/deckCount. */
  slug: string;
  found: number;
  pct: number;
  dist: CardDistributionEntry[];
}

/**
 * Build-time inverted index (`cardUsage.json`): canonical card UID → every
 * archetype that plays it. Lets CardPage load one small file instead of fanning
 * a fetch out to every archetype's cards.json. Absent for tournaments/snapshots
 * generated before the file existed — callers fall back to the per-archetype
 * fan-out.
 */
export interface CardUsagePayload {
  usage: Record<string, CardUsageEntry[]>;
  /** Set on rebaked events; usage keys are then rolling-canonical UIDs. */
  canonicalizedAt?: string;
}

export function fetchCardUsage(tournament: string): Promise<CardUsagePayload | null> {
  return fetchJsonOptional<CardUsagePayload>(`${tournamentPath(tournament)}/cardUsage.json`);
}

/**
 * Per payload: global-canonical UID → usage entries. Both the payload keys
 * (rolling-canonical on a rebaked event) and the lookup card are resolved
 * through the synonym DB to the stable global cluster identity, so a
 * rolling-keyed entry is found from a global-canonical card and vice versa.
 * Built once per payload (usage is this page's largest join surface).
 */
const usageGlobalIndexCache = new WeakMap<CardUsagePayload, Map<string, CardUsageEntry[]>>();

function usageGlobalIndex(payload: CardUsagePayload, db: SynonymDatabase): Map<string, CardUsageEntry[]> {
  const cached = usageGlobalIndexCache.get(payload);
  if (cached) {
    return cached;
  }
  const map = new Map<string, CardUsageEntry[]>();
  for (const [uid, entries] of Object.entries(payload.usage)) {
    const global = getCanonicalCardFromData(db, uid);
    if (!map.has(global)) {
      map.set(global, entries);
    }
  }
  usageGlobalIndexCache.set(payload, map);
  return map;
}

/**
 * Look up a card's per-archetype usage in a `cardUsage.json` payload. Tries the
 * card's UID directly, then resolves both the card and the payload keys to their
 * global cluster identity (so a rolling-uid card matches a global-keyed payload
 * and a global-uid card matches a rolling-keyed one), then a set+number
 * normalized scan. Returns null if the card isn't in the index.
 */
export function cardUsageForCard(
  payload: CardUsagePayload,
  card: CardItem,
  db: SynonymDatabase | null
): CardUsageEntry[] | null {
  const direct = payload.usage[itemUid(card)];
  if (direct) {
    return direct;
  }
  if (db) {
    const byGlobal = usageGlobalIndex(payload, db).get(getCanonicalCardFromData(db, itemUid(card)));
    if (byGlobal) {
      return byGlobal;
    }
  }
  if (card.set && card.number != null) {
    const setU = card.set.toUpperCase();
    const numKey = normalizeCardNumberKey(String(card.number));
    for (const [uid, entries] of Object.entries(payload.usage)) {
      const parts = uid.split('::');
      if (parts.length >= 3 && parts[1].toUpperCase() === setU && normalizeCardNumberKey(parts[2]) === numKey) {
        return entries;
      }
    }
  }
  return null;
}

/**
 * Find the entry whose UID identifies the same synonym cluster as `targetUid`.
 * Tries a direct UID match first, then resolves both the target and each entry's
 * UID to their global cluster identity — so a rolling-canonical key matches a
 * global-canonical target and vice versa. Returns undefined when neither the DB
 * nor a direct hit resolves it.
 */
export function findByClusterUid<T extends { uid: string }>(
  items: T[],
  targetUid: string,
  db: SynonymDatabase | null
): T | undefined {
  const direct = items.find(item => item.uid === targetUid);
  if (direct) {
    return direct;
  }
  if (!db) {
    return undefined;
  }
  const targetGlobal = getCanonicalCardFromData(db, targetUid);
  return items.find(item => getCanonicalCardFromData(db, item.uid) === targetGlobal);
}
