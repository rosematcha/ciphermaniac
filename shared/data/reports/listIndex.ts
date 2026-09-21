/**
 * Compact index of every published list in a report — the artifact production
 * publishes as `lists.json` alongside `cardUsage.json`.
 *
 * Why it exists: the card page shows the actual lists that play a card, best
 * finish first, under each archetype. The raw deck bodies are far too large to
 * answer that from a browser — the online window's per-archetype shards come to
 * ~26 MB, and a major's `decks.json` to ~23 MB — and every deck repeats the
 * same card names, event names and tag strings. Dictionary-coding those three
 * brings the online window to ~1.2 MB (~150 KB compressed) in a single object,
 * so it costs one write per rebuild and serves any card and any filter.
 *
 * Schema (positional tuples; see the exported types for field order):
 *   `{ schemaVersion, tags, archetypes, events, cards, decks }`
 *
 * Semantics:
 * - Cards keep the printing the player registered, exactly as `decks.json`
 *   does. Readers resolve the (small) `cards` dictionary through the synonym
 *   database once, rather than this builder baking in a canonical that rolls.
 * - `archetypes` holds each deck's archetype label as the deck rows carry it;
 *   readers join to `archetypes/index.json` with the shared lowercasing
 *   normalizer, the same join `decks.json` consumers already make.
 * - Success tags are a bitmask over `tags`. They are not a strict hierarchy
 *   (`top16` and `top10` overlap either way round), so one "best tag" would
 *   lose information.
 * - Decks without a published list are skipped: there is nothing to show.
 *
 * IMPORTANT: This module is isomorphic — it works in both browser and
 * Node.js/Workers. Do not add any environment-specific dependencies here.
 * @module shared/data/reports/listIndex
 */

/** Schema version of the `lists.json` payload. */
export const LIST_INDEX_SCHEMA_VERSION = 1;

/** Success tags in bit order. Appending is compatible; reordering is not. */
export const LIST_INDEX_TAGS = ['winner', 'top2', 'top4', 'top8', 'top16', 'top10', 'top25', 'top50'] as const;

/** A deck card row consumed by {@link buildListIndex}. */
export interface ListIndexInputCard {
  name?: string;
  count?: number;
  set?: string | null;
  number?: string | number | null;
  category?: string;
}

/** A deck consumed by {@link buildListIndex}. */
export interface ListIndexInputDeck {
  player?: string | null;
  country?: string | null;
  placement?: number | null;
  archetype?: string | null;
  successTags?: readonly string[] | null;
  hasDecklist?: boolean;
  cards?: readonly ListIndexInputCard[] | null;
  tournamentId?: string | null;
  tournamentName?: string | null;
  tournamentDate?: string | null;
  tournamentPlayers?: number | null;
}

/** The event a deck was played at, for reports whose deck rows do not say. */
export interface ListIndexEventInput {
  id: string;
  name: string;
  /** ISO date or datetime; only the date part is kept. */
  date: string | null;
  players: number | null;
}

/** `[id, name, date (YYYY-MM-DD or ''), players (0 when unknown)]`. */
export type ListIndexEvent = [id: string, name: string, date: string, players: number];

/** `[name, set, number, category]`; set and number are '' for bare-name cards. */
export type ListIndexCard = [name: string, set: string, number: string, category: string];

/**
 * `[player, country, placement, archetype, event, tagBits, cards]` — archetype,
 * event and each even slot of `cards` index the matching dictionary; each odd
 * slot of `cards` is that card's count. Placement is 0 when unknown.
 */
export type ListIndexRow = [
  player: string,
  country: string,
  placement: number,
  archetype: number,
  event: number,
  tagBits: number,
  cards: number[]
];

/** The `lists.json` payload. */
export interface ListIndexPayload {
  schemaVersion: number;
  tags: string[];
  archetypes: string[];
  events: ListIndexEvent[];
  cards: ListIndexCard[];
  decks: ListIndexRow[];
}

/** Insertion-ordered dictionary: a key's index is its position in `values`. */
class Dictionary<T> {
  readonly values: T[] = [];
  private readonly indexByKey = new Map<string, number>();

