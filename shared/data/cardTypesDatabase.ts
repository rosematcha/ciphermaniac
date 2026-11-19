/**
 * Card types database utilities for server-side (Cloudflare Workers)
 * @module lib/cardTypesDatabase
 */

import { canonicalizeVariant } from './cardIdentity';

interface WorkerEnv {
  /** Only `get` is needed here; accepts an R2 bucket or any structural equivalent (e.g. the CI S3 shim). */
  REPORTS?: { get(key: string): Promise<{ text(): Promise<string> } | null> };
}

interface CardTypeInfo {
  /** Internal parser schema marker used to backfill newly introduced metadata once. */
  metadataVersion?: number;
  cardType?: string;
  subType?: string;
  fullType?: string;
  evolutionInfo?: string;
  /** Structured evolution stage (`basic`, `stage1`, `stage2`, `vstar`, ...). */
  stage?: string;
  regulationMark?: string;
  aceSpec?: boolean;
  abilities?: string[];
  attacks?: string[];
  /* Enrichment fields emitted by scripts/build-card-types.mjs (July 2026+).
     Older database entries predate them, so every field stays optional. */
  hp?: number;
  pokemonType?: string;
  weakness?: string;
  resistance?: string;
  retreatCost?: number;
  rarity?: string;
  artist?: string;
  text?: string;
  abilityDetails?: { name: string; effect: string | null }[];
  attackDetails?: { cost: string | null; name: string; damage: string | null; effect: string | null }[];
  legality?: Record<string, string>;
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
// Bounded by a 24h TTL so a long-lived warm isolate
// doesn't serve stale card types indefinitely after an R2 update.
const CARD_TYPES_CACHE_TTL_MS = 86400 * 1000;
let cachedCardTypesData: CardTypesDatabase | null = null;
let cachedAt = 0;

export async function loadCardTypesDatabase(env: WorkerEnv): Promise<CardTypesDatabase> {
  if (cachedCardTypesData && Date.now() - cachedAt < CARD_TYPES_CACHE_TTL_MS) {
    return cachedCardTypesData;
  }
  try {
    if (env.REPORTS) {
      const object = await env.REPORTS.get('assets/data/card-types.json');
      if (object) {
        const text = await object.text();
        const data = JSON.parse(text) as CardTypesDatabase;
        cachedCardTypesData = data;
        cachedAt = Date.now();
        return data;
      }
    }

    console.warn('Card types database not found');
    return {};
  } catch (error: unknown) {
    console.error('Failed to load card types database:', error instanceof Error ? error.message : String(error));
    return {};
  }
}

/** Report fields the database fills when a card doesn't carry them already. */
type FillableField = 'category' | 'trainerType' | 'energyType' | 'evolutionInfo' | 'fullType';

function fillableFields(info: CardTypeInfo): [FillableField, string | undefined][] {
  return [
    ['category', info.cardType],
    ['trainerType', info.cardType === 'trainer' ? info.subType : undefined],
    ['energyType', info.cardType === 'energy' ? info.subType : undefined],
    ['evolutionInfo', info.cardType === 'pokemon' ? info.evolutionInfo : undefined],
    ['fullType', info.fullType]
  ];
}

/**
 * The database key for a card. Keys use an upper-case set and a padded number
 * (`SFA::057`) while Limitless decklists don't pad (`57`), so both are
 * normalized first.
 */
function databaseKey(card: CardRecord | null | undefined): string | null {
  const [set, number] = canonicalizeVariant(card?.set, card?.number);
  return set && number ? `${set}::${number}` : null;
}

export function enrichCardWithType<T extends CardRecord>(card: T, database: CardTypesDatabase): T {
  const key = databaseKey(card);
  if (!key) {
    return card;
  }

  const enriched: T = { ...card };
  const typeInfo = database[key];
  if (!typeInfo) {
    return enriched;
  }

  for (const [field, value] of fillableFields(typeInfo)) {
    if (value && !enriched[field]) {
      (enriched as CardRecord)[field] = value;
    }
  }

  if (typeInfo.regulationMark) {
    enriched.regulationMark = typeInfo.regulationMark;
  }

  // No card-type gate: special-energy ACE SPECs (Legacy Energy, Neo Upper
  // Energy, Enriching Energy) are flagged too.
  if (typeInfo.aceSpec) {
    enriched.aceSpec = true;
  }

  return enriched;
}
