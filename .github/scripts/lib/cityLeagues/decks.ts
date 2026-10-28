/**
 * City League placings → `GatheredDeck`, field for field the shape the online
 * producer builds (shared/onlineMeta/tournamentFetcher.ts `buildPendingDeck`),
 * so the same report code reads both.
 *
 * Field policy: an event page lists its top 16 and nothing else, not even the
 * player count. `tournamentPlayers` is the number of placings listed: 16 for a
 * full page, and the whole field for a smaller event that lists everyone.
 * Success tags are computed against that number. Placement tags (`winner`
 * through `top8`) are then exact, and the percentage tags are a lower bound:
 * the real field is at least as large, so every tag given is true, and some a
 * larger field would earn (top 10% of 64 players is places 1-7) go ungiven.
 * `top16` is never given, because it needs a field of 32 we cannot see.
 */
import { computeSuccessTags } from '../../../../shared/data/contracts';
import { isJapanOnlySet } from '../../../../shared/data/japanOnlyCards';
import { type CardTypesDatabase, enrichCardWithType } from '../../../../shared/data/cardTypesDatabase.js';
import { inferEnergyType, inferTrainerType, isAceSpecName } from '../../../../shared/analysis/cardTypeInference.js';
import type { CardEntry, GatheredDeck, OnlineTournamentSummary } from '../../../../shared/onlineMeta/types';
import { resolveJpCard } from './prints';
import type { CityLeagueEvent, CityLeagueList, EventPlacing, JpPrintMap, ListCard } from './types';

export const DECK_SOURCE = 'limitless-jp';
export const TOURNAMENT_FORMAT = 'STANDARD-JP';
const ARCHETYPE_SOURCE = 'limitless-icons';

/** Our tournament id for a Limitless City League event. */
export function tournamentIdOf(eventId: string): string {
  return `jp-${eventId}`;
}

/** Midnight UTC of the event day: the online producer reads dates as ISO instants. */
function eventInstant(date: string): string {
  return `${date}T00:00:00.000Z`;
}

export function toTournamentSummary(event: CityLeagueEvent): OnlineTournamentSummary {
  return {
    id: tournamentIdOf(event.id),
    name: event.name || `City League ${event.prefecture}`,
    date: eventInstant(event.date),
    format: TOURNAMENT_FORMAT,
    platform: null,
    game: 'PTCG',
    players: event.placings.length,
    organizer: event.shop || null,
    organizerId: null
  };
}

const REGIONAL_FORMS: Record<string, string> = {
  alola: 'Alolan',
  galar: 'Galarian',
  hisui: 'Hisuian',
  paldea: 'Paldean'
};

