/**
 * Deck and filter domain types shared by the frontend, Pages Functions, and
 * pipeline code. Moved out of src/types so shared/ modules (and the Functions
 * that import them) never depend on frontend code; src/types re-exports these
 * for existing frontend imports.
 * @module shared/deckTypes
 */

/**
 * Card within a deck list.
 * Represents a single card entry with count information.
 */
export interface DeckCard {
  /** Card name */
  name?: string;
  /** Set code */
  set?: string;
  /** Collector number */
  number?: string | number;
  /** Number of copies in the deck */
  count?: number;
  /** Alternative field for number of copies */
  copies?: number;
  /** Card category */
  category?: string;
  /** Trainer subtype */
  trainerType?: string;
  /** Energy subtype */
  energyType?: string;
  /** Whether this is an Ace Spec card */
  aceSpec?: boolean;
  /** Pokemon TCG supertype */
  supertype?: string;
  /** Regulation mark (e.g., "G", "H", "I") for format legality */
  regulationMark?: string;
  /** Unique identifier */
  uid?: string;
}

/**
 * Complete deck representation from tournament data.
 * Contains player info, placement, and card list.
 */
export interface Deck {
  /** Unique deck identifier */
  id?: string;
  /** Alternative deck ID field */
  deckId?: string;
  /** Hash of deck contents for deduplication */
  deckHash?: string;
  /** URL-friendly slug */
  slug?: string;
  /** Archetype name (e.g., "Gholdengo", "Charizard ex") */
  archetype?: string;
  /** Archetype ID from source */
  archetypeId?: string | null;
  /** Cards in the deck (primary field) */
  cards?: DeckCard[];
  /** Cards in the deck (alternative field name) */
  deck?: DeckCard[];
  /** Success/placement tags (e.g., ["winner", "top8"]) */
  successTags?: string[];
  /** Tournament placement (1st, 2nd, etc.) */
  placement?: number | string;
  /** Alternative field for placement */
  placing?: number | string;
  /** Number of players in the tournament */
  tournamentPlayers?: number | string;
  /** Alternative field for player count */
  players?: number | string;
  /** Tournament identifier */
  tournamentId?: string;
  /** Tournament display name */
  tournamentName?: string;
  /** Tournament date */
  tournamentDate?: string;
  /** Tournament format (e.g., "STANDARD") */
  tournamentFormat?: string;
  /** Tournament platform */
  tournamentPlatform?: string;
  /** Tournament organizer */
  tournamentOrganizer?: string;
  /** Player name */
  player?: string;
  /** Player ID */
  playerId?: string | null;
  /** Player country code */
  country?: string | null;
  /** Source of deck data */
  deckSource?: string;
  /** Whether player reached phase 2/day 2 */
  madePhase2?: boolean;
  /** Whether player reached top cut */
  madeTopCut?: boolean;
}

/**
 * Comparison operators for quantity filtering.
 */
export type Operator = '=' | '<' | '<=' | '>' | '>=' | 'any' | '';

/**
 * Filter descriptor for card filtering.
 */
export interface Filter {
  /** Card identifier (SET~NUMBER format) */
  cardId: string;
  /** Comparison operator */
  operator?: Operator | null;
  /** Count threshold for comparison */
  count?: number | null;
}

/**
 * Request payload for server-side archetype filter reports.
 */
export interface ArchetypeFilterRequest {
  tournament: string;
  archetype: string;
  successFilter: string;
  filters: Filter[];
  slice?: 'all' | 'phase2' | 'topcut';
}
