/**
 * Shapes the City League source reads off Limitless and caches in R2. Every
 * cached object is what the parser produced, so a cache hit and a fresh fetch
 * build identical decks.
 */

/** One row of the `/tournaments/jp` listing. */
export interface ListingRow {
  /** Limitless's event id, as in `/tournaments/jp/{id}`. */
  id: string;
  /** Event day, `YYYY-MM-DD`, Japan time as Limitless lists it. */
  date: string;
  prefecture: string;
  shop: string;
}

export interface ListingPage {
  rows: ListingRow[];
  /** Last page number the pagination offers. */
  maxPage: number;
}

/** One finish on an event page. Only the top 16 are published. */
export interface EventPlacing {
  placing: number;
  player: string;
  /** Limitless's JP player id, from `/players/jp/{id}`. */
  playerId: string | null;
  /** Decklist id, as in `/decks/list/jp/{id}`. Several finishes can share one. */
  listId: string | null;
  /** Pokémon icon slugs Limitless shows for the deck, e.g. `kangaskhan-mega`. */
  icons: string[];
}

/** A parsed event page plus the listing facts its page leaves out. */
export interface CityLeagueEvent {
  id: string;
  /** Heading, e.g. "City League Kanagawa 10/27". */
  name: string;
  date: string;
  prefecture: string;
  shop: string;
  /** The Players Club result id the page links to. */
  officialId: string | null;
  placings: EventPlacing[];
}

/** One line of a decklist page, as Limitless prints it. */
export interface ListCard {
  count: number;
  name: string;
  /** Set code as Limitless spells it, `MEG` or `M6a`. */
  set: string;
  number: string;
  category: 'pokemon' | 'trainer' | 'energy';
  /**
   * The card has no English print yet: Limitless links it to its Japanese card
   * page and prints a provisional English name.
   */
  jp: boolean;
}

export interface CityLeagueList {
  id: string;
  cards: ListCard[];
}

/** A print on a Limitless card page's prints table. */
export interface PrintRef {
  set: string;
  number: string;
}

/** What a `/cards/jp/{set}/{number}` page says about the card's other prints. */
export interface JpCardPrints {
  /** English prints ("Int. Prints"), empty while the card is unreleased. */
  international: PrintRef[];
  /** Every Japanese print of the same card, this one included. */
  japanese: PrintRef[];
}

/** The English print a Japanese print now resolves to. */
export interface EnglishPrint {
  set: string;
  number: string;
  name: string;
}

export interface JpPrintRecord {
  /**
   * The lowest-numbered Japanese print of the same card in the same set. A
   * secret rare (`M6/96`) counts as its regular print (`M6/62`), so the two
   * never split one card's usage.
   */
  canonicalNumber: string;
  /**
   * Limitless's provisional English name, read off the card page. Lists cached
   * before a translation changes keep the old name, so every list takes the
   * name from here and one print never splits under two names.
   */
  name: string | null;
  /** Null while Limitless lists no English print. */
  en: EnglishPrint | null;
  /** Day the card page was last read, `YYYY-MM-DD`. */
  checkedAt: string;
}

/**
 * Japanese print → English print, keyed `{set}/{number}` in Limitless's own
 * spelling (`M6a/15`). Refreshed by the scraper and applied when decks are
 * built, so cached lists flip to the English card once it releases.
 */
export interface JpPrintMap {
  schemaVersion: 1;
  updatedAt: string;
  prints: Record<string, JpPrintRecord>;
}

/** JSON store the source caches into. Keys are R2 object keys. */
export interface CityLeagueStore {
  read<T>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
  list(prefix: string): Promise<string[]>;
}
