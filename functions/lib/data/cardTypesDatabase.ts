/**
 * Card types database utilities for server-side (Cloudflare Workers)
 * @module lib/cardTypesDatabase
 */

interface WorkerEnv {
  CARD_TYPES_KV?: KVNamespace;
  /** Only `get` is needed here; accepts an R2 bucket or any structural equivalent (e.g. the CI S3 shim). */
  REPORTS?: { get(key: string): Promise<{ text(): Promise<string> } | null> };
}

interface CardTypeInfo {
  cardType?: string;
  subType?: string;
  fullType?: string;
  evolutionInfo?: string;
  regulationMark?: string;
  aceSpec?: boolean;
  abilities?: string[];
  attacks?: string[];
  lastUpdated?: string;
}

export type CardTypesDatabase = Record<string, CardTypeInfo>;

interface CardRecord {
  name?: string;
  set?: string | null;
  number?: string | number | null;
  count?: number;
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  regulationMark?: string;
  evolutionInfo?: string;
  fullType?: string;
}

// Module-level cache: persists across requests within the same isolate,
// avoiding re-fetch and re-parse of the card types JSON on every request.
// Bounded by the same 24h TTL the KV layer uses so a long-lived warm isolate
// doesn't serve stale card types indefinitely after an R2 update.
const CARD_TYPES_CACHE_TTL_MS = 86400 * 1000;
let cachedCardTypesData: CardTypesDatabase | null = null;
let cachedAt = 0;

export async function loadCardTypesDatabase(env: WorkerEnv): Promise<CardTypesDatabase> {
  if (cachedCardTypesData && Date.now() - cachedAt < CARD_TYPES_CACHE_TTL_MS) {
    return cachedCardTypesData;
  }
  try {
    if (env.CARD_TYPES_KV) {
      const cached = await env.CARD_TYPES_KV.get('card-types-database', 'json');
      if (cached) {
        cachedCardTypesData = cached as CardTypesDatabase;
        cachedAt = Date.now();
        return cachedCardTypesData;
      }
    }

    if (env.REPORTS) {
      const object = await env.REPORTS.get('assets/data/card-types.json');
      if (object) {
        const text = await object.text();
        const data = JSON.parse(text) as CardTypesDatabase;

        if (env.CARD_TYPES_KV) {
          await env.CARD_TYPES_KV.put('card-types-database', JSON.stringify(data), {
            expirationTtl: 86400
          });
        }

        cachedCardTypesData = data;
        cachedAt = Date.now();
        return data;
      }
    }

    console.warn('Card types database not found');
    return {};
  } catch (error: any) {
    console.error('Failed to load card types database:', error.message);
    return {};
  }
}

export function enrichCardWithType<T extends CardRecord>(card: T, database: CardTypesDatabase): T {
  if (!card) {
    return card;
  }

  const key = card?.set && card?.number ? `${card.set}::${card.number}` : null;

  if (!key) {
    return card;
  }

  const enriched = { ...card };
  const typeInfo = database[key];

  if (!typeInfo) {
    return enriched as T;
  }

  if (typeInfo.cardType && !enriched.category) {
    enriched.category = typeInfo.cardType;
  }

  if (typeInfo.cardType === 'trainer' && typeInfo.subType && !enriched.trainerType) {
    enriched.trainerType = typeInfo.subType;
  }

  if (typeInfo.cardType === 'energy' && typeInfo.subType && !enriched.energyType) {
    enriched.energyType = typeInfo.subType;
  }

  if (typeInfo.cardType === 'pokemon' && typeInfo.evolutionInfo && !enriched.evolutionInfo) {
    enriched.evolutionInfo = typeInfo.evolutionInfo;
  }

  if (typeInfo.fullType && !enriched.fullType) {
    enriched.fullType = typeInfo.fullType;
  }

  if (typeInfo.regulationMark) {
    enriched.regulationMark = typeInfo.regulationMark;
  }

  if (typeInfo.cardType === 'trainer' && typeInfo.aceSpec) {
    enriched.aceSpec = true;
  }

  return enriched as T;
}