function titleCase(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

/**
 * A readable name for a Limitless sprite slug: `kangaskhan-mega` → "Mega
 * Kangaskhan", `zoroark-hisui` → "Hisuian Zoroark", `ogerpon-wellspring` →
 * "Ogerpon Wellspring".
 */
export function pokemonNameOf(slug: string): string {
  const [base = '', ...forms] = slug.split('-');
  const prefixes: string[] = [];
  const suffixes: string[] = [];
  for (const form of forms) {
    if (form === 'mega') {
      prefixes.push('Mega');
    } else if (REGIONAL_FORMS[form]) {
      prefixes.push(REGIONAL_FORMS[form]);
    } else {
      suffixes.push(titleCase(form));
    }
  }
  return [...prefixes, titleCase(base), ...suffixes].join(' ');
}

/**
 * Limitless labels City League decks only by their Pokémon icons, so the
 * archetype is named after them: `["kangaskhan-mega", "talonflame"]` →
 * "Mega Kangaskhan Talonflame".
 */
export function archetypeFromIcons(icons: string[]): { name: string; id: string | null } {
  if (!icons.length) {
    return { name: 'Unknown', id: null };
  }
  return { name: icons.map(pokemonNameOf).join(' '), id: icons.join(' ') };
}

function addInferredType(entry: CardEntry): void {
  if (entry.category === 'trainer') {
    const trainerType = inferTrainerType(entry.name);
    if (trainerType) {
      entry.trainerType = trainerType;
    }
  } else if (entry.category === 'energy') {
    const energyType = inferEnergyType(entry.name, entry.set);
    if (energyType) {
      entry.energyType = energyType;
    }
  }
}

/** Card types as the online producer adds them: the database first, then name heuristics. */
function withTypeHints(entry: CardEntry, cardTypesDb: CardTypesDatabase | null): CardEntry {
  // Japanese-only prints have no entry in the card types database.
  const enriched = cardTypesDb && !isJapanOnlySet(entry.set) ? enrichCardWithType(entry, cardTypesDb) : entry;
  if (!enriched.trainerType && !enriched.energyType) {
    addInferredType(enriched);
  }
  if (enriched.category === 'trainer' && !enriched.aceSpec && isAceSpecName(enriched.name)) {
    enriched.aceSpec = true;
  }
  return enriched;
}

function toCardEntry(card: ListCard, printMap: JpPrintMap, cardTypesDb: CardTypesDatabase | null): CardEntry {
  const identity = card.jp ? resolveJpCard(card, printMap) : card;
  return withTypeHints(
    { count: card.count, name: identity.name, set: identity.set, number: identity.number, category: card.category },
    cardTypesDb
  );
}

/**
 * The list's cards under the identities they are counted as. Two lines that
 * resolve to one card (a regular and a secret-rare print, or a Japanese print
 * and its new English print) become one line with the counts added.
 */
export function toCardEntries(
  list: CityLeagueList,
  printMap: JpPrintMap,
  cardTypesDb: CardTypesDatabase | null = null
): CardEntry[] {
  const merged = new Map<string, CardEntry>();
  for (const card of list.cards) {
    const entry = toCardEntry(card, printMap, cardTypesDb);
    const key = `${entry.set}::${entry.number}`;
    const existing = merged.get(key);
    if (existing) {
      existing.count += entry.count;
    } else {
      merged.set(key, entry);
    }
  }
  return [...merged.values()];
}

/** Same digest as the online producer's `hashDeck`, so equal lists share an id across sources. */
export async function hashDeck(cards: CardEntry[], fallbackKey = ''): Promise<string> {
  const canonical = cards
    .map(card => `${card.count}x${card.name || ''}::${card.set || ''}::${card.number || ''}`)
    .sort()
    .join('|');
  const source = canonical || fallbackKey || 'unknown-deck';
  const digest = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

interface DeckInput {
  event: CityLeagueEvent;
  placing: EventPlacing;
  list: CityLeagueList | null;
  printMap: JpPrintMap;
  cardTypesDb?: CardTypesDatabase | null;
}

/**
 * One placing as a deck.
 * @param input - The event, the placing, its list (null when none is posted) and the print map
 * @returns The deck, id included
 */
export async function buildDeck(input: DeckInput): Promise<GatheredDeck> {
  const { event, placing, list, printMap } = input;
  const cards = list ? toCardEntries(list, printMap, input.cardTypesDb ?? null) : [];
  const archetype = archetypeFromIcons(placing.icons);
  const tournament = toTournamentSummary(event);
  const fieldSize = event.placings.length;
  const fallbackKey = `${tournament.id}::${placing.playerId || placing.player}::${placing.placing}::${archetype.id || archetype.name}`;
  return {
    id: await hashDeck(cards, fallbackKey),
    player: placing.player,
    playerId: placing.playerId ? `jp:${placing.playerId}` : null,
    country: 'JP',
    placement: placing.placing,
    archetype: archetype.name,
    archetypeId: archetype.id,
    archetypeSource: ARCHETYPE_SOURCE,
    cards,
    hasDecklist: cards.length > 0,
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    tournamentDate: tournament.date,
    tournamentPlayers: fieldSize,
    tournamentFormat: tournament.format,
    tournamentPlatform: tournament.platform,
    tournamentOrganizer: tournament.organizer,
    deckSource: DECK_SOURCE,
    successTags: computeSuccessTags(placing.placing, fieldSize)
  };
}