  intern(key: string, make: () => T): number {
    const known = this.indexByKey.get(key);
    if (known !== undefined) {
      return known;
    }
    const index = this.values.length;
    this.indexByKey.set(key, index);
    this.values.push(make());
    return index;
  }
}

function tagBits(tags: readonly string[] | null | undefined): number {
  let bits = 0;
  for (const tag of tags ?? []) {
    const bit = LIST_INDEX_TAGS.indexOf(String(tag).toLowerCase() as (typeof LIST_INDEX_TAGS)[number]);
    if (bit >= 0) {
      bits |= 1 << bit;
    }
  }
  return bits;
}

function dateOnly(value: string | null | undefined): string {
  return (value ?? '').slice(0, 10);
}

function finite(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function deckEvent(deck: ListIndexInputDeck, fallback: ListIndexEventInput | null): ListIndexEventInput | null {
  if (deck.tournamentId) {
    return {
      id: deck.tournamentId,
      name: deck.tournamentName ?? '',
      date: deck.tournamentDate ?? null,
      players: deck.tournamentPlayers ?? null
    };
  }
  return fallback;
}

function encodeCards(cards: readonly ListIndexInputCard[], dictionary: Dictionary<ListIndexCard>): number[] {
  const pairs: number[] = [];
  for (const card of cards) {
    const name = card.name ?? '';
    const count = finite(card.count);
    if (!name || count === 0) {
      continue;
    }
    const set = card.set ?? '';
    const number = card.number === null || card.number === undefined ? '' : String(card.number);
    const index = dictionary.intern(`${name}\u0000${set}\u0000${number}`, () => [
      name,
      set,
      number,
      card.category ?? ''
    ]);
    pairs.push(index, count);
  }
  return pairs;
}

interface Dictionaries {
  archetypes: Dictionary<string>;
  events: Dictionary<ListIndexEvent>;
  cards: Dictionary<ListIndexCard>;
}

function internEvent(played: ListIndexEventInput | null, events: Dictionary<ListIndexEvent>): number {
  if (!played) {
    return -1;
  }
  return events.intern(played.id, () => [played.id, played.name, dateOnly(played.date), finite(played.players)]);
}

/** One deck's row, or null when it has no list to show. */
function encodeDeck(
  deck: ListIndexInputDeck,
  fallbackEvent: ListIndexEventInput | null,
  dictionaries: Dictionaries
): ListIndexRow | null {
  if (deck.hasDecklist === false) {
    return null;
  }
  const encoded = encodeCards(deck.cards ?? [], dictionaries.cards);
  if (encoded.length === 0) {
    return null;
  }
  const archetype = deck.archetype ?? '';
  return [
    deck.player ?? '',
    deck.country ?? '',
    finite(deck.placement),
    dictionaries.archetypes.intern(archetype, () => archetype),
    internEvent(deckEvent(deck, fallbackEvent), dictionaries.events),
    tagBits(deck.successTags),
    encoded
  ];
}

/**
 * Build the list index for one report.
 * @param decks - Every deck in the report, in any order
 * @param event - The event these decks belong to, for deck rows that carry no
 * tournament fields of their own (a single-event report). Online decks name
 * their own tournament and ignore it.
 * @returns The index, or `null` when no deck has a published list
 */
export function buildListIndex(
  decks: readonly ListIndexInputDeck[] | null | undefined,
  event: ListIndexEventInput | null = null
): ListIndexPayload | null {
  const dictionaries: Dictionaries = {
    archetypes: new Dictionary<string>(),
    events: new Dictionary<ListIndexEvent>(),
    cards: new Dictionary<ListIndexCard>()
  };
  const rows: ListIndexRow[] = [];
  for (const deck of decks ?? []) {
    const row = deck ? encodeDeck(deck, event, dictionaries) : null;
    if (row) {
      rows.push(row);
    }
  }
  if (rows.length === 0) {
    return null;
  }
  return {
    schemaVersion: LIST_INDEX_SCHEMA_VERSION,
    tags: [...LIST_INDEX_TAGS],
    archetypes: dictionaries.archetypes.values,
    events: dictionaries.events.values,
    cards: dictionaries.cards.values,
    decks: rows
  };
}
