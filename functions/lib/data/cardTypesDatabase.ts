/**
 * Card types database utilities for server-side (Cloudflare Workers)
 * @module lib/cardTypesDatabase
 */

interface WorkerEnv {
  CARD_TYPES_KV?: KVNamespace;
  REPORTS?: R2Bucket;
}

interface CardTypeInfo {
  cardType?: string;
  subType?: string;
  fullType?: string;
  evolutionInfo?: string;
  regulationMark?: string;
  aceSpec?: boolean;
  lastUpdated?: string;
}

export type CardTypesDatabase = Record<string, CardTypeInfo>;

interface CardRecord {
  name?: string;
  set?: string;
  number?: string | number;
  count?: number;
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  regulationMark?: string;
  evolutionInfo?: string;
  fullType?: string;
  [key: string]: unknown;
}

interface DeckRecord {
  cards?: CardRecord[];
  [key: string]: unknown;
}

// Module-level cache: persists across requests within the same isolate,
// avoiding re-fetch and re-parse of the card types JSON on every request.
let cachedCardTypesData: CardTypesDatabase | null = null;

export async function loadCardTypesDatabase(env: WorkerEnv): Promise<CardTypesDatabase> {
  if (cachedCardTypesData) {
    return cachedCardTypesData;
  }
  try {
    if (env.CARD_TYPES_KV) {
      const cached = await env.CARD_TYPES_KV.get('card-types-database', 'json');
      if (cached) {
        cachedCardTypesData = cached as CardTypesDatabase;
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

export function enrichCardWithType(card: CardRecord, database: CardTypesDatabase): CardRecord {
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
    return enriched;
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

  return enriched;
}

function enrichDeckCards(deck: DeckRecord, database: CardTypesDatabase): DeckRecord {
  if (!deck || !Array.isArray(deck.cards) || !database) {
    return deck;
  }

  return {
    ...deck,
    cards: deck.cards.map(card => enrichCardWithType(card, database))
  };
}

export function enrichAllDecks(decks: DeckRecord[], database: CardTypesDatabase): DeckRecord[] {
  if (!Array.isArray(decks) || !database) {
    return decks;
  }

  return decks.map(deck => enrichDeckCards(deck, database));
}
